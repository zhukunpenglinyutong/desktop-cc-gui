"use client";

import { memo, useEffect, useMemo, type MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import {
  ComposerPickerMenu,
  PickerOption,
  type ComposerPickerMenuHandle,
} from "@/components/application/ai-chat/composer-picker-menu";
import {
  matchBots,
  matchBuiltInAgents,
  useBotStore,
  visibleBots,
} from "@/features/bots/bot-store";
import { BotAvatarView, defaultGeneratedAvatar } from "@/features/bots/bot-avatar";
import { type SelectedBot } from "@/features/bots/selected-bot";
import { type BotConfig, type BuiltInAgentView } from "@/lib/ipc";

/**
 * `#` picker, rendered above the composer while a `#` trigger is active.
 *
 * Rows are the user's bots plus the enabled built-in catalog entries —
 * grouped (置顶 first, then 我的智能体, then one section per catalog
 * division) while the query is empty, flat when filtering. Each row answers
 * "who is it, what does it do, where does it run", so the runtime badge is
 * visible before committing to the pick. A fixed footer row jumps to the
 * settings page. Thin shell over ComposerPickerMenu — the contentEditable
 * keeps focus and owns the keyboard; keys arrive through menuRef.
 */

/** Imperative key handling for the composer's keydown handler. */
export type BotMenuHandle = ComposerPickerMenuHandle;

/** Sentinel id of the fixed footer row that opens the settings page. */
export const CREATE_NEW_BOT_ID = "__create_new__";

/** A menu row: a bot, or a built-in catalog entry (no stored prompt — it
 *  resolves at send time — but a description and a division badge). */
export type BotMenuEntry =
  | { kind: "bot"; key: string; bot: BotConfig }
  | {
      kind: "builtin";
      key: string;
      name: string;
      description: string;
      icon: string | null;
      divisionLabel?: string;
    }
  | { kind: "create"; key: string; name: string };

/** Menu entry → the persisted per-thread pick. The pick keeps only what the
 *  chip and the send path need; the prompt block itself is assembled on the
 *  first send and frozen there (see features/bots/selected-bot.ts). */
export function toSelectedBot(entry: BotMenuEntry): SelectedBot {
  if (entry.kind === "bot") {
    return {
      id: entry.bot.id,
      name: entry.bot.name,
      title: entry.bot.title ?? undefined,
      slug: entry.bot.slug,
      avatar: entry.bot.avatar,
      source: "custom",
    };
  }
  return {
    id: entry.kind === "builtin" ? entry.key.replace(/^builtin:/, "") : entry.key,
    name: entry.kind === "builtin" ? entry.name : "",
    title: undefined,
    avatar: entry.kind === "builtin" && entry.icon
      ? { type: "emoji", value: entry.icon }
      : defaultGeneratedAvatar(entry.key),
    source: "builtIn",
  };
}

/** Section header between groups; keyboard navigation skips it (headers
 *  are not options — row indices stay contiguous). Same chrome as the `/`
 *  picker's kind headers. */
const GROUP_HEADER =
  "px-2 pb-1 pt-1.5 text-caption-1-medium text-text-tertiary select-none";

/** Runtime badge of a bot row: where this pick will actually run. Shown for
 *  every kind — a user who has not changed it still gets to learn that the
 *  default exists, and the CLI kinds are what change the pick's meaning
 *  (files, terminal, permission prompts). */
function runtimeLabel(bot: BotConfig, t: (key: string) => string): string {
  if (bot.runtime.kind === "claude-code") return "Claude Code";
  if (bot.runtime.kind === "codex") return "Codex";
  return t("chat.botRuntimeDirect");
}

const Row = memo(function Row({
  entry,
  index,
  active,
  onSelect,
  onHover,
}: {
  entry: BotMenuEntry;
  index: number;
  active: boolean;
  onSelect: (entry: BotMenuEntry) => void;
  onHover: (index: number) => void;
}) {
  const { t } = useTranslation();
  if (entry.kind === "create") {
    return (
      <PickerOption active={active} onSelect={() => onSelect(entry)} onHover={() => onHover(index)}>
        <Plus aria-hidden className="size-4 shrink-0 text-foreground-icon-secondary" />
        <span className="shrink-0 text-body-regular text-text-primary">{entry.name}</span>
      </PickerOption>
    );
  }

  const name = entry.kind === "bot" ? entry.bot.name : entry.name;
  const summary = (
    entry.kind === "bot"
      ? entry.bot.title?.trim() || entry.bot.description?.trim()
      : entry.description
  )
    ?.replace(/\s+/g, " ")
    .trim();
  const runtime =
    entry.kind === "bot" ? runtimeLabel(entry.bot, t) : t("chat.botRuntimeDirect");
  const skills = entry.kind === "bot" ? entry.bot.capabilities.skills.length : 0;

  return (
    <PickerOption active={active} onSelect={() => onSelect(entry)} onHover={() => onHover(index)}>
      {entry.kind === "bot" ? (
        <BotAvatarView avatar={entry.bot.avatar} seed={entry.bot.id} size={16} />
      ) : (
        <span aria-hidden className="w-4 shrink-0 text-center text-body-regular">
          {entry.icon ?? "🤖"}
        </span>
      )}
      <span className="shrink-0 text-body-regular text-text-primary">{name}</span>
      {summary && (
        <span className="truncate text-body-regular text-text-tertiary" title={summary}>
          {summary}
        </span>
      )}
      <span className="ml-auto flex shrink-0 items-center gap-2 text-caption-1-regular text-text-tertiary">
        {skills > 0 && <span>{t("chat.botSkillCount", { count: skills })}</span>}
        {entry.kind === "builtin" && entry.divisionLabel && <span>{entry.divisionLabel}</span>}
        <span>{runtime}</span>
      </span>
    </PickerOption>
  );
});

export function BotMenu({
  query,
  /** Horizontal offset (px) of the `#` caret inside the composer wrapper. */
  left,
  onSelect,
  onClose,
  menuRef,
}: {
  query: string;
  left: number;
  onSelect: (entry: BotMenuEntry) => void;
  onClose: () => void;
  menuRef?: MutableRefObject<BotMenuHandle | null>;
}) {
  const { t } = useTranslation();
  const bots = useBotStore((s) => s.bots);
  const builtInAgents = useBotStore((s) => s.builtInAgents);
  const builtInDivisions = useBotStore((s) => s.builtInDivisions);
  const loaded = useBotStore((s) => s.loaded);
  useEffect(() => {
    void useBotStore.getState().refresh();
  }, []);

  // Items plus a parallel group-label array: with a query both sources
  // flatten into one list; without one, pinned bots come first, then the rest
  // under "我的智能体", then each division with enabled entries in catalog order.
  const { items, groups } = useMemo(() => {
    const filtering = query.trim().length > 0;
    const divisionLabelById = new Map(
      builtInDivisions.map((division) => [division.id, division.label]),
    );
    const toBuiltInEntry = (agent: BuiltInAgentView): BotMenuEntry => ({
      kind: "builtin",
      key: `builtin:${agent.id}`,
      name: agent.name,
      description: agent.description,
      icon: agent.icon,
      divisionLabel: divisionLabelById.get(agent.divisionId),
    });

    const items: BotMenuEntry[] = [];
    const groups: (string | null)[] = [];
    const push = (entry: BotMenuEntry, group: string | null) => {
      items.push(entry);
      groups.push(group);
    };

    // Hidden bots live in settings only — they never appear in the picker.
    const visible = visibleBots(bots);
    const matched = matchBots(visible, query);
    const builtInMatched = matchBuiltInAgents(builtInAgents, query);
    if (filtering) {
      for (const bot of matched) push({ kind: "bot", key: bot.id, bot }, null);
      for (const agent of builtInMatched) push(toBuiltInEntry(agent), null);
    } else {
      const pinned = matched.filter((bot) => bot.pinned);
      const rest = matched.filter((bot) => !bot.pinned);
      const pinnedGroup = t("chat.botGroupPinned");
      for (const bot of pinned) push({ kind: "bot", key: bot.id, bot }, pinnedGroup);
      const customGroup = t("chat.agentGroupCustom");
      for (const bot of rest) push({ kind: "bot", key: bot.id, bot }, customGroup);
      const byDivision = new Map<string, BuiltInAgentView[]>();
      for (const agent of builtInMatched) {
        const list = byDivision.get(agent.divisionId);
        if (list) list.push(agent);
        else byDivision.set(agent.divisionId, [agent]);
      }
      for (const division of builtInDivisions) {
        const list = byDivision.get(division.id);
        if (!list?.length) continue;
        for (const agent of list) push(toBuiltInEntry(agent), division.label);
      }
    }
    push({ kind: "create", key: CREATE_NEW_BOT_ID, name: t("chat.agentCreate") }, null);
    return { items, groups };
  }, [bots, builtInAgents, builtInDivisions, query, t]);

  const hasMatches = items.length > 1;

  return (
    <ComposerPickerMenu
      left={left}
      width="w-[420px]"
      ariaLabel={t("chat.agents")}
      scope={query}
      loading={!loaded && !hasMatches}
      loadingText={t("chat.agentsLoading")}
      emptyText={t("chat.agentsEmpty")}
      items={items}
      rowKey={(entry) => entry.key}
      onSelect={onSelect}
      onClose={onClose}
      menuRef={menuRef}
      groupHeaderAt={(_entry, i) => {
        // No bot rows (the create row sits alone): paint the empty hint
        // as a non-selectable header above it.
        if (!hasMatches) {
          return i === 0 ? (
            <div className={GROUP_HEADER}>{t("chat.agentsEmpty")}</div>
          ) : null;
        }
        const group = groups[i];
        return group && (i === 0 || groups[i - 1] !== group) ? (
          <div className={GROUP_HEADER}>{group}</div>
        ) : null;
      }}
      renderRow={(entry, i, active, { onHover }) => (
        <Row entry={entry} index={i} active={active} onSelect={onSelect} onHover={onHover} />
      )}
    />
  );
}
