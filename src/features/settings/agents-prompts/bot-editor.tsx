import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Eye from "lucide-react/dist/esm/icons/eye";
import X from "lucide-react/dist/esm/icons/x";
import Bot from "lucide-react/dist/esm/icons/bot";
import { Button } from "@/components/base/buttons/button";
import { ModalShell } from "@/components/dialogs";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/input/textarea";
import { cx } from "@/utils/cx";
import { BotAvatarView } from "@/features/bots/bot-avatar";
import { refreshBotBlocks } from "@/features/bots/selected-bot";
import { useBotStore } from "@/features/bots/bot-store";
import { useChatStore } from "@/features/chat/store";
import type { BotConfig } from "@/lib/ipc";
import { BotAvatarStudio } from "./bot-avatar-studio";
import { BotPromptPreview } from "./bot-prompt-preview";
import {
  CapabilitiesSection,
  PlannedSection,
  ProseSection,
} from "./bot-editor-sections";
import { MemorySection } from "./memory-section";
import { isPlannedTab } from "./bot-concept-diagram";

/** Debounce before an edit is written to disk (typing feels instant, the
 *  file is not rewritten per keystroke). */
const AUTOSAVE_MS = 600;

/** 运行后端 / 定时任务 / 协作 暂时不进页签栏：分区实现和概念图都还在，等它们
 *  真能用时把这里改回 true 即可。记忆已在「核心闭环」范围内，页签常驻
 *  （见 `visibleTabs`）。 */
const SHOW_PLANNED_TABS = false;

type TabId =
  | "soul"
  | "rules"
  | "capabilities"
  | "runtime"
  | "memory"
  | "routines"
  | "collab";

/** One identity row: the vendored editor's 96px label column, 52px tall. */
function IdRow({
  label,
  htmlFor,
  tall,
  children,
}: {
  label: string;
  htmlFor: string;
  /** Description rows get the extra 82px height the block uses for the textarea. */
  tall?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 border-b border-separator-border pr-2.5 pl-3 last:border-b-0",
        tall ? "min-h-[82px] items-start py-2.5" : "h-[52px]",
      )}
    >
      <label
        htmlFor={htmlFor}
        className={cx("text-body-2-regular text-text-secondary", tall && "pt-1")}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

/**
 * Bot editor dialog, opened from the list. A modal (not a full-bleed page):
 * the list stays one Esc away, and the same shell every other dialog uses
 * brings the backdrop, focus trap and outside-press dismissal. The identity
 * column answers "who is this" at every moment, the tabs answer
 * "what does it do".
 *
 * Saves are automatic: edits land in `draft`, and a debounced write patches
 * the store. The draft, not the store, is what the fields render — otherwise a
 * store refresh would fight the caret.
 */
