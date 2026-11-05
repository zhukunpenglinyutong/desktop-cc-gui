/** Mirrors `CLI_DONE_MARKER` in src-tauri/src/cli_lifecycle.rs: a terminal
 * install line prints it followed by the exit code once the installer
 * finishes. The typed line never contains it followed by a digit, so the
 * command's own echo is not mistaken for completion. */
const CLI_DONE = /__CCGUI_CLI_DONE__(\d+)/;

export type TerminalInstallOutcome = "running" | "succeeded" | "failed";

export function terminalInstallOutcome(backlog: string): TerminalInstallOutcome {
  const match = CLI_DONE.exec(backlog);
  if (!match) return "running";
  return match[1] === "0" ? "succeeded" : "failed";
}
