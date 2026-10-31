/**
 * 条目的两个开关：
 *
 * - 启用：写 CLI 自己的配置，影响所有客户端；只读来源也常驻开关、显示真实
 *   状态，只是置灰不可点，原因在悬停提示里。
 * - 启动方式：只写 ccgui 设置，只影响本应用拉起的引擎进程。按需启动时工具
 *   清单照常给模型（来自缓存），真实 server 到第一次调用才启动。
 *
 * 列表行里两者都是纯图标按钮，状态在 aria-pressed 与悬停提示里；详情弹窗
 * 保留带说明的开关。停用的条目、非 stdio 条目不能选按需启动：图标置灰但仍
 * 可悬停 / 聚焦以读出原因；整个引擎都不支持时不占位。已是按需的条目总能改回
 * 随会话启动（与详情开关、后端 `write_mode` 同一规则）。
 */
import { useTranslation } from "react-i18next";
import Hourglass from "lucide-react/dist/esm/icons/hourglass";
import Power from "lucide-react/dist/esm/icons/power";
import PowerOff from "lucide-react/dist/esm/icons/power-off";
import Zap from "lucide-react/dist/esm/icons/zap";
import { Switch } from "@/components/base/switch/switch";
import { cx } from "@/utils/cx";
import { readonlyReasonText, type Translate } from "./labels";
import { ROW_ICON_BUTTON } from "./probe-ui";
import type { McpConfigEntry, McpLaunchMode } from "./types";

export function isOnDemand(entry: McpConfigEntry): boolean {
  return entry.launchMode === "onDemand";
}

/** null = 可以切换；否则是不可用的说明文字。 */
export function launchModeBlockedReason(t: Translate, entry: McpConfigEntry): string | null {
  if (entry.launchModeUnsupported) {
    return t(`mcp.launch.unsupported.${entry.launchModeUnsupported}`, {
      defaultValue: t("mcp.launch.unsupported.engine"),
    });
  }
  if (!entry.enabled) return t("mcp.launch.disabledEntry");
  return null;
}

/** 行内启用开关：常驻显示真实启停状态；只读来源置灰不可点，悬停给原因。 */
export function EnableToggle({
  entry,
  pending,
  onChange,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const readonlyReason = entry.writable ? null : readonlyReasonText(t, entry);
  const Icon = entry.enabled ? Power : PowerOff;
  return (
    <button
      type="button"
      aria-label={t("mcp.toggle", { name: entry.name })}
      aria-pressed={entry.enabled}
      // aria-disabled 而不是 disabled：被禁用的按钮收不到悬停，原因提示就出不来。
      aria-disabled={readonlyReason !== null || undefined}
      title={
        readonlyReason ??
        t(entry.enabled ? "mcp.enableHint.on" : "mcp.enableHint.off", { name: entry.name })
      }
      disabled={pending}
      onClick={readonlyReason !== null ? undefined : () => onChange(!entry.enabled)}
      className={cx(
        ROW_ICON_BUTTON,
        entry.enabled ? "text-text-primary" : "text-text-tertiary",
        readonlyReason !== null && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/** 行内启动方式开关：闪电 = 随会话启动，沙漏 = 按需启动。 */
export function LaunchModeToggle({
  entry,
  pending,
  onChange,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  onChange: (mode: McpLaunchMode) => void;
}) {
  const { t } = useTranslation();
  const onDemand = isOnDemand(entry);
  // 整个引擎都不支持时每行都一样：不占位，原因在详情里。
  if (entry.launchModeUnsupported === "engine" && !onDemand) return null;
  const blocked = launchModeBlockedReason(t, entry);
  // 只拦「改成按需」；改回随会话永远可以。
  const locked = blocked !== null && !onDemand;
  const Icon = onDemand ? Hourglass : Zap;
  return (
    <button
      type="button"
      aria-label={t("mcp.launch.toggle", { name: entry.name })}
      aria-pressed={onDemand}
      // aria-disabled 而不是 disabled：被禁用的按钮收不到悬停，原因提示就出不来。
      aria-disabled={locked || undefined}
      title={
        locked
          ? blocked
          : t(onDemand ? "mcp.launch.onDemandHint" : "mcp.launch.eagerHint", { name: entry.name })
      }
      disabled={pending}
      onClick={locked ? undefined : () => onChange(onDemand ? "eager" : "onDemand")}
      className={cx(
        ROW_ICON_BUTTON,
        onDemand ? "bg-background-tertiary-default text-text-primary" : "text-text-tertiary",
        locked && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}

/** 详情弹窗里的完整一行：开关 + 说明。 */
export function LaunchModeRow({
  entry,
  pending,
  onChange,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  onChange: (mode: McpLaunchMode) => void;
}) {
  const { t } = useTranslation();
  const blocked = launchModeBlockedReason(t, entry);
  return (
    <div className="flex flex-col gap-1 rounded-2lg border border-separator-border px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-body-2-regular text-text-primary">{t("mcp.launch.title")}</span>
        <Switch
          size="sm"
          aria-label={t("mcp.launch.toggle", { name: entry.name })}
          isSelected={isOnDemand(entry)}
          isDisabled={pending || (blocked !== null && !isOnDemand(entry))}
          onChange={(onDemand) => onChange(onDemand ? "onDemand" : "eager")}
        />
      </div>
      <p className="text-caption-1-regular text-text-secondary">
        {blocked ?? t("mcp.launch.description")}
      </p>
    </div>
  );
}
