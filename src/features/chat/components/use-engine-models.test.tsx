import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliConfig, EngineCatalog, EngineInfo, ProviderSection } from "@/lib/ipc";
import { ipc } from "@/lib/ipc";
import { useEngineModels, type EngineModelsState } from "./use-engine-models";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    getCliConfig: vi.fn(async () => ({})),
    getAppSettings: vi.fn(async () => ({})),
    listEngineModels: vi.fn(async () => ({ models: [], authoritative: false })),
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ENGINE = { id: "omp", enabled: true, available: true } as EngineInfo;
// 模块级稳定引用:与应用内 zustand 提供的 engines 同形。探针记录存在 ref
// 里,数组身份抖动不再引发重复探测(见 use-engine-models 的探针 effect)。
const ENGINES = [ENGINE];
const WS_REMOTE = "//wsl$/Ubuntu/home/u/proj";

let container: HTMLDivElement;
let root: Root;
// 当前 render 的 engines(默认稳定引用;探针类用例按需替换)。
let engines: EngineInfo[] = ENGINES;
let latest: EngineModelsState;

const engineInfo = (id: string, available: boolean): EngineInfo => ({
  id,
  available,
  enabled: true,
  supportsImages: false,
  permissions: [],
});

const noopPin = async () => {};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  engines = ENGINES;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.mocked(ipc.listEngineModels).mockReset();
});

function Harness({
  models,
  pinModels,
  workspacePath,
  providers = {},
}: {
  models: Record<string, string>;
  pinModels: (updates: Record<string, string>, persist?: boolean) => Promise<void>;
  workspacePath?: string;
  /** Session-resolved channel per engine (what the picker refreshes on). */
  providers?: Record<string, string>;
}) {
  latest = useEngineModels(engines, models, pinModels, providers, workspacePath);
  return null;
}

async function render(props: Parameters<typeof Harness>[0]) {
  await act(async () => {
    root.render(<Harness {...props} />);
    // 探针 promise 落地 + catalog 入 store 后的二次 effect 都跑完。
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 让队列中的 promise 回调与随后的 re-render 全部落定:失控的探针循环
 *  会在这么长的窗口里打出成百上千次调用。 */
const settle = () =>
  act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 80);
    await promise;
  });

/** 探针类用例的渲染入口:可换 engines,渲染后等窗口落定。 */
async function show(
  next: EngineInfo[] | null,
  workspacePath?: string,
  providers?: Record<string, string>,
) {
  if (next) engines = next;
  await render({ models: {}, pinModels: noopPin, workspacePath, providers });
  await settle();
}

describe("useEngineModels channel models", () => {
  const EMPTY_SECTION: ProviderSection = { providers: {}, current: null };
  const cliConfigWith = (claude: ProviderSection): CliConfig => ({
    claude,
    kimi: EMPTY_SECTION,
    grok: EMPTY_SECTION,
    codex: EMPTY_SECTION,
    pi: EMPTY_SECTION,
    omp: EMPTY_SECTION,
    dsh: EMPTY_SECTION,
    agy: EMPTY_SECTION,
    opencode: EMPTY_SECTION,
    qoder: EMPTY_SECTION,
    "qoder-cn": EMPTY_SECTION,
  });

  it("切换渠道后别名行改指该渠道映射的模型", async () => {
    // 报告的问题:选中渠道 ss2a 后模型列表仍是官方 settings.json 解析出的行
    // （后端 catalog 只认 CLI 自己的配置）。渠道自己的 ANTHROPIC_DEFAULT_*_MODEL
    // 才是这次选择真正会跑的 id，切渠道必须让别名行跟着换。
    vi.mocked(ipc.getCliConfig).mockResolvedValue(
      cliConfigWith({
        current: "c1",
        providers: {
          c1: {
            name: "one",
            settingsConfig: { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "one-opus" } },
          },
          c2: {
            name: "two",
            settingsConfig: { env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "two-opus" } },
          },
        },
      }),
    );
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [
        { id: "default", name: "Default", description: "Use the default model" },
        { id: "opus", name: "official-opus", description: "Custom Opus model" },
      ],
      authoritative: true,
    } as unknown as EngineCatalog);

    await show([engineInfo("claude", true)], undefined, { claude: "c1" });
    const opusLabel = () =>
      latest.modelsByEngine.claude?.find((model) => model.id === "opus")?.label;
    expect(opusLabel()).toBe("one-opus");

    await show(null, undefined, { claude: "c2" });
    expect(opusLabel()).toBe("two-opus");
  });
});

