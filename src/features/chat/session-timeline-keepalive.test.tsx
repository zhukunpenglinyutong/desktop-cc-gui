import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { ChatConversation } from "./components/ChatConversation";
import { useScopedSession } from "./split/session-scope";
import { useChatStore } from "./store";
import { sessionKey, type ActiveSession } from "./store/persistence";
import { EMPTY_SESSION } from "./store/stream";

const timelineLifecycle = vi.hoisted(() => ({
  mounts: [] as string[],
  unmounts: [] as string[],
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    getAppSettings: vi.fn(async () => ({})),
    refreshAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    listPlanReviews: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    listArchivedSessions: vi.fn(async () => []),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/features/plugins/runtime/loader", () => ({
  notePluginRenderOk: vi.fn(),
  reportPluginCrash: vi.fn(),
}));
vi.mock("@/components/application/ai-chat/cli-menu", () => ({ CliMenu: () => null }));
vi.mock("@/components/application/ai-chat/add-menu", () => ({ AddMenu: () => null }));
vi.mock("@/components/application/ai-chat/permission-menu", () => ({
  PermissionMenu: () => null,
}));
vi.mock("@/features/chat/components/use-branch-switcher", () => ({
  useBranchSwitcher: () => ({}),
}));
vi.mock("@/features/chat/components/use-engine-models", () => ({
  useEngineModels: () => ({
    catalogs: {},
    modelsByEngine: {},
    channelsByEngine: {},
    pendingEngines: {},
    refresh: vi.fn(),
  }),
}));
vi.mock("@/features/chat/components/ConversationFooter", () => ({
  ConversationFooter: () => <div data-testid="footer" />,
}));
vi.mock("@/features/chat/components/MessageTimeline", () => ({
  MessageTimeline: () => {
    const scoped = useScopedSession();
    const id = scoped?.sessionId ?? "none";
    useEffect(() => {
      timelineLifecycle.mounts.push(id);
      return () => {
        timelineLifecycle.unmounts.push(id);
      };
    }, [id]);
    return <div data-testid={`timeline-${id}`} />;
  },
}));

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const WS = "/tmp/ws";
const makeTab = (id: string): ActiveSession => ({
  engine: "claude",
  sessionId: id,
  workspacePath: WS,
});

describe("SessionTimeline keep-alive across tab switches", () => {
  let container: HTMLDivElement;
  let root: Root;
  const composerRef = { current: null };

  function render(active: ActiveSession | null) {
    act(() =>
      root.render(
        <ChatConversation
          active={active}
          engines={[]}
          workspaces={[]}
          startNewChat={vi.fn()}
          composerInputRef={composerRef as never}
        />,
      ),
    );
  }

  beforeEach(() => {
    timelineLifecycle.mounts = [];
    timelineLifecycle.unmounts = [];
    const tabs = ["s-1", "s-2", "s-3", "s-4", "s-5"].map(makeTab);
    useChatStore.setState({
      openTabs: tabs,
      active: tabs[0],
      bySession: Object.fromEntries(
        tabs.map((tab) => [
          sessionKey(tab.engine, tab.sessionId, tab.workspacePath),
          {
            ...EMPTY_SESSION,
            messages: [{ seq: 1, role: "user", text: `hello ${tab.sessionId}`, ts: null }],
          },
        ]),
      ),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps recent timelines mounted when switching back and evicts beyond cap or on tab close", () => {
    const [t1, t2, t3, t4, t5] = useChatStore.getState().openTabs;

    render(t1);
    render(t2);
    // Switching back to t1 must reuse its mounted timeline without remounting.
    render(t1);
    expect(timelineLifecycle.mounts).toEqual(["s-1", "s-2"]);
    expect(timelineLifecycle.unmounts).toEqual([]);

    // Visiting 5 distinct tabs evicts the LRU entry (s-2, since s-1 was revisited).
    render(t3);
    render(t4);
    render(t5);
    expect(timelineLifecycle.unmounts).toEqual(["s-2"]);

    // Closing t3 immediately unmounts its kept timeline.
    act(() => {
      useChatStore.setState((s) => ({
        openTabs: s.openTabs.filter((tab) => tab.sessionId !== "s-3"),
      }));
    });
    expect(timelineLifecycle.unmounts).toEqual(["s-2", "s-3"]);
  });
});
