/** composer CLI 菜单选项过滤(纯函数便于单测):
 *  - 关闭的引擎不出现;
 *  - 未安装(本机探针 available=false)的引擎不出现;
 *  - 接管工作区(allowedEngines 非 null,由 workspace-ui 桥提供)只留列表内
 *    的 CLI,可用态按列表内与否,不按本机 `command -v`。 */
import { workspaceAllowedEngines } from "../workspace-ui-bridge";
import type { EngineInfo } from "@/lib/ipc";
import { orderByStoredKeys } from "@/lib/cli-nav-order";

export interface EngineOption {
  id: string;
  label: string;
  available: boolean;
  disabled: boolean;
  disabledReason: string;
}

export function filterEngineOptions(
  engines: EngineInfo[],
  allowedEngines: string[] | null,
  t: (key: string) => string,
): EngineOption[] {
  const allowed = allowedEngines === null ? null : new Set(allowedEngines);
  return engines.flatMap((e) => {
    if (!e.enabled) return [];
    if (allowed && !allowed.has(e.id)) return [];
    const delegated = allowed !== null;
    if (!delegated && !e.available) return [];
    return [
      {
        id: e.id,
        label: t(`settings.engines.${e.id}`),
        available: delegated || e.available,
        disabled: false,
        disabledReason: t("chat.engineNotInstalled"),
      },
    ];
  });
}

/** Picker order follows the settings CLI 管理 rail's drag order (same
 *  localStorage list, keyed "cli:<engineId>"); engines missing from the
 *  stored list keep their registry order at the end. */
export function orderEngineOptions(
  options: EngineOption[],
  cliNavOrder: string[],
): EngineOption[] {
  return orderByStoredKeys(
    options.map((option) => ({ key: `cli:${option.id}`, option })),
    cliNavOrder,
  ).map((entry) => entry.option);
}

export function workspaceEngineOptions(
  engines: EngineInfo[],
  workspacePath: string,
  t: (key: string) => string,
): EngineOption[] {
  return filterEngineOptions(engines, workspaceAllowedEngines(workspacePath), t);
}
