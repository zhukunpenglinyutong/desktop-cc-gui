/**
 * MCP 连接检测结果（内存态，不落盘，模块级单例：设置页与 `/mcp` 面板共用）。
 *
 * 与 `useMcpInventory` 的运行时分区是两回事：运行时是某个 CLI 会话自己上报
 * 的连接状态，这里是**本应用发起**的一次检测。三条策略：
 *
 * - **打开即检测**：面板/页签出现时自动跑一次，但只针对用户自己配置里「启用 +
 *   可检测 + 没有新鲜结果」的条目（`useAutoProbe` / `autoProbeEligible`），所以
 *   重复打开只是复用缓存；
 * - **工作区配置先确认**：配置文件在工作区里的条目（`workspaceFile`，可能随仓库
 *   下载）从不自动检测；手动检测前经 `probe-confirm.ts` 把完整命令给用户确认；
 * - **缓存**：结果按「条目 id + 配置哈希」存放，配置一变旧结果立即失效；新鲜度
 *   窗口 `PROBE_TTL_MS` 内的结果自动检测直接复用，手动点「检测全部」才强制重跑；
 * - **有限并行**：同时最多 `PROBE_CONCURRENCY` 个检测在飞（stdio 启动是 I/O 等待，
 *   串行太慢，全并行又会同时拉起一堆 npx），失败只影响自己那一条。
 */
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { mcpApi } from "./api";
import {
  confirmWorkspaceProbe,
  confirmedFingerprint,
  forgetProbeConfirm,
} from "./probe-confirm";
import type { McpConfigEntry, McpProbeState } from "./types";

/** 自动检测复用结果的窗口：超过则视为需要重新检测。 */
export const PROBE_TTL_MS = 3 * 60_000;
/** 同时进行的检测数上限。 */
export const PROBE_CONCURRENCY = 4;

interface McpProbeStore {
  /** 条目 id → 检测结果；`pending` 里的条目正在检测。 */
  results: Record<string, McpProbeState>;
  pending: Record<string, true>;
  /** 「检测全部」是否在跑（含队列）。 */
  runningAll: boolean;
  error: string | null;
  probe: (entry: McpConfigEntry, workspace: string | null) => Promise<void>;
  probeAll: (
    entries: McpConfigEntry[],
    workspace: string | null,
    options?: { force?: boolean },
  ) => Promise<void>;
  clear: () => void;
}

/** 配置版本一致的旧结果才有效。 */
export function probeStateFor(
  results: Record<string, McpProbeState>,
  entry: McpConfigEntry,
): McpProbeState | null {
  const state = results[entry.id];
  if (!state || state.version !== entry.version) return null;
  return state;
}

/** 可以检测的条件：配置里真有命令或地址。 */
export function probeable(entry: McpConfigEntry): boolean {
  return Boolean(entry.command || entry.url);
}

/** 需要（重新）检测吗：停用的、没命令/地址的、还有新鲜结果的都跳过。 */
export function needsProbe(
  entry: McpConfigEntry,
  results: Record<string, McpProbeState>,
  now = Date.now(),
): boolean {
  if (!entry.enabled || !probeable(entry)) return false;
  const state = probeStateFor(results, entry);
  if (!state) return true;
  return now - state.checkedAt > PROBE_TTL_MS;
}

