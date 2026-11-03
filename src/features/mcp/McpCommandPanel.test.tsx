import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfigEntry, McpEngineInventory, McpInventory } from "./types";

const api = vi.hoisted(() => ({
  inventory: vi.fn(),
  setEnabled: vi.fn(),
  probe: vi.fn(),
}));

vi.mock("./api", () => ({
  McpHubError: class McpHubError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  mcpApi: api,
}));

// ipc.ts subscribes to settings://changed at module scope; the stub keeps
// that subscription inert (the real transport needs Tauri internals).
vi.mock("@/lib/transport", () => ({
  isWeb: false,
  listen: async () => () => {},
}));

import "@/lib/i18n";
import { useChatStore } from "@/features/chat/store";
import { McpCommandPanel } from "./McpCommandPanel";
import { engineIdFromHash, openMcpSettings } from "./labels";
import { useMcpPanel } from "./panel";
import { useMcpProbeStore } from "./probe-store";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function entry(overrides: Partial<McpConfigEntry>): McpConfigEntry {
  return {
    id: "claude_user:alpha",
    engine: "claude",
    name: "alpha",
    source: "claude_user",
    scope: "user",
    workspaceFile: false,
    path: "/home/u/.claude.json",
    format: "json",
    enabled: true,
    transport: "stdio",
    command: "npx",
    argsCount: 1,
    url: null,
    envKeys: [],
    headerKeys: [],
    writable: false,
    readonlyReason: null,
    readonlyReasonCode: "unverified_write",
    version: "v1",
    ...overrides,
  };
}

function engine(
  id: McpEngineInventory["id"],
  overrides: Partial<McpEngineInventory> = {},
): McpEngineInventory {
  return {
    id,
    available: true,
    support: "native",
    sources: [],
    config: { entries: [], errors: [] },
    runtime: {
      status: "unsupported",
      reason: null,
      workspace: null,
      sessionId: null,
      collectedAt: null,
      entries: [],
    },
    ...overrides,
  };
}

function payload(): McpInventory {
  return {
    engines: [
      engine("claude", { config: { entries: [entry({ name: "alpha" })], errors: [] } }),
      engine("codex", {
        config: {
          entries: [
            entry({
              id: "codex_user:gamma",
              engine: "codex",
              name: "gamma",
              source: "codex_user",
              writable: true,
              readonlyReasonCode: null,
            }),
          ],
          errors: [],
        },
      }),
      engine("pi", { available: false, support: "none" }),
    ],
    collectedAt: 1,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  api.inventory.mockReset();
  api.setEnabled.mockReset();
  api.probe.mockReset();
  api.inventory.mockResolvedValue(payload());
  useMcpProbeStore.setState({ results: {}, pending: {}, runningAll: false, error: null });
  useMcpPanel.setState({ open: false });
  useChatStore.setState({ active: null });
  window.location.hash = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useChatStore.setState({ active: null });
  useMcpPanel.setState({ open: false });
  window.location.hash = "";
});

function openPanel(engineId: string) {
  useChatStore.setState({
    active: { engine: engineId, sessionId: null, workspacePath: "/ws" } as never,
  });
  useMcpPanel.getState().openPanel();
}

async function renderPanel() {
  await act(async () => {
    root.render(<McpCommandPanel />);
  });
}

describe("McpCommandPanel", () => {
  it("renders nothing while the `/mcp` panel is closed", async () => {
    await renderPanel();
    expect(document.body.textContent).not.toContain("MCP 服务");
    expect(api.inventory).not.toHaveBeenCalled();
  });

  it("lists the active engine's servers, not the default engine's", async () => {
    openPanel("codex");
    await renderPanel();
    expect(api.inventory).toHaveBeenCalledWith("/ws");
    expect(document.body.textContent).toContain("MCP 服务 · Codex CLI");
    expect(document.body.textContent).toContain("gamma");
    expect(document.body.textContent).not.toContain("alpha");
  });

  it("explains engines without MCP instead of showing an empty list", async () => {
    openPanel("pi");
    await renderPanel();
    expect(document.body.textContent).toContain("PI CLI 未内置 MCP");
    expect(document.body.textContent).not.toContain("配置清单");
  });

  it("checks the active engine's servers as soon as the panel opens", async () => {
    api.probe.mockResolvedValue({
      status: "connected",
      message: null,
      tools: ["search"],
      toolCount: 1,
      serverName: "fake",
      protocolVersion: "2025-06-18",
      elapsedMs: 7,
    });
    openPanel("codex");
    await renderPanel();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("已连接 · 1 个工具");
    });
    expect(api.probe).toHaveBeenCalledTimes(1);
    expect(api.probe.mock.calls[0][0].name).toBe("gamma");
  });

  it("reuses cached results when the panel is reopened quickly", async () => {
    api.probe.mockResolvedValue({
      status: "connected",
      message: null,
      tools: ["search"],
      toolCount: 1,
      serverName: "fake",
      protocolVersion: "2025-06-18",
      elapsedMs: 7,
    });
    openPanel("codex");
    await renderPanel();
    await vi.waitFor(() => {
      expect(api.probe).toHaveBeenCalledTimes(1);
    });

    // 关闭再打开：3 分钟内的结果直接复用，不再启动服务。
    useMcpPanel.getState().closePanel();
    await act(async () => {
      root.render(<McpCommandPanel />);
    });
    api.probe.mockClear();
    openPanel("codex");
    await renderPanel();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.probe).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("已连接 · 1 个工具");
  });

  it("deep links the settings page at the active engine", async () => {
    openPanel("codex");
    await renderPanel();
    const manage = [...document.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === "在设置中管理",
    );
    await act(async () => manage?.click());
    expect(window.location.hash).toBe("#/settings?page=mcp&engine=codex");
    expect(useMcpPanel.getState().open).toBe(false);
  });
});

describe("engine deep links", () => {
  it("parses the engine from the hash router URL", () => {
    expect(engineIdFromHash("#/settings?page=mcp&engine=qoder-cn")).toBe("qoder-cn");
    expect(engineIdFromHash("#/settings?page=mcp")).toBeNull();
    expect(engineIdFromHash("")).toBeNull();
  });

  it("writes a hash the settings page can read back", () => {
    openMcpSettings("agy");
    expect(engineIdFromHash(window.location.hash)).toBe("agy");
  });
});
