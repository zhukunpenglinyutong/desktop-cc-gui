import { IS_WINDOWS, isWeb } from "@/lib/platform";
import { shortcutActions } from "@/features/shortcuts/actions";
import { BETA_FEATURES } from "./beta-features";
import { ENGINE_IDS, type EngineId } from "./providers";
import type { SettingsSearchEntry } from "./settings-search";

/**
 * Builtin pages' search index (`settings-search.ts` holds the mechanism): one
 * block per page, in rail order, so coverage is readable in one place — a page
 * whose block is missing is a page whose rows cannot be searched yet.
 *
 * Every `anchor` must exist on that page as a `SettingsRow anchor=` (or the
 * literal `data-setting-anchor` attribute where the row is hand-rolled);
 * `builtin-search.test.tsx` renders each page and fails on either direction of
 * drift (a declared row that never renders, a rendered row nobody indexed).
 *
 * Rows generated from a catalog are mapped from that catalog instead of being
 * spelled out (shortcuts, 内测功能) — the page renders `anchor={action.id}`
 * from the same list, so the two cannot drift.
 *
 * Pages whose content is entirely the user's data (归档管理's session list,
 * 用量's charts, 关于's community block) index nothing: their page name is
 * the entry, and searching *their* content is a data search, not a settings
 * search. Pages whose lists hang off a fixed control index that control
 * instead: 工作区 的 分组/项目/已授权目录 sections, the Skills and
 * 智能体与提示词 pane tabs.
 */

/** 通用 (`GeneralSection.tsx` + `PromptHistorySettings.tsx`): every row of the
 *  page, in the order the page renders them, so results read in page order. */
const generalEntries: SettingsSearchEntry[] = [
  // 外观
  {
    page: "general",
    anchor: "theme",
    labelKey: "settings.theme",
    sectionKey: "settings.appearance",
  },
  // 标题栏样式只在 Windows 渲染（`IS_WINDOWS`）；其他平台不索引，避免搜索结果
  // 命中一个当前平台根本没渲染的行。
  ...(IS_WINDOWS
    ? [
        {
          page: "general",
          anchor: "titlebar",
          labelKey: "settings.titlebar",
          sectionKey: "settings.appearance",
        } satisfies SettingsSearchEntry,
      ]
    : []),
  {
    page: "general",
    anchor: "language",
    labelKey: "settings.language",
    sectionKey: "settings.appearance",
  },
  {
    page: "general",
    anchor: "uiZoom",
    labelKey: "settings.uiZoom",
    sectionKey: "settings.appearance",
  },
  {
    page: "general",
    anchor: "fontFamily",
    labelKey: "settings.fontFamily",
    sectionKey: "settings.appearance",
  },
  {
    page: "general",
    anchor: "codeFontFamily",
    labelKey: "settings.codeFontFamily",
    sectionKey: "settings.appearance",
  },
  {
    page: "general",
    anchor: "sidebarThreadLimit",
    labelKey: "settings.sidebarThreadLimit",
    sectionKey: "settings.appearance",
  },
  // 行为
  {
    page: "general",
    anchor: "sendShortcut",
    labelKey: "settings.sendShortcut",
    sectionKey: "settings.behavior",
  },
  {
    page: "general",
    anchor: "thinkingAutoCollapse",
    labelKey: "settings.thinkingAutoCollapse",
    sectionKey: "settings.behavior",
  },
  {
    page: "general",
    anchor: "promptHistory",
    labelKey: "settings.promptHistory",
    sectionKey: "settings.behavior",
  },
  // 输入历史：行标题带条数（管理历史记录 ({{count}})），搜索结果里去掉计数。
  {
    page: "general",
    anchor: "promptHistoryManage",
    labelKey: "settings.promptHistoryManageTitle",
    sectionKey: "settings.promptHistoryManage",
  },
];

/** 桌面宠物 (`PetSection.tsx`): row labels are 显示桌面宠物 / 角色 / 宠物大小;
 *  the page title is itself 桌面宠物, so the page-title lane finds the name a
 *  user remembers, and the `pet` aliases cover English searches. */
