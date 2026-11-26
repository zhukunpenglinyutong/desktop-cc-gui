import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { McpConfigEntry, McpServerInput } from "./types";

const api = vi.hoisted(() => ({ getRawEntry: vi.fn() }));

vi.mock("./api", () => ({ mcpApi: api }));

// Keeps the transport layer's module-scope subscription inert (no Tauri here).
vi.mock("@/lib/transport", () => ({
  isWeb: false,
  listen: async () => () => {},
}));

import "@/lib/i18n";
import { McpConfigFormDialog } from "./McpConfigFormDialog";

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

function remoteEntry(): McpConfigEntry {
  return {
    id: "codex_user:api",
    engine: "codex",
    name: "api",
    source: "codex_user",
    scope: "user",
    workspaceFile: false,
    path: "/home/u/.codex/config.toml",
    format: "toml",
    enabled: true,
    transport: "http",
    command: null,
    argsCount: 0,
    url: "https://example.test/mcp",
    envKeys: [],
    headerKeys: ["X-Team"],
    writable: true,
    readonlyReason: null,
    version: "v1",
  };
}

describe("McpConfigFormDialog", () => {
  let host: HTMLDivElement;
  let root: Root;
  let onSubmit: Mock<(input: McpServerInput) => Promise<void>>;
  let onClose: Mock<() => void>;

  beforeEach(() => {
    api.getRawEntry.mockReset();
    onSubmit = vi.fn<(input: McpServerInput) => Promise<void>>().mockResolvedValue();
    onClose = vi.fn<() => void>();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = "";
  });

  const render = async (mode: Parameters<typeof McpConfigFormDialog>[0]["mode"]) => {
    await act(async () => {
      root.render(
        <McpConfigFormDialog
          mode={mode}
          workspacePath={null}
          onSubmit={onSubmit}
          onClose={onClose}
        />,
      );
    });
  };

  const textInputs = () =>
    Array.from(document.body.querySelectorAll<HTMLInputElement>('input[type="text"]'));
  const textareas = () =>
    Array.from(document.body.querySelectorAll<HTMLTextAreaElement>("textarea"));
  const button = (label: string) => {
    const found = Array.from(document.body.querySelectorAll("button")).find(
      (node) => node.textContent?.trim() === label,
    );
    if (!found) throw new Error(`no button "${label}"`);
    return found;
  };

  const type = async (
    node: HTMLInputElement | HTMLTextAreaElement,
    value: string,
  ) => {
    const proto =
      node instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("新建 stdio：空表单不可提交；参数按行拆分，环境变量按第一个 = 拆分", async () => {
    await render({ kind: "create", source: "claude_user" });
    expect((button("创建") as HTMLButtonElement).disabled).toBe(true);

    const [name, command] = textInputs();
    const [args, env] = textareas();
    await type(name, "  fs  ");
    await type(command, "npx");
    await type(args, "-y\n\n  @mcp/server-fs  \n");
    await type(env, "TOKEN=a=b\nEMPTY\n=ignored");
    expect((button("创建") as HTMLButtonElement).disabled).toBe(false);

    await act(async () => button("创建").click());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      name: "fs",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@mcp/server-fs"],
      cwd: "",
      env: [
        { key: "TOKEN", value: "a=b" },
        { key: "EMPTY", value: "" },
      ],
      url: "",
      headers: [],
      enabled: true,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("编辑远程服务：名称锁定，回显的旧 command 不会随提交带回", async () => {
    // 历史文件里可能同时留着 command 与 url；提交必须只保留 url 一侧。
    api.getRawEntry.mockResolvedValue({
      name: "api",
      transport: "http",
      command: "stale-cmd",
      args: ["--old"],
      cwd: "/tmp",
      env: [{ key: "OLD", value: "1" }],
      url: "https://example.test/mcp",
      headers: [{ key: "X-Team", value: "core" }],
      enabled: true,
    } satisfies McpServerInput);
    await render({ kind: "edit", entry: remoteEntry() });

    expect(api.getRawEntry).toHaveBeenCalledWith(remoteEntry(), null);
    const [name, url] = textInputs();
    expect(name.value).toBe("api");
    expect(name.disabled).toBe(true);
    expect(url.value).toBe("https://example.test/mcp");
    expect(textareas()[0].value).toBe("X-Team=core");

    await act(async () => button("保存修改").click());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "api",
        transport: "http",
        command: "",
        args: [],
        cwd: "",
        env: [],
        url: "https://example.test/mcp",
        headers: [{ key: "X-Team", value: "core" }],
      }),
    );
  });

  it("提交失败：显示后端错误，弹窗保持打开以便修正", async () => {
    onSubmit.mockRejectedValue(new Error("配置文件已被外部修改，请刷新后重试"));
    await render({ kind: "create", source: "codex_user" });
    const [name, command] = textInputs();
    await type(name, "alpha");
    await type(command, "uvx");

    await act(async () => button("创建").click());

    expect(document.body.textContent).toContain("配置文件已被外部修改，请刷新后重试");
    expect(onClose).not.toHaveBeenCalled();
    expect((button("创建") as HTMLButtonElement).disabled).toBe(false);
  });

  it("读取原始配置失败：显示错误，不渲染可保存的空表单", async () => {
    api.getRawEntry.mockRejectedValue(new Error("配置文件中不存在 MCP 服务「api」"));
    await render({ kind: "edit", entry: remoteEntry() });

    expect(document.body.textContent).toContain("配置文件中不存在 MCP 服务「api」");
    expect(textInputs()).toHaveLength(0);
    expect((button("保存修改") as HTMLButtonElement).disabled).toBe(true);
  });
});
