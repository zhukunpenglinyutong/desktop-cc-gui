import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "../store";
import { sessionKey } from "../store/persistence";
import { EMPTY_SESSION, routeRun, runRouting, untrackRun } from "../store/stream";
import { handleEngineEvents, settledRuns, type EngineEventDeps } from "../store/engine-events";
import {
  setAutoCompactEnabled,
  setAutoCompactThreshold,
} from "../auto-compact-context";
import { ConversationFooter } from "./ConversationFooter";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    compactActiveRun: vi.fn(async () => {}),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    listArchivedSessions: vi.fn(async () => []),
    listPlanReviews: vi.fn(async () => []),
    archiveSession: vi.fn(async () => {}),
    restoreSession: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    loadRemoteSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    deleteSession: vi.fn(async () => {}),
    deleteRemoteSession: vi.fn(async () => {}),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
    usageRecord: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));
// The footer's heavy children are irrelevant here; only its compaction
// orchestration is under test.
vi.mock("@/components/application/ai-chat/ai-chat-composer", () => ({
  Composer: () => null,
  StatusBar: ({ compacting, canCompact, onCompactContext, compactHint }: { compacting: boolean; canCompact: boolean; onCompactContext: () => void; compactHint?: string }) => (
    <button disabled={!canCompact} onClick={onCompactContext} title={compactHint}>{compacting ? "busy" : "compact"}</button>
  ),
}));
vi.mock("@/components/application/ai-chat/message-queue", () => ({
  MessageQueue: () => null,
}));
vi.mock("@/features/plugins/boundary/composer-slot-extras", () => ({
  ComposerSlotExtras: () => null,
}));
vi.mock("./RunStatusStrip", () => ({ RunStatusStrip: () => null }));
vi.mock("./QuestionDock", () => ({
  QuestionDock: () => null,
  usePendingQuestion: () => null,
}));
vi.mock("./PlanReviewDock", () => ({
  PlanReviewDock: () => null,
  usePendingPlanReview: () => null,
}));
vi.mock("./use-composer-file-drop", () => ({
  useComposerFileDrop: () => ({ dropRef: { current: null }, isDragOver: false }),
}));

const WS = "/tmp/ws";
const TAB_A = { engine: "pi", sessionId: "s-a", workspacePath: WS };
const TAB_B = { engine: "pi", sessionId: "s-b", workspacePath: WS };
const KEY_A = sessionKey(TAB_A.engine, TAB_A.sessionId, TAB_A.workspacePath);
const TAB_OMP = { engine: "omp", sessionId: "s-omp", workspacePath: WS };
const KEY_OMP = sessionKey(TAB_OMP.engine, TAB_OMP.sessionId, TAB_OMP.workspacePath);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const originalCompactContext = useChatStore.getState().compactContext;

function footerProps() {
  return {
    active: TAB_A,
    workspaces: [],
    queue: [],
    onRemoveQueued: () => {},
    onMoveQueued: () => {},
    onSendQueuedNow: () => {},
    imageError: null,
    branchError: null,
    onDismissImageError: () => {},
    onDismissBranchError: () => {},
    images: [],
    previews: {},
    onRemoveImage: () => {},
    draft: "",
    onDraftChange: () => {},
    onSubmit: () => {},
    sendShortcut: "enter",
    onStop: () => {},
    streaming: false,
    noEnabledEngines: false,
    composerInputRef: { current: null },
    addMenu: null,
    cliMenu: null,
    permissionMenu: null,
    supportsImages: false,
    onPasteImages: () => {},
    sessionUsage: { input: 90 },
    contextMax: 100,
    branch: undefined,
    branches: undefined,
    branchRepoName: undefined,
    onBranchSelect: () => {},
    startNewChat: () => {},
  };
}

beforeEach(async () => {
  localStorage.clear();
  settledRuns.clear();
  vi.mocked(ipc.sendMessage).mockClear();
  vi.mocked(ipc.compactActiveRun).mockClear();
  for (const runId of [...runRouting.keys()]) {
    runRouting.delete(runId);
    untrackRun(runId);
  }
  await i18n.changeLanguage("zh");
  useChatStore.setState({
    openTabs: [TAB_A, TAB_B],
    active: TAB_A,
    bySession: {
      [KEY_A]: { ...EMPTY_SESSION },
      [TAB_B.engine + "/" + TAB_B.sessionId]: { ...EMPTY_SESSION },
    },
    streamingByKey: {},
    sessions: [],
    compactContext: originalCompactContext,
  });
  // Arm threshold auto-compaction for session A only.
  setAutoCompactEnabled(KEY_A, true);
  setAutoCompactThreshold(KEY_A, 50);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  useChatStore.setState({ compactContext: originalCompactContext });
  vi.restoreAllMocks();
});

