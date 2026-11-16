import type { TFunction } from "i18next";
import { useShallow } from "zustand/react/shallow";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { useChatStore } from "@/features/chat/store";
import { sessionKey } from "@/features/chat/store/persistence";
import { resolveSessionModel, resolveSessionProvider } from "@/features/chat/store/stream";
import type { ChatStore } from "@/features/chat/store/types";
import {
  resolveTranslationExecution,
  TOOL_LESS_ENGINES,
  type CurrentSessionExecution,
  type TranslationExecutionResolution,
} from "./execution";
import { usePluginTranslationStore } from "./store";

/**
 * 翻译用哪个引擎/模型的展示层：插件中心的菜单与 设置 → 插件 → 插件翻译
 * 共用。刻意不依赖插件中心的组件与市场状态，设置页引入它不会连带加载
 * 插件运行时。
 */

/** 设置 → 插件 → 插件翻译 的页面 key。 */
export const TRANSLATION_SETTINGS_PAGE = "pluginTranslation";

export function openTranslationSettings(): void {
  window.location.hash = `#/settings?page=${TRANSLATION_SETTINGS_PAGE}`;
}

export function engineName(engine: string): string {
  return CLI_DISPLAY_NAMES[engine] ?? engine;
}

/**
 * 当前会话实际在用的模型与渠道，与聊天发送（messaging.ts）同一套解析：
 * 模型 = 标签页所选 > 会话记住的 > 历史消息里的 > 引擎默认；渠道 = 未创建
 * 会话的标签页所选 > 会话记住的 > 引擎当前渠道。
 */
export function selectCurrentSession(
  s: Pick<ChatStore, "active" | "bySession" | "models" | "providers">,
): CurrentSessionExecution | null {
  const tab = s.active;
  if (!tab) return null;
  // 每次聊天状态更新都会跑：不能零工具运行的引擎根本用不上模型/渠道，别去扫消息。
  if (!TOOL_LESS_ENGINES.includes(tab.engine)) return { engine: tab.engine, model: null, provider: null };
  const session = s.bySession[sessionKey(tab.engine, tab.sessionId, tab.workspacePath)];
  return {
    engine: tab.engine,
    model: resolveSessionModel(tab, session, s.models[tab.engine]) || null,
    provider: resolveSessionProvider(tab, session, s.providers[tab.engine]) ?? null,
  };
}

/** 这次翻译会用的引擎/模型：设置里固定的优先，其次跟随当前会话。 */
export function useTranslationExecution(): TranslationExecutionResolution {
  const engines = useChatStore((s) => s.engines);
  const active = useChatStore(useShallow(selectCurrentSession));
  const preference = usePluginTranslationStore((s) => s.preference);
  return resolveTranslationExecution(engines, active, preference);
}

/** 「模型：Claude Code · sonnet（当前会话）」这类一行说明。 */
export function describeExecution(
  resolution: TranslationExecutionResolution,
  t: TFunction,
): string {
  if (!resolution.execution) {
    return resolution.reason === "pinnedUnavailable"
      ? t("plugins.hub.translate.pinnedUnavailable", { engine: engineName(resolution.engine) })
      : t("plugins.hub.translate.noEngine");
  }
  const key =
    resolution.source === "settings"
      ? "plugins.hub.translate.modelSettings"
      : resolution.source === "session"
        ? "plugins.hub.translate.modelSession"
        : "plugins.hub.translate.modelDefault";
  return t(key, {
    engine: engineName(resolution.execution.engine),
    model: resolution.execution.model ?? t("plugins.hub.translate.modelDefaultName"),
  });
}
