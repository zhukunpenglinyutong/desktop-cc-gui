import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  SettingsShell,
  type SettingsNavGroup,
} from "@/components/application/settings/settings-shell";
import {
  pluginIdFromRegistryKey,
  settingsRegistry,
  useRegistry,
} from "@ccgui/plugin-sdk";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";
import { pluginSettingsNavIcon } from "@/features/plugins/hub/PluginSettingsNavIcon";
import { useChatStore } from "@/features/chat/store";
import { ENGINE_IDS, type EngineId } from "./providers";
import { CliHeaderActions } from "./CliHeaderActions";
import {
  orderByStoredKeys,
  useCliNavOrder,
  writeCliNavOrder,
} from "@/lib/cli-nav-order";
import { settingsSearchEntries } from "./settings-search";
// Side-effect import: registers all builtin sections into settingsRegistry
// (and their page-internal search rows, see ./sections).
import "./sections";

/** Rail meta for known nav groups (label + rail order). A group the SDK adds
 *  later isn't listed here — it falls back to label = group id, appended
 *  after the known rails, so new groups render instead of silently
 *  vanishing (empty groups are filtered out as before). */
/** A nav group plus its rail order, sorted before handing to the modal. */
type RailGroup = SettingsNavGroup & { order: number };
const GROUP_META: Record<string, { labelKey: string; order: number }> = {
  system: { labelKey: "settings.groupSystem", order: 0 },
  plugins: { labelKey: "settings.groupPlugins", order: 1 },
  cli: { labelKey: "settings.cliManage", order: 2 },
  capabilities: { labelKey: "settings.groupCapabilities", order: 3 },
  workspace: { labelKey: "settings.groupWorkspace", order: 4 },
  misc: { labelKey: "settings.groupMisc", order: 5 },
};
const KNOWN_GROUP_COUNT = Object.keys(GROUP_META).length;
// The rail order lives in @/lib/cli-nav-order, shared with the composer CLI
// picker so both surfaces follow the same drag order.

/** Unknown page params fall back to General. */
const renderPage = (key: string) => {
  const def = settingsRegistry.get(key);
  if (!def) {
    const fallback = settingsRegistry.get("general");
    return fallback ? <fallback.component /> : null;
  }
  const Component = def.component;
  // Plugin-rendered pages are wrapped so a render crash unmounts only the
  // plugin subtree (plan acceptance 1b); host pages stay unwrapped.
  if (key.startsWith("plugin:")) {
    return (
      <PluginBoundary pluginId={pluginIdFromRegistryKey(key)}>
        <Component />
      </PluginBoundary>
    );
  }
  return <Component />;
};
/** CLI 管理 pages get the docs/version/update cluster next to the title. */
const renderHeaderActions = (key: string) => {
  if (!key.startsWith("cli:")) return null;
  const engine = key.slice("cli:".length);
  if (!(ENGINE_IDS as readonly string[]).includes(engine)) return null;
  return <CliHeaderActions engine={engine as EngineId} />;
};

/**
 * Settings route: fullscreen settings shell. ChatPage itself is mounted once
 * by App on every route, so opening and closing settings never rebuilds
 * the chat tree.
 *
 * Nav groups and pages come from settingsRegistry: builtin sections register
 * in ./sections, plugin sections arrive via ctx.ui.registerSettingsSection
 * (plan §4.2 #1).
 */
