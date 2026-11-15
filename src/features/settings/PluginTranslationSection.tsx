import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { Select, SelectItem } from "@/components/base/select/select";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { useChatStore } from "@/features/chat/store";
import {
  isEngineUsable,
  TOOL_LESS_ENGINES,
} from "@/features/plugins/hub/translation/execution";
import {
  describeExecution,
  useTranslationExecution,
} from "@/features/plugins/hub/translation/execution-view";
import { usePluginTranslationStore } from "@/features/plugins/hub/translation/store";
import { ipc, type EngineModel } from "@/lib/ipc";

/** Select 的「跟随会话 / 默认模型」占位值（Select 的 key 不能为空串）。 */
const FOLLOW_SESSION = "__session__";
const DEFAULT_MODEL = "__default__";

/**
 * 设置 → 插件 → 插件翻译：插件中心「翻译」用哪个引擎与模型。
 *
 * 引擎只列能零工具运行的（Claude Code / Pi）：翻译的输入是第三方插件文本，
 * 后端必须能把这一轮跑成没有任何工具的纯文本轮次。未安装或已停用的引擎
 * 置灰并注明原因。默认「跟随当前会话」。
 *
 * 模型目录只在选定某个引擎后拉取（`list_engine_models`：Claude 读本机
 * 文件，Pi 跑一次 `pi models`，与聊天的模型选择器同一来源），拉不到时仍可
 * 用「默认模型」，已保存但目录里没有的模型保留为可选项。
 */
export function PluginTranslationSection() {
  const { t } = useTranslation();
  const engines = useChatStore((s) => s.engines);
  const preference = usePluginTranslationStore((s) => s.preference);
  const setPreference = usePluginTranslationStore((s) => s.setPreference);
  const resolution = useTranslationExecution();
  const [models, setModels] = useState<EngineModel[] | null>(null);
  const [modelsFailed, setModelsFailed] = useState(false);

  const pinned = preference.engine;
  const pinnedUsable = pinned ? isEngineUsable(engines, pinned) : false;

  useEffect(() => {
    setModels(null);
    setModelsFailed(false);
    if (!pinned || !pinnedUsable) return;
    let cancelled = false;
    ipc
      .listEngineModels(pinned)
      .then((catalog) => {
        if (!cancelled) setModels(catalog?.models ?? []);
      })
      .catch(() => {
        if (!cancelled) setModelsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pinned, pinnedUsable]);

  const engineLabel = (id: string): string => {
    const name = CLI_DISPLAY_NAMES[id] ?? id;
    const info = engines.find((engine) => engine.id === id);
    if (!info || !info.available) return t("settings.translationEngineMissing", { engine: name });
    if (!info.enabled) return t("settings.translationEngineDisabled", { engine: name });
    return name;
  };

  // 已保存但目录里没有的模型（目录变化、拉取失败）仍显示为可选项。
  const modelOptions: { id: string; label: string }[] = [
    { id: DEFAULT_MODEL, label: t("plugins.hub.translate.modelDefaultName") },
    ...(models ?? []).map((model) => ({ id: model.id, label: model.name || model.id })),
  ];
  if (preference.model && !modelOptions.some((option) => option.id === preference.model)) {
    modelOptions.push({ id: preference.model, label: preference.model });
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <p className="px-3 text-body-2-regular text-text-secondary">
        {t("settings.translationDesc")}
      </p>
      <SettingsCard className="mt-1">
        <SettingsRow
          anchor="translationEngine"
          label={t("settings.translationEngine")}
          description={t("settings.translationEngineHint")}
        >
          <Select
            aria-label={t("settings.translationEngine")}
            className="w-[240px] shrink-0"
            selectedKey={pinned ?? FOLLOW_SESSION}
            onSelectionChange={(key) => {
              if (key === null) return;
              const engine = key === FOLLOW_SESSION ? null : String(key);
              // 模型 id 属于具体引擎：换引擎时回到该引擎的默认模型。
              setPreference({ engine, model: null });
            }}
          >
            <SelectItem id={FOLLOW_SESSION}>{t("settings.translationFollowSession")}</SelectItem>
            {TOOL_LESS_ENGINES.map((id) => (
              <SelectItem
                key={id}
                id={id}
                // 已固定的引擎即便不可用也保持可见可选，否则当前值无处显示。
                isDisabled={!isEngineUsable(engines, id) && id !== pinned}
              >
                {engineLabel(id)}
              </SelectItem>
            ))}
          </Select>
        </SettingsRow>
        <SettingsRow
          anchor="translationModel"
          label={t("settings.translationModel")}
          description={
            !pinned
              ? t("settings.translationModelFollow")
              : modelsFailed
                ? t("settings.translationModelLoadFailed")
                : t("settings.translationModelHint")
          }
        >
          <Select
            aria-label={t("settings.translationModel")}
            className="w-[240px] shrink-0"
            isDisabled={!pinned || !pinnedUsable}
            selectedKey={preference.model ?? DEFAULT_MODEL}
            onSelectionChange={(key) => {
              if (key === null) return;
              setPreference({
                engine: pinned,
                model: key === DEFAULT_MODEL ? null : String(key),
              });
            }}
          >
            {modelOptions.map((option) => (
              <SelectItem key={option.id} id={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </Select>
        </SettingsRow>
      </SettingsCard>
      <p
        className={
          resolution.execution
            ? "px-3 text-body-2-regular text-text-tertiary"
            : "px-3 text-body-2-regular text-text-warning-primary"
        }
      >
        {describeExecution(resolution, t)}
      </p>
    </div>
  );
}
