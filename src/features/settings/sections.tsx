import { lazy, Suspense, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import Settings from "lucide-react/dist/esm/icons/settings";
import PawPrint from "lucide-react/dist/esm/icons/paw-print";
import Keyboard from "lucide-react/dist/esm/icons/keyboard";
import Globe from "lucide-react/dist/esm/icons/globe";
import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import Archive from "lucide-react/dist/esm/icons/archive";
import Info from "lucide-react/dist/esm/icons/info";
import Activity from "lucide-react/dist/esm/icons/activity";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Bot from "lucide-react/dist/esm/icons/bot";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Smartphone from "lucide-react/dist/esm/icons/smartphone";
import ChartColumn from "lucide-react/dist/esm/icons/chart-column";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Plug from "lucide-react/dist/esm/icons/plug";
// 电脑操控入口：暂时隐藏，恢复时取消注释。
// import MousePointer2 from "lucide-react/dist/esm/icons/mouse-pointer-2";
import i18n from "@/lib/i18n";
import type { SettingsNavItem } from "@/components/application/settings/settings-shell";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { settingsRegistry } from "@ccgui/plugin-sdk";
import { cx } from "@/utils/cx";
import { GeneralSection } from "./GeneralSection";
import { PetSection } from "./PetSection";
import { ProxySection } from "./ProxySection";
import { WorkspacesSection } from "./WorkspacesSection";
import { ArchivedSessionsSection } from "./ArchivedSessionsSection";
import { BotsPane } from "./agents-prompts/BotsPane";
import { PromptsPane } from "./agents-prompts/PromptsPane";
import { CliConfigSection } from "./CliConfigSection";
import { AboutSection } from "./AboutSection";
import { PerformanceDiagnosticsSection } from "./PerformanceDiagnostics";
import { BetaFeaturesSection } from "./BetaFeaturesSection";
import { UpdateSection } from "./UpdateSection";
import { WebAccessSection } from "./WebAccessSection";
import { UsageSection } from "./UsageSection";
import { ShortcutsSection } from "@/features/shortcuts/ShortcutsSection";
import { ENGINE_IDS, type EngineId } from "./providers";
import { builtinSearchEntries } from "./builtin-search";
import { registerSettingsSearchEntries } from "./settings-search";

/**
 * Builtin settings sections, registered through the same extension-point
 * registry plugins use (plan §4.2 #1 — the settings page is the dogfood
 * surface). Module-scope side effect, imported once by SettingsPage; the
 * registry's upsert semantics make HMR re-runs harmless.
 */

/** Nav-rail mark for one CLI engine, rendered on the rail's own icon grid
 *  (16px, same box as the lucide icons in every other row): brand marks are
 *  full-bleed artwork, so a larger box made them read a size bigger than the
 *  lucide rows *and* pushed the CLI labels 4px right of every other label.
 *  The dsh mark is an <img> with an intrinsic px size, so the box has to be
 *  pinned here rather than left to the shell's size class. The rail colors
 *  every icon foreground-icon-secondary (gray); the monochrome brand glyphs
 *  (kimi/grok/codex/pi follow currentColor) read as disabled at that shade,
 *  so bump them to icon-primary. Image and gradient marks (claude/dsh/omp)
 *  carry their own colors and ignore the text color either way. */
const engineNavIcon = (engine: EngineId): SettingsNavItem["icon"] => {
  const EngineNavIcon = ({ className }: { className?: string }) => (
    <EngineIcon engine={engine} size={16} className={cx(className, "text-foreground-icon-primary")} />
  );
  return EngineNavIcon;
};

settingsRegistry.register({
  id: "general",
  key: "general",
  label: () => i18n.t("settings.general"),
  icon: Settings,
  group: "system",
  order: 0,
  component: GeneralSection,
});
// 页面内部的搜索行索引（settings-search.ts）：跟页面一起注册。覆盖了哪些页
// 在 builtin-search.ts 里一眼能看全（每页一段）。
registerSettingsSearchEntries(builtinSearchEntries);
settingsRegistry.register({
  id: "proxy",
  key: "proxy",
  label: () => i18n.t("settings.proxy"),
  icon: Globe,
  group: "system",
  order: 5,
  component: ProxySection,
});
settingsRegistry.register({
  id: "workspaces",
  key: "workspaces",
  label: () => i18n.t("settings.workspaces"),
  icon: FolderSymlink,
  group: "workspace",
  order: 0,
  component: WorkspacesSection,
});
settingsRegistry.register({
  id: "archivedSessions",
  key: "archivedSessions",
  label: () => i18n.t("settings.archivedSessions"),
  icon: Archive,
  group: "workspace",
  order: 1,
  component: ArchivedSessionsSection,
});
settingsRegistry.register({
  id: "agents",
  key: "agents",
  label: () => i18n.t("settings.agents"),
  icon: Bot,
  group: "system",
  order: 3,
  component: BotsPane,
});
settingsRegistry.register({
  id: "prompts",
  key: "prompts",
  label: () => i18n.t("settings.prompts"),
  icon: FileText,
  group: "system",
  order: 4,
  component: PromptsPane,
});
settingsRegistry.register({
  id: "webAccess",
  key: "webAccess",
  label: () => i18n.t("settings.webAccess"),
  icon: Smartphone,
  group: "system",
  order: 1,
  component: WebAccessSection,
});
settingsRegistry.register({
  id: "shortcuts",
  key: "shortcuts",
  label: () => i18n.t("shortcuts.sectionTitle"),
  icon: Keyboard,
  group: "system",
  order: 2,
  component: ShortcutsSection,
});
settingsRegistry.register({
  id: "usage",
  key: "usage",
  label: () => i18n.t("usage.title"),
  icon: ChartColumn,
  group: "workspace",
  order: 2,
  component: UsageSection,
});
/**
 * Capability pages (Skills / MCP) load lazily: opening ordinary settings must
 * not scan skill directories, touch the network or read MCP config files.
 * The fallback is a quiet line — the settings shell already shows the title.
 */
function lazySection(
  loader: () => Promise<{ default: ComponentType }>,
): ComponentType {
  const Lazy = lazy(loader);
  return function LazySettingsSection() {
    const { t } = useTranslation();
    return (
      <Suspense
        fallback={
          <p className="py-8 text-body-2-regular text-text-tertiary">
            {t("common.loading")}
          </p>
        }
      >
        <Lazy />
      </Suspense>
    );
  };
}

const LazySkillsSection = lazySection(() =>
  import("@/features/skills/SkillsSection").then((module) => ({
    default: module.SkillsSection,
  })),
);
const LazyMcpSection = lazySection(() =>
  import("@/features/mcp/McpSection").then((module) => ({
    default: module.McpSection,
  })),
);
// 电脑操控入口：暂时隐藏，恢复时取消注释。
// const LazyComputerUseSection = lazySection(() =>
//   import("./ComputerUseSection").then((module) => ({
//     default: module.ComputerUseSection,
//   })),
// );

settingsRegistry.register({
  id: "skills",
  key: "skills",
  label: () => i18n.t("settings.skills"),
  icon: Sparkles,
  group: "capabilities",
  order: 0,
  component: LazySkillsSection,
});
settingsRegistry.register({
  id: "mcp",
  key: "mcp",
  label: () => i18n.t("settings.mcp"),
  icon: Plug,
  group: "capabilities",
  order: 1,
  component: LazyMcpSection,
});
// 电脑操控入口：暂时隐藏，恢复时取消注释。
// settingsRegistry.register({
//   id: "computerUse",
//   key: "computerUse",
//   label: () => i18n.t("settings.computerUse"),
//   icon: MousePointer2,
//   group: "capabilities",
//   order: 2,
//   component: LazyComputerUseSection,
// });
settingsRegistry.register({
  id: "pet",
  key: "pet",
  label: () => i18n.t("settings.pet"),
  icon: PawPrint,
  group: "misc",
  order: 4,
  component: PetSection,
});
settingsRegistry.register({
  id: "update",
  key: "update",
  label: () => i18n.t("settings.checkUpdates"),
  icon: RefreshCw,
  group: "misc",
  order: 1,
  component: UpdateSection,
});
settingsRegistry.register({
  id: "about",
  key: "about",
  label: () => i18n.t("settings.about"),
  icon: Info,
  group: "misc",
  order: 2,
  component: AboutSection,
});
settingsRegistry.register({
  id: "diagnostics",
  key: "diagnostics",
  label: () => i18n.t("diagnostics.title"),
  icon: Activity,
  group: "misc",
  order: 3,
  component: PerformanceDiagnosticsSection,
});
settingsRegistry.register({
  id: "betaFeatures",
  key: "betaFeatures",
  label: () => i18n.t("settings.betaFeatures"),
  icon: FlaskConical,
  group: "misc",
  order: 0,
  component: BetaFeaturesSection,
});
ENGINE_IDS.forEach((engine, index) => {
  settingsRegistry.register({
    id: `cli:${engine}`,
    key: `cli:${engine}`,
    label: () => CLI_DISPLAY_NAMES[engine],
    icon: engineNavIcon(engine),
    group: "cli",
    order: index,
    component: () => <CliConfigSection engine={engine} />,
  });
});
