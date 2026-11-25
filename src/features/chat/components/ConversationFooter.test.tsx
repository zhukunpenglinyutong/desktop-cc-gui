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
// orchestration and the props handed to StatusBar are under test.
const statusBarProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("@/components/application/ai-chat/ai-chat-composer", () => ({
  Composer: () => null,
  StatusBar: (props: Record<string, unknown>) => {
    statusBarProps.current = props;
    return null;
  },
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
const KEY_B = sessionKey(TAB_B.engine, TAB_B.sessionId, TAB_B.workspacePath);

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

describe("ConversationFooter 压缩状态按会话隔离", () => {
  it("A 压缩进行中切到 B：B 的压缩按钮可用，切回 A 仍显示压缩中", async () => {
    const deferredA = Promise.withResolvers<void>();
    const compactSpy = vi.fn((key: string) =>
      key === KEY_A ? deferredA.promise : Promise.resolve(),
    );
    useChatStore.setState({ compactContext: compactSpy as never });

    // Session A crosses its armed threshold on mount; hold that run open.
    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} />);
    });
    expect(compactSpy).toHaveBeenCalledWith(KEY_A, { trigger: "threshold" });
    expect(statusBarProps.current?.compacting).toBe(true);
    expect(statusBarProps.current?.canCompact).toBe(false);

    // Same pane switches to B: the footer is reused, not remounted.
    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} active={TAB_B} />);
    });
    expect(statusBarProps.current?.compacting).toBe(false);
    expect(statusBarProps.current?.canCompact).toBe(true);

    await act(async () => {
      (statusBarProps.current?.onCompactContext as () => void)();
    });
    expect(compactSpy).toHaveBeenCalledWith(KEY_B, { trigger: "manual" });

    // Back on A: its run is still in flight.
    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} />);
    });
    expect(statusBarProps.current?.compacting).toBe(true);
    expect(statusBarProps.current?.canCompact).toBe(false);

    await act(async () => {
      deferredA.resolve();
      await deferredA.promise;
    });
    expect(statusBarProps.current?.compacting).toBe(false);
  });

  it("A 压缩进行中切到 B：B 越过自己的阈值仍会自动压缩", async () => {
    const deferredA = Promise.withResolvers<void>();
    const compactSpy = vi.fn((key: string) =>
      key === KEY_A ? deferredA.promise : Promise.resolve(),
    );
    useChatStore.setState({ compactContext: compactSpy as never });
    setAutoCompactEnabled(KEY_B, true);
    setAutoCompactThreshold(KEY_B, 50);

    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} />);
    });
    expect(compactSpy).toHaveBeenCalledWith(KEY_A, { trigger: "threshold" });

    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} active={TAB_B} />);
    });
    expect(compactSpy).toHaveBeenCalledWith(KEY_B, { trigger: "threshold" });

    await act(async () => {
      deferredA.resolve();
      await deferredA.promise;
    });
  });
});

describe("ConversationFooter 状态栏文件夹显示", () => {
  const ws = (id: string, path: string) => ({
    id,
    path,
    name: path.split("/").pop() ?? path,
    lastOpenedAt: null,
    sortOrder: null,
    groupId: null,
  });

  beforeEach(() => {
    statusBarProps.current = null;
    // These tests render with the armed threshold from the outer beforeEach;
    // neutralize compaction so it can't fire async noise mid-assertion.
    useChatStore.setState({ compactContext: vi.fn(async () => {}) as never });
  });

  it("文件夹列表与当前项优先显示工作区别名，未设别名回退到文件夹名", async () => {
    const workspaces = [ws("w1", "/tmp/alpha"), ws("w2", WS)];
    useChatStore.setState({
      workspaces,
      workspaceAliases: { w2: "我的项目" },
      archivedWorkspaces: [],
    });

    await act(async () => {
      root.render(<ConversationFooter {...footerProps()} workspaces={workspaces} />);
    });

    const props = statusBarProps.current!;
    // w1 has no alias → folder basename; w2 (the active workspace) → alias.
    expect(props.folders).toEqual(["alpha", "我的项目"]);
    expect(props.selectedFolder).toBe("我的项目");
  });

  it("重名工作区按下标选择目标，不会字符串匹配到第一个同名项", async () => {
    const startNewChat = vi.fn();
    const workspaces = [ws("w1", "/tmp/one/app"), ws("w2", "/tmp/two/app")];
    useChatStore.setState({ workspaces, workspaceAliases: {}, archivedWorkspaces: [] });

    await act(async () => {
      root.render(
        <ConversationFooter {...footerProps()} workspaces={workspaces} startNewChat={startNewChat} />,
      );
    });

    const props = statusBarProps.current!;
    expect(props.folders).toEqual(["app", "app"]);
    act(() => {
      (props.onFolderSelect as (index: number) => void)(1);
    });
    expect(startNewChat).toHaveBeenCalledWith("/tmp/two/app");
  });
});
