import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "../store";
import { sessionKey } from "../store/persistence";
import { EMPTY_SESSION } from "../store/stream";
import {
  setAutoCompactEnabled,
  setAutoCompactThreshold,
} from "../auto-compact-context";
import { ConversationFooter } from "./ConversationFooter";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
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
  // 记录最近一次传入的 props,好断言多根提示不会顺手禁用输入框(不阻塞)。
  Composer: (props: { disabled?: boolean }) => {
    (globalThis as { __lastComposerProps?: unknown }).__lastComposerProps = props;
    return null;
  },
  StatusBar: () => null,
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
const TAB_A = { engine: "claude", sessionId: "s-a", workspacePath: WS };
const TAB_B = { engine: "claude", sessionId: "s-b", workspacePath: WS };
const KEY_A = sessionKey(TAB_A.engine, TAB_A.sessionId, TAB_A.workspacePath);

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

describe("ConversationFooter 自动压缩续接", () => {
  it("压缩进行中关掉标签页后不发送续接消息，也不落到当前活动会话", async () => {
    // Hold the compaction turn open so the tab can be closed in between.
    const deferred = Promise.withResolvers<void>();
    const compactSpy = vi.fn(() => deferred.promise);
    useChatStore.setState({ compactContext: compactSpy as never });
    const sendSpy = vi.spyOn(useChatStore.getState(), "send");

    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} />);
    });
    expect(compactSpy).toHaveBeenCalledWith(KEY_A, { trigger: "threshold" });

    // The user closes session A's tab while /compact is still running; the
    // store falls back to tab B as the active conversation.
    await act(async () => {
      useChatStore.getState().closeTab(TAB_A.engine, TAB_A.sessionId, TAB_A.workspacePath);
    });
    expect(useChatStore.getState().openTabs.some((t) => t.sessionId === "s-a")).toBe(false);
    expect(useChatStore.getState().active?.sessionId).toBe("s-b");

    await act(async () => {
      deferred.resolve();
      await deferred.promise;
    });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(ipc.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ prompt: i18n.t("chat.autoCompactResume") }),
    );
  });
});

/** 工作区多目录:非 claude 引擎只用主目录的轻提示。仅当「激活工作区含附加根
 *  且当前引擎非 claude」时出现;claude 或单目录都不显示。 */
describe("ConversationFooter 非 claude 多根轻提示", () => {
  const WS_MULTI = {
    id: "w1",
    path: WS,
    name: "ws",
    lastOpenedAt: null,
    sortOrder: 0,
    groupId: null,
    roots: ["/tmp/extra"],
  };

  function setMultiRoot(engine: string) {
    useChatStore.setState({
      activeEngine: engine,
      workspaces: [WS_MULTI as never],
    });
  }

  it("非 claude + 有附加根 → 显示提示,且不阻塞 composer(提交按钮仍在)", async () => {
    setMultiRoot("codex");
    await act(async () => {
      // 有草稿(可发送)时仍不被提示禁用——轻提示不阻塞输入/发送。
      root.render(<ConversationFooter {...footerProps()} draft="hi" />);
    });
    expect(
      document.body.textContent?.includes(
        i18n.t("chat.engineNoMultiRoot", { engine: "Codex CLI" }),
      ),
    ).toBe(true);
    // 轻提示:输入框不被提示禁用(不阻塞)。
    expect(
      (globalThis as { __lastComposerProps?: { disabled?: boolean } }).__lastComposerProps
        ?.disabled,
    ).not.toBe(true);
  });

  it("claude + 有附加根 → 不显示提示(claude 读写全部根)", async () => {
    setMultiRoot("claude");
    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} />);
    });
    expect(
      document.body.textContent?.includes(
        i18n.t("chat.engineNoMultiRoot", { engine: "Claude Code" }),
      ),
    ).toBe(false);
  });
});
