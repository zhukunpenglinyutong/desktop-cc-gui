import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { Button } from "@/components/base/buttons/button";
import { EmptyState } from "@/components/base/empty-state";
import { Input } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import {
  currentCatalogLocale,
  useBotStore,
} from "@/features/bots/bot-store";
import { errorText } from "@/lib/errors";
import {
  ipc,
  type BotConfig,
  type BuiltInAgentCatalogView,
  type BuiltInAgentDivisionView,
  type BuiltInAgentView,
} from "@/lib/ipc";
import { openExternal } from "@/lib/platform";
import {
  BuiltInAgentRow,
  DivisionFilterChips,
  PromptPreviewModal,
  type PromptViewState,
} from "./BuiltInAgentSections";

/**
 * Built-in agent catalog tab: summary (enabled count, source link,
 * revision), search / enabled-only / division filters, and card rows with
 * an enable switch, a prompt viewer, and copy-as-custom. The catalog is
 * read-only and bundled; enabled ids persist in app settings. Toggles
 * reload the catalog and revalidate useBotStore so the composer `#`
 * menu picks up the change.
 */
export function BuiltInBotsPane({
  onCopied,
}: {
  /** The copy landed: hand the new bot back so the caller can open it. */
  onCopied: (bot: BotConfig) => void;
}) {
  const { t, i18n } = useTranslation();
  const [catalog, setCatalog] = useState<BuiltInAgentCatalogView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [divisionId, setDivisionId] = useState<string | null>(null);

  /** Per-agent toggle in flight; the switch stays disabled meanwhile. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [divisionPending, setDivisionPending] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [promptView, setPromptView] = useState<PromptViewState | null>(null);

  const load = useCallback(async () => {
    try {
      setCatalog(await ipc.listBuiltInAgents(currentCatalogLocale()));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // Catalog strings are localized: reload when the UI language changes.
  useEffect(() => {
    void load();
  }, [load, i18n.language]);

  const divisionById = useMemo(() => {
    const map = new Map<string, BuiltInAgentDivisionView>();
    for (const division of catalog?.divisions ?? []) {
      map.set(division.id, division);
    }
    return map;
  }, [catalog]);

  const enabledCount = useMemo(
    () => (catalog?.agents ?? []).filter((agent) => agent.enabled).length,
    [catalog],
  );

  const visibleAgents = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.agents.filter((agent) => {
      if (enabledOnly && !agent.enabled) return false;
      if (divisionId && agent.divisionId !== divisionId) return false;
      if (!q) return true;
      return (
        agent.name.toLowerCase().includes(q) ||
        agent.description.toLowerCase().includes(q) ||
        (divisionById.get(agent.divisionId)?.label.toLowerCase().includes(q) ?? false)
      );
    });
  }, [catalog, search, enabledOnly, divisionId, divisionById]);

  /** Every mutation funnel: apply, reload the catalog, and revalidate the
   *  composer-facing store. */
  const mutate = useCallback(
    async (op: () => Promise<unknown>) => {
      try {
        await op();
        await load();
        void useBotStore.getState().refresh();
      } catch (e) {
        setError(errorText(e));
      }
    },
    [load],
  );

  const toggleAgent = useCallback(
    (agent: BuiltInAgentView, enabled: boolean) => {
      setPending((prev) => new Set(prev).add(agent.id));
      void mutate(() => ipc.setBuiltInAgentEnabled(agent.id, enabled)).finally(() =>
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(agent.id);
          return next;
        }),
      );
    },
    [mutate],
  );

  const toggleDivision = useCallback(
    (enabled: boolean) => {
      if (!divisionId) return;
      setDivisionPending(true);
      void mutate(() =>
        ipc.setBuiltInAgentDivisionEnabled(divisionId, enabled),
      ).finally(() => setDivisionPending(false));
    },
    [divisionId, mutate],
  );

  const viewPrompt = useCallback((agent: BuiltInAgentView) => {
    setPromptView({ agent, prompt: null, error: null });
    ipc
      .getBuiltInAgentPrompt(agent.id)
      .then((prompt) => setPromptView({ agent, prompt, error: null }))
      .catch((e: unknown) =>
        setPromptView({ agent, prompt: null, error: errorText(e) }),
      );
  }, []);

  const copyAsCustom = useCallback(
    (agent: BuiltInAgentView) => {
      setCopyingId(agent.id);
      ipc
        .getBuiltInAgentPrompt(agent.id)
        .then(({ prompt }) =>
          useBotStore.getState().create({
            name: agent.name,
            // The catalog description is the bot's one-line intro; the prompt
            // becomes its 人格 (same mapping the v1 migration uses).
            description: agent.description,
            avatar: agent.icon
              ? { type: "emoji" as const, value: agent.icon }
              : undefined,
            soul: prompt,
            source: "builtin" as const,
            builtinId: agent.id,
          }),
        )
        .then((bot) => {
          setPromptView(null);
          onCopied(bot);
        })
        .catch((e: unknown) => setError(errorText(e)))
        .finally(() => setCopyingId(null));
    },
    [onCopied],
  );

  if (loading) {
    return (
      <p className="text-body-regular text-text-tertiary">{t("common.loading")}</p>
    );
  }
  if (!catalog) {
    return (
      <EmptyState className="flex-col gap-2 rounded-2xl border border-dashed border-border-button-default px-4 py-8">
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("settings.agentBuiltInLoadFailed")}
          {error ? `: ${error}` : ""}
        </p>
        <Button size="small" variant="secondary" onClick={() => void load()}>
          {t("settings.agentBuiltInRetry")}
        </Button>
      </EmptyState>
    );
  }

  const { provider } = catalog;

  return (
    <div className="flex w-full flex-col gap-2">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}

      <SettingsSectionLabel>
        {t("settings.agentBuiltInSummary", {
          enabled: enabledCount,
          total: catalog.agents.length,
        })}
        <button
          type="button"
          onClick={() => openExternal(provider.sourceUrl)}
          className="ml-3 inline-flex cursor-pointer items-center gap-1 font-normal text-text-tertiary hover:text-text-secondary"
        >
          {provider.displayName}
          <ExternalLink aria-hidden className="size-3.5" />
        </button>
        <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
          @{provider.sourceRevision.slice(0, 8)} · {provider.license}
        </span>
      </SettingsSectionLabel>

      <div className="flex items-center gap-3">
        <Input
          value={search}
          onChange={setSearch}
          placeholder={t("settings.agentBuiltInSearchPlaceholder")}
          fieldClassName="w-56"
          aria-label={t("settings.agentBuiltInSearchPlaceholder")}
        />
        <div className="ml-auto flex items-center gap-2">
          <Switch
            size="sm"
            aria-label={t("settings.agentBuiltInEnabledOnly")}
            isSelected={enabledOnly}
            onChange={setEnabledOnly}
          />
          <span className="text-body-2-regular text-text-secondary">
            {t("settings.agentBuiltInEnabledOnly")}
          </span>
        </div>
      </div>

      <DivisionFilterChips
        divisions={catalog.divisions}
        selectedId={divisionId}
        enabledCount={enabledCount}
        totalCount={catalog.agents.length}
        divisionPending={divisionPending}
        onSelect={setDivisionId}
        onToggleDivision={toggleDivision}
      />

      {visibleAgents.length === 0 ? (
        <EmptyState className="flex-col gap-1 rounded-2xl border border-dashed border-border-button-default px-4 py-8">
          <p className="text-body-2-regular text-text-secondary">
            {t("settings.agentBuiltInEmpty")}
          </p>
        </EmptyState>
      ) : (
        <SettingsCard>
          {visibleAgents.map((agent) => (
            <BuiltInAgentRow
              key={agent.id}
              agent={agent}
              division={divisionById.get(agent.divisionId)}
              pending={pending.has(agent.id)}
              copying={copyingId === agent.id}
              onViewPrompt={viewPrompt}
              onCopy={copyAsCustom}
              onToggle={toggleAgent}
            />
          ))}
        </SettingsCard>
      )}

      {promptView && (
        <PromptPreviewModal
          state={promptView}
          copying={copyingId === promptView.agent.id}
          onClose={() => setPromptView(null)}
          onCopy={copyAsCustom}
        />
      )}
    </div>
  );
}
