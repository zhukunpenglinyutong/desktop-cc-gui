//! OpenCode engine — managed-server variant.
//!
//! The built-in `question` tool parks server-side and is answered over HTTP,
//! so a one-shot `opencode run` (nobody to ask) was migrated to the managed
//! `opencode serve` ([`super::opencode_server`]): the turn runs as a server
//! session (create/resume → prompt_async → SSE events), projected in
//! [`super::opencode_session::run_server_turn`]. Verified live: `run --attach
//! --format json` prints NO transcript, so parsing a run child was never an
//! option — the server event stream is the only complete channel.

use super::{BuiltCommand, Engine, EngineEvent, SendRequest};

pub struct OpenCodeEngine;

impl Engine for OpenCodeEngine {
    fn id(&self) -> &'static str {
        "opencode"
    }

    fn drives_own_transport(&self) -> bool {
        true
    }

    /// Never invoked on the virtual path (`send_host_stream` branches before
    /// the process spawn); a stub keeps the trait contract honest.
    fn build_command(&self, _req: &SendRequest, _bin: &str) -> Result<BuiltCommand, String> {
        Err("opencode runs as a server session; no child process to build".to_string())
    }

    /// Never invoked on the virtual path: frames arrive over the server SSE
    /// and are projected to engine events in opencode_session.
    fn parse_line(&self, _line: &str, _out: &mut Vec<EngineEvent>) {}

    fn supports_images(&self) -> bool {
        // prompt_async parts accept data-URL file parts; that IS the serve
        // image transport.
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }

    fn supported_permissions(&self) -> &'static [&'static str] {
        // serve has no mid-turn approval UI we show (permission.asked is
        // auto-answered): "auto"/"plan" reply "once" per ask; "bypass"
        // replies "always" so matching asks stop round-tripping for the
        // rest of the session — the serve-world equivalent of `run --auto`
        // (approve everything not explicitly denied; config denies never
        // reach us either way). "plan" selects the read-only plan agent in
        // the prompt body.
        &["auto", "plan", "bypass"]
    }

}
