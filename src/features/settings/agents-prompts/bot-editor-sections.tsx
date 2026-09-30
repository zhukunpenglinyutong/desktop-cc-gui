import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import { Button } from "@/components/base/buttons/button";
import { Switch } from "@/components/base/switch/switch";
import { TextArea } from "@/components/base/input/textarea";
import { cx } from "@/utils/cx";
import { cachedInstalledSkills } from "@/features/skills/api";
import {
  PROSE_LIMIT,
  SKILL_INDEX_LIMIT,
  duplicateProseLines,
  skillsIndexText,
} from "@/features/bots/bot-prompt";
import type { BotAvatar, BotCapabilities, BotConfig } from "@/lib/ipc";
import {
  BotConceptDiagram,
  PLANNED_TAB_COPY,
  type PlannedTabId,
} from "./bot-concept-diagram";

/** Structured skeleton offered for an empty SOUL / AGENTS field. */
const SOUL_TEMPLATE = `你是「{name}」。

- 说话像……（语气）
- 不确定时直接说「这块我没把握」，并给出判断依据
- 从不用行话，出现专业词就顺手解释一句`;

const AGENTS_TEMPLATE = `# 职责
-

# 流程
1.

# 输出格式
-

# 不做什么
- 不编造 API 或版本号`;

function charCount(text: string): number {
  return [...text].length;
}

/** Shared usage bar for the SOUL + AGENTS budget. */
function ProseUsage({ used }: { used: number }) {
  const { t } = useTranslation();
  const ratio = used / PROSE_LIMIT;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-caption-1-regular">
        <span className="text-text-tertiary">{t("settings.botProseUsageLabel")}</span>
        <span
          className={cx(
            "font-mono",
            ratio > 1
              ? "text-text-error-primary"
              : ratio > 0.8
                ? "text-text-warning-primary"
                : "text-text-secondary",
          )}
        >
          {used.toLocaleString()} / {PROSE_LIMIT.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
        <div
          className={cx(
            "h-full rounded-full",
            ratio > 1 ? "bg-text-error-primary" : ratio > 0.8 ? "bg-text-warning-primary" : "bg-accent-500",
          )}
          style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * One prose field (人格 / 工作规则). Both are Markdown, both count toward the
 * same budget, and both carry the same affordances — the two tabs differ in
 * wording and placeholder, not in behaviour.
 */
export function ProseSection({
  kind,
  bot,
  onChange,
}: {
  kind: "soul" | "instructions";
  bot: BotConfig;
  onChange: (patch: { soul?: string; instructions?: string }) => void;
}) {
  const { t } = useTranslation();
  const value = kind === "soul" ? bot.soul : bot.instructions;
  const other = kind === "soul" ? bot.instructions : bot.soul;
  const duplicates = useMemo(() => duplicateProseLines(bot), [bot]);
  const used = charCount(bot.soul ?? "") + charCount(other ?? "");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-body-medium text-text-primary">
          {t(kind === "soul" ? "settings.botSoulTitle" : "settings.botRulesTitle")}
        </p>
        <p className="mt-1 text-body-2-regular text-text-secondary">
          {t(kind === "soul" ? "settings.botSoulDesc" : "settings.botRulesDesc")}
        </p>
      </div>

      {kind === "soul" && (
        <div className="flex items-start gap-2 rounded-2lg border border-separator-border bg-background-secondary-default px-3 py-2.5 text-caption-1-regular text-text-tertiary">
          <span aria-hidden>💡</span>
          <p>{t("settings.botSoulMigrationHint")}</p>
        </div>
      )}

      {duplicates.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2lg border border-status-warning-background bg-status-warning-background/40 px-3 py-2.5 text-caption-1-regular text-text-warning-primary"
        >
          <span aria-hidden>⚠️</span>
          <div>
            <p>{t("settings.botProseDuplicate", { count: duplicates.length })}</p>
            <p className="mt-1 font-mono text-text-tertiary">{duplicates[0]}</p>
          </div>
        </div>
      )}

      <TextArea
        mono
        rows={14}
        value={value ?? ""}
        onChange={(next) => onChange({ [kind]: next })}
        placeholder={t(
          kind === "soul" ? "settings.botSoulPlaceholder" : "settings.botRulesPlaceholder",
        )}
        aria-label={t(kind === "soul" ? "settings.botSoulTitle" : "settings.botRulesTitle")}
        maxLength={100_000}
      />

      <div className="flex items-end gap-3">
        <Button
          size="small"
          variant="secondary"
          onClick={() =>
            onChange({
              [kind]: value?.trim()
                ? `${value}\n\n${kind === "soul" ? SOUL_TEMPLATE : AGENTS_TEMPLATE}`
                : (kind === "soul" ? SOUL_TEMPLATE : AGENTS_TEMPLATE).replace(
                    "{name}",
                    bot.name,
                  ),
            })
          }
        >
          {t("settings.botInsertTemplate")}
        </Button>
        <div className="ml-auto w-full max-w-[240px]">
          <ProseUsage used={used} />
        </div>
      </div>
    </div>
  );
}

