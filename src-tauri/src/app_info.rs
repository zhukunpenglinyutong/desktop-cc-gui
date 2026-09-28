/// Return the version compiled into the native host. Keeping this command in
/// its own module avoids coupling plugin loading to the optional
/// `tauri-plugin-app` command.
#[tauri::command]
pub fn host_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
