/**
 * 设置 → 能力扩展 → MCP.
 *
 * Every engine the app can drive gets a tab, whether or not it ships MCP
 * support: the config inventory (what the CLI files declare, enable switches
 * only for sources whose write semantics are verified) and the runtime
 * inventory (what a live session actually connected, workspace- and
 * session-scoped, with its collection time). Engines that carry MCP through
 * plugins say so; engines without MCP say so instead of showing an empty
 * list as if nothing were configured. A vendor's runtime that this app cannot
 * query states that rather than pretending there are no servers.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Activity from "lucide-react/dist/esm/icons/activity";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { CenteredSpinner, EmptyState } from "@/components/base/empty-state";
import { Chip } from "@/components/base/chips/chip";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { ActionFeedbackIcon, useActionFeedback, type ActionFeedback } from "@/components/base/action-feedback";
import { LocalOnlyNotice } from "@/components/application/settings/local-only-notice";
import { useChatStore } from "@/features/chat/store";
import { isWeb } from "@/lib/transport";
import { cx } from "@/utils/cx";
import { McpDetailDialog } from "./McpDetailDialog";
import { EnableToggle, LaunchModeToggle } from "./launch-ui";
import { ProbeActionButton, ProbeStatusChip } from "./probe-ui";
import {
  latestCheckedAt,
  probeable,
  useAutoProbe,
  useMcpProbeStore,
} from "./probe-store";
import { engineIdFromHash, engineLabel } from "./labels";
import type {
  McpConfigEntry,
  McpEngineId,
  McpEngineInventory,
  McpRuntimeEntry,
  McpRuntimeSection,
  McpLaunchMode,
  McpSourceInfo,
} from "./types";
import { useMcpInventory } from "./useMcpInventory";

type KindFilter = "all" | "config" | "runtime";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-body-medium text-text-primary">{children}</h3>;
}

function ConfigRow({
  entry,
  pending,
  selected,
  workspacePath,
  onOpen,
  onToggle,
  onLaunchMode,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  selected: boolean;
  workspacePath: string | null;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onLaunchMode: (mode: McpLaunchMode) => void;
}) {
  const { t } = useTranslation();
  const meta = entry.command
    ? `${entry.command}${entry.argsCount > 0 ? ` +${entry.argsCount}` : ""}`
    : (entry.url ?? t("mcp.transportUnknown"));
  return (
    <li
      className={cx(
        "flex items-center gap-2 rounded-2lg border border-separator-border px-3 py-2",
        selected && "bg-background-secondary-hover",
        pending && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={t("mcp.row.open", { name: entry.name })}
        className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
          <span className="flex w-full items-center gap-2">
            <span className="truncate text-body-regular text-text-primary" title={entry.name}>
              {entry.name}
            </span>
            <span className="shrink-0 rounded-full bg-background-tertiary-default px-1.5 py-0.5 text-[10px] text-text-secondary">
              {t(`mcp.source.${entry.source}`)}
            </span>
            {!entry.enabled ? (
              <span className="shrink-0 rounded-full bg-background-tertiary-default px-1.5 py-0.5 text-[10px] text-text-tertiary">
                {t("mcp.disabled")}
              </span>
            ) : null}
          </span>
          <span
            className="w-full truncate text-caption-1-regular text-text-secondary"
            title={meta}
          >
            {entry.transport ? `${entry.transport} · ` : ""}
            {meta}
          </span>
        </span>
        {/* 徽标与两行文字整体垂直居中，和右侧图标在同一水平线；仍在按钮里，点它照样打开详情。 */}
        <ProbeStatusChip entry={entry} />
      </button>
      {/* 检测 · 启动方式 · 启用：都直接放在行里，与状态区共用行的 gap-2，间距一致；
          启用开关常驻最右（只读来源置灰），与原来的开关同列。 */}
      {probeable(entry) ? (
        <ProbeActionButton entry={entry} workspacePath={workspacePath} />
      ) : null}
      <LaunchModeToggle entry={entry} pending={pending} onChange={onLaunchMode} />
      <EnableToggle entry={entry} pending={pending} onChange={onToggle} />
    </li>
  );
}

/** Config rows for one engine; shared by the settings page and the `/mcp`
 *  panel so both surfaces show identical state. */
