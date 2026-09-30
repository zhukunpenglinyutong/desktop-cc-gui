import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Bot from "lucide-react/dist/esm/icons/bot";
import Library from "lucide-react/dist/esm/icons/library";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Pin from "lucide-react/dist/esm/icons/pin";
import Plus from "lucide-react/dist/esm/icons/plus";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { Button } from "@/components/base/buttons/button";
import { EmptyState } from "@/components/base/empty-state";
import { Input } from "@/components/base/input/input";
import { PillTab, PillTabList } from "@/components/base/tabs/pill-tab";
import { ConfirmDialog } from "@/components/dialogs";
import { BotAvatarView } from "@/features/bots/bot-avatar";
import { matchBots, useBotStore } from "@/features/bots/bot-store";
import { forgetBotSelection } from "@/features/bots/selected-bot";
import { errorText } from "@/lib/errors";
import type { BotConfig } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { ROW } from "../CliChannelRow";
import { BuiltInBotsPane } from "./built-in-bots-pane";
import { BotEditor } from "./bot-editor";

type Filter = "all" | "pinned" | "custom" | "builtin";

/** Same affordance the message rows use: bare icon, hover-revealed chrome. */
const ICON_BUTTON =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary";

/** One row's second line: whichever of title/description exists. */
function summaryOf(bot: BotConfig): string {
  const text = bot.description?.trim() || bot.title?.trim() || "";
  return text.replace(/\s+/g, " ").slice(0, 120);
}