export default function SettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sections = useRegistry(settingsRegistry);
  const cliNavOrder = useCliNavOrder();
  /** Engine enable states; the chat store refreshes them on every CLI config
   *  change, so toggling a CLI's enable switch moves its rail row live. An
   *  empty list (probe still running or failed) means "don't split" — never
   *  collapse the whole rail away. */
  const engines = useChatStore((s) => s.engines);
  /** CLI 管理 rail keys in display order (user order wins over registry order). */
  const orderedCliKeys = useMemo(() => {
    const keys = sections
      .filter((def) => def.group === "cli")
      .sort((a, b) => a.order - b.order)
      .map((def) => def.key);
    return orderByStoredKeys(
      keys.map((key) => ({ key })),
      cliNavOrder,
    ).map((entry) => entry.key);
  }, [sections, cliNavOrder]);
  // Legacy links land on a CLI 管理 page: ?page=cliConfig → first CLI,
  // ?page=dsh → the DSH engine page (its host section merged there).
  // ?page=agentsPrompts was the old combined 智能体与提示词 page; it opens the
  // 智能体 half, which was that page's default tab.
  const rawPage = searchParams.get("page") ?? "general";
  const pageParam =
    rawPage === "cliConfig"
      ? (orderedCliKeys[0] ?? "general")
      : rawPage === "dsh"
        ? "cli:dsh"
        : rawPage === "agentsPrompts"
          ? "agents"
          : rawPage;

  const groups = useMemo<RailGroup[]>(() => {
    const sorted = [...sections].sort((a, b) => a.order - b.order);
    // Bucket by group in first-seen order; unknown groups (new SDK group
    // values) keep their own rail instead of joining nothing.
    const byGroup = new Map<string, SettingsNavGroup["items"]>();
    for (const def of sorted) {
      const item = {
        key: def.key,
        label: def.label(),
        icon: pluginSettingsNavIcon(def),
      };
      const bucket = byGroup.get(def.group);
      if (bucket) bucket.push(item);
      else byGroup.set(def.group, [item]);
    }
    /** Enabled engine ids; empty when the engine probe hasn't landed, in
     *  which case every CLI stays in the main rail. */
    const enabledEngines = new Set(
      engines.flatMap((engine) => (engine.enabled ? [engine.id] : [])),
    );
    /** Installed engine ids; empty while the probe is out, in which case
     *  every CLI stays in the main rail. */
    const availableEngines = new Set(
      engines.flatMap((engine) => (engine.available ? [engine.id] : [])),
    );
    // Re-render the rail on language flips: labels are functions of i18n.
    return [...byGroup.entries()]
      .flatMap(([group, items], index) => {
        const meta = GROUP_META[group];
        const order = meta?.order ?? KNOWN_GROUP_COUNT + index;
        if (group !== "cli") {
          // Every rail group is a static Codex-style section (muted heading,
          // always-visible items) — no collapse state to carry.
          return [
            {
              id: group,
              label: meta ? t(meta.labelKey) : group,
              order,
              items,
            },
          ];
        }
        const ordered = orderByStoredKeys(items, orderedCliKeys);
        // CLIs whose binary isn't installed drop into a 未安装 bucket with
        // grayed icons, CLIs the user turned off into the 未启用 bucket.
        // Both buckets only exist once the engine
        // probe has landed and at least one CLI qualifies.
        // Plugin sections in this rail have no `cli:` key — no engine state,
        // they always stay in the main group.
        const uninstalledItems =
          engines.length > 0
            ? ordered.flatMap((item) =>
                item.key.startsWith("cli:") &&
                !availableEngines.has(item.key.slice("cli:".length))
                  ? [{ ...item, disabled: true }]
                  : [],
              )
            : [];
        const installedItems =
          uninstalledItems.length > 0
            ? ordered.filter(
                (item) => !uninstalledItems.some((u) => u.key === item.key),
              )
            : ordered;
        const disabledItems =
          engines.length > 0
            ? installedItems.flatMap((item) =>
                item.key.startsWith("cli:") &&
                !enabledEngines.has(item.key.slice("cli:".length))
                  ? [{ ...item, disabled: true }]
                  : [],
              )
            : [];
        const enabledItems =
          disabledItems.length > 0
            ? installedItems.filter(
                (item) => !disabledItems.some((d) => d.key === item.key),
              )
            : installedItems;
        const rail: RailGroup[] = [
          {
            id: "cli",
            label: meta ? t(meta.labelKey) : group,
            order,
            items: enabledItems,
            // The rail, the 未安装 bucket and the 未启用 bucket fold; the two
            // buckets start folded so the installed-and-enabled CLIs stay in
            // view, while the main rail starts open.
            collapsible: true,
            defaultExpanded: true,
            // The CLI 管理 rail is drag-sortable; the order persists across
            // sessions (localStorage) and new engines append at the end. A
            // reorder only covers the enabled rows — the stored list keeps
            // the bucketed keys trailing in their current relative order.
            onReorderItems: (orderedKeys: string[]) => {
              const next = [
                ...orderedKeys,
                ...disabledItems.map((item) => item.key),
                ...uninstalledItems.map((item) => item.key),
              ];
              writeCliNavOrder(next);
            },
            dragHandleLabel: t("settings.cliDrag"),
          },
        ];
        // Bucket order: 未安装 sorts before 未启用; both are folded buckets
        // that unfold on click (and stay visible on the mobile rail, which
        // has no headings to toggle). `nested` tucks each bucket under the
        // CLI 管理 rail with a tighter gap than a full section gets.
        if (uninstalledItems.length > 0) {
          rail.push({
            id: "cli-missing",
            label: t("settings.cliNotInstalledGroup"),
            order: order + 0.5,
            items: uninstalledItems,
            collapsible: true,
            nested: true,
          });
        }
        if (disabledItems.length > 0) {
          rail.push({
            id: "cli-disabled",
            label: t("settings.cliDisabledGroup"),
            order: order + 0.6,
            items: disabledItems,
            collapsible: true,
            nested: true,
          });
        }
        return rail;
      })
      .sort((a, b) => a.order - b.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, t, i18n.language, cliNavOrder, orderedCliKeys, engines]);

  const titles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const def of sections) map[def.key] = def.label();
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, i18n.language]);

  return (
    <SettingsShell
      key={pageParam}
      onClose={() => navigate("/")}
      defaultPage={pageParam}
      ariaLabel={t("settings.title")}
      groups={groups}
      titles={titles}
      renderPage={renderPage}
      renderHeaderActions={renderHeaderActions}
      searchEntries={settingsSearchEntries()}
    />
  );
}