describe("useEngineModels pin effect", () => {
  it("远端(remote)catalog 只做展示:永不触发 pin,不污染全局 models / persisted 默认", async () => {
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [{ id: "remote-m1", name: "Remote M1" }],
      authoritative: true,
      remote: true,
    } as unknown as EngineCatalog);
    const pinModels = vi.fn(async () => {});
    // stored 与远端 catalog 不相交 —— 修复前这里会 volatile pin,进而在
    // 切回本地工作区时被 persisted pin 覆盖用户保存的默认模型。
    await render({ models: { omp: "user-pick" }, pinModels, workspacePath: WS_REMOTE });
    expect(pinModels).not.toHaveBeenCalled();
  });

  it("本地 authoritative catalog 仍重置过期 stored pick(persist 默认值不变)", async () => {
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [{ id: "m1", name: "M1" }],
      authoritative: true,
    } as unknown as EngineCatalog);
    const pinModels = vi.fn(async () => {});
    await render({ models: { omp: "stale-id" }, pinModels });
    expect(pinModels).toHaveBeenCalledWith({ omp: "m1" });
  });
});

describe("useEngineModels probe dispatch", () => {
  it("探针失败只派发一次:不会被 pending 抖动反复重发", async () => {
    vi.mocked(ipc.listEngineModels).mockRejectedValue(new Error("DSH host 未运行"));
    await show([engineInfo("dsh", true)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(1);
    expect(latest.pendingEngines).toEqual({});
  });

  it("另一引擎的 catalog 落地不会连带重试失败引擎", async () => {
    vi.mocked(ipc.listEngineModels).mockImplementation(async (id: string) => {
      if (id === "dsh") throw new Error("DSH host 未运行");
      return { models: [{ id: "pi/m1", provider: "pi" }], authoritative: true };
    });
    await show([engineInfo("dsh", true), engineInfo("pi", true)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
    expect(latest.catalogs.pi?.models[0]?.id).toBe("pi/m1");
    await settle();
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
  });

  it("refresh 重探所有引擎(失败者也算)", async () => {
    vi.mocked(ipc.listEngineModels).mockRejectedValue(new Error("down"));
    await show([engineInfo("dsh", true)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(1);
    vi.mocked(ipc.listEngineModels).mockResolvedValue({
      models: [{ id: "deepseek/x", provider: "deepseek" }],
      authoritative: true,
    });
    await act(async () => {
      await latest.refresh();
    });
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
    expect(latest.catalogs.dsh?.models[0]?.id).toBe("deepseek/x");
  });

  it("引擎可用性翻转后允许再探一次", async () => {
    vi.mocked(ipc.listEngineModels).mockRejectedValue(new Error("missing CLI"));
    await show([engineInfo("dsh", false)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(1);
    await show([engineInfo("dsh", true)]);
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
  });

  it("探针记录按工作区隔离", async () => {
    vi.mocked(ipc.listEngineModels).mockRejectedValue(new Error("down"));
    await show([engineInfo("dsh", true)], "/ws-a");
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(1);
    await show(null, "/ws-b");
    expect(ipc.listEngineModels).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ipc.listEngineModels).mock.calls.map((call) => call[1])).toEqual([
      "/ws-a",
      "/ws-b",
    ]);
  });
});
