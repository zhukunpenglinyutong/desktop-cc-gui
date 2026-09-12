import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { GrantCard } from "./components/GrantCard";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "./store";
import { handleEngineEvents, type EngineEventDeps } from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    rememberSessionModel: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    grantScope: vi.fn(async () => "/data"),
    grantRoot: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
}));

const KEY = sessionKey("claude", "s-1", "/tmp/ws");

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

function denialEvent(path: string | null, message = "") {
  return {
    runId: "run-1",
    sessionId: "s-1",
    engine: "claude",
    seq: 1,
    kind: "permission_denied" as const,
    data: { tool: "Read", path, message },
  };
}

function grantRows() {
  return (useChatStore.getState().bySession[KEY]?.messages ?? []).filter(
    (m) => m.role === "grant",
  );
}

describe("permission denial grant flow", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useChatStore.setState({
      openTabs: [],
      active: null,
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          messages: [
            { seq: 1, role: "user", text: "读一下那个文件", ts: null },
          ],
        },
      },
      streamingByKey: {},
    });
  });

  it("a denial event appends one pending grant card with the denied path", async () => {
    handleEngineEvents(
      [denialEvent("/data/secrets/key.pem", "Claude requested permissions...")],
      deps(),
    );
    const rows = grantRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/data/secrets/key.pem");
    expect(rows[0].grant?.status).toBe("pending");
    // grant_scope preview fills in the directory asynchronously.
    await vi.waitFor(() =>
      expect(grantRows()[0].grant?.dir).toBe("/data"),
    );
  });

  it("tool_result and result-event duplicates collapse into one card", () => {
    handleEngineEvents(
      [denialEvent("/data/x"), denialEvent("/data/x")],
      deps(),
    );
    expect(grantRows()).toHaveLength(1);
  });

  it("accept persists the grant via grant_root and flips the card", async () => {
    handleEngineEvents([denialEvent("/data/x")], deps());
    const seq = grantRows()[0].seq;
    await useChatStore.getState().respondToGrant(KEY, seq, true);
    expect(vi.mocked(ipc.grantRoot)).toHaveBeenCalledWith("/data/x");
    expect(grantRows()[0].grant?.status).toBe("granted");
  });

  it("decline marks the card without touching the backend", async () => {
    handleEngineEvents([denialEvent("/data/x")], deps());
    const seq = grantRows()[0].seq;
    await useChatStore.getState().respondToGrant(KEY, seq, false);
    expect(vi.mocked(ipc.grantRoot)).not.toHaveBeenCalled();
    expect(grantRows()[0].grant?.status).toBe("declined");
    // A declined card must not block a fresh card for the same path.
    handleEngineEvents([denialEvent("/data/x")], deps());
    expect(grantRows()).toHaveLength(2);
  });

  it("resendLastUser re-sends the last user message once granted", async () => {
    handleEngineEvents([denialEvent("/data/x")], deps());
    await useChatStore
      .getState()
      .respondToGrant(KEY, grantRows()[0].seq, true);
    useChatStore.setState({
      active: { engine: "claude", sessionId: "s-1", workspacePath: "/tmp/ws" },
    });
    await useChatStore.getState().resendLastUser(KEY);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "读一下那个文件" }),
    );
  });
});

describe("GrantCard", () => {
  const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    void i18n.changeLanguage("zh");
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(message: Parameters<typeof GrantCard>[0]["message"]) {
    act(() => root.render(<GrantCard message={message} />));
  }

  it("pending card shows the denied path and both actions", async () => {
    render({
      seq: 9,
      role: "grant",
      text: "Claude requested permissions to read from /data/x, but you haven't granted it yet.",
      path: "/data/x",
      ts: null,
      grant: { status: "pending", dir: "/data" },
    });
    expect(container.textContent).toContain("/data/x");
    expect(container.textContent).toContain("/data");
    expect(container.textContent).toContain(i18n.t("chat.grantAllow"));
    expect(container.textContent).toContain(i18n.t("chat.grantDecline"));
  });

  it("granted card swaps actions for the resend affordance", () => {
    render({
      seq: 9,
      role: "grant",
      text: "",
      path: "/data/x",
      ts: null,
      grant: { status: "granted", dir: "/data" },
    });
    expect(container.textContent).toContain(i18n.t("chat.grantResend"));
    expect(container.textContent).not.toContain(i18n.t("chat.grantAllow"));
  });
});
