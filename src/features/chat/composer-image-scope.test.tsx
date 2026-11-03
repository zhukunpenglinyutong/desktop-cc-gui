import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { ChatConversation } from "./components/ChatConversation";
import { useChatStore } from "./store";
import { NO_ATTACHMENT_MOVES } from "./store/attachments";
import { sessionKey, type ActiveSession } from "./store/persistence";
import { EMPTY_SESSION } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    savePastedImage: vi.fn(async () => "/sandbox/paste-a.png"),
    importAttachments: vi.fn(async (paths: string[]) => paths),
    readFile: vi.fn(async () => ({ kind: "other" })),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    rememberSessionProvider: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({
      messages: [],
      nextBefore: null,
      subagentHistory: [],
    })),
    loadRemoteSessionPage: vi.fn(async () => ({
      messages: [],
      nextBefore: null,
      subagentHistory: [],
    })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    listPlanReviews: vi.fn(async () => []),
    listSessions: vi.fn(async () => []),
    listArchivedSessions: vi.fn(async () => []),
    rescanSessions: vi.fn(async () => {}),
    interruptSession: vi.fn(async () => true),
    archiveSession: vi.fn(async () => {}),
    restoreSession: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}),
    deleteRemoteSession: vi.fn(async () => {}),
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
vi.mock("@/features/chat/components/MessageTimeline", () => ({
  MessageTimeline: () => <div data-testid="timeline" />,
}));

// The composer footer is the seam the bug was reported at: the chips it paints
// come from the conversation's attachment state, so the test captures that
// state per render instead of mounting the real (heavy) composer.
const footerState = vi.hoisted(() => ({
  images: [] as string[],
  draft: "",
  onPasteImages: null as null | ((files: File[]) => void),
}));
vi.mock("@/features/chat/components/ConversationFooter", () => ({
  ConversationFooter: ({
    images,
    draft,
    onPasteImages,
  }: {
    images: string[];
    draft: string;
    onPasteImages: (files: File[]) => void;
  }) => {
    footerState.images = images;
    footerState.draft = draft;
    footerState.onPasteImages = onPasteImages;
    return <div data-testid="footer" />;
  },
}));

const WS = "/tmp/ws";
const A: ActiveSession = { engine: "claude", sessionId: "s-a", workspacePath: WS };
const B: ActiveSession = { engine: "claude", sessionId: "s-b", workspacePath: WS };
const KEY_A = sessionKey(A.engine, A.sessionId, A.workspacePath);
const KEY_B = sessionKey(B.engine, B.sessionId, B.workspacePath);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("composer attachments are scoped to their session", () => {
  let container: HTMLDivElement;
  let root: Root;
  const composerRef = { current: null };

  /** Tab switch with the same ChatConversation instance, exactly how
   *  SplitLayout hands a different `active` to one mounted conversation. */
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

  /** Paste one PNG and let the whole chain settle inside act: FileReader →
   *  savePastedImage → store write → conversation re-render. */
  async function pastePng() {
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", {
      type: "image/png",
    });
    await act(async () => {
      footerState.onPasteImages?.([file]);
      for (let i = 0; i < 20 && footerState.images.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    });
    expect(footerState.images).toHaveLength(1);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    footerState.images = [];
    footerState.draft = "";
    footerState.onPasteImages = null;
    useChatStore.setState({
      active: A,
      openTabs: [A, B],
      bySession: {
        [KEY_A]: { ...EMPTY_SESSION },
        [KEY_B]: { ...EMPTY_SESSION },
      },
      drafts: {},
      composerAttachments: {},
      composerAttachmentMoves: NO_ATTACHMENT_MOVES,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useChatStore.setState({
      active: null,
      openTabs: [],
      bySession: {},
      drafts: {},
      composerAttachments: {},
      composerAttachmentMoves: NO_ATTACHMENT_MOVES,
    });
  });

  it("does not carry a pasted image into another session", async () => {
    render(A);
    await pastePng();
    expect(footerState.images).toEqual(["/sandbox/paste-a.png"]);

    render(B);
    expect(footerState.images).toEqual([]);
  });

  it("keeps each session's own attachments when switching back and forth", async () => {
    render(A);
    await pastePng();

    render(B);
    expect(footerState.images).toEqual([]);

    render(A);
    expect(footerState.images).toEqual(["/sandbox/paste-a.png"]);
  });

  it("hands a picture pasted with no tab open to the first new chat", async () => {
    // Like the unbound draft: the composer stays editable with no tab, and
    // what the user pasted there belongs to the session they open next.
    useChatStore.setState({ active: null, openTabs: [], activeEngine: "claude" });
    render(null);
    await pastePng();

    act(() => useChatStore.getState().startNewChat(WS));
    const opened = useChatStore.getState().active;
    expect(opened?.sessionId).toBeNull();
    render(opened!);

    expect(footerState.images).toEqual(["/sandbox/paste-a.png"]);
  });

  it("keeps the text draft isolated the same way (baseline)", async () => {
    render(A);
    act(() => useChatStore.getState().setDraft(KEY_A, "A 的草稿"));

    render(B);
    expect(footerState.draft).toBe("");

    render(A);
    expect(footerState.draft).toBe("A 的草稿");
  });
});