export function McpConfigList({
  entries,
  pendingId,
  selectedId,
  workspacePath,
  onOpen,
  onToggle,
  onLaunchMode,
}: {
  entries: McpConfigEntry[];
  pendingId: string | null;
  selectedId: string | null;
  workspacePath: string | null;
  onOpen: (entry: McpConfigEntry) => void;
  onToggle: (entry: McpConfigEntry, enabled: boolean) => void;
  onLaunchMode: (entry: McpConfigEntry, mode: McpLaunchMode) => void;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <ConfigRow
          key={entry.id}
          entry={entry}
          pending={pendingId === entry.id}
          selected={selectedId === entry.id}
          workspacePath={workspacePath}
          onOpen={() => onOpen(entry)}
          onToggle={(enabled) => onToggle(entry, enabled)}
          onLaunchMode={(mode) => onLaunchMode(entry, mode)}
        />
      ))}
    </ul>
  );
}

function RuntimeEntryRow({ entry }: { entry: McpRuntimeEntry }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-2 rounded-2lg border border-separator-border px-3 py-2">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-body-regular text-text-primary">{entry.name}</span>
        {entry.builtin ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60">
            {t("mcp.builtin")}
          </span>
        ) : null}
      </span>
      <span className="shrink-0 text-caption-1-regular text-text-secondary">
        {entry.toolNames.length > 0
          ? t("mcp.runtime.tools", { count: entry.toolNames.length })
          : (entry.status ?? t("mcp.runtime.statusUnknown"))}
      </span>
    </li>
  );
}

function RuntimeEntryList({
  entries,
  searching,
}: {
  entries: McpRuntimeEntry[];
  searching: boolean;
}) {
  const { t } = useTranslation();
  if (entries.length === 0) {
    return (
      <EmptyState className="py-4">
        <p className="text-body-2-regular">
          {searching ? t("mcp.runtime.noMatch") : t("mcp.runtime.empty")}
        </p>
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {entries.map((entry) => (
        <RuntimeEntryRow key={entry.name} entry={entry} />
      ))}
    </ul>
  );
}

export function RuntimeBlock({
  section,
  filter,
  query,
}: {
  section: McpRuntimeSection;
  filter: KindFilter;
  query: string;
}) {
  const { t, i18n } = useTranslation();
  // Rendering a formatter is what is slow; the locale change is rare enough
  // that rebuilding on it is fine.
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.language],
  );
  if (filter === "config") return null;
  const needle = query.trim().toLowerCase();
  const entries = needle
    ? section.entries.filter((entry) => entry.name.toLowerCase().includes(needle))
    : section.entries;
  const collected = section.collectedAt
    ? timeFormat.format(new Date(section.collectedAt))
    : null;
  const ready = section.status === "ready" || section.status === "session_ended";
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{t("mcp.runtime.title")}</SectionTitle>
      {ready ? (
        <>
          <p className="text-caption-1-regular text-text-tertiary">
            {t(`mcp.runtime.status.${section.status}`)}
            {section.sessionId ? ` · ${t("mcp.runtime.session", { id: section.sessionId })}` : ""}
            {collected ? ` · ${t("mcp.runtime.collectedAt", { time: collected })}` : ""}
          </p>
          <RuntimeEntryList entries={entries} searching={Boolean(needle)} />
        </>
      ) : (
        <p
          className={cx(
            "rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular",
            section.status === "unsupported"
              ? "text-text-secondary"
              : "text-text-tertiary",
          )}
        >
          {section.reason ?? t(`mcp.runtime.status.${section.status}`)}
        </p>
      )}
    </section>
  );
}

/** Where this page looks for the engine's config; missing files still show so
 *  an empty inventory never reads as "this CLI has no MCP support". */