const petEntries: SettingsSearchEntry[] = [
  {
    page: "pet",
    anchor: "petEnabled",
    labelKey: "settings.petEnabled",
    keywords: ["pet", "spritesheet"],
  },
  {
    page: "pet",
    anchor: "petCharacter",
    labelKey: "settings.petCharacter",
    keywords: ["pet"],
  },
  {
    page: "pet",
    anchor: "petScale",
    labelKey: "settings.petScale",
    keywords: ["pet"],
  },
];

/** 快捷键 (`ShortcutsSection.tsx`): one row per action in the metadata table,
 *  breadcrumbed by its group (会话 / 应用 / 面板 …). The page's own filter box
 *  is unrelated — it narrows the page, not the searched index. */
const shortcutEntries: SettingsSearchEntry[] = shortcutActions.map((action) => ({
  page: "shortcuts",
  anchor: action.id,
  labelKey: action.labelKey,
  sectionKey: `shortcuts.groups.${action.category}`,
}));

/** 内测功能 (`BetaFeaturesSection.tsx`): one switch per entry, mapped from the
 *  catalog the page renders. No card heading on that page — the page name
 *  alone already names it. */
const betaFeatureEntries: SettingsSearchEntry[] = BETA_FEATURES.map(
  (feature) => ({
    page: "betaFeatures",
    anchor: feature.id,
    labelKey: feature.labelKey,
  }),
);

/** Web 访问 (`WebAccessSection.tsx`): the two panes plus the cards that live in
 *  公网访问, which only render while that pane is open — they carry the pane
 *  tab as their activator, so a hit opens the pane first. */
const webAccessEntries: SettingsSearchEntry[] = [
  { page: "webAccess", anchor: "webLanTab", labelKey: "settings.webLan" },
  { page: "webAccess", anchor: "webWanTab", labelKey: "settings.webWan" },
  {
    page: "webAccess",
    anchor: "webAuth",
    labelKey: "settings.webAuth",
    activatorAnchor: "webWanTab",
  },
  {
    page: "webAccess",
    anchor: "webDevices",
    labelKey: "settings.webDevices",
    activatorAnchor: "webWanTab",
  },
  {
    page: "webAccess",
    anchor: "webRelay",
    labelKey: "settings.webRelay",
    activatorAnchor: "webWanTab",
  },
  {
    page: "webAccess",
    anchor: "webRelayDeploy",
    labelKey: "settings.webRelayDeploy",
    activatorAnchor: "webWanTab",
  },
];

/**
 * CLI 管理 pages: the same handful of rows on all 11 engine pages (引擎名 is
 * the group heading, so a hit reads 「Claude › 官方配置」 and the user picks
 * their engine — the rail already lists enabled engines first). The row set
 * follows each page's own composition:
 *   - dsh has no 官方配置 row (no native config file) and keeps its bin picker
 *     inside 本地主机, behind the collapsed 连接设置 card;
 *   - codex has one path row (配置目录) instead of a bin override;
 *   - pi/omp add 订阅授权 / API Key / 自定义供应商, whose rows are user data
 *     and whose headings are the searchable setting.
 */
function cliPageEntries(engine: EngineId): SettingsSearchEntry[] {
  const rows: {
    anchor: string;
    labelKey: string;
    activatorAnchor?: string;
  }[] = [];
  if (engine !== "dsh") {
    rows.push({ anchor: "cliOfficial", labelKey: "settings.cliOfficial" });
  }
  if (engine === "codex") {
    rows.push({ anchor: "cliHomePath", labelKey: "settings.cliCustomHome" });
  } else if (engine !== "dsh") {
    rows.push({ anchor: "cliBinPath", labelKey: "settings.cliCustomPath" });
  }
  rows.push({ anchor: "cliCustomModels", labelKey: "settings.cliCustomModels" });
  if (engine === "dsh") {
    rows.push({ anchor: "dshHost", labelKey: "settings.dshLocalHost" });
    rows.push({
      anchor: "dshConnection",
      labelKey: "settings.dshConnectionSettings",
    });
    for (const anchor of ["dshCustomPath", "dshHostAddress", "dshAutoStart"] as const) {
      rows.push({
        anchor,
        labelKey: `settings.${anchor}`,
        activatorAnchor: "dshConnection",
      });
    }
  }
  if (engine === "pi" || engine === "omp") {
    rows.push({ anchor: "piAuthOauth", labelKey: "settings.piAuthOauthTitle" });
    rows.push({ anchor: "piAuthApiKey", labelKey: "settings.piAuthApiKeyTitle" });
    rows.push({ anchor: "piAuthCustom", labelKey: "settings.piAuthCustomTitle" });
  }
  rows.push({ anchor: "cliChannels", labelKey: "settings.cliChannels" });
  return rows.map((row) => ({ page: `cli:${engine}`, ...row }));
}