export function BotEditor({
  bot,
  onBack,
}: {
  bot: BotConfig;
  /** Close the dialog. `saved` tells the list whether to mention the write. */
  onBack: (saved: boolean) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<BotConfig>(bot);
  const [tab, setTab] = useState<TabId>("soul");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const timerRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const applyLocal = (patch: Partial<BotConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
    pendingRef.current = true;
  };

  // Debounced autosave. The patch carries every editable field: the backend
  // validates the whole shape anyway, and a partial patch would need a
  // per-field dirty map that adds nothing here.
  useEffect(() => {
    if (!pendingRef.current) return;
    setSave({ kind: "saving" });
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      pendingRef.current = false;
      void useBotStore
        .getState()
        .update(draft.id, {
          name: draft.name,
          slug: draft.slug,
          title: draft.title ?? "",
          description: draft.description ?? "",
          avatar: draft.avatar,
          soul: draft.soul,
          instructions: draft.instructions,
          capabilities: draft.capabilities,
          runtime: draft.runtime,
          memory: draft.memory,
          pinned: draft.pinned,
          hidden: draft.hidden,
        })
        .then((updated) => {
          if (!updated) {
            setSave({ kind: "error", message: t("settings.botSaveMissing") });
            return;
          }
          // The backend may normalize what we sent (slug uniqueness, an
          // emoji avatar with no glyph): adopt its answer for those fields
          // without touching what the user is typing.
          setDraft((current) => ({
            ...current,
            slug: updated.slug,
            avatar: updated.avatar,
            updatedAt: updated.updatedAt,
          }));
          setSave({ kind: "saved", at: Date.now() });
        })
        .catch((error: unknown) => {
          setSave({
            kind: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }, AUTOSAVE_MS);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [draft, t]);

  // Leaving the editor with unsaved keystrokes would drop them: flush now.
  useEffect(
    () => () => {
      if (!pendingRef.current) return;
      const current = draftRef.current;
      void useBotStore
        .getState()
        .update(current.id, {
          name: current.name,
          slug: current.slug,
          title: current.title ?? "",
          description: current.description ?? "",
          avatar: current.avatar,
          soul: current.soul,
          instructions: current.instructions,
          capabilities: current.capabilities,
          runtime: current.runtime,
          memory: current.memory,
          pinned: current.pinned,
          hidden: current.hidden,
        })
        .catch(() => {});
    },
    [],
  );

  const tabs: Array<{ id: TabId; label: string; planned?: boolean }> = useMemo(() => {
    const all: Array<{ id: TabId; label: string; planned?: boolean }> = [
      { id: "soul", label: t("settings.botTabSoul") },
      { id: "rules", label: t("settings.botTabRules") },
      { id: "capabilities", label: t("settings.botTabCapabilities") },
      // 记忆已上线，不再带 planned 标记；其余三个仍是概念图。
      { id: "memory", label: t("settings.botTabMemory") },
      { id: "runtime", label: t("settings.botTabRuntime"), planned: true },
      { id: "routines", label: t("settings.botTabRoutines"), planned: true },
      { id: "collab", label: t("settings.botTabCollab"), planned: true },
    ];
    return SHOW_PLANNED_TABS ? all : all.filter((entry) => !entry.planned);
  }, [t]);
  const engines = useChatStore((s) => s.engines);

  const saveLabel =
    save.kind === "saving"
      ? t("settings.botSaving")
      : save.kind === "error"
        ? t("settings.botSaveFailed", { message: save.message })
        : save.kind === "saved"
          ? t("settings.botSaved", {
              time: new Date(save.at).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              }),
            })
          : t("settings.botSavedIdle");

  const close = () => {
    const wasPending = pendingRef.current;
    pendingRef.current = false;
    onBack(wasPending);
  };

  return (
    <ModalShell
      label={t("settings.botEditorTitle", { name: draft.name })}
      onClose={close}
      className="h-[min(780px,90vh)] w-[min(1180px,94vw)] overflow-hidden rounded-2xl p-0"
      dialogClassName="flex h-full min-h-0 flex-col"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-separator-border px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <BotAvatarView avatar={draft.avatar} seed={draft.id} size={22} />
          <span className="truncate text-body-medium text-text-primary">{draft.name}</span>
          <span className="shrink-0 rounded-md bg-background-tertiary-default px-1.5 py-0.5 text-caption-1-regular text-text-tertiary">
            {draft.source === "builtin"
              ? t("settings.botSourceBuiltIn")
              : t("settings.botSourceCustom")}
          </span>
        </span>
        <span
          role="status"
          className={cx(
            "ml-auto shrink-0 text-caption-1-regular",
            save.kind === "error" ? "text-text-error-primary" : "text-text-tertiary",
          )}
        >
          {saveLabel}
        </span>
        <Button
          size="small"
          variant="secondary"
          leadingIcon={Eye}
          onClick={() => setPreviewOpen((open) => !open)}
        >
          {t("settings.botPreviewToggle")}
        </Button>
        <button
          type="button"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={close}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-background-tertiary-default text-foreground-icon-secondary transition-colors hover:bg-background-tertiary-hover hover:text-foreground-icon-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* 身份：常驻左栏，切到任何分区都不会丢。字段行沿用 BoardUI agent
            editor 的 96px 标签列 + 52px 行高，和真组件同一种节奏；400px 的栏宽
            留给输入框约 250px。这一栏自己是滚动容器，子块一律 `shrink-0`：
            不写的话弹性收缩会把 239px 的身份卡片压到 63px（它带
            `overflow-hidden`，于是被剪掉而不是顶开滚动条），整栏 scrollHeight
            等于 clientHeight，滚也滚不动。滚动条不画（`scrollbar-none`）：
            11px 的轨道贴在手边的分隔线上，看起来像第二条竖线，而设置页
            本身的内容列（settings-shell）和页签条也都是这个做法。 */}
        <div className="scrollbar-none flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-r border-separator-border bg-background-secondary-default p-4">
          <div className="shrink-0">
            <BotAvatarStudio
              avatar={draft.avatar}
              seed={draft.id}
              onChange={(avatar) => applyLocal({ avatar })}
            />
          </div>

          <div className="flex shrink-0 flex-col overflow-hidden rounded-2xl bg-background-primary-default">
            <IdRow label={t("settings.agentName")} htmlFor="bot-name">
              <Input
                id="bot-name"
                size="small"
                value={draft.name}
                onChange={(name) => applyLocal({ name })}
                maxLength={64}
                aria-label={t("settings.agentName")}
              />
            </IdRow>
            <IdRow label={t("settings.botTitleLabel")} htmlFor="bot-title">
              <Input
                id="bot-title"
                size="small"
                value={draft.title ?? ""}
                onChange={(title) => applyLocal({ title })}
                maxLength={48}
                placeholder={t("settings.botTitlePlaceholder")}
                aria-label={t("settings.botTitleLabel")}
              />
            </IdRow>
            <IdRow label={t("settings.botDescriptionLabel")} htmlFor="bot-description" tall>
              <TextArea
                id="bot-description"
                value={draft.description ?? ""}
                onChange={(description) => applyLocal({ description })}
                rows={2}
                maxLength={200}
                placeholder={t("settings.botDescriptionPlaceholder")}
                aria-label={t("settings.botDescriptionLabel")}
                // The vendored block's own sizing: a fixed 62px field inside
                // the 82px row, no drag handle (it would escape the rounded
                // card it sits in).
                fieldClassName="h-[62px]"
                inputClassName="resize-none"
              />
            </IdRow>
            <IdRow label={t("settings.botSlugLabel")} htmlFor="bot-slug">
              <div className="flex items-center gap-1">
                <span className="text-body-2-regular text-text-tertiary">@</span>
                <Input
                  id="bot-slug"
                  size="small"
                  value={draft.slug}
                  onChange={(slug) => applyLocal({ slug })}
                  maxLength={48}
                  aria-label={t("settings.botSlugLabel")}
                />
              </div>
            </IdRow>
          </div>

          <div className="flex shrink-0 flex-col gap-1 text-caption-1-regular text-text-tertiary">
            <p>{t("settings.botTitleHint")}</p>
            <p>{t("settings.botDescriptionHint")}</p>
            <p>{t("settings.botSlugHint")}</p>
          </div>

          <p className="mt-auto shrink-0 text-caption-1-regular text-text-quaternary">
            {t("settings.botMetaLine", {
              date: new Date(draft.createdAt).toLocaleDateString(),
            })}
            <br />
            {t("settings.botSchemaLine", { version: draft.schemaVersion })}
          </p>
        </div>

        {/* 分区内容 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="scrollbar-none flex shrink-0 items-center gap-1 overflow-x-auto border-b border-separator-border px-4 py-2">
            {tabs.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={cx(
                  "flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 text-body-2-regular",
                  "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                  tab === entry.id
                    ? "bg-background-tertiary-default text-text-primary"
                    : "text-text-tertiary hover:text-text-primary",
                )}
              >
                {entry.label}
                {entry.planned && (
                  <span className="text-caption-1-regular text-text-quaternary">
                    {t("settings.botComingSoon")}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-4 py-5">
            <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
              {(tab === "soul" || tab === "rules") && (
                <ProseSection
                  kind={tab === "soul" ? "soul" : "instructions"}
                  bot={draft}
                  onChange={(patch) => applyLocal(patch)}
                />
              )}
              {tab === "capabilities" && (
                <CapabilitiesSection
                  bot={draft}
                  onChange={(patch) => applyLocal(patch)}
                />
              )}
              {tab === "memory" && (
                <MemorySection
                  bot={draft}
                  engines={engines}
                  onChange={(patch) => applyLocal(patch)}
                />
              )}
              {isPlannedTab(tab) && (
                <PlannedSection tab={tab} avatar={draft.avatar} name={draft.name} />
              )}
              <div className="flex items-start gap-2 rounded-2lg border border-separator-border bg-background-secondary-default px-3 py-2.5 text-caption-1-regular text-text-tertiary">
                <Bot className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <p>{t("settings.botEditorFooter")}</p>
              </div>
            </div>
          </div>
        </div>

        {previewOpen && (
          <BotPromptPreview
            bot={draft}
            onClose={() => setPreviewOpen(false)}
            onRefreshContext={() => refreshBotBlocks(draft.id)}
          />
        )}
      </div>
    </ModalShell>
  );
}