function BotRow({
  bot,
  onOpen,
  onDelete,
}: {
  bot: BotConfig;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const summary = summaryOf(bot);
  const skills = bot.capabilities.skills.length;
  const runtime =
    bot.runtime.kind === "claude-code"
      ? "Claude Code"
      : bot.runtime.kind === "codex"
        ? "Codex"
        : t("chat.botRuntimeDirect");

  return (
    <div
      data-testid="bot-row"
      className={cx(ROW, "cursor-pointer")}
      onClick={onOpen}
    >
      <BotAvatarView avatar={bot.avatar} seed={bot.id} size={36} />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex min-w-0 items-center gap-1.5 text-body-regular text-text-primary">
          <span className="truncate">{bot.name}</span>
          {bot.title && (
            <span className="truncate text-body-2-regular text-text-tertiary">
              · {bot.title}
            </span>
          )}
          {bot.source === "builtin" && (
            <span className="shrink-0 rounded-md bg-background-tertiary-default px-1.5 text-caption-1-regular text-text-tertiary">
              {t("settings.botSourceBuiltIn")}
            </span>
          )}
          {bot.hidden && (
            <span className="shrink-0 rounded-md bg-background-tertiary-default px-1.5 text-caption-1-regular text-text-tertiary">
              {t("settings.botHiddenBadge")}
            </span>
          )}
        </p>
        {summary && (
          <p className="truncate text-body-2-regular text-text-secondary" title={summary}>
            {summary}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden text-caption-1-regular text-text-quaternary sm:inline">
          {t("settings.botMetaLineShort", { runtime, skills })}
        </span>
        <button
          type="button"
          aria-label={bot.pinned ? t("settings.botUnpin") : t("settings.botPin")}
          title={bot.pinned ? t("settings.botUnpin") : t("settings.botPin")}
          onClick={(event) => {
            event.stopPropagation();
            void useBotStore.getState().update(bot.id, { pinned: !bot.pinned });
          }}
          className={cx(ICON_BUTTON, bot.pinned && "text-text-link-primary")}
        >
          <Pin className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("settings.agentEdit")}
          title={t("settings.agentEdit")}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          className={ICON_BUTTON}
        >
          <Pencil className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("settings.agentDelete")}
          title={t("settings.agentDelete")}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className={ICON_BUTTON}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/**
 * 智能体 pane: the bot library (search, pin/hide, create, duplicate, delete)
 * plus the bundled built-in catalog. Selecting a row opens the full-bleed
 * editor (BotEditor); this pane keeps its own list state so coming back lands
 * on the same filter.
 */
export function BotsPane() {
  const { t } = useTranslation();
  const bots = useBotStore((s) => s.bots);
  const loaded = useBotStore((s) => s.loaded);

  const [tab, setTab] = useState<"custom" | "builtIn">("custom");
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BotConfig | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  // The store's first refresh is lazy — kick it off on mount.
  useEffect(() => {
    if (!useBotStore.getState().loaded) {
      useBotStore.getState().refresh().catch((e: unknown) => setError(errorText(e)));
    }
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const reportFailure = (e: unknown) => setError(errorText(e));

  const editing = useMemo(
    () => bots.find((bot) => bot.id === editingId) ?? null,
    [bots, editingId],
  );

  const counts = useMemo(
    () => ({
      all: bots.length,
      pinned: bots.filter((bot) => bot.pinned).length,
      custom: bots.filter((bot) => bot.source === "custom").length,
      builtin: bots.filter((bot) => bot.source === "builtin").length,
    }),
    [bots],
  );

  const { visible, hidden } = useMemo(() => {
    const matched = matchBots(bots, search).filter((bot) => {
      if (filter === "pinned") return bot.pinned;
      if (filter === "custom") return bot.source === "custom";
      if (filter === "builtin") return bot.source === "builtin";
      return true;
    });
    return {
      visible: matched.filter((bot) => !bot.hidden),
      hidden: matched.filter((bot) => bot.hidden),
    };
  }, [bots, search, filter]);

  const createBot = () => {
    setError(null);
    void useBotStore
      .getState()
      .create({ name: t("settings.botUntitled") })
      .then((bot) => setEditingId(bot.id))
      .catch(reportFailure);
  };

  const confirmDelete = () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    setError(null);
    if (editingId === target.id) setEditingId(null);
    forgetBotSelection(target.id);
    void useBotStore.getState().remove(target.id).catch(reportFailure);
  };

  if (editing) {
    return (
      <BotEditor
        key={editing.id}
        bot={editing}
        onBack={(saved) => {
          setEditingId(null);
          if (saved) setNotice(t("settings.botSavedNotice"));
        }}
      />
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <PillTabList className="self-start">
        <PillTab
          variant="gray"
          icon={Bot}
          anchor="custom"
          isSelected={tab === "custom"}
          onSelect={() => setTab("custom")}
        >
          {t("settings.agentTabCustom")}
        </PillTab>
        <PillTab
          variant="gray"
          icon={Library}
          anchor="builtIn"
          isSelected={tab === "builtIn"}
          onSelect={() => setTab("builtIn")}
        >
          {t("settings.agentTabBuiltIn")}
        </PillTab>
      </PillTabList>

      {notice && (
        <p role="status" className="text-body-2-regular text-state-success-text">
          {notice}
        </p>
      )}

      {tab === "builtIn" ? (
        <BuiltInBotsPane
          onCopied={(bot) => {
            setTab("custom");
            setEditingId(bot.id);
          }}
        />
      ) : (
        <div className="flex w-full flex-col gap-2">
          {error && (
            <p role="alert" className="text-body-regular text-text-error-primary">
              {t("common.error")}: {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <SettingsSectionLabel>
              {t("settings.agents")}
              <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
                {t("settings.botSectionDesc")}
              </span>
            </SettingsSectionLabel>
            <Button size="small" leadingIcon={Plus} onClick={createBot} className="shrink-0">
              {t("settings.botNew")}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Input
              size="small"
              value={search}
              onChange={setSearch}
              placeholder={t("settings.botSearchPlaceholder")}
              aria-label={t("settings.botSearchPlaceholder")}
              fieldClassName="flex-1"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["all", t("settings.botFilterAll")],
                ["pinned", t("settings.botFilterPinned")],
                ["custom", t("settings.botFilterCustom")],
                ["builtin", t("settings.botFilterBuiltIn")],
              ] as Array<[Filter, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
                className={cx(
                  "cursor-pointer rounded-full border px-2.5 py-1 text-caption-1-regular transition-colors",
                  filter === id
                    ? "border-accent-500 bg-accent-500/10 text-text-link-primary"
                    : "border-separator-border text-text-tertiary hover:text-text-primary",
                )}
              >
                {label} {counts[id]}
              </button>
            ))}
          </div>

          {loaded && visible.length === 0 && hidden.length === 0 ? (
            <EmptyState className="flex-col gap-1 rounded-2xl border border-dashed border-border-button-default px-4 py-8">
              <p className="text-body-medium text-text-primary">{t("settings.botEmptyTitle")}</p>
              <p className="text-body-2-regular text-text-secondary">{t("settings.botEmptyDesc")}</p>
              <Button size="small" variant="secondary" onClick={createBot} className="mt-2">
                {t("settings.botNew")}
              </Button>
            </EmptyState>
          ) : (
            <SettingsCard>
              {visible.map((bot) => (
                <BotRow
                  key={bot.id}
                  bot={bot}
                  onOpen={() => setEditingId(bot.id)}
                  onDelete={() => setDeleting(bot)}
                />
              ))}
            </SettingsCard>
          )}

          {hidden.length > 0 && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                aria-expanded={showHidden}
                onClick={() => setShowHidden((open) => !open)}
                className="w-fit cursor-pointer text-caption-1-regular text-text-tertiary hover:text-text-primary"
              >
                {t("settings.botHiddenSection", { count: hidden.length })}
              </button>
              {showHidden && (
                <SettingsCard>
                  {hidden.map((bot) => (
                    <BotRow
                      key={bot.id}
                      bot={bot}
                      onOpen={() => setEditingId(bot.id)}
                      onDelete={() => setDeleting(bot)}
                    />
                  ))}
                </SettingsCard>
              )}
            </div>
          )}

          {deleting && (
            <ConfirmDialog
              danger
              message={t("settings.botDeleteConfirm", { name: deleting.name })}
              onConfirm={confirmDelete}
              onCancel={() => setDeleting(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