/** 智能体 (`BotsPane.tsx`): its two pane tabs (自定义 / 内置目录); the tab
 *  itself is the searchable target (the pane content is the user's bots), so a
 *  hit selects that tab. 提示词 (`PromptsPane.tsx`) indexes nothing — its list
 *  is the user's own prompts, so the page is reachable by title alone. */
const agentsEntries: SettingsSearchEntry[] = [
  {
    page: "agents",
    anchor: "custom",
    labelKey: "settings.agentTabCustom",
    activatorAnchor: "custom",
  },
  {
    page: "agents",
    anchor: "builtIn",
    labelKey: "settings.agentTabBuiltIn",
    activatorAnchor: "builtIn",
  },
];

/** 能力扩展 → Skills (`SkillsSection.tsx`): its three panes (我的 Skills / 发现
 *  / 使用情况), same shape as 智能体与提示词 — the tab is the setting, the
 *  content is data. */
const skillsEntries: SettingsSearchEntry[] = (
  ["installed", "discover", "usage"] as const
).map((tab) => ({
  page: "skills",
  anchor: tab,
  labelKey: `skills.tabs.${tab}`,
  activatorAnchor: tab,
}));

/** 工作区与数据 → 工作区 (`WorkspacesSection.tsx`): its three sections (分组 /
 *  项目 / 已授权目录); their rows are the user's own workspaces. 项目 and
 *  已授权目录 only render once there is something to show — a hit then still
 *  opens the page, it just has nothing to flash. 已授权目录 is native-only:
 *  the web bridge never routes `grant_root` (`GrantedRootsCard` skips the
 *  section), so indexing it there would point at a row that cannot exist. */
const workspaceEntries: SettingsSearchEntry[] = [
  {
    page: "workspaces",
    anchor: "workspaceGroups",
    labelKey: "settings.workspaceGroups",
  },
  { page: "workspaces", anchor: "projects", labelKey: "settings.projects" },
  ...(isWeb
    ? []
    : [
        {
          page: "workspaces",
          anchor: "grantedRoots",
          labelKey: "settings.grantedRoots",
        } satisfies SettingsSearchEntry,
      ]),
];

export const builtinSearchEntries: SettingsSearchEntry[] = [
  ...generalEntries,

  // 桌面宠物（其他）
  ...petEntries,

  // 网络代理
  {
    page: "proxy",
    anchor: "proxyEnabled",
    labelKey: "settings.proxyEnabled",
    sectionKey: "settings.proxy",
  },
  {
    page: "proxy",
    anchor: "proxyAddress",
    labelKey: "settings.proxyAddress",
    sectionKey: "settings.proxy",
  },

  ...shortcutEntries,

  // 检查更新：品牌行没有译文（labelText），检查动作行与页标题同名，不再重复
  // 一层面包屑。
  { page: "update", anchor: "appVersion", labelText: "CC GUI" },
  {
    page: "update",
    anchor: "checkUpdates",
    labelKey: "settings.checkUpdates",
    keywords: ["update", "version"],
  },

  ...betaFeatureEntries,

  ...webAccessEntries,

  ...ENGINE_IDS.flatMap(cliPageEntries),

  ...agentsEntries,

  ...skillsEntries,

  ...workspaceEntries,

  // 性能诊断：这个开关是页面上唯一的设置行（打开诊断弹窗那一块是动作入口）。
  {
    page: "diagnostics",
    anchor: "renderScan",
    labelKey: "diagnostics.renderPanelTitle",
    keywords: ["react-scan"],
  },
];
