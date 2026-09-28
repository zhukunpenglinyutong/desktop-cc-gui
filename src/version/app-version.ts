import { version } from "../../package.json";

/** Host build version, compiled in from package.json — the single source of
 *  truth that release scripts bump alongside Cargo.toml/tauri.conf.json.
 *  Used as the fallback when the native version bridge is unavailable, so it
 *  must never be a hand-maintained literal (it would silently go stale). */
export const APP_VERSION: string = version;
