/**
 * Official CLI installer scripts (claude / codex native channel) run in the
 * built-in terminal: the dialog types the backend-planned line (`plan.
 * terminalCommand`) into a fresh tab of the active workspace's dock, where
 * the user watches the output and can Ctrl+C. The app no longer runs them as
 * a hidden PowerShell child — a download-and-execute pattern endpoint
 * security flags. npm installs keep streaming inside the dialog.
 */
import { ipc } from "@/lib/ipc";
import { useChatStore } from "@/features/chat/store";
import { ensureTerminalOutputListener, hasTerminalSession } from "@/features/terminal/sessions";
import { useTerminalStore } from "@/features/terminal/store";
import { ENTER, openDedicatedTerminalTab, settleTerminalBacklog, waitForSession } from "./terminalLogin";

export type CliTerminalLaunch =
  | { ok: true; terminalId: string }
  /** The terminal dock belongs to a workspace; none is active. */
  | { ok: false; reason: "no-workspace" }
  /** The tab opened but its PTY never became usable, or the write failed. */
  | { ok: false; reason: "terminal-unavailable" };

/** Open one dedicated terminal tab and type the planned install line. Any
 * failure closes only the tab this launch created. */
export async function launchCliInstallInTerminal(line: string): Promise<CliTerminalLaunch> {
  const workspacePath = useChatStore.getState().active?.workspacePath;
  if (!workspacePath) return { ok: false, reason: "no-workspace" };

  const id = openDedicatedTerminalTab(workspacePath);
  if (!id) return { ok: false, reason: "terminal-unavailable" };
  const unavailable = (): CliTerminalLaunch => {
    useTerminalStore.getState().closeTab(workspacePath, id);
    return { ok: false, reason: "terminal-unavailable" };
  };

  if (!(await waitForSession(id))) return unavailable();
  ensureTerminalOutputListener();
  // Let the shell prompt draw first, so the line is not typed into a
  // half-initialized shell.
  await settleTerminalBacklog(id);
  if (!hasTerminalSession(id)) return unavailable();
  try {
    await ipc.terminalWrite(id, `${line}${ENTER}`);
  } catch {
    return unavailable();
  }
  return { ok: true, terminalId: id };
}

export { terminalInstallOutcome, type TerminalInstallOutcome } from "./cliInstallMarker";
