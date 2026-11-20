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
  renders: {} as Record<string, number>,
  lastCount: {} as Record<string, number>,
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
  MessageTimeline: ({ session }: { session: { messages: unknown[] } }) => {
    const scoped = useScopedSession();
    const id = scoped?.sessionId ?? "none";
    timelineLifecycle.renders[id] = (timelineLifecycle.renders[id] ?? 0) + 1;
    timelineLifecycle.lastCount[id] = session.messages.length;
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
    timelineLifecycle.renders = {};
    timelineLifecycle.lastCount = {};
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

  it("never reorders or reparents kept timeline DOM nodes when switching back between tabs", () => {
    const [t1, t2, t3, t4, t5] = useChatStore.getState().openTabs;

    render(t1);
    render(t2);
    const node1 = container.querySelector('[data-testid="timeline-s-1"]')!.parentElement!;
    const node2 = container.querySelector('[data-testid="timeline-s-2"]')!.parentElement!;
    const host = node1.parentElement!;
    expect(Array.from(host.children)).toEqual([node1, node2]);
    expect(node1.style.contain).toBe("");
    expect(node2.style.contain).toBe("");

    // Spy on DOM reparenting: moving an existing node with appendChild or
    // insertBefore resets scrollTop to 0 in browsers.
    const appendSpy = vi.spyOn(host, "appendChild");
    const insertSpy = vi.spyOn(host, "insertBefore");

    // Switching back and forth between t1 and t2 must not move either DOM node.
    render(t1);
    render(t2);
    render(t1);
    expect(appendSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    expect(Array.from(host.children)).toEqual([node1, node2]);

    // Evicting the LRU tab (t2) on the 5th tab must keep surviving nodes in place.
    render(t3);
    render(t4);
    const node3 = container.querySelector('[data-testid="timeline-s-3"]')!.parentElement!;
    const node4 = container.querySelector('[data-testid="timeline-s-4"]')!.parentElement!;
    appendSpy.mockClear();
    insertSpy.mockClear();
    render(t5);
    const node5 = container.querySelector('[data-testid="timeline-s-5"]')!.parentElement!;
    expect(Array.from(host.children)).toEqual([node1, node3, node4, node5]);
    expect(appendSpy.mock.calls.map(([child]) => child)).toEqual([node5]);
    expect(insertSpy).not.toHaveBeenCalled();
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

  it("freezes hidden kept timelines during background streaming and catches up on reveal", () => {
    const [t1, t2] = useChatStore.getState().openTabs;
    const k1 = sessionKey(t1.engine, t1.sessionId, t1.workspacePath);

    render(t1);
    render(t2);
    const rendersWhileHidden = timelineLifecycle.renders["s-1"];

    // Background stream chunks land on hidden tab s-1: must not re-render its timeline.
    act(() => {
      for (let i = 2; i <= 5; i++) {
        useChatStore.setState((s) => ({
          bySession: {
            ...s.bySession,
            [k1]: {
              ...s.bySession[k1],
              streaming: true,
              messages: [
                ...s.bySession[k1].messages,
                { seq: i, role: "assistant", text: `chunk-${i}`, ts: null },
              ],
            },
          },
        }));
      }
    });
    expect(timelineLifecycle.renders["s-1"]).toBe(rendersWhileHidden);

    // Switching back to t1 reconciles all accumulated background messages immediately.
    render(t1);
    expect(timelineLifecycle.lastCount["s-1"]).toBe(5);
  });
});
