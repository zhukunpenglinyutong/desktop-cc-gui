use super::*;
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Default)]
struct MemoryStore(Rc<RefCell<HashMap<String, Cache>>>);

impl CacheStore for MemoryStore {
    fn load(&self, protocol_version: &str) -> Option<Cache> {
        self.0.borrow().get(protocol_version).cloned()
    }
    fn save(&self, protocol_version: &str, cache: &Cache) {
        self.0.borrow_mut().insert(protocol_version.to_string(), cache.clone());
    }
}

const INIT: &str = r#"{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}"#;

fn init_result() -> Value {
    json!({"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"real","version":"1"}})
}

fn tools(names: &[&str]) -> Value {
    json!({"tools": names.iter().map(|n| json!({"name": n, "inputSchema": {"type":"object"}})).collect::<Vec<_>>()})
}

fn warm_store() -> MemoryStore {
    let store = MemoryStore::default();
    let mut lists = BTreeMap::new();
    lists.insert("tools/list".to_string(), tools(&["alpha"]));
    store.save("2025-06-18", &Cache { initialize: init_result(), lists });
    store
}

fn parse(line: &str) -> Value {
    serde_json::from_str(line).unwrap()
}

fn to_child(actions: &[Action]) -> Vec<Value> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::ToChild(line) => Some(parse(line)),
            _ => None,
        })
        .collect()
}

fn to_client(actions: &[Action]) -> Vec<Value> {
    actions
        .iter()
        .filter_map(|a| match a {
            Action::ToClient(line) => Some(parse(line)),
            _ => None,
        })
        .collect()
}

#[test]
fn warm_cache_answers_handshake_and_lists_without_starting_the_server() {
    let mut proxy = Proxy::new(warm_store());
    let init = proxy.on_client(INIT);
    assert_eq!(to_client(&init)[0]["result"], init_result());
    assert!(proxy.on_client(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#).is_empty());
    let list = proxy.on_client(r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#);
    assert_eq!(to_client(&list)[0]["result"], tools(&["alpha"]));
    let ping = proxy.on_client(r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#);
    assert_eq!(to_client(&ping)[0]["result"], json!({}));
    let all = [init, list, ping].concat();
    assert!(!all.iter().any(|a| matches!(a, Action::Spawn(_) | Action::ToChild(_))));
}

#[test]
fn first_tool_call_starts_the_server_replays_initialize_then_forwards() {
    let mut proxy = Proxy::new(warm_store());
    proxy.on_client(INIT);
    let call = r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"alpha","arguments":{}}}"#;
    let start = proxy.on_client(call);
    assert_eq!(start[0], Action::Spawn(1));
    let replay = &to_child(&start)[0];
    assert_eq!(replay["method"], "initialize");
    assert_eq!(replay["params"]["protocolVersion"], "2025-06-18");
    let init_id = replay["id"].as_str().unwrap().to_string();

    let after_init = proxy.on_child(
        1,
        &json!({"jsonrpc":"2.0","id":init_id,"result":init_result()}).to_string(),
    );
    let sent = to_child(&after_init);
    assert_eq!(sent[0]["method"], "notifications/initialized");
    assert_eq!(sent[1]["method"], "tools/list");
    let list_id = sent[1]["id"].clone();

    // Same list as the cache: no list_changed, the queued call goes out.
    let ready = proxy.on_child(
        1,
        &json!({"jsonrpc":"2.0","id":list_id,"result":tools(&["alpha"])}).to_string(),
    );
    assert!(to_client(&ready).is_empty());
    assert_eq!(to_child(&ready), vec![parse(call)]);

    let reply = r#"{"jsonrpc":"2.0","id":7,"result":{"content":[]}}"#;
    assert_eq!(proxy.on_child(1, reply), vec![Action::ToClient(reply.to_string())]);
    assert!(!proxy.has_pending());
}

#[test]
fn a_changed_tool_list_is_cached_and_announced() {
    let store = warm_store();
    let mut proxy = Proxy::new(store.clone());
    proxy.on_client(INIT);
    let start = proxy.on_client(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"alpha"}}"#);
    let init_id = to_child(&start)[0]["id"].clone();
    let sent = to_child(&proxy.on_child(1, &json!({"jsonrpc":"2.0","id":init_id,"result":init_result()}).to_string()));
    let ready = proxy.on_child(1, &json!({"jsonrpc":"2.0","id":sent[1]["id"],"result":tools(&["alpha","beta"])}).to_string());
    assert_eq!(to_client(&ready)[0]["method"], "notifications/tools/list_changed");
    assert_eq!(store.load("2025-06-18").unwrap().lists["tools/list"], tools(&["alpha", "beta"]));
}

#[test]
fn cold_cache_starts_on_initialize_and_fills_the_cache() {
    let store = MemoryStore::default();
    let mut proxy = Proxy::new(store.clone());
    let start = proxy.on_client(INIT);
    assert_eq!(start[0], Action::Spawn(1));
    let init_id = to_child(&start)[0]["id"].clone();
    let sent = to_child(&proxy.on_child(1, &json!({"jsonrpc":"2.0","id":init_id,"result":init_result()}).to_string()));
    let ready = proxy.on_child(1, &json!({"jsonrpc":"2.0","id":sent[1]["id"],"result":tools(&["alpha"])}).to_string());
    let replies = to_client(&ready);
    assert_eq!(replies.len(), 1, "initialize answered once, no list_changed on a cold cache");
    assert_eq!(replies[0]["id"], 0);
    assert_eq!(replies[0]["result"], init_result());
    assert!(store.load("2025-06-18").is_some());
}

#[test]
fn server_exit_fails_in_flight_requests_and_the_next_call_restarts_it() {
    let mut proxy = Proxy::new(warm_store());
    proxy.on_client(INIT);
    let start = proxy.on_client(r#"{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"alpha"}}"#);
    assert_eq!(start[0], Action::Spawn(1));
    let failed = proxy.on_child_exit(1);
    let errors = to_client(&failed);
    assert_eq!(errors[0]["id"], 9);
    assert!(errors[0]["error"]["message"].as_str().unwrap().contains("exited"));
    // A late line from the dead generation is ignored.
    assert!(proxy.on_child(1, r#"{"jsonrpc":"2.0","id":9,"result":{}}"#).is_empty());
    let again = proxy.on_client(r#"{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"alpha"}}"#);
    assert_eq!(again[0], Action::Spawn(2));
}

#[test]
fn stateless_client_without_initialize_is_passed_through() {
    let mut proxy = Proxy::new(MemoryStore::default());
    let line = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{}}}"#;
    let first = proxy.on_client(line);
    assert_eq!(first, vec![Action::Spawn(1), Action::ToChild(line.to_string())]);
    let reply = r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#;
    assert_eq!(proxy.on_child(1, reply), vec![Action::ToClient(reply.to_string())]);
    assert_eq!(proxy.on_child_exit(1), vec![Action::Exit]);
}

#[test]
fn discover_probe_is_refused_so_the_client_falls_back_to_initialize() {
    let mut proxy = Proxy::new(warm_store());
    let out = proxy.on_client(r#"{"jsonrpc":"2.0","id":1,"method":"server/discover"}"#);
    assert_eq!(to_client(&out)[0]["error"]["code"], -32601);
    assert!(!out.iter().any(|a| matches!(a, Action::Spawn(_))));
}

#[test]
fn paginated_list_requests_bypass_the_cache() {
    let mut proxy = Proxy::new(warm_store());
    proxy.on_client(INIT);
    let out = proxy.on_client(r#"{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{"cursor":"p2"}}"#);
    assert_eq!(out[0], Action::Spawn(1));
}