/**
 * Skills the bot may use, plus the tool switches. The honours system is real:
 * the index handed to the model lists only the ticked skills (see
 * features/bots/bot-block.ts), and `*` means "every skill, now and later".
 */
export function CapabilitiesSection({
  bot,
  onChange,
}: {
  bot: BotConfig;
  onChange: (patch: { capabilities?: BotCapabilities }) => void;
}) {
  const { t } = useTranslation();
  const [skills, setSkills] = useState<{ name: string; description: string }[] | null>(null);
  const [search, setSearch] = useState("");
  const caps = bot.capabilities;
  const allEnabled = caps.skills.includes("*");

  useEffect(() => {
    let cancelled = false;
    void cachedInstalledSkills()
      .then((result) => {
        if (!cancelled) {
          setSkills(result.skills.map((s) => ({ name: s.name, description: s.description })));
        }
      })
      .catch(() => {
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCount = allEnabled ? (skills?.length ?? 0) : caps.skills.length;
  const index = useMemo(
    () =>
      skillsIndexText(
        (skills ?? []).filter(
          (skill) => allEnabled || caps.skills.includes(skill.name),
        ),
      ),
    [skills, caps.skills, allEnabled],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = skills ?? [];
    if (!q) return list;
    return list.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q),
    );
  }, [skills, search]);

  const setSkillsEnabled = (next: string[]) =>
    onChange({ capabilities: { ...caps, skills: next } });

  const toggleSkill = (name: string, enabled: boolean) => {
    if (allEnabled) {
      // Leaving "*" materialises the current list minus the one just turned
      // off, so the click does what it looks like it does.
      const current = (skills ?? []).map((skill) => skill.name);
      setSkillsEnabled(current.filter((item) => item !== name));
      return;
    }
    setSkillsEnabled(
      enabled ? [...caps.skills, name] : caps.skills.filter((item) => item !== name),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-body-medium text-text-primary">{t("settings.botCapabilitiesTitle")}</p>
        <p className="mt-1 text-body-2-regular text-text-secondary">
          {t("settings.botCapabilitiesDesc")}
        </p>
      </div>

      <div className="rounded-2xl border border-separator-border bg-background-secondary-default">
        <div className="flex items-center gap-3 border-b border-separator-border px-3.5 py-3">
          <div className="min-w-0">
            <p className="text-body-regular text-text-primary">
              {t("settings.botSkillsTitle", {
                enabled: enabledCount,
                total: skills?.length ?? 0,
              })}
            </p>
            <p className="text-caption-1-regular text-text-tertiary">
              {t("settings.botSkillsIndexUsage", {
                used: index.text.length,
                limit: SKILL_INDEX_LIMIT,
              })}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-caption-1-regular text-text-secondary">
              <Switch
                size="sm"
                isSelected={allEnabled}
                onChange={(next) => setSkillsEnabled(next ? ["*"] : [])}
                aria-label={t("settings.botSkillsAll")}
              />
              {t("settings.botSkillsAll")}
            </label>
          </div>
        </div>

        {skills === null ? (
          <p className="px-3.5 py-4 text-body-2-regular text-text-tertiary">
            {t("common.loading")}
          </p>
        ) : skills.length === 0 ? (
          <div className="flex flex-col gap-2 px-3.5 py-4">
            <p className="text-body-2-regular text-text-secondary">
              {t("settings.botSkillsEmpty")}
            </p>
            <a
              href="#/settings?page=skills"
              className="inline-flex w-fit items-center gap-1 text-body-2-regular text-text-link-primary"
            >
              {t("settings.botSkillsOpenHub")}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
          </div>
        ) : (
          <>
            <div className="border-b border-separator-border px-3.5 py-2">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("settings.botSkillsSearch")}
                aria-label={t("settings.botSkillsSearch")}
                className="w-full bg-transparent text-body-2-regular text-text-primary outline-none placeholder:text-text-placeholder"
              />
            </div>
            <div className="max-h-[320px] overflow-y-auto">
              {visible.map((skill) => {
                const enabled = allEnabled || caps.skills.includes(skill.name);
                return (
                  <div
                    key={skill.name}
                    className={cx(
                      "flex items-center gap-3 border-b border-separator-border px-3.5 py-2.5 last:border-b-0",
                      !enabled && "opacity-60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-body-2-medium text-text-primary">
                        {skill.name}
                      </p>
                      <p className="truncate text-caption-1-regular text-text-tertiary">
                        {skill.description || t("settings.botSkillsNoDescription")}
                      </p>
                    </div>
                    <Switch
                      size="sm"
                      isSelected={enabled}
                      onChange={(next) => toggleSkill(skill.name, next)}
                      aria-label={skill.name}
                    />
                  </div>
                );
              })}
              {visible.length === 0 && (
                <p className="px-3.5 py-4 text-body-2-regular text-text-tertiary">
                  {t("settings.botSkillsNoMatch")}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-separator-border bg-background-secondary-default">
        <div className="border-b border-separator-border px-3.5 py-3">
          <p className="text-body-regular text-text-primary">{t("settings.botToolsTitle")}</p>
          <p className="text-caption-1-regular text-text-tertiary">
            {t("settings.botToolsDesc")}
          </p>
        </div>
        {[
          { id: "session_search", label: t("settings.botToolSessionSearch") },
          { id: "delegate_task", label: t("settings.botToolDelegate") },
        ].map((tool) => (
          <div
            key={tool.id}
            className="flex items-center gap-3 border-b border-separator-border px-3.5 py-2.5 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className="font-mono text-body-2-medium text-text-primary">{tool.label}</p>
            </div>
            <span className="rounded-md bg-background-tertiary-default px-2 py-0.5 text-caption-1-regular text-text-tertiary">
              {t("settings.botComingSoon")}
            </span>
            <Switch size="sm" isSelected={false} isDisabled aria-label={tool.label} />
          </div>
        ))}
        <p className="border-t border-separator-border px-3.5 py-2.5 text-caption-1-regular text-text-tertiary">
          {t("settings.botToolsMemoryHint")}
        </p>
      </div>
    </div>
  );
}

/**
 * A section whose feature has not shipped yet. It draws the planned flow
 * instead of hiding the tab: a user who read the release notes needs to find
 * the thing they were told about, and a concept diagram is cheaper than a
 * support question about a missing menu.
 *
 * The diagram is read-only and the copy says 「即将支持」 — the roadmap phase
 * numbers stay in the data (`bot-prompt.ts` marks blocks the same way) and
 * out of the UI, where 「阶段 3」 read like a version the user could wait for.
 */
export function PlannedSection({
  tab,
  avatar,
  name,
}: {
  tab: PlannedTabId;
  avatar?: BotAvatar | null;
  name: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <p className="text-body-medium text-text-primary">
            {t(PLANNED_TAB_COPY[tab].titleKey)}
          </p>
          <p className="mt-1 text-body-2-regular text-text-secondary">
            {t(PLANNED_TAB_COPY[tab].descKey)}
          </p>
        </div>
        <span className="ml-auto shrink-0 rounded-md bg-background-tertiary-default px-2 py-1 text-caption-1-regular text-text-tertiary">
          {t("settings.botComingSoon")}
        </span>
      </div>
      <div
        data-testid="bot-concept"
        className="rounded-2xl border border-dashed border-border-button-default p-3.5"
      >
        <BotConceptDiagram tab={tab} avatar={avatar} name={name} />
      </div>
    </div>
  );
}