export function McpSourceHint({ sources }: { sources: McpSourceInfo[] }) {
  const { t } = useTranslation();
  if (sources.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-2lg bg-background-tertiary-default px-3 py-2">
      <span className="text-caption-1-medium text-text-secondary">
        {t("mcp.sources.title")}
      </span>
      {sources.map((info) => (
        <span
          key={`${info.source}:${info.path}`}
          className="flex flex-wrap items-baseline gap-x-2 text-caption-1-regular text-text-tertiary"
        >
          <span className="shrink-0">{t(`mcp.source.${info.source}`)}</span>
          <span className="min-w-0 break-all font-mono" title={info.path}>
            {info.path}
          </span>
          {!info.exists ? <span className="shrink-0">{t("mcp.sources.missing")}</span> : null}
        </span>
      ))}
    </div>
  );
}

/** Engine-level support statement for the selected tab. */
function SupportNote({ engine }: { engine: McpEngineInventory }) {
  const { t } = useTranslation();
  const name = engineLabel(engine.id);
  if (engine.support === "none") {
    return (
      <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
        {t("mcp.support.none", { name })}
      </p>
    );
  }
  if (engine.support === "plugin") {
    return (
      <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
        {t("mcp.support.plugin", { name })}
      </p>
    );
  }
  return null;
}

/** Engine tab strip: every engine gets a tab, configured count or not. */
function EngineTabs({
  engines,
  activeId,
  onSelect,
}: {
  engines: McpEngineInventory[];
  activeId: McpEngineId | null;
  onSelect: (id: McpEngineId) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {engines.map((item) => (
        <Chip
          key={item.id}
          selected={activeId === item.id}
          title={
            item.config.entries.length > 0
              ? t("mcp.tabCount", { count: item.config.entries.length })
              : engineLabel(item.id)
          }
          onClick={() => onSelect(item.id)}
        >
          <span className="flex items-center gap-1">
            <EngineIcon engine={item.id} size={12} />
            {engineLabel(item.id)}
            {item.config.entries.length > 0 ? (
              <span className="text-text-tertiary">{item.config.entries.length}</span>
            ) : null}
          </span>
        </Chip>
      ))}
    </div>
  );
}

/** Search, 「检测全部」 and refresh; the parent owns the refresh feedback cycle. */
function McpToolbar({
  query,
  onQueryChange,
  loading,
  probingAll,
  probeableCount,
  onProbeAll,
  refreshFeedback,
  onRefresh,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  loading: boolean;
  probingAll: boolean;
  probeableCount: number;
  onProbeAll: () => void;
  refreshFeedback: ActionFeedback;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={t("mcp.searchPlaceholder")}
        placeholder={t("mcp.searchPlaceholder")}
        value={query}
        onChange={onQueryChange}
        leadingIcon={Search}
        size="small"
        className="flex-1"
      />
      <Button
        variant="secondary"
        size="small"
        title={t("mcp.probe.hint")}
        disabled={loading || probingAll || probeableCount === 0}
        leadingIcon={Activity}
        onClick={onProbeAll}
      >
        {t("mcp.probe.checkAll")}
      </Button>
      <Button
        variant="secondary"
        size="small"
        disabled={loading || refreshFeedback === "running"}
        onClick={onRefresh}
      >
        <ActionFeedbackIcon icon={RefreshCw} feedback={refreshFeedback} spin />
        {t("common.refresh")}
      </Button>
    </div>
  );
}

/** Kind chips plus the config/runtime counts and the last probe time. */
function KindFilterBar({
  kind,
  onKindChange,
  configCount,
  runtimeCount,
  checkedAt,
}: {
  kind: KindFilter;
  onKindChange: (kind: KindFilter) => void;
  configCount: number;
  runtimeCount: number;
  checkedAt: number | null;
}) {
  const { t, i18n } = useTranslation();
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    [i18n.language],
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(["all", "config", "runtime"] as const).map((value) => (
        <Chip key={value} selected={kind === value} onClick={() => onKindChange(value)}>
          {t(`mcp.filter.${value}`)}
        </Chip>
      ))}
      <span className="ml-1 text-caption-1-regular text-text-tertiary">
        {t("mcp.count", { config: configCount, runtime: runtimeCount })}
        {checkedAt
          ? ` · ${t("mcp.probe.lastChecked", {
              time: timeFormat.format(new Date(checkedAt)),
            })}`
          : ""}
      </span>
    </div>
  );
}

