use super::*;
use crate::plugins::test_support::Scratch;
use std::io::{BufRead, BufReader};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const CHILD_ADDRESS: &str = "CCGUI_STORAGE_TEST_ADDRESS";
const TEST_NAME: &str = "plugins::storage::process_tests::independent_processes_enforce_cas";
const PLUGIN: &str = "cas.test";

#[derive(Serialize, Deserialize)]
struct Request {
    state: PathBuf,
    data: PathBuf,
    program: PathBuf,
    expected: Option<String>,
    content: String,
    remove: bool,
}

struct Worker(Child, BufReader<TcpStream>);

impl Drop for Worker {
    fn drop(&mut self) {
        // Only this test's freshly spawned child can be terminated here.
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

impl Worker {
    fn start(request: Request) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", TEST_NAME, "--nocapture"])
            .env(CHILD_ADDRESS, listener.local_addr().unwrap().to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let stream = loop {
            match listener.accept() {
                Ok((stream, _)) => {
                    stream.set_nonblocking(false).unwrap();
                    break stream;
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    if let Some(status) = child.try_wait().unwrap() {
                        panic!("storage worker exited before connecting: {status}");
                    }
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        panic!("storage worker did not connect");
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    panic!("accept storage worker: {error}");
                }
            }
        };
        stream.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
        stream.set_write_timeout(Some(Duration::from_secs(30))).unwrap();
        let mut worker = Self(child, BufReader::new(stream));
        serde_json::to_writer(worker.1.get_mut(), &request).unwrap();
        worker.1.get_mut().write_all(b"\n").unwrap();
        assert_eq!(worker.line(), "ready\n");
        worker
    }

    fn line(&mut self) -> String {
        let mut line = String::new();
        assert_ne!(self.1.read_line(&mut line).unwrap(), 0, "worker disconnected");
        line
    }

    fn release(&mut self) {
        self.1.get_mut().write_all(b"go\n").unwrap();
    }

    fn result(&mut self) -> serde_json::Value {
        let result = serde_json::from_str(&self.line()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                assert!(status.success(), "storage worker failed: {status}");
                return result;
            }
            assert!(Instant::now() < deadline, "storage worker did not exit");
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

fn child_request() -> bool {
    let Ok(address) = std::env::var(CHILD_ADDRESS) else { return false };
    let mut stream = BufReader::new(TcpStream::connect(address).unwrap());
    stream.get_ref().set_read_timeout(Some(Duration::from_secs(30))).unwrap();
    let mut line = String::new();
    stream.read_line(&mut line).unwrap();
    let request: Request = serde_json::from_str(&line).unwrap();
    stream.get_mut().write_all(b"ready\n").unwrap();
    line.clear();
    stream.read_line(&mut line).unwrap();
    assert_eq!(line, "go\n");
    let roots = StorageRoots { data: request.data, program: request.program };
    let result = if request.remove {
        serde_json::to_value(remove_with_version_at(
            &request.state, &roots, PLUGIN, "doc", request.expected.as_deref(),
        ).unwrap()).unwrap()
    } else {
        serde_json::to_value(write_text_at(
            &request.state, &roots, PLUGIN, "doc", &request.content, request.expected,
        ).unwrap()).unwrap()
    };
    serde_json::to_writer(stream.get_mut(), &result).unwrap();
    stream.get_mut().write_all(b"\n").unwrap();
    true
}

fn initialize_state(path: &Path) {
    let mut state = super::super::state::PluginsState::default();
    let mut record = super::super::state::PluginRecord::fresh("test", 1);
    record.permissions = vec!["plugin.storage".into()];
    state.plugins.insert(PLUGIN.into(), record);
    super::super::state::write_state(path, &state).unwrap();
}

#[test]
fn independent_processes_enforce_cas() {
    if child_request() { return; }
    // Separate configuration files must still coordinate on one physical root.
    // The absent-document case also protects expectedVersion=null creation.
    for (separate_state, create, remove) in [(false, false, false), (true, false, false), (true, true, false), (true, false, true)] {
        let scratch = Scratch::new();
        let first_state = scratch.path("one/plugins.json");
        let second_state = if separate_state { scratch.path("two/plugins.json") } else { first_state.clone() };
        initialize_state(&first_state);
        if separate_state { initialize_state(&second_state); }
        let roots = StorageRoots { data: scratch.path("data"), program: scratch.path("program") };
        let expected = if create {
            None
        } else {
            let written = write_text_at(&first_state, &roots, PLUGIN, "doc", "base", None).unwrap();
            let WriteResult::Written { version } = written else { panic!("initial write conflicted") };
            Some(version)
        };
        let request = |state, content, remove| Request {
            state, data: roots.data.clone(), program: roots.program.clone(),
            expected: expected.clone(), content, remove,
        };
        // A substantive payload widens the old unprotected check→replace window.
        let a_content = "a".repeat(128 * 1024);
        let b_content = "b".repeat(128 * 1024);
        let mut a = Worker::start(request(first_state.clone(), a_content.clone(), false));
        let mut b = Worker::start(request(second_state, b_content.clone(), remove));
        a.release();
        b.release();
        let results = [a.result(), b.result()];
        assert_eq!(results.iter().filter(|r| r["status"] == "conflict").count(), 1, "{results:?}");
        let winner = results.iter().position(|r| r["status"] != "conflict").unwrap();
        let stored = read_text_at(&first_state, &roots, PLUGIN, "doc").unwrap();
        if results[winner]["status"] == "removed" {
            assert!(stored.is_none());
            assert!(!plugin_root(&roots.data, PLUGIN).join("doc.bak").exists());
        } else {
            let stored = stored.unwrap();
            assert_eq!(stored.content, if winner == 0 { a_content } else { b_content });
            assert_eq!(stored.version, results[winner]["version"].as_str().unwrap());
            if !create {
                assert_eq!(fs::read_to_string(plugin_root(&roots.data, PLUGIN).join("doc.bak")).unwrap(), "base");
            }
        }
    }
}
