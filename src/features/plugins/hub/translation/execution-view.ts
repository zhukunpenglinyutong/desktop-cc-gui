import type { TFunction } from "i18next";
import { useShallow } from "zustand/react/shallow";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { useChatStore } from "@/features/chat/store";
import { resolveTranslationExecution, type TranslationExecutionResolution } from "./execution";
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

/** 这次翻译会用的引擎/模型：设置里固定的优先，其次跟随当前会话。 */
export function useTranslationExecution(): TranslationExecutionResolution {
  const { engines, active } = useChatStore(
    useShallow((s) => ({ engines: s.engines, active: s.active })),
  );
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