/** First-paint spinner and load errors; background reloads keep the list. */
function InventoryStatus({
  loading,
  hasInventory,
  error,
  onReload,
}: {
  loading: boolean;
  hasInventory: boolean;
  error: string | { message: string } | null;
  onReload: () => void;
}) {
  const { t } = useTranslation();
  if (loading && !hasInventory) {
    return <CenteredSpinner className="py-10" />;
  }
  if (typeof error === "string") {
    return (
      <div className="flex flex-col items-start gap-2 py-6">
        <p role="alert" className="text-body-2-regular text-text-error-primary">
          {error}
        </p>
        <Button variant="secondary" size="small" onClick={onReload}>
          {t("common.refresh")}
        </Button>
      </div>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-body-2-regular text-text-error-primary">
        {error.message}
      </p>
    );
  }
  return null;
}

/** Toggle/probe failures, shown under the inventory status block. */
function InventoryAlerts({
  toggleError,
  probeError,
}: {
  toggleError: string | null;
  probeError: string | null;
}) {
  return (
    <>
      {toggleError ? (
        <p role="alert" className="text-body-2-regular text-text-error-primary">
          {toggleError}
        </p>
      ) : null}
      {probeError ? (
        <p role="alert" className="text-body-2-regular text-text-error-primary">
          {probeError}
        </p>
      ) : null}
    </>
  );
}

