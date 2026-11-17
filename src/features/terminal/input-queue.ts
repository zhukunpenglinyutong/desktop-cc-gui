export interface InputQueueOptions {
  /** Write one chunk to the live PTY. */
  write: (data: string) => Promise<void>;
  /** (Re)open the PTY session; idempotent on the backend. */
  reopen: () => Promise<void>;
  /** Whether a write failure means the PTY is gone, so the shell must be respawned. */
  isSessionGone: (error: unknown) => boolean;
}

export interface TerminalInputQueue {
  /** Queue terminal input; resolves once everything queued so far is written. */
  send: (data: string) => Promise<void>;
}

/**
 * Ordered PTY input. Tauri commands are async and may start out of call order
 * (see `lib/ipc.ts`), so one in-flight write at a time is what keeps typed
 * bytes in sequence; input that arrives meanwhile is coalesced into the next
 * write instead of racing the current one. Keystrokes therefore cost one IPC
 * round trip per burst rather than one per key.
 *
 * A failure caused by a dead shell ("Terminal session not found", e.g. after
 * `exit` or Ctrl-D) reopens the session and resends the same chunk, so input
 * typed into a freshly exited shell is not lost.
 */
export function createInputQueue({
  write,
  reopen,
  isSessionGone,
}: InputQueueOptions): TerminalInputQueue {
  let pending = "";
  let draining: Promise<void> | null = null;

  const drain = async () => {
    try {
      while (pending) {
        const chunk = pending;
        pending = "";
        try {
          await write(chunk);
        } catch (error) {
          if (!isSessionGone(error)) continue;
          try {
            await reopen();
            await write(chunk);
          } catch {
            // The shell could not be restarted; the chunk is dropped, as before.
          }
        }
      }
    } finally {
      draining = null;
    }
  };

  return {
    send(data) {
      if (!data) return Promise.resolve();
      pending += data;
      draining ??= drain();
      return draining;
    },
  };
}
