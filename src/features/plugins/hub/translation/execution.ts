import type { EngineInfo } from "@/lib/ipc";
import type { TranslationExecution } from "./runner";
import type { TranslationPreference } from "./store";

/**
 * 能跑零工具轮次的引擎，与后端 `Engine::supports_no_tools` 保持一致
 * （claude.rs / pi_family.rs）。这里只用来挑默认引擎、给设置页列选项和
 * 给出说明；真正的闸门在后端 prepare_launch，名单不一致时启动会被如实拒绝。
 */
export const TOOL_LESS_ENGINES: readonly string[] = ["claude", "pi"];

export function isEngineUsable(engines: EngineInfo[], id: string): boolean {
  return engines.some((info) => info.id === id && info.available && info.enabled);
}

/**
 * 当前会话实际在用的引擎 / 模型 / 渠道，按聊天发送同一套规则解析过
 * （execution-view.ts 的 selectCurrentSession）。
 */
export interface CurrentSessionExecution {
  engine: string;
  model: string | null;
  provider: string | null;
}

export type TranslationExecutionResolution =
  | { execution: TranslationExecution; source: "settings" | "session" | "default" }
  | { execution: null; reason: "noEngine" }
  /** 设置里固定的引擎现在用不了（未安装或已停用）：不悄悄换别的引擎。 */
  | { execution: null; reason: "pinnedUnavailable"; engine: string };

/**
 * 这次翻译用哪个引擎/模型：
 * 1. 设置 → 插件翻译里固定了引擎：就用它（及固定的模型，未固定 = 引擎默认）；
 *    那个引擎用不了时直接报不可用，而不是悄悄换成别的引擎。
 * 2. 跟随当前会话：会话引擎能零工具运行时用它实际在用的模型与渠道；
 * 3. 否则退到第一个可用的受支持引擎的默认模型。
 * 推理档位不跟随会话——翻译不需要高档位，用引擎默认值。
 */
export function resolveTranslationExecution(
  engines: EngineInfo[],
  active: CurrentSessionExecution | null,
  preference?: TranslationPreference | null,
): TranslationExecutionResolution {
  if (preference?.engine) {
    const engine = preference.engine;
    if (!TOOL_LESS_ENGINES.includes(engine) || !isEngineUsable(engines, engine)) {
      return { execution: null, reason: "pinnedUnavailable", engine };
    }
    return {
      execution: { engine, model: preference.model ?? null, providerId: null },
      source: "settings",
    };
  }
  if (active && TOOL_LESS_ENGINES.includes(active.engine) && isEngineUsable(engines, active.engine)) {
    return {
      execution: { engine: active.engine, model: active.model, providerId: active.provider },
      source: "session",
    };
  }
  const fallback = TOOL_LESS_ENGINES.find((id) => isEngineUsable(engines, id));
  if (!fallback) return { execution: null, reason: "noEngine" };
  return { execution: { engine: fallback, model: null, providerId: null }, source: "default" };
}
