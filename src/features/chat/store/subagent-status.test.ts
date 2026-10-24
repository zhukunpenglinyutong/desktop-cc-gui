import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "../store";
import { AGENT_STATUS_ROLE, ipc, type Message, type SessionPage } from "@/lib/ipc";

const KEY = "omp/s1";

function message(seq: number, role: string, text = ""): Message {
  return { seq, role, text, ts: null };
}

function delivery(seq: number, status = "completed"): Message {
  return {
    ...message(seq, AGENT_STATUS_ROLE),
    ts: "2026-10-19T06:34:32.530Z",
    result: {
      details: { op: "async", jobs: [{ id: "Worker", type: "task", status }] },
    },
  };
}

function page(messages: Message[], subagentHistory: Message[] = []): SessionPage {
  return { messages, nextBefore: null, subagentHistory };
}

/** A session that dispatched a subagent but whose stream stopped after the
 *  last "running" snapshot — the state the panel reads. */
function seed(messages: Message[], subagentHistory: Message[] = []) {
  useChatStore.setState({
    openTabs: [{ engine: "omp", sessionId: "s1", workspacePath: "/ws" }],
    bySession: {
      [KEY]: { messages, subagentHistory, streaming: false } as never,
    },
  });
}

function stored() {
  return useChatStore.getState().bySession[KEY]!;
}

describe("refreshSubagentStatus", () => {
  beforeEach(() => {
    localStorage.clear();
    useChatStore.setState({ bySession: {}, openTabs: [] });
    vi.restoreAllMocks();
  });

  it("appends a late job delivery at the transcript tail, once", async () => {
    const running: Message = {
      ...message(2, "tool", "hub · Waiting"),
      args: { op: "wait" },
      result: { details: { jobs: [{ id: "Worker", status: "running" }] } },
    };
    seed(
      [
        message(1, "user", "review"),
        { ...message(2, "tool", "task · Dispatching"), args: { tasks: [{ name: "Worker" }] } },
        { ...running, seq: 3 },
      ],
      [message(4, "tool", "hub")],
    );
    const load = vi
      .spyOn(ipc, "loadSessionPage")
      // The page also carries the dispatch; only the delivery is new.
      .mockResolvedValue(page([delivery(9)], [message(1, "user", "review")]));

    await useChatStore.getState().refreshSubagentStatus(KEY);

    const messages = stored().messages;
    expect(messages).toHaveLength(4);
    expect(messages.at(-1)!.role).toBe(AGENT_STATUS_ROLE);
    // Newest row wins the step: the older "running" snapshot must not.
    const seqs = messages.map((row) => row.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(messages.at(-1)!.seq).toBe(5);

    // A second reconcile re-reads the same delivery and adds nothing.
    await useChatStore.getState().refreshSubagentStatus(KEY);
    expect(stored().messages).toHaveLength(4);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("takes deliveries from the folded history too", async () => {
    seed([message(1, "user", "review"), { ...message(2, "tool", "task"), args: { tasks: [] } }]);
    vi.spyOn(ipc, "loadSessionPage").mockResolvedValue(page([], [delivery(3)]));

    await useChatStore.getState().refreshSubagentStatus(KEY);

    const messages = stored().messages;
    expect(messages.at(-1)!.role).toBe(AGENT_STATUS_ROLE);
    expect(stored().subagentHistory).toEqual([]);
  });

  it("drops the read when a newer turn already replaced the messages", async () => {
    seed([message(1, "user", "review"), { ...message(2, "tool", "task"), args: { tasks: [] } }]);
    const read = Promise.withResolvers<SessionPage>();
    vi.spyOn(ipc, "loadSessionPage").mockReturnValue(read.promise);

    const pending = useChatStore.getState().refreshSubagentStatus(KEY);
    const newer = [message(7, "user", "next"), { ...message(8, "tool", "task"), args: { tasks: [] } }];
    useChatStore.setState((state) => ({
      bySession: { ...state.bySession, [KEY]: { ...stored(), messages: newer } },
    }));
    read.resolve(page([delivery(9)]));
    await pending;

    expect(stored().messages).toBe(newer);
  });

  it("skips the read when the session never dispatched anything", async () => {
    seed([message(1, "user", "hello"), message(2, "assistant", "hi")]);
    const load = vi.spyOn(ipc, "loadSessionPage");

    await useChatStore.getState().refreshSubagentStatus(KEY);

    expect(load).not.toHaveBeenCalled();
  });
});
