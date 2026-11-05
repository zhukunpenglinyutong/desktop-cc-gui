/**
 * 检测工作区里的 MCP 配置前先让用户确认（`McpConfigEntry.workspaceFile`）。
 *
 * 这些配置文件放在工作区目录里（`.mcp.json`、`.codex/config.toml`、
 * `.omp/mcp.json` …），可以随仓库一起下载；检测会真的启动其中的命令或连接
 * 其中的地址。所以它们从不自动检测（probe-store 的 `autoProbeEligible`），
 * 手动检测时先用 `mcp_probe_plan` 拿到完整命令 / 地址给用户看，确认后才执行。
 * 确认绑定的是计划的指纹（`McpProbePlan.fingerprint`，完整目标的哈希）：
 * 每次检测前都重读计划，指纹没变就不再询问，变了（`git pull`、agent 改了
 * 文件，哪怕列表还没刷新）就重新询问；检测请求带上已确认的指纹，后端不一致
 * 时拒绝执行（`conflict`），调用方据此 `forgetProbeConfirm`。
 *
 * 形状同 lib/grant.ts：`McpProbeConfirmHost` 渲染这个请求，答复后 resolve；
 * 并发的请求串行排队，不会互相覆盖。
 */
import { mcpApi } from "./api";
import type { McpConfigEntry, McpProbePlan } from "./types";

export interface ProbeConfirmItem {
  entry: McpConfigEntry;
  /** null: the plan could not be read; the dialog says so. */
  plan: McpProbePlan | null;
}

let pending: ((ok: boolean) => void) | null = null;
/** Stable snapshot for useSyncExternalStore (a new object only on change). */
let snapshot: { items: ProbeConfirmItem[] } | null = null;
const listeners = new Set<() => void>();
/** confirmKey → fingerprint of the plan the user confirmed. */
const confirmed = new Map<string, string>();
let chain: Promise<unknown> = Promise.resolve();

function emit() {
  for (const cb of listeners) cb();
}

function confirmKey(entry: McpConfigEntry, workspace: string | null): string {
  return `${workspace ?? ""}\u0000${entry.id}`;
}

/** The fingerprint to send with this entry's probe, if confirmed. */
export function confirmedFingerprint(
  entry: McpConfigEntry,
  workspace: string | null,
): string | undefined {
  return confirmed.get(confirmKey(entry, workspace));
}

/** Drop a confirmation the backend rejected as stale (`conflict`). */
export function forgetProbeConfirm(entry: McpConfigEntry, workspace: string | null) {
  confirmed.delete(confirmKey(entry, workspace));
}

/** useSyncExternalStore wiring for McpProbeConfirmHost. */
export function subscribeProbeConfirm(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function currentProbeConfirm(): { items: ProbeConfirmItem[] } | null {
  return snapshot;
}

export function answerProbeConfirm(ok: boolean) {
  const resolve = pending;
  pending = null;
  snapshot = null;
  emit();
  resolve?.(ok);
}

async function ask(entries: McpConfigEntry[], workspace: string | null): Promise<boolean> {
  // Re-read every plan: the list may be stale while the file changed.
  const planned = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      plan: await mcpApi.probePlan(entry, workspace).catch(() => null),
    })),
  );
  const items = planned.filter(
    ({ entry, plan }) =>
      !plan?.fingerprint || confirmed.get(confirmKey(entry, workspace)) !== plan.fingerprint,
  );
  if (items.length === 0) return true;
  const ok = await new Promise<boolean>((resolve) => {
    pending = resolve;
    snapshot = { items };
    emit();
  });
  if (ok) {
    for (const { entry, plan } of items) {
      if (plan?.fingerprint) confirmed.set(confirmKey(entry, workspace), plan.fingerprint);
    }
  }
  return ok;
}

/** Resolve true once the user agreed to run these workspace servers. */
export function confirmWorkspaceProbe(
  entries: McpConfigEntry[],
  workspace: string | null,
): Promise<boolean> {
  if (entries.length === 0) return Promise.resolve(true);
  const asked = chain.catch(() => undefined).then(() => ask(entries, workspace));
  chain = asked;
  return asked;
}