/** Support statement, missing-CLI note and config parse errors. */
function EngineNotices({ engine }: { engine: McpEngineInventory }) {
  const { t } = useTranslation();
  return (
    <>
      <SupportNote engine={engine} />
      {engine.support !== "none" && !engine.available ? (
        <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
          {t("mcp.notInstalled")}
        </p>
      ) : null}
      {engine.config.errors.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {engine.config.errors.map((error) => (
            <li
              key={`${error.source}:${error.path}`}
              className="rounded-2lg border border-separator-border px-3 py-2 text-caption-1-regular"
            >
              <span className="text-text-error-primary">{error.message}</span>
              <span className="ml-2 break-all font-mono text-text-tertiary">{error.path}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/** Config list + empty state + source hint for the selected engine. */
function ConfigSection({
  engine,
  entries,
  pendingId,
  selectedId,
  workspacePath,
  searching,
  noEntries,
  onOpen,
  onToggle,
  onLaunchMode,
}: {
  engine: McpEngineInventory;
  entries: McpConfigEntry[];
  pendingId: string | null;
  selectedId: string | null;
  workspacePath: string | null;
  searching: boolean;
  noEntries: boolean;
  onOpen: (entry: McpConfigEntry) => void;
  onToggle: (entry: McpConfigEntry, enabled: boolean) => void;
  onLaunchMode: (entry: McpConfigEntry, mode: McpLaunchMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle>{t("mcp.config.title")}</SectionTitle>
      {entries.length === 0 ? (
        <>
          <EmptyState className="py-6">
            <p className="text-body-2-regular">{t("mcp.config.empty")}</p>
          </EmptyState>
          {noEntries && !searching ? <McpSourceHint sources={engine.sources} /> : null}
        </>
      ) : (
        <McpConfigList
          entries={entries}
          pendingId={pendingId}
          selectedId={selectedId}
          workspacePath={workspacePath}
          onOpen={onOpen}
          onToggle={onToggle}
          onLaunchMode={onLaunchMode}
        />
      )}
    </section>
  );
}

export function McpSection() {
  const { t } = useTranslation();
  const activeWorkspace = useChatStore((state) => state.active?.workspacePath ?? null);
  const store = useMcpInventory(activeWorkspace);
  const [engineId, setEngineId] = useState<McpEngineId>(
    () => (engineIdFromHash(window.location.hash) as McpEngineId | null) ?? "claude",
  );
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refreshAction = useActionFeedback({ spin: true });
  const [toggleError, setToggleError] = useState<string | null>(null);
  const probeAll = useMcpProbeStore((state) => state.probeAll);
  const probingAll = useMcpProbeStore((state) => state.runningAll);
  const probeError = useMcpProbeStore((state) => state.error);
  const probeResults = useMcpProbeStore((state) => state.results);

  // Inventory reloads replace the object; memoizing the engines array is what
  // keeps the `engine` lookup (and everything derived from it) stable between
  // renders that do not change the inventory.
  const engines = useMemo(() => store.inventory?.engines ?? [], [store.inventory]);
  const engine = useMemo(
    () => engines.find((item) => item.id === engineId) ?? engines[0] ?? null,
    [engines, engineId],
  );
  // 弹窗跟随回读后的清单，切换开关后显示的是文件里的真实状态。
  const selected = useMemo(
    () => engine?.config.entries.find((entry) => entry.id === selectedId) ?? null,
    [engine, selectedId],
  );
  // 打开页面即检测（复用新鲜缓存；配置一变指纹就变，只补没结果的）。
  useAutoProbe(engine?.config.entries, activeWorkspace, !isWeb);

  const filteredEntries = useMemo(() => {
    if (!engine) return [];
    const needle = query.trim().toLowerCase();
    return engine.config.entries.filter(
      (entry) => !needle || entry.name.toLowerCase().includes(needle),
    );
  }, [engine, query]);

  const showConfig = kind !== "runtime";
  const noEntries = (engine?.config.entries.length ?? 0) === 0;
  const searching = query.trim().length > 0;
  const probeableCount = useMemo(
    () => (engine?.config.entries ?? []).filter(probeable).length,
    [engine],
  );
  const checkedAt = useMemo(
    () => latestCheckedAt(engine?.config.entries ?? [], probeResults),
    [engine, probeResults],
  );

  const handleToggle = (entry: McpConfigEntry, enabled: boolean) => {
    setToggleError(null);
    void store.setEnabled(entry, enabled).catch((error: unknown) => {
      setToggleError(error instanceof Error ? error.message : String(error));
    });
  };
  const handleLaunchMode = (entry: McpConfigEntry, mode: McpLaunchMode) => {
    setToggleError(null);
    void store.setLaunchMode(entry, mode).catch((error: unknown) => {
      setToggleError(error instanceof Error ? error.message : String(error));
    });
  };

  const handleRefresh = () => {
    if (refreshAction.feedback === "running") return;
    void refreshAction.start(() => store.reload()).catch(() => undefined);
  };

  // Desktop-only (web dispatch excludes mcp_inventory / mcp_set_enabled).
  if (isWeb) {
    return <LocalOnlyNotice message={t("mcp.desktopOnly")} />;
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <EngineTabs
        engines={engines}
        activeId={engine?.id ?? null}
        onSelect={(id) => {
          setEngineId(id);
          setSelectedId(null);
        }}
      />
      <McpToolbar
        query={query}
        onQueryChange={setQuery}
        loading={store.loading}
        probingAll={probingAll}
        probeableCount={probeableCount}
        onProbeAll={() =>
          void probeAll(engine?.config.entries ?? [], activeWorkspace, { force: true })
        }
        refreshFeedback={refreshAction.feedback}
        onRefresh={handleRefresh}
      />
      <KindFilterBar
        kind={kind}
        onKindChange={setKind}
        configCount={engine?.config.entries.length ?? 0}
        runtimeCount={engine?.runtime.entries.length ?? 0}
        checkedAt={checkedAt}
      />
      <InventoryStatus
        loading={store.loading}
        hasInventory={Boolean(store.inventory)}
        error={store.error}
        onReload={() => void store.reload()}
      />
      <InventoryAlerts toggleError={toggleError} probeError={probeError} />
      {engine ? <EngineNotices engine={engine} /> : null}
      {engine && engine.support !== "none" && showConfig ? (
        <ConfigSection
          engine={engine}
          entries={filteredEntries}
          pendingId={store.pendingId}
          selectedId={selected?.id ?? null}
          workspacePath={activeWorkspace}
          searching={searching}
          noEntries={noEntries}
          onOpen={(entry) => setSelectedId(entry.id)}
          onToggle={handleToggle}
          onLaunchMode={handleLaunchMode}
        />
      ) : null}
      {engine && engine.support !== "none" ? (
        <RuntimeBlock section={engine.runtime} filter={kind} query={query} />
      ) : null}
      {selected ? (
        <McpDetailDialog
          entry={selected}
          pending={store.pendingId === selected.id}
          workspacePath={activeWorkspace}
          onToggle={(enabled) => handleToggle(selected, enabled)}
          onLaunchMode={(mode) => handleLaunchMode(selected, mode)}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}
