import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { pluginIdFromRegistryKey, statusBarRegistry, useRegistry } from "@ccgui/plugin-sdk";
import { Switch } from "@/components/base/switch/switch";
import {
  SettingsCard,
  SettingsRow,
} from "@/components/application/settings/settings-rows";
import { usePluginsStore } from "@/features/plugins/manager/usePlugins";
import {
  STATUS_BAR_BUILTIN_CATALOG,
  useStatusBarHidden,
  useStatusBarVisibilityStore,
} from "@/lib/status-bar-visibility";

/**
 * 状态栏显示 (设置 → 插件): one switch per builtin item plus one per plugin.
 *
 * 插件按**插件**聚合而不是按 chip：一个插件挂多个 chip 时共用一个开关，
 * 因为用户的心智是「这个插件要不要占我的底栏」，不是「它的第 2 个格子
 * 要不要」。分组在渲染时从 statusBarRegistry 现场推导，插件装/卸/重载
 * 后无需任何同步逻辑。
 *
 * 关闭 = 不渲染，不等于停用插件：插件的定时器、IPC 与面板都照旧。这条
 * 写进页面说明里，避免用户以为关掉开关能省资源。
 */
export function StatusBarDisplaySection() {
  const { t } = useTranslation();
  const items = useRegistry(statusBarRegistry);
  const hidden = useStatusBarHidden();
  const setVisible = useStatusBarVisibilityStore((state) => state.setVisible);
  const installed = usePluginsStore((state) => state.installed);
  const refreshPlugins = usePluginsStore((state) => state.refresh);

  // 插件名来自管理器列表（启动时已由 startPluginSystem 填充）。这里补一次
  // 刷新，覆盖「后端晚于界面就绪」的启动竞态；失败就退回显示插件 id。
  useEffect(() => {
    void refreshPlugins().catch(() => {});
  }, [refreshPlugins]);

  const displayNameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const plugin of installed) names.set(plugin.id, plugin.name);
    return names;
  }, [installed]);

  const pluginGroups = useMemo(() => {
    const groups = new Map<string, { pluginId: string; label: string; chipIds: string[] }>();
    for (const def of items) {
      const pluginId = pluginIdFromRegistryKey(def.id);
      const existing = groups.get(pluginId);
      if (existing) existing.chipIds.push(def.id);
      else
        groups.set(pluginId, {
          pluginId,
          label: displayNameOf.get(pluginId) ?? pluginId,
          chipIds: [def.id],
        });
    }
    return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [items, displayNameOf]);

  const builtinIds = STATUS_BAR_BUILTIN_CATALOG.map((item) => item.id);
  const hiddenBuiltinCount = builtinIds.filter((id) => hidden.has(id)).length;
  const hiddenPluginCount = pluginGroups.filter((group) =>
    group.chipIds.every((id) => hidden.has(id)),
  ).length;

  const showAll = () => {
    setVisible([...builtinIds, ...pluginGroups.flatMap((group) => group.chipIds)], true);
  };
  const hideAll = () => {
    setVisible([...builtinIds, ...pluginGroups.flatMap((group) => group.chipIds)], false);
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex w-full flex-col gap-2">
        <p className="px-3 text-body-2-regular text-text-secondary">
          {t("settings.statusBarDisplayDesc")}
        </p>

        <p className="mt-2 px-3 text-body-2-medium text-text-tertiary">
          {t("settings.statusBarBuiltinGroup")}
        </p>
        <SettingsCard className="mt-1">
          {STATUS_BAR_BUILTIN_CATALOG.map((item) => {
            const label = t(item.labelKey);
            return (
              <SettingsRow key={item.id} anchor={item.anchor} label={label}>
                <Switch
                  size="sm"
                  aria-label={label}
                  isSelected={!hidden.has(item.id)}
                  onChange={(visible) => setVisible([item.id], visible)}
                />
              </SettingsRow>
            );
          })}
        </SettingsCard>

        <p className="mt-2 px-3 text-body-2-medium text-text-tertiary">
          {t("settings.statusBarPluginGroup")}
        </p>
        <SettingsCard className="mt-1">
          {pluginGroups.length === 0 ? (
            <p className="py-4 pr-3 text-body-2-regular text-text-tertiary">
              {t("settings.statusBarNoPlugins")}
            </p>
          ) : (
            pluginGroups.map((group) => {
              const visible = group.chipIds.some((id) => !hidden.has(id));
              return (
                // 插件行不带 anchor：搜索索引是静态声明的，插件列表随安装
                // 变化，索引不了。
                <SettingsRow key={group.pluginId} label={group.label}>
                  <Switch
                    size="sm"
                    aria-label={group.label}
                    isSelected={visible}
                    onChange={(next) => setVisible(group.chipIds, next)}
                  />
                </SettingsRow>
              );
            })
          )}
        </SettingsCard>

        <div className="mt-2 flex items-center justify-between gap-3 px-3">
          <p className="text-body-2-regular text-text-tertiary">
            {t("settings.statusBarHiddenSummary", {
              builtin: hiddenBuiltinCount,
              plugins: hiddenPluginCount,
            })}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={showAll}
              className="cursor-pointer rounded-lg bg-background-secondary-default px-3 py-1.5 text-body-2-medium text-text-primary transition-colors hover:bg-background-secondary-hover"
            >
              {t("settings.statusBarShowAll")}
            </button>
            <button
              type="button"
              onClick={hideAll}
              className="cursor-pointer rounded-lg bg-background-secondary-default px-3 py-1.5 text-body-2-medium text-text-primary transition-colors hover:bg-background-secondary-hover"
            >
              {t("settings.statusBarHideAll")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
