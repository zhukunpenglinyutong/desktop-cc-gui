import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { ipc, type Message } from "@/lib/ipc";
import type { ActiveSession } from "./persistence";
import { EMPTY_SESSION, type SessionState } from "./stream";
import { createTabActions } from "./tabs";
import type { ChatStore } from "./types";

function makeTab(id: string): ActiveSession {
  return { engine: "omp", sessionId: id, workspacePath: "/ws" };
}

function makeSession(chars: number): SessionState {
  const messages: Message[] = [
    {
      seq: 1,
      role: "tool",
      text: "bash",
      ts: null,
      result: "x".repeat(chars),
    },
  ];
  return { ...EMPTY_SESSION, messages };
}

function setup(tabs: ActiveSession[], bySession: Record<string, SessionState>) {
  const store = createStore<ChatStore>(() => ({
    openTabs: tabs,
    active: tabs[0] ?? null,
    activeEngine: "omp",
    workspaces: [],
    sessions: [],
    engines: [],
    bySession,
    streamingByKey: {},
    retryingByKey: {},
    drafts: {},
    composerAttachments: {},
    composerAttachmentMoves: [],
    unseen: {},
    providers: {},
    models: {},
    efforts: {},
    workspaceDefaultEngines: {},
    sessionContributions: {},
    selectSession: vi.fn(async () => {}),
    setAppSettings: vi.fn(),
  }) as unknown as ChatStore);

  const actions = createTabActions({
    set: store.setState,
    get: store.getState,
  });
  store.setState(actions);
  return { store, actions };
}

describe("closedTabCache eviction", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("evicts oversized closed sessions beyond the byte budget even below count limit", () => {
    const tabs = [makeTab("s1"), makeTab("s2"), makeTab("s3")];
    const bySession: Record<string, SessionState> = {
      "omp/s1": makeSession(5_000_000),
      "omp/s2": makeSession(5_000_000),
      "omp/s3": makeSession(1_000),
    };
    const { store, actions } = setup(tabs, bySession);

    actions.closeTab("omp", "s1", "/ws");
    expect(store.getState().bySession["omp/s1"]).toBeDefined();

    // Closing s2 pushes cached closed sessions over 8M chars -> oldest (s1) evicted
    actions.closeTab("omp", "s2", "/ws");
    expect(store.getState().bySession["omp/s1"]).toBeUndefined();
    expect(store.getState().bySession["omp/s2"]).toBeDefined();
  });

  it("keeps streaming closed tabs out of byte eviction", () => {
    const tabs = [makeTab("s1"), makeTab("s2"), makeTab("s3"), makeTab("s4")];
    const bySession: Record<string, SessionState> = {
      "omp/s1": makeSession(5_000_000),
      "omp/s2": makeSession(2_000_000),
      "omp/s3": makeSession(2_000_000),
      "omp/s4": makeSession(1_000),
    };
    const { store, actions } = setup(tabs, bySession);
    store.setState({ streamingByKey: { "omp/s1": true } });

    actions.closeTab("omp", "s1", "/ws");
    actions.closeTab("omp", "s2", "/ws");
    expect(store.getState().bySession["omp/s1"]).toBeDefined();
    expect(store.getState().bySession["omp/s2"]).toBeDefined();

    // Closing s3 (2M) pushes total past 8M -> skips streaming s1 and evicts s2
    actions.closeTab("omp", "s3", "/ws");
    expect(store.getState().bySession["omp/s1"]).toBeDefined();
    expect(store.getState().bySession["omp/s2"]).toBeUndefined();
    expect(store.getState().bySession["omp/s3"]).toBeDefined();
  });
});

describe("OMP ACP daemon prewarm and close lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("prewarms on new OMP chat, session switch, and closes session on tab close", () => {
    const prewarm = vi.spyOn(ipc, "prewarmOmpSession").mockResolvedValue(undefined);
    const closeOmp = vi.spyOn(ipc, "closeOmpSession").mockResolvedValue(undefined);
    const tabs = [makeTab("s1"), makeTab("s2")];
    const { actions } = setup(tabs, {});

    actions.focusTab("omp", "s2", "/ws");
    expect(prewarm).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: "/ws", sessionId: "s2" }),
    );

    prewarm.mockClear();
    actions.startNewChat("/ws", "omp");
    expect(prewarm).toHaveBeenCalledWith(
      expect.objectContaining({ workspacePath: "/ws", sessionId: null }),
    );

    actions.closeTab("omp", "s1", "/ws");
    expect(closeOmp).toHaveBeenCalledWith("s1");
  });
});
