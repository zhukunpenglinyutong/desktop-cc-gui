// `tauri dev` beforeDevCommand: start vite at once and build the computer-use
// helper (src-tauri/src/bin/ccgui-computer-use) beside it.
//
// `tauri dev` runs `cargo run`, which builds only the main binary, so the
// helper needs its own build. It must not sit in front of vite: a cold build
// compiles the whole lib first, and tauri waits for the dev server with a
// timeout. A failed helper build (e.g. Windows still running an old helper
// exe) only warns — `/ccgui-cua` then reports the driver missing until the
// next successful build. Editing helper sources needs a dev restart or a
// manual `cargo build --bin ccgui-computer-use`.
import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";

const helper = spawn(
  "cargo",
  ["build", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "ccgui-computer-use"],
  { stdio: ["ignore", "inherit", "inherit"] },
);
helper.on("error", (error) => {
  console.warn(`[dev] computer-use helper build did not start: ${error.message}`);
});
helper.on("exit", (code, signal) => {
  if (code !== 0 && signal === null) {
    console.warn(`[dev] computer-use helper build failed (exit ${code}); computer use is unavailable until it builds`);
  }
});

// npx is a .cmd shim on Windows, which spawn only resolves through a shell.
const vite = spawn("npx", ["vite"], { stdio: "inherit", shell: isWindows });

function stopAll(signal) {
  if (helper.exitCode === null) helper.kill(signal);
  if (vite.exitCode === null) vite.kill(signal);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => stopAll(signal));
}
vite.on("exit", (code) => {
  stopAll("SIGTERM");
  process.exit(code ?? 0);
});
vite.on("error", (error) => {
  console.error(`[dev] vite did not start: ${error.message}`);
  stopAll("SIGTERM");
  process.exit(1);
});
