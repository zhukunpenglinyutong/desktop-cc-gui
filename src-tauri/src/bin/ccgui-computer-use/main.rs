//! Computer use driver (电脑操控): a standalone stdio MCP server that engine
//! CLIs spawn only for a send the user explicitly started with computer use.
//!
//! Screen capture (xcap) and mouse/keyboard injection (enigo) live in this
//! binary and nowhere else, so the always-running CC GUI process never links
//! them. The main app only builds the launch spec (computer_use.rs), shows
//! the virtual pointer (cu_overlay.rs) and reports OS permission status.
//!
//! No Tauri runtime here, and stdout is the MCP protocol channel: nothing
//! else may print to it — diagnostics go to stderr.

// Spawned by GUI-launched CLIs: a console-subsystem exe would flash a
// console window on Windows. Pipes are inherited either way.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ax;
mod driver;
mod mcp;

fn main() {
    if let Err(error) = mcp::serve_stdio() {
        eprintln!("[computer-use] MCP server exited: {error}");
        std::process::exit(1);
    }
}
