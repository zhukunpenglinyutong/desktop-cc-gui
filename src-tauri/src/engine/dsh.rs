//! DeepSeek Harness (dsh) engine — host-session variant.
//!
//! 0.1.2's durable streaming lives on the host (`/api/remote.mux` follow
//! stream with the `assistantStream` opt-in), so the engine drives its own
//! transport ([`Engine::drives_own_transport`]) instead of spawning a child
//! process: the turn runs as a host session (create → prompt → deltas),
//! projected in [`super::dsh_session::run_host_turn`]. The host itself is
//! probed/adopted/spawned by [`crate::dsh_host`].

use super::{BuiltCommand, Engine, SendRequest};

pub struct DshEngine;

impl Engine for DshEngine {
    fn id(&self) -> &'static str {
        "dsh"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    /// Never invoked on the virtual path (`send_host_stream` branches before
    /// the process spawn); a stub keeps the trait contract honest.
    fn build_command(&self, _req: &SendRequest, _bin: &str) -> Result<BuiltCommand, String> {
        Err("dsh runs as a host session; no child process to build".to_string())
    }

    /// Never invoked on the virtual path: frames arrive over the mux WS and
    /// are projected directly to engine events.
    fn parse_line(&self, _line: &str, _out: &mut Vec<super::EngineEvent>) {}

    fn supports_images(&self) -> bool {
        false
    }
}
