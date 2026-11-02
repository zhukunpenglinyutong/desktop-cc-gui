use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

const SAMPLING_INTERVAL: Duration = Duration::from_secs(5);
const RETENTION: Duration = Duration::from_secs(300);
const SAMPLE_CAPACITY: usize = 60;
const PROCESS_LIMIT: usize = 32;

pub struct MetricsState {
    cache: Arc<Mutex<Cache>>,
    lifecycle: Mutex<Lifecycle>,
    transition: Mutex<()>,
    preference_path: Option<PathBuf>,
}

#[derive(Deserialize, Serialize)]
struct DiagnosticsPreference {
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMetrics {
    pub memory_bytes: u64,
    pub cpu_percent: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Role {
    Main,
    Child,
    WebkitGpuCandidate,
    WebkitContentCandidate,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum Attribution {
    Main,
    AppDescendant,
    UnattributedCandidate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
enum CpuStatus {
    Baseline,
    Available,
    Unavailable,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSample {
    pid: u32,
    role: Role,
    attribution: Attribution,
    memory_bytes: Option<u64>,
    cpu_percent: Option<f32>,
    cpu_status: CpuStatus,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Sample {
    timestamp_ms: u64,
    sample_duration_ms: u64,
    logical_cpu_count: Option<usize>,
    system_cpu_percent: Option<f32>,
    system_memory_total_bytes: Option<u64>,
    system_memory_available_bytes: Option<u64>,
    swap_used_bytes: Option<u64>,
    status: &'static str,
    error: Option<&'static str>,
    main_memory_bytes: Option<u64>,
    main_cpu_percent: Option<f32>,
    processes: Vec<ProcessSample>,
    omitted_app_process_count: usize,
    omitted_candidate_process_count: usize,
}

impl Sample {
    fn unavailable(error: &'static str) -> Self {
        Self {
            timestamp_ms: timestamp_ms(),
            sample_duration_ms: 0,
            logical_cpu_count: None,
            system_cpu_percent: None,
            system_memory_total_bytes: None,
            system_memory_available_bytes: None,
            swap_used_bytes: None,
            status: "unavailable",
            error: Some(error),
            main_memory_bytes: None,
            main_cpu_percent: None,
            processes: Vec::new(),
            omitted_app_process_count: 0,
            omitted_candidate_process_count: 0,
        }
    }

    fn record_system_memory(
        &mut self,
        total: u64,
        available: u64,
        used: u64,
        swap_total: u64,
        swap_used: u64,
    ) {
        self.system_memory_total_bytes = (total > 0).then_some(total);
        self.system_memory_available_bytes =
            (total > 0 && (available > 0 || used > 0) && available <= total).then_some(available);
        self.swap_used_bytes = (swap_total > 0 && swap_used <= swap_total).then_some(swap_used);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceDiagnostics {
    schema_version: u32,
    enabled: bool,
    os: &'static str,
    arch: &'static str,
    logical_cpu_count: Option<usize>,
    session_started_at_ms: u64,
    generated_at_ms: u64,
    sampling_interval_ms: u64,
    retention_ms: u64,
    sample_capacity: usize,
    process_limit: usize,
    persistence: &'static str,
    status: &'static str,
    limitations: Vec<&'static str>,
    samples: Vec<Sample>,
}

struct Cache {
    enabled: bool,
    session_started_at_ms: u64,
    status: &'static str,
    samples: VecDeque<(Instant, Sample)>,
}

impl Cache {
    fn new() -> Self {
        Self {
            enabled: true,
            session_started_at_ms: timestamp_ms(),
            status: "starting",
            samples: VecDeque::with_capacity(SAMPLE_CAPACITY),
        }
    }

    fn push(&mut self, now: Instant, sample: Sample) {
        while self
            .samples
            .front()
            .is_some_and(|(time, _)| now.saturating_duration_since(*time) >= RETENTION)
            || self.samples.len() >= SAMPLE_CAPACITY
        {
            self.samples.pop_front();
        }
        self.status = if sample.status == "unavailable" {
            "unavailable"
        } else {
            "running"
        };
        self.samples.push_back((now, sample));
    }

    fn status(&self) -> &'static str {
        if self.status != "stopped"
            && self
                .samples
                .back()
                .is_some_and(|(time, _)| time.elapsed() > SAMPLING_INTERVAL * 3)
        {
            "stale"
        } else {
            self.status
        }
    }
}

#[derive(Default)]
struct Lifecycle {
    started: bool,
    stopped: bool,
    worker: Option<(mpsc::Sender<()>, JoinHandle<()>)>,
}

impl MetricsState {
    pub fn load() -> Result<Self, String> {
        Self::load_from(crate::paths::app_home().join("performance-diagnostics.json"))
    }

    fn load_from(path: PathBuf) -> Result<Self, String> {
        let preference = match std::fs::read_to_string(&path) {
            Ok(content) => serde_json::from_str::<DiagnosticsPreference>(&content)
                .map(|preference| preference.enabled)
                .map_err(|error| format!("parse diagnostics preference: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
            Err(error) => Err(format!("read diagnostics preference: {error}")),
        };
        let enabled = match preference {
            Ok(enabled) => enabled,
            Err(error) => {
                eprintln!("[metrics] {error}; diagnostics disabled");
                false
            }
        };
        let mut state = Self::empty();
        state.preference_path = Some(path);
        {
            let mut cache = state
                .cache
                .lock()
                .map_err(|_| "metrics cache unavailable")?;
            cache.enabled = enabled;
            cache.status = if enabled { "starting" } else { "disabled" };
        }
        if enabled {
            let _ = state.start_collector();
        }
        Ok(state)
    }

    pub fn new() -> Self {
        let state = Self::empty();
        let _ = state.start_collector();
        state
    }

    fn empty() -> Self {
        Self {
            cache: Arc::new(Mutex::new(Cache::new())),
            lifecycle: Mutex::new(Lifecycle::default()),
            transition: Mutex::new(()),
            preference_path: None,
        }
    }

    fn start_collector(&self) -> Result<bool, String> {
        let mut collector = Collector::new();
        self.start_sampler(SAMPLING_INTERVAL, move || collector.sample())
    }

    fn enabled(&self) -> Result<bool, String> {
        Ok(self
            .cache
            .lock()
            .map_err(|_| "metrics cache unavailable")?
            .enabled)
    }

    fn set_enabled(&self, enabled: bool, notify: impl FnOnce(bool)) -> Result<bool, String> {
        self.set_enabled_with_sampler(enabled, notify, Self::start_collector)
    }

    fn set_enabled_with_sampler(
        &self,
        enabled: bool,
        notify: impl FnOnce(bool),
        start: impl FnOnce(&Self) -> Result<bool, String>,
    ) -> Result<bool, String> {
        let _transition = self
            .transition
            .lock()
            .map_err(|_| "metrics transition unavailable")?;
        if self
            .lifecycle
            .lock()
            .map_err(|_| "metrics lifecycle unavailable")?
            .stopped
        {
            return Err("metrics sampler is stopped".into());
        }
        if let Some(path) = &self.preference_path {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|error| format!("create diagnostics preference directory: {error}"))?;
            }
            let content = serde_json::to_string(&DiagnosticsPreference { enabled })
                .map_err(|error| error.to_string())?;
            crate::settings::atomic_write(path, &content)?;
        }
        if self.enabled()? != enabled {
            self.stop_worker(false);
            {
                let mut cache = self.cache.lock().map_err(|_| "metrics cache unavailable")?;
                cache.samples.clear();
                cache.enabled = enabled;
                cache.status = if enabled { "starting" } else { "disabled" };
            }
            if enabled && start(self).is_err() {
                let mut cache = self.cache.lock().map_err(|_| "metrics cache unavailable")?;
                cache.samples.clear();
                cache.push(Instant::now(), Sample::unavailable("samplerStartFailed"));
            }
        }
        notify(enabled);
        Ok(enabled)
    }

    fn start_sampler<F>(&self, interval: Duration, mut sample: F) -> Result<bool, String>
    where
        F: FnMut() -> Sample + Send + 'static,
    {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .map_err(|_| "metrics lifecycle unavailable")?;
        if lifecycle.started || lifecycle.stopped || !self.enabled()? {
            return Ok(false);
        }
        lifecycle.started = true;
        let cache = Arc::clone(&self.cache);
        let (sender, receiver) = mpsc::channel();
        let worker = std::thread::Builder::new()
            .name("performance-sampler".into())
            .spawn(move || loop {
                match receiver.try_recv() {
                    Ok(()) | Err(mpsc::TryRecvError::Disconnected) => break,
                    Err(mpsc::TryRecvError::Empty) => {}
                }
                let started = Instant::now();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(&mut sample));
                let failed = result.is_err();
                let mut measurement =
                    result.unwrap_or_else(|_| Sample::unavailable("samplerPanicked"));
                measurement.sample_duration_ms = started.elapsed().as_millis() as u64;
                match cache.lock() {
                    Ok(mut cache) => cache.push(Instant::now(), measurement),
                    Err(_) => break,
                }
                if failed {
                    break;
                }
                match receiver.recv_timeout(interval) {
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    _ => break,
                }
            });
        match worker {
            Ok(worker) => {
                lifecycle.worker = Some((sender, worker));
                Ok(true)
            }
            Err(_) => {
                if let Ok(mut cache) = self.cache.lock() {
                    cache.push(Instant::now(), Sample::unavailable("samplerStartFailed"));
                }
                Err("metrics sampler could not start".into())
            }
        }
    }

    pub fn stop(&self) {
        let _transition = self
            .transition
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        self.stop_worker(true);
        if let Ok(mut cache) = self.cache.lock() {
            cache.status = "stopped";
        }
    }

    fn stop_worker(&self, terminal: bool) {
        let worker = {
            let mut lifecycle = self
                .lifecycle
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            lifecycle.started = terminal;
            lifecycle.stopped = terminal;
            lifecycle.worker.take()
        };
        if let Some((sender, worker)) = worker {
            let _ = sender.send(());
            let _ = worker.join();
        }
    }

    fn cached_app_metrics(&self) -> Result<AppMetrics, String> {
        let cache = self.cache.lock().map_err(|_| "metrics cache unavailable")?;
        if !cache.enabled {
            return Err("metrics diagnostics disabled".into());
        }
        if matches!(cache.status(), "stale" | "stopped") {
            return Err("metrics sampler is stale or stopped".into());
        }
        let (_, sample) = cache.samples.back().ok_or("metrics sample not ready")?;
        if sample.status == "unavailable" {
            return Err(sample.error.unwrap_or("metrics unavailable").into());
        }
        Ok(AppMetrics {
            memory_bytes: sample
                .main_memory_bytes
                .ok_or("metrics memory unavailable")?,
            cpu_percent: sample
                .main_cpu_percent
                .ok_or("metrics CPU baseline not ready")?,
        })
    }

    fn report(&self) -> Result<PerformanceDiagnostics, String> {
        let cache = self.cache.lock().map_err(|_| "metrics cache unavailable")?;
        Ok(PerformanceDiagnostics {
            schema_version: 1,
            enabled: cache.enabled,
            os: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            logical_cpu_count: cache.samples.back().and_then(|(_, sample)| sample.logical_cpu_count),
            session_started_at_ms: cache.session_started_at_ms,
            generated_at_ms: timestamp_ms(),
            sampling_interval_ms: SAMPLING_INTERVAL.as_millis() as u64,
            retention_ms: RETENTION.as_millis() as u64,
            sample_capacity: SAMPLE_CAPACITY,
            process_limit: PROCESS_LIMIT,
            persistence: "currentSessionOnly",
            status: cache.status(),
            limitations: vec![
                "CPU percentages use accumulated CPU-millisecond deltas over monotonic elapsed time, per logical core, and may exceed 100; null is not zero.",
                "systemCpuPercent is whole-machine utilization on a 0-100 scale, unlike per-process single-core percentages; its first sample is null.",
                "System memory uses a fresh sysinfo snapshot each sample to avoid stale values. Unknown or inconsistent byte counts are null. Zero available RAM requires a nonzero used-memory reading from the same snapshot. Zero swap capacity is ambiguous without sysinfo error results and conservatively reported as null; zero usage with nonzero swap capacity is valid.",
                "swapUsedBytes is occupancy, not paging activity or a page-in/page-out rate; it cannot alone establish paging as the cause of high CPU.",
                "Only this run is retained in memory; no previous-session report is persisted.",
                "The 32-process budget reserves main plus up to two unattributed GPU and two unattributed content candidates. Remaining slots prefer descendants, then extra candidates. Unused reservations are backfilled; selection and output use stable PID ordering within each priority.",
                "WebKit name matches are discovery hints only; unattributed candidates may belong to other applications and are never app totals.",
                "Ancestry is a snapshot: reparented, short-lived and inaccessible processes may be absent; engines are generic child roles.",
                "Omission counts cover discovered matches excluded by the 32-process limit, not undiscoverable processes.",
                "sysinfo provides no per-field permission/error result; zero RSS is treated as unavailable, other silent partial refresh failures cannot be ruled out.",
                "Sampling waits 5 seconds after each collection; scheduling and collection time may extend the interval. RSS is not unique memory and must not be summed as an app footprint.",
            ],
            samples: cache.samples.iter().filter(|(time, _)| time.elapsed() < RETENTION)
                .map(|(_, sample)| sample.clone()).collect(),
        })
    }
}

impl Default for MetricsState {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for MetricsState {
    fn drop(&mut self) {
        self.stop();
    }
}

fn timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

struct ProcessIdentity {
    pid: u32,
    parent: Option<u32>,
    name: String,
}

struct Selection {
    processes: Vec<ProcessSample>,
    omitted_app_process_count: usize,
    omitted_candidate_process_count: usize,
}

fn candidate_role(name: &str) -> Role {
    match name {
        "com.apple.WebKit.GPU" | "WebKitGPUProcess" => Role::WebkitGpuCandidate,
        "com.apple.WebKit.WebContent" | "WebKitWebProcess" | "WebKitWebProces" => {
            Role::WebkitContentCandidate
        }
        _ => Role::Other,
    }
}

fn select_processes(rows: &[ProcessIdentity], main_pid: u32) -> Selection {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    for row in rows {
        if let Some(parent) = row.parent {
            children.entry(parent).or_default().push(row.pid);
        }
    }
    let mut owned = HashSet::from([main_pid]);
    let mut pending = vec![main_pid];
    while let Some(parent) = pending.pop() {
        if let Some(children) = children.get(&parent) {
            for &child in children {
                if owned.insert(child) {
                    pending.push(child);
                }
            }
        }
    }
    let mut matches: Vec<_> = rows
        .iter()
        .filter_map(|row| {
            let candidate = candidate_role(&row.name);
            let (priority, role, attribution) = if row.pid == main_pid {
                (0, Role::Main, Attribution::Main)
            } else if owned.contains(&row.pid) {
                (1, Role::Child, Attribution::AppDescendant)
            } else if candidate != Role::Other {
                (2, candidate, Attribution::UnattributedCandidate)
            } else {
                return None;
            };
            Some((
                priority,
                ProcessSample {
                    pid: row.pid,
                    role,
                    attribution,
                    memory_bytes: None,
                    cpu_percent: None,
                    cpu_status: CpuStatus::Unavailable,
                },
            ))
        })
        .collect();
    matches.sort_unstable_by_key(|(priority, process)| (*priority, process.pid));
    let mut selected = HashSet::with_capacity(PROCESS_LIMIT);
    for role in [Role::WebkitGpuCandidate, Role::WebkitContentCandidate] {
        for (_, process) in matches
            .iter()
            .filter(|(_, process)| process.role == role)
            .take(2)
        {
            selected.insert(process.pid);
        }
    }
    for (_, process) in &matches {
        if selected.len() >= PROCESS_LIMIT {
            break;
        }
        selected.insert(process.pid);
    }
    let omitted = matches
        .iter()
        .filter(|(_, process)| !selected.contains(&process.pid));
    let omitted_app_process_count = omitted
        .clone()
        .filter(|(priority, _)| *priority < 2)
        .count();
    let omitted_candidate_process_count = omitted.filter(|(priority, _)| *priority == 2).count();
    Selection {
        processes: matches
            .into_iter()
            .filter(|(_, process)| selected.contains(&process.pid))
            .map(|(_, process)| process)
            .collect(),
        omitted_app_process_count,
        omitted_candidate_process_count,
    }
}

#[derive(Default)]
struct CpuTracker {
    previous: HashMap<u32, (u64, u64, Instant)>,
}

impl CpuTracker {
    fn read(
        &mut self,
        pid: u32,
        start_time: u64,
        cpu_ms: u64,
        now: Instant,
    ) -> (Option<f32>, CpuStatus) {
        if start_time == 0 {
            self.previous.remove(&pid);
            return (None, CpuStatus::Unavailable);
        }
        match self.previous.insert(pid, (start_time, cpu_ms, now)) {
            Some((previous_start, previous_cpu_ms, _))
                if previous_start == start_time && cpu_ms < previous_cpu_ms =>
            {
                self.previous.remove(&pid);
                (None, CpuStatus::Unavailable)
            }
            Some((previous_start, previous_cpu_ms, previous_time))
                if previous_start == start_time
                    && now.saturating_duration_since(previous_time)
                        >= sysinfo::MINIMUM_CPU_UPDATE_INTERVAL =>
            {
                let elapsed_ms = now.duration_since(previous_time).as_secs_f64() * 1000.0;
                let percent = (cpu_ms - previous_cpu_ms) as f64 / elapsed_ms * 100.0;
                (Some(percent as f32), CpuStatus::Available)
            }
            _ => (None, CpuStatus::Baseline),
        }
    }
}

/// Pids refreshed for memory/CPU: this round's selection plus last round's,
/// sorted and deduplicated. A pid that left the selection (exited, or pushed
/// out by the limit) rides along once so sysinfo's `remove_dead_processes`
/// drops it — `ProcessesToUpdate::Some` only ever prunes listed pids.
fn refresh_targets(selected: &[u32], previous: &HashSet<u32>) -> Vec<u32> {
    let mut targets: Vec<u32> = selected.iter().chain(previous).copied().collect();
    targets.sort_unstable();
    targets.dedup();
    targets
}

/// Process table rows (pid, parent, name) used only to work out which
/// processes are ours.
///
/// Windows: a Toolhelp snapshot lists pid / parent / exe name without
/// opening any process. sysinfo's `ProcessesToUpdate::All` instead calls
/// `OpenProcess(QUERY_INFORMATION | VM_READ)` on every new process on the
/// machine — lsass included — every sample, which endpoint security reads
/// as credential-theft / injection staging. Handles are opened only for the
/// selected (own) pids in the second, `ProcessesToUpdate::Some` refresh.
#[cfg(windows)]
fn process_table(_system: &mut System) -> Option<Vec<ProcessIdentity>> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }.ok()?;
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut rows = Vec::new();
    let mut more = unsafe { Process32FirstW(snapshot, &mut entry) }.is_ok();
    while more {
        let len = entry
            .szExeFile
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(entry.szExeFile.len());
        rows.push(ProcessIdentity {
            pid: entry.th32ProcessID,
            parent: (entry.th32ParentProcessID != 0).then_some(entry.th32ParentProcessID),
            name: String::from_utf16_lossy(&entry.szExeFile[..len]),
        });
        more = unsafe { Process32NextW(snapshot, &mut entry) }.is_ok();
    }
    let _ = unsafe { CloseHandle(snapshot) };
    (!rows.is_empty()).then_some(rows)
}

/// macOS / Linux: sysinfo with `ProcessRefreshKind::nothing()` reads only
/// list-level metadata (libproc process info / `/proc/<pid>/stat`) — no task
/// port, memory contents or environment of other processes. Memory and CPU
/// are read afterwards for the selected pids only.
#[cfg(not(windows))]
fn process_table(system: &mut System) -> Option<Vec<ProcessIdentity>> {
    let updated = system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().without_tasks(),
    );
    (updated > 0).then(|| {
        system
            .processes()
            .values()
            .map(|process| ProcessIdentity {
                pid: process.pid().as_u32(),
                parent: process.parent().map(|pid| pid.as_u32()),
                name: process.name().to_string_lossy().into_owned(),
            })
            .collect()
    })
}

struct Collector {
    system: System,
    cpu: CpuTracker,
    previous_system_sample: Option<Instant>,
    main_pid: u32,
    /// Pids measured last round (see [`refresh_targets`]).
    sampled: HashSet<u32>,
}

impl Collector {
    fn new() -> Self {
        Self {
            system: System::new(),
            cpu: CpuTracker::default(),
            previous_system_sample: None,
            main_pid: std::process::id(),
            sampled: HashSet::new(),
        }
    }

    fn sample(&mut self) -> Sample {
        let mut sample = Sample::unavailable("processRefreshFailed");
        if !sysinfo::IS_SUPPORTED_SYSTEM {
            sample.error = Some("unsupportedSystem");
            return sample;
        }
        let mut memory = System::new();
        memory.refresh_memory();
        sample.record_system_memory(
            memory.total_memory(),
            memory.available_memory(),
            memory.used_memory(),
            memory.total_swap(),
            memory.used_swap(),
        );
        let system_sample_time = Instant::now();
        self.system.refresh_cpu_usage();
        sample.logical_cpu_count = match self.system.cpus().len() {
            0 => None,
            count => Some(count),
        };
        let system_cpu = self.system.global_cpu_usage();
        if sample.logical_cpu_count.is_some()
            && system_cpu.is_finite()
            && (0.0..=100.0).contains(&system_cpu)
        {
            if self.previous_system_sample.is_some_and(|previous| {
                system_sample_time.saturating_duration_since(previous)
                    >= sysinfo::MINIMUM_CPU_UPDATE_INTERVAL
            }) {
                sample.system_cpu_percent = Some(system_cpu);
            }
            self.previous_system_sample = Some(system_sample_time);
        } else {
            self.previous_system_sample = None;
        }
        let Some(rows) = process_table(&mut self.system)
            .filter(|rows| rows.iter().any(|row| row.pid == self.main_pid))
        else {
            self.cpu.previous.clear();
            return sample;
        };
        let selection = select_processes(&rows, self.main_pid);
        let selected: Vec<u32> = selection.processes.iter().map(|process| process.pid).collect();
        let pids: Vec<_> = refresh_targets(&selected, &self.sampled)
            .into_iter()
            .map(Pid::from_u32)
            .collect();
        self.sampled = selected.into_iter().collect();
        let updated = self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids),
            true,
            ProcessRefreshKind::nothing()
                .without_tasks()
                .with_memory()
                .with_cpu(),
        );
        sample.omitted_app_process_count = selection.omitted_app_process_count;
        sample.omitted_candidate_process_count = selection.omitted_candidate_process_count;
        if updated == 0 {
            self.cpu.previous.clear();
            return sample;
        }
        sample.processes = selection.processes;
        let measured_at = Instant::now();
        let mut measured = HashSet::new();
        for entry in &mut sample.processes {
            if let Some(process) = self.system.process(Pid::from_u32(entry.pid)) {
                if process.memory() > 0 {
                    entry.memory_bytes = Some(process.memory());
                    (entry.cpu_percent, entry.cpu_status) = self.cpu.read(
                        entry.pid,
                        process.start_time(),
                        process.accumulated_cpu_time(),
                        measured_at,
                    );
                    measured.insert(entry.pid);
                }
            }
            if entry.pid == self.main_pid {
                sample.main_memory_bytes = entry.memory_bytes;
                sample.main_cpu_percent = entry.cpu_percent;
            }
        }
        self.cpu.previous.retain(|pid, _| measured.contains(pid));
        if sample.main_memory_bytes.is_some() {
            sample.status = "available";
            sample.error = None;
        } else {
            sample.error = Some("mainProcessUnavailable");
        }
        sample
    }
}

#[tauri::command]
pub fn app_metrics(state: tauri::State<'_, MetricsState>) -> Result<AppMetrics, String> {
    state.cached_app_metrics()
}

#[tauri::command]
pub fn performance_diagnostics(
    state: tauri::State<'_, MetricsState>,
) -> Result<PerformanceDiagnostics, String> {
    state.report()
}

#[tauri::command]
pub fn performance_diagnostics_enabled(
    state: tauri::State<'_, MetricsState>,
) -> Result<bool, String> {
    state.enabled()
}

#[tauri::command]
pub fn performance_diagnostics_set_enabled(
    enabled: bool,
    state: tauri::State<'_, MetricsState>,
    app_state: tauri::State<'_, crate::AppState>,
) -> Result<bool, String> {
    use crate::event_sink::Emit;
    state.set_enabled(enabled, |enabled| {
        app_state.emitters.emit_json(
            "performance-diagnostics-enabled",
            if enabled {
                "{\"enabled\":true}"
            } else {
                "{\"enabled\":false}"
            },
        );
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn system_memory_fields_are_nullable_camel_case_bytes() {
        let mut sample = Sample::unavailable("test");
        let json = serde_json::to_value(&sample).unwrap();
        for key in [
            "systemMemoryTotalBytes",
            "systemMemoryAvailableBytes",
            "swapUsedBytes",
        ] {
            assert_eq!(json.get(key), Some(&serde_json::Value::Null));
        }
        sample.record_system_memory(8192, 2048, 6144, 4096, 1024);
        let json = serde_json::to_value(&sample).unwrap();
        assert_eq!(json["systemMemoryTotalBytes"], 8192);
        assert_eq!(json["systemMemoryAvailableBytes"], 2048);
        assert_eq!(json["swapUsedBytes"], 1024);
    }

    #[test]
    fn system_memory_preserves_known_zero_swap_but_rejects_unknown_or_invalid_values() {
        let mut sample = Sample::unavailable("test");
        sample.record_system_memory(8192, 2048, 6144, 4096, 0);
        assert_eq!(sample.swap_used_bytes, Some(0));
        sample.record_system_memory(0, 0, 0, 0, 0);
        assert_eq!(sample.system_memory_total_bytes, None);
        assert_eq!(sample.system_memory_available_bytes, None);
        assert_eq!(sample.swap_used_bytes, None);
        sample.record_system_memory(8192, 9000, 6144, 4096, 9000);
        assert_eq!(sample.system_memory_total_bytes, Some(8192));
        assert_eq!(sample.system_memory_available_bytes, None);
        assert_eq!(sample.swap_used_bytes, None);
        sample.record_system_memory(8192, 0, 0, 0, 0);
        assert_eq!(sample.system_memory_available_bytes, None);
        assert_eq!(sample.swap_used_bytes, None);
        sample.record_system_memory(8192, 0, 8192, 4096, 0);
        assert_eq!(sample.system_memory_available_bytes, Some(0));
        assert_eq!(sample.swap_used_bytes, Some(0));
    }

    fn row(pid: u32, parent: Option<u32>, name: &str) -> ProcessIdentity {
        ProcessIdentity {
            pid,
            parent,
            name: name.into(),
        }
    }

    #[test]
    fn ring_is_bounded_by_capacity_and_monotonic_age() {
        assert_eq!(RETENTION, Duration::from_secs(300));
        assert_eq!(SAMPLE_CAPACITY, 60);
        let mut cache = Cache::new();
        let now = Instant::now();
        for index in 0..150 {
            cache.push(
                now + Duration::from_secs(index * 5),
                Sample::unavailable("test"),
            );
        }
        assert_eq!(cache.samples.len(), SAMPLE_CAPACITY);
        cache.push(now + Duration::from_secs(1400), Sample::unavailable("test"));
        assert_eq!(cache.samples.len(), 1);
    }

    #[test]
    fn report_expires_samples_at_five_minutes_without_another_collection() {
        let state = MetricsState::empty();
        state.cache.lock().unwrap().push(
            Instant::now() - Duration::from_secs(301),
            Sample::unavailable("test"),
        );
        assert!(state.report().unwrap().samples.is_empty());
        let json = serde_json::to_value(state.report().unwrap()).unwrap();
        assert_eq!(json["enabled"], true);
        assert_eq!(json["retentionMs"], 300_000);
        assert_eq!(json["sampleCapacity"], 60);
    }

    #[test]
    fn disabled_sampling_clears_cache_stays_idle_and_reenables_with_fresh_cpu_baseline() {
        let state = MetricsState::empty();
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        state
            .start_sampler(Duration::from_millis(5), move || {
                count.fetch_add(1, Ordering::SeqCst);
                Sample::unavailable("test")
            })
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        while state.report().unwrap().samples.is_empty() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(1));
        }
        assert!(!state.set_enabled(false, |_| {}).unwrap());
        let stopped_calls = calls.load(Ordering::SeqCst);
        for _ in 0..10 {
            assert!(state.cached_app_metrics().is_err());
            let report = state.report().unwrap();
            assert!(!report.enabled);
            assert_eq!(report.status, "disabled");
            assert!(report.samples.is_empty());
            std::thread::sleep(Duration::from_millis(2));
        }
        assert_eq!(calls.load(Ordering::SeqCst), stopped_calls);
        assert!(!state
            .start_sampler(Duration::from_millis(5), || panic!("disabled"))
            .unwrap());
        assert!(state.set_enabled(true, |_| {}).unwrap());
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let report = state.report().unwrap();
            if let Some(sample) = report.samples.first() {
                assert_eq!(sample.main_cpu_percent, None);
                assert_eq!(sample.system_cpu_percent, None);
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        state.stop();
        assert!(state.set_enabled(true, |_| {}).is_err());
    }

    #[test]
    fn native_preference_defaults_true_and_survives_restart() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-metrics-{}", uuid::Uuid::new_v4()));
        let path = directory.join("performance-diagnostics.json");
        {
            let state = MetricsState::load_from(path.clone()).unwrap();
            assert!(state.report().unwrap().enabled);
            assert!(!state.set_enabled(false, |_| {}).unwrap());
        }
        {
            let state = MetricsState::load_from(path.clone()).unwrap();
            assert_eq!(state.report().unwrap().status, "disabled");
            assert!(!state.enabled().unwrap());
            assert!(state.lifecycle.lock().unwrap().worker.is_none());
            assert!(state.cached_app_metrics().is_err());
            assert!(state.set_enabled(true, |_| {}).unwrap());
        }
        let state = MetricsState::load_from(path.clone()).unwrap();
        assert!(state.enabled().unwrap());
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(&path).unwrap())
                .unwrap(),
            serde_json::json!({"enabled": true})
        );
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_preference_write_does_not_change_state_or_emit() {
        let path = std::env::temp_dir().join(format!("ccgui-metrics-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, "not a directory").unwrap();
        let mut state = MetricsState::empty();
        state.preference_path = Some(path.join("preference.json"));
        assert!(state
            .set_enabled(false, |_| panic!("must not emit on failure"))
            .is_err());
        assert!(state.enabled().unwrap());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn invalid_native_preference_starts_disabled_and_can_be_repaired() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-metrics-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("performance-diagnostics.json");
        std::fs::write(&path, "{broken").unwrap();
        let state = MetricsState::load_from(path.clone()).unwrap();
        assert!(!state.enabled().unwrap());
        assert_eq!(state.report().unwrap().status, "disabled");
        assert!(state.lifecycle.lock().unwrap().worker.is_none());
        assert!(state.set_enabled(true, |_| {}).unwrap());
        drop(state);
        let restarted = MetricsState::load_from(path).unwrap();
        assert!(restarted.enabled().unwrap());
        drop(restarted);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn sampler_start_failure_returns_persisted_enabled_with_unavailable_report() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-metrics-{}", uuid::Uuid::new_v4()));
        let path = directory.join("performance-diagnostics.json");
        let state = MetricsState::load_from(path.clone()).unwrap();
        state.set_enabled(false, |_| {}).unwrap();
        let mut notified = false;
        let result = state.set_enabled_with_sampler(
            true,
            |enabled| {
                notified = enabled;
                assert!(state.enabled().unwrap());
                assert_eq!(state.report().unwrap().status, "unavailable");
            },
            |_| Err("injected thread spawn failure".into()),
        );
        assert_eq!(result, Ok(true));
        assert!(notified);
        assert_eq!(
            state.report().unwrap().samples[0].error,
            Some("samplerStartFailed")
        );
        assert!(state.cached_app_metrics().is_err());
        let stored: DiagnosticsPreference =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        assert!(stored.enabled);
        drop(state);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn unreadable_native_preference_fails_closed_without_blocking_startup() {
        let path = std::env::temp_dir().join(format!("ccgui-metrics-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        let state = MetricsState::load_from(path.clone()).unwrap();
        assert!(!state.enabled().unwrap());
        assert_eq!(state.report().unwrap().status, "disabled");
        assert!(state.lifecycle.lock().unwrap().worker.is_none());
        drop(state);
        std::fs::remove_dir(path).unwrap();
    }

    #[test]
    fn disable_joins_inflight_collection_and_drops_collector_before_notifying() {
        struct DropSignal(mpsc::Sender<()>);
        impl Drop for DropSignal {
            fn drop(&mut self) {
                let _ = self.0.send(());
            }
        }
        let state = Arc::new(MetricsState::empty());
        let (started_sender, started_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        let (dropped_sender, dropped_receiver) = mpsc::channel();
        let signal = DropSignal(dropped_sender);
        state
            .start_sampler(Duration::from_secs(60), move || {
                let _keep_alive = &signal;
                started_sender.send(()).unwrap();
                release_receiver
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
                Sample::unavailable("late sample")
            })
            .unwrap();
        started_receiver
            .recv_timeout(Duration::from_secs(3))
            .unwrap();
        let toggled_state = state.clone();
        let (notified_sender, notified_receiver) = mpsc::channel();
        let disabler = std::thread::spawn(move || {
            toggled_state
                .set_enabled(false, |enabled| {
                    assert!(!enabled);
                    assert!(toggled_state.report().unwrap().samples.is_empty());
                    dropped_receiver.try_recv().unwrap();
                    notified_sender.send(()).unwrap();
                })
                .unwrap()
        });
        assert!(notified_receiver
            .recv_timeout(Duration::from_millis(20))
            .is_err());
        release_sender.send(()).unwrap();
        assert!(!disabler.join().unwrap());
        notified_receiver
            .recv_timeout(Duration::from_secs(3))
            .unwrap();
        assert!(state.report().unwrap().samples.is_empty());
    }

    #[test]
    fn concurrent_toggles_keep_persistence_cache_and_notifications_in_order() {
        let directory =
            std::env::temp_dir().join(format!("ccgui-metrics-{}", uuid::Uuid::new_v4()));
        let path = directory.join("performance-diagnostics.json");
        let state = Arc::new(MetricsState::load_from(path.clone()).unwrap());
        let notifications = Arc::new(Mutex::new(Vec::new()));
        let mut workers = Vec::new();
        for enabled in [false, true, false, true, false, true] {
            let state = state.clone();
            let notifications = notifications.clone();
            let path = path.clone();
            workers.push(std::thread::spawn(move || {
                state
                    .set_enabled(enabled, |actual| {
                        assert_eq!(actual, enabled);
                        assert_eq!(state.enabled().unwrap(), enabled);
                        let stored: DiagnosticsPreference =
                            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
                        assert_eq!(stored.enabled, enabled);
                        notifications.lock().unwrap().push(enabled);
                    })
                    .unwrap();
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }
        assert_eq!(notifications.lock().unwrap().len(), 6);
        assert_eq!(
            notifications.lock().unwrap().last().copied(),
            Some(state.enabled().unwrap())
        );
        let expected = state.enabled().unwrap();
        drop(state);
        let restarted = MetricsState::load_from(path).unwrap();
        assert_eq!(restarted.enabled().unwrap(), expected);
        drop(restarted);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn refresh_targets_carry_previous_samples_so_exited_pids_drop_out() {
        let targets = refresh_targets(&[1, 5, 3], &HashSet::from([3, 7]));
        assert_eq!(targets, vec![1, 3, 5, 7]);
        assert!(refresh_targets(&[], &HashSet::new()).is_empty());
    }

    /// Endpoint security reads "OpenProcess(VM_READ) on every new process,
    /// lsass included, every 5 s" as credential-theft / injection staging,
    /// and sysinfo does exactly that on Windows for `ProcessesToUpdate::All`.
    /// The full-table refresh may only live in the non-Windows table reader.
    #[test]
    fn whole_system_refresh_never_reaches_the_windows_build() {
        let source = include_str!("metrics.rs");
        // Code only: doc comments may name the API they warn about.
        let production: String = source
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .map(|line| format!("{line}\n"))
            .collect();
        let needle = ["ProcessesToUpdate", "::All"].concat();
        let uses: Vec<_> = production.match_indices(&needle).collect();
        assert_eq!(uses.len(), 1, "full refresh must appear exactly once");
        let reader = production
            .find("#[cfg(not(windows))]\nfn process_table(")
            .expect("non-Windows process_table");
        let reader_end = reader + production[reader..].find("\n}\n").unwrap();
        assert!(
            (reader..reader_end).contains(&uses[0].0),
            "ProcessesToUpdate::All outside the non-Windows table reader"
        );
    }

    #[test]
    fn ancestry_is_transitive_candidates_are_not_owned_and_output_is_private() {
        let rows = vec![
            row(1, None, "private-main"),
            row(2, Some(1), "secret-engine"),
            row(3, Some(2), "secret-worker"),
            row(4, Some(90), "com.apple.WebKit.GPU"),
            row(5, Some(1), "com.apple.WebKit.WebContent"),
            row(6, Some(90), "unrelated-gpu"),
            row(7, Some(90), "WebKitWebProcess"),
            row(8, Some(9), "cycle"),
            row(9, Some(8), "cycle"),
        ];
        let selection = select_processes(&rows, 1);
        assert_eq!(selection.processes.len(), 6);
        assert_eq!(selection.processes[0].role, Role::Main);
        assert!(
            selection
                .processes
                .iter()
                .find(|p| p.pid == 3)
                .unwrap()
                .attribution
                == Attribution::AppDescendant
        );
        assert!(
            selection
                .processes
                .iter()
                .find(|p| p.pid == 4)
                .unwrap()
                .attribution
                == Attribution::UnattributedCandidate
        );
        assert!(
            selection
                .processes
                .iter()
                .find(|p| p.pid == 5)
                .unwrap()
                .attribution
                == Attribution::AppDescendant
        );
        let json = serde_json::to_string(&selection.processes).unwrap();
        for secret in [
            "private-main",
            "secret-engine",
            "secret-worker",
            "WebKitWebProcess",
            "name",
            "argv",
            "env",
            "path",
        ] {
            assert!(!json.contains(secret), "{secret}");
        }
        assert!(json.contains("webkit-gpu-candidate"));
        assert!(json.contains("unattributedCandidate"));
    }

    #[test]
    fn selection_reserves_candidates_and_counts_omissions() {
        let mut rows = vec![row(100, None, "main")];
        rows.extend((101..140).map(|pid| row(pid, Some(100), "engine")));
        rows.extend((1..11).map(|pid| row(pid, None, "com.apple.WebKit.GPU")));
        let selection = select_processes(&rows, 100);
        assert_eq!(selection.processes.len(), PROCESS_LIMIT);
        assert_eq!(selection.processes[0].pid, 100);
        assert_eq!(selection.omitted_app_process_count, 10);
        assert_eq!(selection.omitted_candidate_process_count, 8);
        assert_eq!(
            selection
                .processes
                .iter()
                .filter(|process| process.role == Role::WebkitGpuCandidate)
                .count(),
            2
        );
    }

    #[test]
    fn selection_keeps_both_webkit_classes_when_descendants_fill_the_limit() {
        let mut rows = vec![row(100, None, "main")];
        rows.extend((101..132).map(|pid| row(pid, Some(100), "engine")));
        rows.push(row(200, None, "com.apple.WebKit.GPU"));
        rows.push(row(201, None, "com.apple.WebKit.WebContent"));
        let selection = select_processes(&rows, 100);
        assert_eq!(selection.processes.len(), PROCESS_LIMIT);
        assert_eq!(selection.processes[0].pid, 100);
        assert_eq!(selection.omitted_app_process_count, 2);
        assert_eq!(selection.omitted_candidate_process_count, 0);
        assert_eq!(
            selection
                .processes
                .iter()
                .filter(|process| process.attribution == Attribution::AppDescendant)
                .count(),
            29
        );
        for pid in [200, 201] {
            assert_eq!(
                selection
                    .processes
                    .iter()
                    .find(|process| process.pid == pid)
                    .unwrap()
                    .attribution,
                Attribution::UnattributedCandidate
            );
        }
        let pids: Vec<_> = selection
            .processes
            .iter()
            .map(|process| process.pid)
            .collect();
        rows.reverse();
        assert_eq!(
            select_processes(&rows, 100)
                .processes
                .iter()
                .map(|process| process.pid)
                .collect::<Vec<_>>(),
            pids
        );
    }

    #[test]
    fn selection_backfills_missing_candidate_classes_and_spare_descendant_slots() {
        for name in ["com.apple.WebKit.GPU", "com.apple.WebKit.WebContent"] {
            let mut rows = vec![row(100, None, "main")];
            rows.extend((101..132).map(|pid| row(pid, Some(100), "engine")));
            rows.push(row(200, None, name));
            let selection = select_processes(&rows, 100);
            assert_eq!(selection.processes.len(), PROCESS_LIMIT);
            assert_eq!(selection.omitted_app_process_count, 1);
            assert_eq!(selection.omitted_candidate_process_count, 0);
            assert_eq!(
                selection
                    .processes
                    .iter()
                    .filter(|process| process.attribution == Attribution::AppDescendant)
                    .count(),
                30
            );
            assert!(selection.processes.iter().any(|process| process.pid == 200));
        }
        let mut rows = vec![row(100, None, "main"), row(101, Some(100), "engine")];
        rows.extend((200..240).map(|pid| row(pid, None, "com.apple.WebKit.GPU")));
        let selection = select_processes(&rows, 100);
        assert_eq!(selection.processes.len(), PROCESS_LIMIT);
        assert_eq!(selection.omitted_app_process_count, 0);
        assert_eq!(selection.omitted_candidate_process_count, 10);
        assert_eq!(selection.processes.last().unwrap().pid, 229);
    }

    #[test]
    fn selection_reserves_two_per_candidate_class_with_stable_lowest_pids() {
        let mut rows = vec![row(100, None, "main")];
        rows.extend((101..132).map(|pid| row(pid, Some(100), "engine")));
        rows.extend((200..204).map(|pid| row(pid, None, "com.apple.WebKit.GPU")));
        rows.extend((300..304).map(|pid| row(pid, None, "com.apple.WebKit.WebContent")));
        let selection = select_processes(&rows, 100);
        assert_eq!(selection.processes.len(), PROCESS_LIMIT);
        assert_eq!(selection.omitted_app_process_count, 4);
        assert_eq!(selection.omitted_candidate_process_count, 4);
        assert_eq!(
            selection
                .processes
                .iter()
                .filter(|process| process.attribution == Attribution::UnattributedCandidate)
                .map(|process| process.pid)
                .collect::<Vec<_>>(),
            vec![200, 201, 300, 301]
        );
    }

    #[test]
    fn cpu_requires_baseline_interval_and_same_process_identity() {
        let mut tracker = CpuTracker::default();
        let now = Instant::now();
        assert_eq!(tracker.read(1, 10, 0, now), (None, CpuStatus::Baseline));
        assert_eq!(tracker.read(1, 10, 0, now), (None, CpuStatus::Baseline));
        assert_eq!(
            tracker.read(1, 10, 6250, now + Duration::from_secs(5)),
            (Some(125.0), CpuStatus::Available)
        );
        assert_eq!(
            tracker.read(1, 11, 10, now + Duration::from_secs(10)),
            (None, CpuStatus::Baseline)
        );
        assert_eq!(
            tracker.read(1, 11, 0, now + Duration::from_secs(15)),
            (None, CpuStatus::Unavailable)
        );
        assert_eq!(
            tracker.read(1, 11, 0, now + Duration::from_secs(20)),
            (None, CpuStatus::Baseline)
        );
        assert_eq!(
            tracker.read(1, 11, 0, now + Duration::from_secs(25)),
            (Some(0.0), CpuStatus::Available)
        );
        assert_eq!(
            tracker.read(1, 0, 0, now + Duration::from_secs(30)),
            (None, CpuStatus::Unavailable)
        );
    }

    #[test]
    fn startup_cache_single_sampler_and_prompt_cleanup() {
        let state = MetricsState::empty();
        assert!(state.cached_app_metrics().is_err());
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        assert!(state
            .start_sampler(Duration::from_secs(60), move || {
                count.fetch_add(1, Ordering::SeqCst);
                Sample::unavailable("test")
            })
            .unwrap());
        assert!(!state
            .start_sampler(Duration::from_secs(60), || panic!("second sampler"))
            .unwrap());
        let deadline = Instant::now() + Duration::from_secs(3);
        while state.report().unwrap().samples.is_empty() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
        for _ in 0..20 {
            let _ = state.cached_app_metrics();
            let _ = state.report().unwrap();
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let start = Instant::now();
        state.stop();
        assert!(start.elapsed() < Duration::from_secs(1));
        assert_eq!(state.report().unwrap().status, "stopped");
        assert!(!state
            .start_sampler(Duration::from_secs(60), || panic!("restarted"))
            .unwrap());
    }

    #[test]
    fn cache_does_not_turn_unavailable_or_baseline_cpu_into_zero() {
        let state = MetricsState::empty();
        let mut sample = Sample::unavailable("processRefreshFailed");
        sample.main_memory_bytes = Some(123);
        state.cache.lock().unwrap().push(Instant::now(), sample);
        assert!(state.cached_app_metrics().is_err());
        let mut sample = Sample::unavailable("test");
        sample.status = "available";
        sample.error = None;
        sample.main_memory_bytes = Some(123);
        sample.main_cpu_percent = Some(0.0);
        state.cache.lock().unwrap().push(Instant::now(), sample);
        let metrics = state.cached_app_metrics().unwrap();
        assert_eq!(metrics.memory_bytes, 123);
        assert_eq!(metrics.cpu_percent, 0.0);
        let json = serde_json::to_value(state.report().unwrap()).unwrap();
        assert_eq!(json["persistence"], "currentSessionOnly");
        assert_eq!(json["sampleCapacity"], 60);
        assert_eq!(json["processLimit"], 32);
        assert_eq!(json["os"], std::env::consts::OS);
        assert_eq!(json["arch"], std::env::consts::ARCH);
        assert!(json.get("logicalCpuCount").is_some());
        assert!(json["samples"][0].get("systemCpuPercent").is_some());
        assert!(json["samples"][0]["mainCpuPercent"].is_null());
    }

    #[test]
    fn background_sampling_progresses_without_any_ipc_polls_and_drop_joins() {
        let state = MetricsState::empty();
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        let (sender, receiver) = mpsc::channel();
        state
            .start_sampler(Duration::from_millis(10), move || {
                count.fetch_add(1, Ordering::SeqCst);
                sender.send(()).unwrap();
                Sample::unavailable("test")
            })
            .unwrap();
        for _ in 0..3 {
            receiver.recv_timeout(Duration::from_secs(3)).unwrap();
        }
        drop(state);
        let finished = calls.load(Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(40));
        assert_eq!(calls.load(Ordering::SeqCst), finished);
    }

    #[test]
    fn collection_never_holds_the_cache_lock() {
        let state = MetricsState::empty();
        let (started_sender, started_receiver) = mpsc::channel();
        let (release_sender, release_receiver) = mpsc::channel();
        state
            .start_sampler(Duration::from_secs(60), move || {
                started_sender.send(()).unwrap();
                release_receiver
                    .recv_timeout(Duration::from_secs(3))
                    .unwrap();
                Sample::unavailable("test")
            })
            .unwrap();
        started_receiver
            .recv_timeout(Duration::from_secs(3))
            .unwrap();
        let cache_is_free = state.cache.try_lock().is_ok();
        release_sender.send(()).unwrap();
        state.stop();
        assert!(cache_is_free);
    }

    #[test]
    fn stale_cache_is_not_returned_as_live_metrics() {
        let state = MetricsState::empty();
        state.cache.lock().unwrap().push(
            Instant::now() - Duration::from_secs(20),
            Sample::unavailable("test"),
        );
        assert_eq!(state.report().unwrap().status, "stale");
        assert!(state.cached_app_metrics().is_err());
    }

    #[test]
    fn real_collector_primes_cpu_then_reports_finite_single_core_percentage() {
        if !sysinfo::IS_SUPPORTED_SYSTEM {
            return;
        }
        let mut collector = Collector::new();
        let first = collector.sample();
        assert_eq!(first.status, "available");
        assert!(first.main_memory_bytes.unwrap() > 0);
        assert_eq!(first.main_cpu_percent, None);
        assert_eq!(first.processes[0].cpu_status, CpuStatus::Baseline);
        std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL + Duration::from_millis(50));
        let second = collector.sample();
        assert_eq!(second.status, "available");
        let cpu = second.main_cpu_percent.unwrap();
        assert!(cpu.is_finite() && cpu >= 0.0);
        assert!(second.logical_cpu_count.unwrap() > 0);
        assert!(second.processes.len() <= PROCESS_LIMIT);
        for process in collector.system.processes().values() {
            assert!(process.cmd().is_empty());
            assert!(process.environ().is_empty());
            assert!(process.exe().is_none());
            assert!(process.cwd().is_none());
            assert!(process.root().is_none());
        }
    }

    #[test]
    fn missing_main_is_unavailable_and_discards_cpu_baselines() {
        let mut collector = Collector::new();
        collector.main_pid = u32::MAX;
        let sample = collector.sample();
        assert_eq!(sample.status, "unavailable");
        assert!(sample.error.is_some());
        assert!(sample.main_cpu_percent.is_none());
        assert!(collector.cpu.previous.is_empty());
    }

    #[test]
    fn sampler_panic_is_exported_as_unavailable_not_success() {
        let state = MetricsState::empty();
        state
            .start_sampler(Duration::from_secs(60), || panic!("test sampler failure"))
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let report = state.report().unwrap();
            if let Some(sample) = report.samples.last() {
                assert_eq!(report.status, "unavailable");
                assert_eq!(sample.error, Some("samplerPanicked"));
                assert!(sample.main_cpu_percent.is_none());
                assert!(state.cached_app_metrics().is_err());
                break;
            }
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn new_starts_real_sampler_and_commands_only_read_its_cache() {
        if !sysinfo::IS_SUPPORTED_SYSTEM {
            return;
        }
        let state = MetricsState::new();
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let report = state.report().unwrap();
            if report.samples.len() >= 2 {
                assert_eq!(report.status, "running");
                assert_eq!(report.samples[0].main_cpu_percent, None);
                let latest = report.samples.last().unwrap();
                let serialization_started = Instant::now();
                let json = serde_json::to_string(&report).unwrap();
                let serialization_us = serialization_started.elapsed().as_micros();
                let decoded: serde_json::Value = serde_json::from_str(&json).unwrap();
                assert_eq!(decoded["schemaVersion"], 1);
                assert_eq!(decoded["os"], std::env::consts::OS);
                assert_eq!(decoded["arch"], std::env::consts::ARCH);
                assert!(decoded["samples"][0]["systemCpuPercent"].is_null());
                assert!(decoded["samples"][1]["systemCpuPercent"].is_number());
                let metrics = state.cached_app_metrics().unwrap();
                assert_eq!(Some(metrics.cpu_percent), latest.main_cpu_percent);
                assert_eq!(Some(metrics.memory_bytes), latest.main_memory_bytes);
                assert!(report.samples[1].timestamp_ms >= report.samples[0].timestamp_ms + 5000);
                eprintln!(
                    "native metrics smoke: samples={}, collection_ms={:?}, selected_processes={}",
                    report.samples.len(),
                    report
                        .samples
                        .iter()
                        .map(|sample| sample.sample_duration_ms)
                        .collect::<Vec<_>>(),
                    latest.processes.len()
                );
                eprintln!("native metrics smoke: os={}, arch={}, logical_cores={}, json_bytes={}, serialization_us={}",
                    std::env::consts::OS, std::env::consts::ARCH,
                    latest.logical_cpu_count.unwrap(), json.len(), serialization_us);
                for sample in &report.samples {
                    assert!(sample.system_memory_total_bytes.unwrap() > 0);
                    assert!(
                        sample.system_memory_available_bytes.unwrap()
                            <= sample.system_memory_total_bytes.unwrap()
                    );
                    eprintln!("native memory smoke: total_bytes={:?}, available_bytes={:?}, swap_used_bytes={:?}",
                        sample.system_memory_total_bytes, sample.system_memory_available_bytes, sample.swap_used_bytes);
                    eprintln!("native metrics smoke: main_cpu={:?}, system_cpu={}, gpu_candidates={}, content_candidates={}, omitted_app={}, omitted_candidates={}",
                        sample.main_cpu_percent, serde_json::to_value(sample).unwrap()["systemCpuPercent"],
                        sample.processes.iter().filter(|process| process.role == Role::WebkitGpuCandidate).count(),
                        sample.processes.iter().filter(|process| process.role == Role::WebkitContentCandidate).count(),
                        sample.omitted_app_process_count, sample.omitted_candidate_process_count);
                    assert!(sample
                        .processes
                        .iter()
                        .filter(|process| matches!(
                            process.role,
                            Role::WebkitGpuCandidate | Role::WebkitContentCandidate
                        ))
                        .all(|process| process.attribution == Attribution::UnattributedCandidate));
                }
                state.stop();
                assert!(state.cached_app_metrics().is_err());
                break;
            }
            assert!(
                Instant::now() < deadline,
                "native sampler did not produce two samples"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
