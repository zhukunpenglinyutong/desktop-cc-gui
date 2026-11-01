import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  McpConfigEntry,
  McpEngineInventory,
  McpInventory,
  McpRuntimeSection,
} from "./types";

const api = vi.hoisted(() => ({
  inventory: vi.fn(),
  setEnabled: vi.fn(),
  setLaunchMode: vi.fn(),
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
import { engineLabel } from "./labels";
import { useMcpProbeStore } from "./probe-store";
import { McpSection } from "./McpSection";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function claudeUser(): McpConfigEntry {
  return {
    id: "claude_user:alpha",
    engine: "claude",
    name: "alpha",
    source: "claude_user",
    scope: "user",
    path: "/home/u/.claude.json",
    format: "json",
    enabled: true,
    transport: "stdio",
    command: "npx",
    argsCount: 2,
    url: null,
    envKeys: ["API_KEY"],
    headerKeys: [],
    writable: false,
    readonlyReason: "Claude Code 未在该来源提供可验证的原生停用开关，这里只读展示",
    version: "v1",
  };
}

function claudeProject(): McpConfigEntry {
  return {
    id: "claude_project:beta",
    engine: "claude",
    name: "beta",
    source: "claude_project",
    scope: "project",
    path: "/ws/.mcp.json",
    format: "json",
    enabled: false,
    transport: "http",
    command: null,
    argsCount: 0,
    url: "https://example.com/mcp?token=***",
    envKeys: [],
    headerKeys: ["Authorization"],
    writable: true,
    readonlyReason: null,
    version: "v2",
  };
}

function connectedProbe(tools = ["a"], toolCount = tools.length) {
  return {
    status: "connected" as const,
    message: null,
    tools,
    toolCount,
    serverName: "fake",
    protocolVersion: "2025-06-18",
    elapsedMs: 7,
  };
}

function noSession(): McpRuntimeSection {
  return {
    status: "no_session",
    reason: null,
    workspace: "/ws",
    sessionId: null,
    collectedAt: null,
    entries: [],
  };
}

/** One engine partition; defaults to a plain native engine with no config. */
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
    runtime: noSession(),
    ...overrides,
  };
}

function payload(overrides: Partial<McpInventory> = {}): McpInventory {
  return {
    engines: [
      engine("claude", {
        config: { entries: [claudeUser(), claudeProject()], errors: [] },
      }),
      engine("codex", {
        available: false,
        sources: [
          { source: "codex_user", path: "/home/u/.codex/config.toml", exists: true },
        ],
        config: {
          entries: [
            {
              ...claudeProject(),
              id: "codex_user:gamma",
              engine: "codex",
              name: "gamma",
              source: "codex_user",
              path: "/home/u/.codex/config.toml",
              format: "toml",
              enabled: true,
              writable: true,
              readonlyReason: null,
            },
          ],
          errors: [],
        },
        runtime: {
          status: "unsupported",
          reason: null,
          workspace: null,
          sessionId: null,
          collectedAt: null,
          entries: [],
        },
      }),
      engine("kimi", {
        sources: [
          {
            source: "kimi_user",
            path: "/home/u/.kimi-code/mcp.json",
            exists: false,
          },
          {
            source: "kimi_local",
            path: "/ws/.kimi-code/mcp.json",
            exists: false,
          },
        ],
      }),
      engine("pi", { available: false, support: "none" }),
    ],
    collectedAt: 1,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  api.inventory.mockReset();
  api.setEnabled.mockReset();
  api.setLaunchMode.mockReset();
  api.probe.mockReset();
  api.inventory.mockResolvedValue(payload());
  api.setEnabled.mockResolvedValue(claudeProject());
  api.setLaunchMode.mockResolvedValue(undefined);
  api.probe.mockResolvedValue(connectedProbe());
  useMcpProbeStore.setState({ results: {}, pending: {}, runningAll: false, error: null });
  useChatStore.setState({ active: null });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useChatStore.setState({ active: null });
  window.location.hash = "";
});

async function renderSection() {
  await act(async () => {
    root.render(<McpSection />);
  });
}

function buttonExact(text: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

/** Engine pill: label (+ optional count badge) inside an aria-pressed tab. */
function engineTab(label: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('button[aria-pressed]'),
  ].find((item) => (item.textContent ?? "").trim().startsWith(label));
  if (!button) throw new Error(`engine tab not found: ${label}`);
  return button;
}

describe("McpSection", () => {
  it("keeps config and runtime separate; a read-only entry keeps an inert switch with its reason", async () => {
    await renderSection();
    expect(document.body.textContent).toContain("alpha");
    expect(document.body.textContent).toContain("beta");
    // Runtime section explains why it is empty instead of claiming no servers.
    expect(document.body.textContent).toContain("运行时清单");
    expect(document.body.textContent).toContain("没有运行中的会话，无法观测运行时状态");
    // Read-only entry: the switch stays and shows the real state, but it is
    // inert and carries the reason — no lock icon in its place.
    const alphaRow = [...document.querySelectorAll("li")].find((row) =>
      row.textContent?.includes("alpha"),
    );
    const toggle = alphaRow?.querySelector<HTMLButtonElement>('button[aria-label="启用 alpha"]');
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.getAttribute("aria-disabled")).toBe("true");
    expect(toggle?.getAttribute("title")).toContain("只读展示");
    expect(alphaRow?.querySelector("svg.lucide-lock")).toBeNull();
    await act(async () => {
      toggle?.click();
    });
    expect(api.setEnabled).not.toHaveBeenCalled();
  });

  it("keeps the enable switch in the detail dialog for a read-only entry, disabled", async () => {
    await renderSection();
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="查看 alpha 详情"]')?.click();
    });
    const dialogSwitch = document.querySelector<HTMLInputElement>(
      '[role="dialog"] input[aria-label="启用 alpha"]',
    );
    expect(dialogSwitch?.checked).toBe(true);
    expect(dialogSwitch?.disabled).toBe(true);
  });

  it("tells why a Claude entry's switch is inert when no workspace is open", async () => {
    // Claude 的启停按工作区记录：没有工作区时后端只给原因码、不给字面文案。
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          engine("claude", {
            config: {
              entries: [
                { ...claudeUser(), readonlyReason: null, readonlyReasonCode: "needs_workspace" },
              ],
              errors: [],
            },
          }),
        ],
      }),
    );
    await renderSection();
    const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="启用 alpha"]');
    expect(toggle?.getAttribute("aria-disabled")).toBe("true");
    // A bare "只读" leaves the user guessing why the switch does nothing.
    expect(toggle?.getAttribute("title")).not.toBe("只读");
    expect(toggle?.getAttribute("title")).toContain("工作区");
  });

  it("switches engines and shows the not-installed notice for Codex", async () => {
    await renderSection();
    await act(async () => {
      engineTab("Codex CLI").click();
    });
    expect(document.body.textContent).toContain("gamma");
    expect(document.body.textContent).not.toContain("alpha");
    expect(document.body.textContent).toContain("该 CLI 未安装");
    expect(document.body.textContent).toContain("当前引擎不支持运行时查询");
  });

  it("toggles a writable entry without opening its detail dialog", async () => {
    await renderSection();
    const betaRow = [...document.querySelectorAll("li")].find((row) =>
      row.textContent?.includes("beta"),
    );
    const toggle = betaRow?.querySelector<HTMLButtonElement>('button[aria-label="启用 beta"]');
    // Icon-only: the state lives in aria-pressed, not in visible text.
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(toggle?.textContent).toBe("");
    await act(async () => {
      toggle?.click();
    });
    expect(api.setEnabled).toHaveBeenCalledWith(
      expect.objectContaining({ id: "claude_project:beta" }),
      true,
      null,
    );
    expect(api.inventory).toHaveBeenCalledTimes(2);
    // The row click opens details; the switch must not.
    expect(document.querySelector('[aria-label="查看 beta 详情"]')).toBeTruthy();
    expect(
      [...document.querySelectorAll("h3")].some((heading) =>
        heading.textContent?.includes("beta 详情"),
      ),
    ).toBe(false);
  });

  it("distinguishes a source parse error from an empty config list", async () => {
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          engine("claude", {
            config: {
              entries: [],
              errors: [
                {
                  source: "claude_project",
                  path: "/ws/.mcp.json",
                  message: "/ws/.mcp.json: invalid JSON: boom",
                },
              ],
            },
          }),
          payload().engines[1],
        ],
      }),
    );
    await renderSection();
    expect(document.body.textContent).toContain("invalid JSON");
    expect(document.body.textContent).toContain("/ws/.mcp.json");
    expect(document.body.textContent).toContain("当前引擎没有可展示的 MCP 配置");
  });

  it("renders a tab per engine, including ones without MCP", async () => {
    await renderSection();
    for (const label of ["Claude Code", "Codex CLI", "Kimi CLI", "PI CLI"]) {
      expect(engineTab(label)).toBeTruthy();
    }
    await act(async () => {
      engineTab("PI CLI").click();
    });
    expect(document.body.textContent).toContain("PI CLI 未内置 MCP");
    // No config inventory is faked for an engine that has no MCP at all.
    expect(document.body.textContent).not.toContain("配置清单");
  });

  it("covers every engine the backend drives (mirrors config::ENGINES)", async () => {
    const all = [
      "claude",
      "kimi",
      "grok",
      "codex",
      "pi",
      "omp",
      "dsh",
      "agy",
      "opencode",
      "qoder",
      "qoder-cn",
    ] as const;
    api.inventory.mockResolvedValue(payload({
      engines: all.map((id) => engine(id, { support: id === "pi" ? "none" : "native" })),
    }));
    await renderSection();
    const labels = all.map((id) => engineLabel(id));
    // 每个引擎都有页签与品牌名（后端 ENGINES → CLI_DISPLAY_NAMES 无缺口）。
    expect(labels).toHaveLength(11);
    expect(new Set(labels).size).toBe(11);
    for (const label of labels) {
      expect(engineTab(label)).toBeTruthy();
    }
  });

  it("lists the source files it reads when an engine has no entries yet", async () => {
    await renderSection();
    await act(async () => {
      engineTab("Kimi CLI").click();
    });
    expect(document.body.textContent).toContain("本页读取这些文件");
    expect(document.body.textContent).toContain("/home/u/.kimi-code/mcp.json");
    expect(document.body.textContent).toContain("/ws/.kimi-code/mcp.json");
    expect(document.body.textContent).toContain("（尚未创建）");
  });

  it("localizes the read-only reason code and deep links the engine tab", async () => {
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          payload().engines[0],
          engine("kimi", {
            config: {
              entries: [
                {
                  ...claudeProject(),
                  id: "kimi_user:alpha",
                  engine: "kimi",
                  source: "kimi_user",
                  path: "/home/u/.kimi-code/mcp.json",
                  writable: false,
                  readonlyReason: null,
                  readonlyReasonCode: "unverified_write",
                },
              ],
              errors: [],
            },
          }),
        ],
      }),
    );
    window.location.hash = "#/settings?page=mcp&engine=kimi";
    await renderSection();
    // The deep link selected Kimi without a click.
    expect(engineTab("Kimi CLI").getAttribute("aria-pressed")).toBe("true");
    // The switch's title carries the localized reason, not the raw code.
    expect(document.body.textContent).not.toContain("unverified_write");
    const toggle = document.querySelector<HTMLElement>('[title*="还未在本机真实 CLI 上验证"]');
    expect(toggle?.tagName).toBe("BUTTON");
    expect(toggle?.getAttribute("aria-disabled")).toBe("true");
  });

  it("searches runtime entries too, with a distinct no-match message", async () => {
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          {
            ...payload().engines[0],
            runtime: {
              status: "ready",
              reason: null,
              workspace: "/ws",
              sessionId: "s-1",
              collectedAt: Date.now(),
              entries: [
                {
                  name: "alpha-tools",
                  status: "connected",
                  builtin: false,
                  toolNames: ["search", "fetch"],
                  resourcesCount: 0,
                  templatesCount: 0,
                },
                {
                  name: "beta-tools",
                  status: "failed",
                  builtin: false,
                  toolNames: [],
                  resourcesCount: 0,
                  templatesCount: 0,
                },
              ],
            },
          },
          payload().engines[1],
        ],
      }),
    );
    await renderSection();
    expect(document.body.textContent).toContain("alpha-tools");
    expect(document.body.textContent).toContain("beta-tools");

    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder]');
      if (!input) throw new Error("search input missing");
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "alpha");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("alpha-tools");
    expect(document.body.textContent).not.toContain("beta-tools");

    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('input[placeholder]');
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "ghost");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("没有匹配的服务");
  });

  it("filters to runtime only and hides the config section", async () => {
    await renderSection();
    await act(async () => {
      buttonExact("运行时").click();
    });
    expect(document.body.textContent).not.toContain("alpha");
    expect(document.body.textContent).toContain("运行时清单");
  });

  it("checks on open, reuses fresh results, and re-checks only on demand", async () => {
    api.probe.mockImplementation(async (entry: McpConfigEntry) => {
      if (entry.name === "alpha") return connectedProbe(["a", "b"]);
      return {
        status: "needs_auth",
        message: "服务要求认证（HTTP 401）",
        tools: [],
        toolCount: 0,
        serverName: null,
        protocolVersion: null,
        elapsedMs: 5,
      };
    });
    await renderSection();
    // 打开即检测：只跑当前引擎里启用且可检测的条目（fixture 里 beta 已停用）。
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("已连接 · 2 个工具");
    });
    expect(api.probe.mock.calls.map((call) => call[0].name)).toEqual(["alpha"]);

    // 再挂载一次（≈ 快速再次打开）：新鲜结果直接复用，不再启动服务。
    act(() => root.unmount());
    root = createRoot(container);
    api.probe.mockClear();
    await renderSection();
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.probe).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("已连接 · 2 个工具");

    // 手动「检测全部」是强制重跑（同样只针对启用中的条目）。
    await act(async () => {
      buttonExact("检测全部").click();
    });
    await vi.waitFor(() => {
      expect(api.probe).toHaveBeenCalledTimes(1);
      expect(api.probe.mock.calls[0][0].name).toBe("alpha");
    });
  });

  it("never auto-probes an on-demand entry: probing would start the server it defers", async () => {
    const gamma: McpConfigEntry = { ...claudeUser(), id: "claude_user:gamma", name: "gamma" };
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          engine("claude", {
            config: {
              entries: [{ ...claudeUser(), launchMode: "onDemand" }, gamma],
              errors: [],
            },
          }),
        ],
      }),
    );
    await renderSection();
    // gamma (eager) is probed; once that lands the auto-probe pass is over.
    await vi.waitFor(() => {
      expect(api.probe).toHaveBeenCalled();
    });
    expect(api.probe.mock.calls.map((call) => call[0].name)).toEqual(["gamma"]);
    // The on-demand row says so instead of looking idle.
    const alphaRow = [...document.querySelectorAll("li")].find((li) =>
      li.textContent?.includes("alpha"),
    );
    const launch = alphaRow?.querySelector('button[aria-label="alpha 按需启动"]');
    expect(launch?.getAttribute("aria-pressed")).toBe("true");
    expect(launch?.textContent).toBe("");
  });

  it("switches launch mode from the row icon, and a blocked entry explains instead of writing", async () => {
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          engine("claude", {
            config: {
              entries: [
                claudeUser(),
                { ...claudeProject(), enabled: true, launchModeUnsupported: "transport" },
              ],
              errors: [],
            },
          }),
        ],
      }),
    );
    await renderSection();
    const alphaLaunch = document.querySelector<HTMLButtonElement>(
      'button[aria-label="alpha 按需启动"]',
    );
    expect(alphaLaunch?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      alphaLaunch?.click();
    });
    expect(api.setLaunchMode).toHaveBeenCalledWith(
      expect.objectContaining({ id: "claude_user:alpha" }),
      "onDemand",
      null,
    );

    api.setLaunchMode.mockClear();
    const betaLaunch = document.querySelector<HTMLButtonElement>(
      'button[aria-label="beta 按需启动"]',
    );
    // Still hoverable/focusable so the reason tooltip shows; the click is inert.
    expect(betaLaunch?.getAttribute("aria-disabled")).toBe("true");
    expect(betaLaunch?.hasAttribute("disabled")).toBe(false);
    expect(
      betaLaunch?.getAttribute("title") || betaLaunch?.getAttribute("aria-description"),
    ).toContain("只有 stdio 服务能按需启动");
    await act(async () => {
      betaLaunch?.click();
    });
    expect(api.setLaunchMode).not.toHaveBeenCalled();
  });

  it("shows the declared tool count even when the name list is truncated", async () => {
    // 详情列表封顶 40 个名字，但数量必须是服务声明的实际总数。
    const names = Array.from({ length: 40 }, (_, index) => `tool-${index}`);
    api.probe.mockResolvedValue(connectedProbe(names, 139));
    await renderSection();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("已连接 · 139 个工具");
    });
  });

  it("skips disabled entries and shows the needs-sign-in state", async () => {
    api.inventory.mockResolvedValue(
      payload({
        engines: [
          engine("claude", {
            config: {
              entries: [{ ...claudeProject(), enabled: true }, { ...claudeUser(), enabled: false }],
              errors: [],
            },
          }),
          payload().engines[1],
        ],
      }),
    );
    api.probe.mockImplementation(async (entry: McpConfigEntry) =>
      entry.name === "beta"
        ? {
            status: "needs_auth" as const,
            message: "服务要求认证（HTTP 401）",
            tools: [],
            toolCount: 0,
            serverName: null,
            protocolVersion: null,
            elapsedMs: 5,
          }
        : connectedProbe(),
    );
    await renderSection();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("需要登录");
    });
    // 停用的 alpha 不启动，只检测启用的 beta。
    expect(api.probe.mock.calls.map((call) => call[0].name)).toEqual(["beta"]);
  });

  it("surfaces a probe transport failure next to the row", async () => {
    api.probe.mockResolvedValue({
      status: "failed",
      message: "启动失败：No such file or directory",
      tools: [],
      toolCount: 0,
      serverName: null,
      protocolVersion: null,
      elapsedMs: 3,
    });
    await renderSection();
    const alphaRow = [...document.querySelectorAll("li")].find((row) =>
      row.textContent?.includes("alpha"),
    );
    await vi.waitFor(() => {
      expect(alphaRow?.textContent).toContain("连接失败");
    });
    // 失败原因在 title 上，不把错误正文塞满行内。
    expect(
      alphaRow?.querySelector('[title*="启动失败"]'),
    ).toBeTruthy();
  });

  it("workspace switches cannot be overwritten by a late response", async () => {
    let releaseA: (value: McpInventory) => void = () => undefined;
    api.inventory.mockImplementationOnce(
      () =>
        new Promise<McpInventory>((resolve) => {
          releaseA = resolve;
        }),
    );
    const workspace = (path: string) =>
      ({
        engine: "claude",
        sessionId: null,
        workspacePath: path,
      }) as never;
    useChatStore.setState({ active: workspace("/ws-a") });
    await act(async () => {
      root.render(<McpSection />);
    });

    api.inventory.mockResolvedValue(
      payload({
        engines: [
          {
            ...payload().engines[0],
            config: {
              entries: [{ ...claudeUser(), name: "from-b" }],
              errors: [],
            },
          },
          payload().engines[1],
        ],
      }),
    );
    await act(async () => {
      useChatStore.setState({ active: workspace("/ws-b") });
    });
    expect(document.body.textContent).toContain("from-b");

    // The late /ws-a response must not replace the newer /ws-b state.
    await act(async () => {
      releaseA(
        payload({
          engines: [
            {
              ...payload().engines[0],
              config: {
                entries: [{ ...claudeUser(), name: "from-a" }],
                errors: [],
              },
            },
            payload().engines[1],
          ],
        }),
      );
    });
    expect(document.body.textContent).toContain("from-b");
    expect(document.body.textContent).not.toContain("from-a");
  });
});