function compactionEvent(active: boolean, reason: string, kind: "compaction" | "live_compact_ready" = "compaction") {
  const deps: EngineEventDeps = {
    set: (fn) => useChatStore.setState(fn), get: useChatStore.getState,
    drainQueue: () => {}, markUnseenIfBackground: () => {}, upsertSessionMeta: () => {},
  };
  handleEngineEvents([{ seq: 1, engine: "omp", sessionId: TAB_OMP.sessionId, runId: "run-omp-live", kind, data: { active, reason } }], deps);
}

describe("ConversationFooter compaction ownership", () => {
  it("does not resume into the active tab after an idle compaction tab closes", async () => {
    await act(async () => { root.render(<ConversationFooter {...footerProps()} />); });
    expect(useChatStore.getState().bySession[KEY_A]?.compaction?.trigger).toBe("threshold");
    expect(useChatStore.getState().bySession[KEY_A]?.messages[0]?.text).toBe("/compact");
    await act(async () => {
      useChatStore.getState().closeTab(TAB_A.engine, TAB_A.sessionId, TAB_A.workspacePath);
      handleEngineEvents([{ seq: 1, engine: "pi", runId: "run-1", sessionId: TAB_A.sessionId, kind: "done", data: { usage: null } }], {
        set: (fn) => useChatStore.setState(fn), get: useChatStore.getState,
        drainQueue: () => {}, markUnseenIfBackground: () => {}, upsertSessionMeta: () => {},
      });
      const settled = Promise.withResolvers<void>();
      setTimeout(settled.resolve, 450);
      await settled.promise;
    });
    expect(useChatStore.getState().active?.sessionId).toBe(TAB_B.sessionId);
    expect(useChatStore.getState().bySession[`${TAB_B.engine}/${TAB_B.sessionId}`]?.messages).toEqual([]);
    expect(ipc.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("holds progress after ACK and through growing usage until correlated completion", async () => {
    useChatStore.setState({
      openTabs: [TAB_OMP], active: TAB_OMP,
      bySession: { [KEY_OMP]: { ...EMPTY_SESSION, streaming: true, liveCompactRunId: "run-omp-live" } },
      streamingByKey: { [KEY_OMP]: true },
    });
    routeRun("run-omp-live", KEY_OMP);
    setAutoCompactThreshold(KEY_OMP, 50);
    setAutoCompactEnabled(KEY_OMP, false);
    await act(async () => { root.render(<ConversationFooter {...footerProps()} active={TAB_OMP} streaming />); });
    expect(ipc.compactActiveRun).not.toHaveBeenCalled();
    // Enabling in the middle of this response must take effect now.
    await act(async () => { setAutoCompactEnabled(KEY_OMP, true); });
    expect(useChatStore.getState().bySession[KEY_OMP]?.compaction?.trigger).toBe("threshold");
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.textContent).toContain("busy");
    await act(async () => { root.render(<ConversationFooter {...footerProps()} active={TAB_OMP} streaming sessionUsage={{ input: 95 }} />); });
    await act(async () => { compactionEvent(false, "auto"); });
    expect(container.textContent).toContain("busy");
    expect(ipc.compactActiveRun).toHaveBeenCalledTimes(1);
    await act(async () => { compactionEvent(false, "ccgui-live-compact:1"); });
    expect(useChatStore.getState().bySession[KEY_OMP]?.compaction).toBeNull();
    expect(useChatStore.getState().bySession[KEY_OMP]?.streaming).toBe(true);
    expect(container.querySelector("button")?.disabled).toBe(true);
    await act(async () => { compactionEvent(true, "", "live_compact_ready"); });
    expect(container.querySelector("button")?.disabled).toBe(false);
    expect(ipc.compactActiveRun).toHaveBeenCalledTimes(1);
    expect(ipc.sendMessage).not.toHaveBeenCalled();
    await act(async () => { root.render(<ConversationFooter {...footerProps()} active={TAB_B} sessionUsage={{ input: 0 }} />); });
    await act(async () => { root.render(<ConversationFooter {...footerProps()} active={TAB_OMP} streaming sessionUsage={{ input: 95 }} />); });
    expect(ipc.compactActiveRun).toHaveBeenCalledTimes(1);
  });

  it("does not recompact rounded-up post-turn usage and still triggers a real crossing", async () => {
    useChatStore.setState({
      openTabs: [TAB_OMP], active: TAB_OMP,
      bySession: { [KEY_OMP]: { ...EMPTY_SESSION, streaming: true, liveCompactRunId: "run-omp-live" } },
      streamingByKey: { [KEY_OMP]: true },
    });
    routeRun("run-omp-live", KEY_OMP);
    setAutoCompactThreshold(KEY_OMP, 5);
    setAutoCompactEnabled(KEY_OMP, false);
    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} active={TAB_OMP} streaming contextMax={400_000} sessionUsage={{ input: 44_000 }} />);
    });
    await act(async () => { setAutoCompactEnabled(KEY_OMP, true); });
    expect(ipc.compactActiveRun).toHaveBeenCalledTimes(1);

    await act(async () => {
      compactionEvent(false, "ccgui-live-compact:1");
      compactionEvent(true, "", "live_compact_ready");
      root.render(<ConversationFooter {...footerProps()} active={TAB_OMP} streaming contextMax={400_000} sessionUsage={{ input_tokens: 17_563, contextOnly: true }} />);
    });
    const finalUsage = { input: 17_772, output: 638, totalTokens: 18_410 };
    await act(async () => {
      handleEngineEvents([
        { seq: 2, engine: "omp", sessionId: TAB_OMP.sessionId, runId: "run-omp-live", kind: "usage", data: finalUsage },
        { seq: 3, engine: "omp", sessionId: TAB_OMP.sessionId, runId: "run-omp-live", kind: "done", data: { usage: null } },
      ], {
        set: (fn) => useChatStore.setState(fn), get: useChatStore.getState,
        drainQueue: () => {}, markUnseenIfBackground: () => {}, upsertSessionMeta: () => {},
      });
      root.render(<ConversationFooter {...footerProps()} active={TAB_OMP} contextMax={400_000} sessionUsage={finalUsage} />);
    });
    expect(useChatStore.getState().bySession[KEY_OMP]?.messages.some((m) => m.text === "/compact")).toBe(false);
    expect(useChatStore.getState().bySession[KEY_OMP]?.streaming).toBe(false);
    expect(ipc.sendMessage).not.toHaveBeenCalled();

    routeRun("run-omp-next", KEY_OMP);
    await act(async () => {
      useChatStore.setState((s) => ({
        bySession: { ...s.bySession, [KEY_OMP]: { ...s.bySession[KEY_OMP], streaming: true, liveCompactRunId: "run-omp-next" } },
        streamingByKey: { [KEY_OMP]: true },
      }));
      root.render(<ConversationFooter {...footerProps()} active={TAB_OMP} streaming contextMax={400_000} sessionUsage={{ input: 20_000 }} />);
    });
    expect(ipc.compactActiveRun).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().bySession[KEY_OMP]?.compaction?.runId).toBe("run-omp-next");
  });

  it.each(["claude", "codex"])("%s uses native auto settings without a host idle fallback", async (engine) => {
    const tab = { ...TAB_A, engine };
    const key = `${engine}/${tab.sessionId}`;
    setAutoCompactEnabled(key, true);
    useChatStore.setState({ active: tab, openTabs: [tab], bySession: { [key]: { ...EMPTY_SESSION, streaming: true } }, streamingByKey: { [key]: true } });
    await act(async () => { root.render(<ConversationFooter {...footerProps()} active={tab} streaming />); });
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelector("button")?.title).toBe(i18n.t("chat.compactNativeBusy"));
    await act(async () => {
      useChatStore.setState({ bySession: { [key]: { ...EMPTY_SESSION } }, streamingByKey: {} });
      root.render(<ConversationFooter {...footerProps()} active={tab} />);
    });
    expect(useChatStore.getState().bySession[key]?.compaction).toBeNull();
    expect(ipc.sendMessage).not.toHaveBeenCalled();
  });

  it("does not infer OMP capability from the engine or its routed run", async () => {
    useChatStore.setState({ active: TAB_OMP, openTabs: [TAB_OMP], bySession: { [KEY_OMP]: { ...EMPTY_SESSION, streaming: true } }, streamingByKey: { [KEY_OMP]: true } });
    routeRun("run-omp-live", KEY_OMP);
    setAutoCompactEnabled(KEY_OMP, true);
    await act(async () => { root.render(<ConversationFooter {...footerProps()} active={TAB_OMP} streaming />); });
    expect(container.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelector("button")?.title).toBe(i18n.t("chat.compactUnsupportedBusy"));
    expect(useChatStore.getState().bySession[KEY_OMP]?.compaction).toBeNull();
    expect(ipc.compactActiveRun).not.toHaveBeenCalled();
  });
});