export const useMcpProbeStore = create<McpProbeStore>((set, get) => {
  /** One probe, no confirmation: callers have already cleared workspace
   *  entries through `confirmWorkspaceProbe`. */
  const run = async (entry: McpConfigEntry, workspace: string | null): Promise<void> => {
    set((state) => ({ pending: { ...state.pending, [entry.id]: true }, error: null }));
    try {
      // Workspace servers carry the fingerprint of the plan the user
      // confirmed; the backend refuses anything else.
      const result = entry.workspaceFile
        ? await mcpApi.probe(entry, workspace, confirmedFingerprint(entry, workspace))
        : await mcpApi.probe(entry, workspace);
      // 边界校验：缺字段的响应不能当成「已连接」写进状态，否则一条坏响应
      // 就会把整个列表画崩（数量展示依赖 `toolCount`，缺了会显示成 NaN）。
      if (!result || typeof result.status !== "string" || typeof result.toolCount !== "number") {
        throw new Error("MCP 检测返回了无法识别的结果");
      }
      set((state) => ({
        results: {
          ...state.results,
          [entry.id]: { result, checkedAt: Date.now(), version: entry.version },
        },
      }));
    } catch (probeError) {
      // The file changed after it was confirmed: forget that answer so the
      // next click shows the new command.
      if (entry.workspaceFile && (probeError as { code?: unknown })?.code === "conflict") {
        forgetProbeConfirm(entry, workspace);
      }
      set({
        error: probeError instanceof Error ? probeError.message : String(probeError),
      });
    } finally {
      set((state) => {
        const pending = { ...state.pending };
        delete pending[entry.id];
        return { pending };
      });
    }
  };

  return {
    results: {},
    pending: {},
    runningAll: false,
    error: null,

    probe: async (entry, workspace) => {
      if (!probeable(entry)) return;
      if (entry.workspaceFile && !(await confirmWorkspaceProbe([entry], workspace))) return;
      await run(entry, workspace);
    },

    probeAll: async (entries, workspace, options) => {
      const force = options?.force ?? false;
      let targets = entries.filter((entry) =>
        force ? entry.enabled && probeable(entry) : needsProbe(entry, get().results),
      );
      if (targets.length === 0 || get().runningAll) return;
      set({ runningAll: true, error: null });
      try {
        // Workspace servers: one confirmation for all of them; declining
        // still checks the user's own servers.
        const fromWorkspace = targets.filter((entry) => entry.workspaceFile);
        if (fromWorkspace.length > 0 && !(await confirmWorkspaceProbe(fromWorkspace, workspace))) {
          targets = targets.filter((entry) => !entry.workspaceFile);
        }
        // 有限并行：逐个 shift 取任务，谁先空谁退出。
        const queue = [...targets];
        const worker = async (): Promise<void> => {
          const next = queue.shift();
          if (!next) return;
          await run(next, workspace);
          await worker();
        };
        await Promise.all(
          Array.from({ length: Math.min(PROBE_CONCURRENCY, queue.length) }, worker),
        );
      } finally {
        set({ runningAll: false });
      }
    },

    clear: () => set({ results: {}, error: null }),
  };
});

/**
 * 打开页面时可以自动检测的条目：启用、可检测、随会话启动，且配置是用户自己
 * 的文件。工作区里的配置（`workspaceFile`）可能随仓库下载，检测会真的执行
 * 其中的命令，所以绝不自动跑；按需启动的条目也不自动跑（打开页面就启动一遍
 * 正是按需启动要避免的）。两者手动「检测」仍可用。
 */
export function autoProbeEligible(entries: McpConfigEntry[]): McpConfigEntry[] {
  return entries.filter(
    (entry) =>
      entry.enabled &&
      probeable(entry) &&
      entry.launchMode !== "onDemand" &&
      !entry.workspaceFile,
  );
}

/**
 * 打开（或切到某个引擎）时自动检测 `autoProbeEligible` 的条目：指纹由这些
 * 条目的「id + 配置哈希」组成，指纹没变就不再跑（重复打开只吃缓存），变了的
 * 条目里只补那些没有新鲜结果的。
 */
export function useAutoProbe(
  entries: McpConfigEntry[] | undefined,
  workspacePath: string | null,
  enabled = true,
): void {
  const probeAll = useMcpProbeStore((state) => state.probeAll);
  const runningAll = useMcpProbeStore((state) => state.runningAll);
  const eligible = useMemo(() => autoProbeEligible(entries ?? []), [entries]);
  const fingerprint = useMemo(
    () => eligible.map((entry) => `${entry.id}@${entry.version}`).join("|"),
    [eligible],
  );
  const probed = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || runningAll) return;
    if (probed.current === fingerprint) return;
    probed.current = fingerprint;
    void probeAll(eligible, workspacePath);
  }, [enabled, fingerprint, runningAll, eligible, probeAll, workspacePath]);
}

/** 当前可见条目里最新一次检测的时间（用于「状态更新于 …」）。 */
export function latestCheckedAt(
  entries: McpConfigEntry[],
  results: Record<string, McpProbeState>,
): number | null {
  let latest: number | null = null;
  for (const entry of entries) {
    const state = probeStateFor(results, entry);
    if (!state) continue;
    latest = latest === null ? state.checkedAt : Math.max(latest, state.checkedAt);
  }
  return latest;
}
