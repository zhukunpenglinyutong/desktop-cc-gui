import { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversationModeRegistry, type PluginConversationProps } from "@ccgui/plugin-sdk";
import { useChatStore, sessionKey, type ActiveSession } from "@/features/chat/store";
import { EMPTY_SESSION } from "@/features/chat/store/stream";
import { ChatConversation } from "@/features/chat/components/ChatConversation";
import { getConversationModeState } from "./state";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import "@/lib/i18n";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../runtime/loader", () => ({ notePluginRenderOk: vi.fn(), reportPluginCrash: vi.fn() }));
vi.mock("@/components/application/ai-chat/cli-menu", () => ({ CliMenu: () => <span>CLI selector</span> }));
vi.mock("@/components/application/ai-chat/add-menu", () => ({ AddMenu: () => null }));
vi.mock("@/components/application/ai-chat/permission-menu", () => ({ PermissionMenu: () => null }));
vi.mock("@/features/chat/components/use-branch-switcher", () => ({ useBranchSwitcher: () => ({}) }));
vi.mock("@/features/chat/components/use-engine-models", () => ({ useEngineModels: () => ({
  catalogs: {}, modelsByEngine: {}, channelsByEngine: {}, pendingEngines: {}, refresh: vi.fn(),
}) }));
vi.mock("@/features/chat/components/MessageTimeline", () => ({ MessageTimeline: () => <div data-testid="timeline">Normal history</div> }));
vi.mock("@/features/chat/components/ConversationFooter", () => ({
  ConversationFooter: ({ cliMenu, draft }: { cliMenu: ReactNode; draft: string }) => <div data-testid="footer">{cliMenu}<textarea data-testid="normal-composer" value={draft} readOnly /></div>,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChatConversation mode integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let dispose: () => void;
  const active: ActiveSession = { engine: "pi", sessionId: "native-session", workspacePath: "/workspace" };
  const key = sessionKey(active.engine, active.sessionId, active.workspacePath);
  const session = { ...EMPTY_SESSION, messages: [], queue: [] };
  const composerRef = createRef<ComposerInputHandle>();
  let modeProps: PluginConversationProps;

  function Harness() {
    const current = useChatStore((state) => state.active);
    return <ChatConversation active={current} engines={[]} workspaces={[]} startNewChat={vi.fn()} composerInputRef={composerRef} />;
  }
  beforeEach(() => {
    useChatStore.setState({ active, openTabs: [active], bySession: { [key]: session }, drafts: { [key]: "Untouched ordinary draft" }, pendingMention: null });
    dispose = conversationModeRegistry.register({ id: "plugin:relay", label: () => "Relay", component: (props) => {
      modeProps = props;
      return <textarea data-testid="plugin-composer" defaultValue="Plugin transcript" />;
    } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<Harness />));
  });
  afterEach(() => {
    if (modeProps) getConversationModeState().setExitBlocked(modeProps.conversationId, "plugin:relay", false);
    act(() => { root.unmount(); dispose(); });
    container.remove();
    useChatStore.setState({ active: null, openTabs: [], bySession: {}, drafts: {} });
  });
  const enter = () => act(() => [...container.querySelectorAll("button")].find((button) => button.textContent === "Relay")!.click());

  it("keeps busy draft tabs addressable through close, close-all and new-chat attempts", () => {
    const draft: ActiveSession = { engine: "pi", sessionId: null, workspacePath: "/draft" };
    const other: ActiveSession = { engine: "pi", sessionId: null, workspacePath: "/other" };
    act(() => useChatStore.setState({ active: draft, activeEngine: "pi", openTabs: [draft, other] }));
    enter();
    const identity = modeProps.conversationId;
    act(() => modeProps.setExitBlocked!(true));
    act(() => useChatStore.getState().closeTab("pi", null, "/draft"));
    expect(useChatStore.getState().openTabs).toContainEqual(draft);
    expect(useChatStore.getState().active).toEqual(draft);
    act(() => useChatStore.getState().startNewChat("/draft"));
    expect(modeProps.conversationId).toBe(identity);
    act(() => useChatStore.getState().setActiveEngine("codex"));
    expect(useChatStore.getState().active).toEqual(draft);
    expect(useChatStore.getState().activeEngine).toBe("pi");
    act(() => useChatStore.setState({ active: other }));
    act(() => {
      for (const tab of useChatStore.getState().openTabs) {
        useChatStore.getState().closeTab(tab.engine, tab.sessionId, tab.workspacePath);
      }
    });
    expect(useChatStore.getState().openTabs).toEqual([draft]);
    expect(modeProps.conversationId).toBe(identity);
    expect(container.querySelector('[data-testid="plugin-composer"]')).not.toBeNull();
    act(() => modeProps.setExitBlocked!(false));
    act(() => useChatStore.getState().closeTab("pi", null, "/draft"));
    expect(useChatStore.getState().openTabs).toEqual([]);
    act(() => useChatStore.getState().startNewChat("/draft"));
    expect(container.querySelector('[data-testid="normal-composer"]')).not.toBeNull();
    enter();
    expect(modeProps.conversationId).not.toBe(identity);
  });

  it("does not expose normal sending when a locked mode is unregistered", () => {
    enter();
    act(() => modeProps.setExitBlocked!(true));
    act(dispose);
    expect(container.querySelector('[data-testid="normal-composer"]')).toBeNull();
    act(() => useChatStore.getState().closeTab(active.engine, active.sessionId, active.workspacePath));
    expect(useChatStore.getState().openTabs).toContainEqual(active);
    const identity = modeProps.conversationId;
    act(() => {
      dispose = conversationModeRegistry.register({ id: "plugin:relay", label: () => "Relay", component: (props) => {
        modeProps = props;
        return <textarea data-testid="plugin-composer" />;
      } });
    });
    expect(modeProps.conversationId).toBe(identity);
    expect(container.querySelector("button")!.disabled).toBe(true);
    expect(container.querySelector('[data-testid="plugin-composer"]')).not.toBeNull();
  });

  it("replaces timeline and composer with exactly one plugin surface and restores unchanged normal state", () => {
    expect(container.querySelector('[data-testid="timeline"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="footer"]')?.textContent).toContain("CLI selectorRelay");
    enter();
    expect(container.querySelector('[data-testid="timeline"]')).toBeNull();
    expect(container.querySelector('[data-testid="normal-composer"]')).toBeNull();
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(modeProps.workspacePath).toBe("/workspace");
    expect(modeProps.conversationId).toContain(key);
    const identity = modeProps.conversationId;
    act(() => { modeProps.setExitBlocked!(true); modeProps.onExit(); });
    expect(container.querySelector('[data-testid="normal-composer"]')).toBeNull();
    expect(container.querySelector("button")!.disabled).toBe(true);
    act(() => container.querySelector("button")!.click());
    expect(container.querySelector('[data-testid="normal-composer"]')).toBeNull();
    act(() => modeProps.setExitBlocked!(false));
    act(() => modeProps.onExit());
    expect(container.querySelector('[data-testid="timeline"]')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="normal-composer"]')?.value).toBe("Untouched ordinary draft");
    expect(container.querySelector('[data-testid="plugin-composer"]')).toBeNull();
    expect(useChatStore.getState().bySession[key]).toBe(session);
    enter();
    expect(modeProps.conversationId).toBe(identity);
    act(dispose);
    expect(container.querySelector('[data-testid="normal-composer"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="plugin-composer"]')).toBeNull();
  });

  it("blocks ordinary streaming and queued sends, and does not carry mode into another workspace", () => {
    act(() => useChatStore.setState({ bySession: { [key]: { ...session, streaming: true } } }));
    enter();
    expect(container.querySelector('[data-testid="plugin-composer"]')).toBeNull();
    act(() => useChatStore.setState({ bySession: { [key]: { ...session, queue: [{ id: "q", text: "queued", images: [], queuedAt: 1 }] } } }));
    enter();
    expect(container.querySelector('[data-testid="plugin-composer"]')).toBeNull();
    act(() => useChatStore.setState({ bySession: { [key]: session } }));
    enter();
    const firstIdentity = modeProps.conversationId;
    const second = { ...active, workspacePath: "/another-workspace" };
    act(() => useChatStore.setState({ active: second, openTabs: [active, second] }));
    expect(container.querySelector('[data-testid="plugin-composer"]')).toBeNull();
    enter();
    expect(modeProps.conversationId).not.toBe(firstIdentity);
    act(() => useChatStore.setState({ active }));
    expect(modeProps.conversationId).toBe(firstIdentity);
  });
});

/**
 * 空态的前提有两种，文案不能混：一条工作区都没有时，用户缺的不是「选一个
 * 会话」而是「先有一个可归属的目录」——「新建会话」此刻会先弹目录选择器。
 * 首启用户看到的正是这个状态，所以它必须说自己缺什么。
 */
describe("ChatConversation 空态前提", () => {
  let container: HTMLDivElement;
  let root: Root;
  const composerRef = createRef<ComposerInputHandle>();

  function EmptyHarness() {
    const current = useChatStore((state) => state.active);
    return (
      <ChatConversation
        active={current}
        engines={[]}
        workspaces={[]}
        startNewChat={vi.fn()}
        composerInputRef={composerRef}
      />
    );
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useChatStore.setState({ active: null, openTabs: [], bySession: {}, drafts: {}, workspaces: [] });
  });

  it("零工作区时说「先添加工作区」，而不是「选择或新建一个会话」", () => {
    act(() =>
      useChatStore.setState({ active: null, openTabs: [], workspaces: [], bySession: {}, drafts: {} }),
    );
    act(() => root.render(<EmptyHarness />));
    expect(container.textContent).toContain("还没有工作区，请先在侧栏添加");
    expect(container.textContent).not.toContain("选择或新建一个会话开始");
  });

  it("已有工作区但没有会话时保留「选择或新建一个会话」", () => {
    act(() =>
      useChatStore.setState({
        active: null,
        openTabs: [],
        workspaces: [
          { id: "w1", path: "/ws/a", name: "a", sortOrder: 0, groupId: null, lastOpenedAt: null },
        ],
        bySession: {},
        drafts: {},
      }),
    );
    act(() => root.render(<EmptyHarness />));
    expect(container.textContent).toContain("选择或新建一个会话开始");
    // 提示行只属于「零工作区」分支；有工作区时不该再出现（提示里含「工作区」三字）。
    expect(container.textContent).not.toContain("用侧栏「新建会话」");
  });
});
