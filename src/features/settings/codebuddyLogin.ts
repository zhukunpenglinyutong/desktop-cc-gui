/**
 * Login launch for CodeBuddy: the CLI owns the interactive OAuth/login flow,
 * so the app drives its built-in terminal: open the dock on a fresh tab,
 * wait for the PTY, then run codebuddy and trigger /login.
 */
import { ipc } from "@/lib/ipc";
import { useChatStore } from "@/features/chat/store";
import { hasTerminalSession, terminalBacklog, ensureTerminalOutputListener } from "@/features/terminal/sessions";
import { useTerminalStore } from "@/features/terminal/store";

const ENTER = "\r";

function shellQuote(bin: string): string {
  return bin.includes(" ") ? `"${bin}"` : bin;
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Poll until TerminalView has spawned the backend PTY for `id`. */
async function waitForSession(id: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasTerminalSession(id)) return true;
    await delay(100);
  }
  return false;
}

/**
 * Wait until the CLI has actually started before typing `/login` into it.
 * The previous fixed 1.5s delay raced with slow cold starts: the text then
 * landed at the shell prompt and ran as a shell command. We poll the
 * terminal backlog until output grows well past the echoed launch command
 * (the CLI clears the screen and draws its TUI). On timeout we send anyway
 * — that is no worse than the old fixed delay.
 */
async function waitForCliReady(
  id: string,
  baseline: number,
  echoLength: number,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Echo of the launch line plus shell control bytes; real CLI output (TUI
  // redraw) is far larger than this slack.
  const threshold = baseline + echoLength + 80;
  while (Date.now() < deadline) {
    if (terminalBacklog(id).length > threshold) return;
    await delay(200);
  }
}

/**
 * Open the terminal dock on a fresh tab and start CodeBuddy login flow.
 * Returns false when there is no active workspace to host the terminal.
 */
export async function launchCodeBuddyLogin(): Promise<boolean> {
  const workspacePath = useChatStore.getState().active?.workspacePath;
  if (!workspacePath) return false;

  const term = useTerminalStore.getState();
  if (!term.open) term.toggle(workspacePath);
  useTerminalStore.getState().newTab(workspacePath);
  const id = useTerminalStore.getState().activeByWorkspace[workspacePath];
  if (!id) return false;

  const settings = await ipc.getAppSettings().catch(() => null);
  const customBin = settings?.codebuddyBin?.trim();
  const bin = shellQuote(customBin || "codebuddy");

  if (!(await waitForSession(id))) return false;

  ensureTerminalOutputListener(); // idempotent; terminalBacklog depends on it
  const baseline = terminalBacklog(id).length;
  void ipc.terminalWrite(id, `${bin}${ENTER}`).catch(() => {});
  // Fire-and-forget: resolve /login delivery in the background so the
  // caller can navigate away immediately.
  void (async () => {
    await waitForCliReady(id, baseline, bin.length + ENTER.length);
    void ipc.terminalWrite(id, `/login${ENTER}`).catch(() => {});
  })();
  return true;
}
