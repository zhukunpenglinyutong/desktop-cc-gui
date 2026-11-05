/**
 * MCP 页面的展示用映射：引擎显示名与只读原因本地化。放在独立模块里，
 * 设置页、`/mcp` 面板与详情弹窗共用，避免互相 import 造成循环依赖。
 */
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import type { McpConfigEntry } from "./types";

export function engineLabel(id: string): string {
  return CLI_DISPLAY_NAMES[id] ?? id;
}

export type Translate = (
  key: string,
  options?: { defaultValue?: string },
) => string;

/** 只读说明：优先用可本地化的原因码，其次后端下发的字面文案，最后兜底。 */
export function readonlyReasonText(t: Translate, entry: McpConfigEntry): string {
  const code = entry.readonlyReasonCode;
  if (code) {
    return t(`mcp.readonlyReason.${code}`, {
      defaultValue: entry.readonlyReason ?? t("mcp.readonly"),
    });
  }
  return entry.readonlyReason ?? t("mcp.readonly");
}

/** 引擎深链（`#/settings?page=mcp&engine=codex`）——从 hash 读取，让设置
 *  区块在 Router 之外（测试、嵌入式使用）也能渲染。 */
export function engineIdFromHash(hash: string): string | null {
  const query = hash.split("?")[1];
  if (!query) return null;
  return new URLSearchParams(query).get("engine");
}

/** 深链到设置页的 MCP 区块。 */
export function openMcpSettings(engineId: string): void {
  window.location.hash = `#/settings?page=mcp&engine=${encodeURIComponent(engineId)}`;
}
