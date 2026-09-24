import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/ipc";
import { useChatStore } from "./store";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION } from "./store/stream";
import {
  mergeMissingTranscriptRows,
  mergeTranscriptTail,
} from "./store/sessions";

/**
 * C2: a foreign run's content frames are dropped while the session streams
 * a newer run (see engine-events' FOREIGN_CONTENT_KINDS). When that run
 * settles, the session's transcript is re-read and the rows the live view
 * missed are merged back — without disturbing the in-flight run.
 */

vi.mock("@/lib/ipc", () => ({
  ipc: {
    rescanSessions: vi.fn(async () => {}),
    usageRecord: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
}));

const KEY = sessionKey("claude", "s-1", "/tmp/ws");
const TAB = { engine: "claude", sessionId: "s-1", workspacePath: "/tmp/ws" };

const msg = (seq: number, role: string, text: string, extra?: Partial<Message>): Message => ({
  seq, role, text, ts: null, ...extra,
});

/** The live view: A's reply streamed, B's turn is in flight; A's completion
 *  turn ("工作流完成：全部成功") was dropped while B streamed. */
const localMessages = (): Message[] => [
  msg(1, "user", "跑一下"),
  msg(2, "assistant", "正文段", { usage: { input_tokens: 7 } }),
  msg(3, "user", "下一句"),
  msg(4, "assistant", "B 的部分回复", { live: true }),
];

/** The transcript once A settled: complete, with A's completion turn in
 *  chronological position between A's reply and B's user message. */
const historyMessages = (): Message[] => [
  msg(1, "user", "跑一下"),
  msg(2, "assistant", "正文段", { usage: { input_tokens: 7 } }),
  msg(3, "assistant", "工作流完成：全部成功"),
  msg(4, "user", "下一句"),
];

describe("mergeMissingTranscriptRows", () => {
  it("inserts missing transcript rows at their aligned position", () => {
    const merged = mergeMissingTranscriptRows(localMessages(), historyMessages());
    expect(merged.map((m) => m.text)).toEqual([
      "跑一下",
      "正文段",
      "工作流完成：全部成功",
      "下一句",
      "B 的部分回复",
    ]);
    // The in-flight run's live row is untouched and stays last.
    expect(merged[merged.length - 1].live).toBe(true);
    // Existing rows keep their identity; the inserted row gets a fresh,
    // collision-free seq.
    expect(merged[1].seq).toBe(2);
    expect(new Set(merged.map((m) => m.seq)).size).toBe(merged.length);
  });

  it("is idempotent: a fully merged view is returned unchanged", () => {
    const merged = mergeMissingTranscriptRows(localMessages(), historyMessages());
    expect(mergeMissingTranscriptRows(merged, historyMessages())).toBe(merged);
  });

  it("keeps rows a restarted session already loaded", () => {
    // After an app restart the history load already carries the completion
    // turn; merging the same page must not duplicate it.
    const loaded = historyMessages();
    expect(mergeMissingTranscriptRows(loaded, historyMessages())).toBe(loaded);
  });
});

describe("mergeTranscriptTail", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useChatStore.setState({
      openTabs: [TAB],
      active: TAB,
      unseen: {},
      bySession: { [KEY]: { ...EMPTY_SESSION, messages: localMessages() } },
      streamingByKey: {},
    });
  });

  it("merges the missed completion turn into the open session", async () => {
    const loadHistoryPage = vi.fn(async () => ({
      messages: historyMessages(),
      nextBefore: null,
      subagentHistory: [],
    }));
    await mergeTranscriptTail(
      useChatStore.setState,
      useChatStore.getState,
      loadHistoryPage,
      KEY,
      0,
    );
    const messages = useChatStore.getState().bySession[KEY]!.messages;
    expect(messages.map((m) => m.text)).toEqual([
      "跑一下",
      "正文段",
      "工作流完成：全部成功",
      "下一句",
      "B 的部分回复",
    ]);
    expect(loadHistoryPage).toHaveBeenCalledWith("claude", "s-1", "/tmp/ws", 100);

    // A second pass (e.g. both the error and the done fired) is a no-op.
    const before = useChatStore.getState().bySession[KEY]!.messages;
    await mergeTranscriptTail(
      useChatStore.setState,
      useChatStore.getState,
      loadHistoryPage,
      KEY,
      0,
    );
    expect(useChatStore.getState().bySession[KEY]!.messages).toBe(before);
  });

  it("retries once when the transcript write trails the terminal event", async () => {
    const loadHistoryPage = vi
      .fn<() => Promise<{ messages: Message[]; nextBefore: null; subagentHistory: [] }>>()
      .mockResolvedValueOnce({ messages: localMessages().slice(0, 3), nextBefore: null, subagentHistory: [] })
      .mockResolvedValueOnce({ messages: historyMessages(), nextBefore: null, subagentHistory: [] });
    await mergeTranscriptTail(
      useChatStore.setState,
      useChatStore.getState,
      loadHistoryPage,
      KEY,
      1,
    );
    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    const texts = useChatStore.getState().bySession[KEY]!.messages.map((m) => m.text);
    expect(texts).toContain("工作流完成：全部成功");
  });
});
