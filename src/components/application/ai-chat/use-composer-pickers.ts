import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  useMentionPicker,
  type MentionTriggerState,
} from "@/components/application/ai-chat/use-mention-picker";
import {
  useSlashPicker,
  type SlashTriggerState,
} from "@/components/application/ai-chat/use-slash-picker";
import {
  useBotPicker,
  type BotTriggerState,
} from "@/components/application/ai-chat/use-bot-picker";
import {
  usePromptPicker,
  type PromptTriggerState,
} from "@/components/application/ai-chat/use-prompt-picker";
import {
  extractText,
  findMentionTrigger,
  getCaretOffset,
  htmlFromText,
  insertTextAtCaret,
  mentionToken,
  sanitizeEditableHtml,
  setCaretOffset,
} from "@/components/application/ai-chat/file-tags";
import { findSlashTrigger } from "@/components/application/ai-chat/slash-commands";
import { type FileMentionMenuHandle } from "@/components/application/ai-chat/file-mention-menu";
import { type SlashCommandMenuHandle } from "@/components/application/ai-chat/slash-command-menu";
import {
  toSelectedBot,
  type BotMenuEntry,
  type BotMenuHandle,
} from "@/components/application/ai-chat/bot-menu";
import {
  CREATE_NEW_PROMPT_PATH,
  type PromptMenuHandle,
} from "@/components/application/ai-chat/prompt-menu";
import {
  findBangTrigger,
  findHashTrigger,
} from "@/components/application/ai-chat/agent-prompt-triggers";
import { type MentionEntry } from "@/components/application/ai-chat/mention-files";
import { type CustomPromptEntry, type SlashCommandEntry } from "@/lib/ipc";
import { useSelectedBot, type SelectedBot } from "@/features/bots/selected-bot";
import { useChatStore } from "@/features/chat/store";
import { useMcpPanel } from "@/features/mcp/panel";
import { joinPath } from "@/features/files/store";

export interface UseComposerPickersArgs {
  /** The composer field itself. */
  editableRef: RefObject<HTMLDivElement | null>;
  /** Popover anchor / outside-press root owned by the Composer wrapper. */
  wrapperRef: RefObject<HTMLDivElement | null>;
  workspacePath?: string;
  value?: string;
  /** Last text the composer emitted upward (echo suppression). */
  lastEmittedRef: MutableRefObject<string>;
  emitChange: () => void;
  syncTags: () => void;
}

/**
 * The composer's picker bundle: trigger state and menu handles for each
 * picker (`@` mention, `/` slash, `#` bot, `!` prompt), the
 * priority-arbitrated `updateTriggers` pass, the select actions, and the
 * pinned-bot chip state.
 */
export interface ComposerPickers {
  mention: MentionTriggerState | null;
  setMention: Dispatch<SetStateAction<MentionTriggerState | null>>;
  mentionMenuRef: MutableRefObject<FileMentionMenuHandle | null>;
  slash: SlashTriggerState | null;
  setSlash: Dispatch<SetStateAction<SlashTriggerState | null>>;
  slashMenuRef: MutableRefObject<SlashCommandMenuHandle | null>;
  /** Re-derive the `/` trigger from the DOM; returns whether one is active. */
  updateSlashTrigger: () => boolean;
  bot: BotTriggerState | null;
  setBot: Dispatch<SetStateAction<BotTriggerState | null>>;
  botMenuRef: MutableRefObject<BotMenuHandle | null>;
  prompt: PromptTriggerState | null;
  setPrompt: Dispatch<SetStateAction<PromptTriggerState | null>>;
  promptMenuRef: MutableRefObject<PromptMenuHandle | null>;
  /** One detection pass per input, priority `/` > `@` > `#` > `!`. */
  updateTriggers: () => void;
  handleMentionSelect: (entry: MentionEntry) => void;
  handleSlashSelect: (entry: SlashCommandEntry) => void;
  handleBotSelect: (entry: BotMenuEntry) => void;
  handlePromptSelect: (entry: CustomPromptEntry) => void;
  selectedBot: SelectedBot | null;
  clearSelectedBot: () => void;
}

/**
 * `@` mention / `/` slash / `#` bot / `!` prompt pickers for the composer:
 * trigger tracking, priority arbitration (one picker at a time), select
 * actions that rewrite the field, and the per-thread pinned-bot selection.
 * Returns everything the Composer renders (menus, pinned-bot chip) plus the
 * callbacks the editable field and input handle consume.
 */
export function useComposerPickers({
  editableRef,
  wrapperRef,
  workspacePath,
  value,
  lastEmittedRef,
  emitChange,
  syncTags,
}: UseComposerPickersArgs): ComposerPickers {
  // @-mention file picker: trigger tracking, caret anchoring, and workspace
  // lifecycle live in useMentionPicker; the menu + select action stay wired
  // here. The parent owns the wrapper ref (root div + popover anchor).
  const { mention, setMention, mentionMenuRef, updateMentionTrigger } =
    useMentionPicker({ editableRef, wrapperRef, workspacePath, value, lastEmittedRef });
  // `/` command picker: same trigger-tracking model as the mention picker.
  const { slash, setSlash, slashMenuRef, updateSlashTrigger } =
    useSlashPicker({ editableRef, wrapperRef, workspacePath, value, lastEmittedRef });

  // `#` bot picker and `!` prompt picker: same trigger-tracking model.
  const { bot, setBot, botMenuRef, updateBotTrigger } =
    useBotPicker({ editableRef, wrapperRef, workspacePath, value, lastEmittedRef });
  const { prompt, setPrompt, promptMenuRef, updatePromptTrigger } =
    usePromptPicker({ editableRef, wrapperRef, workspacePath, value, lastEmittedRef });

  const navigate = useNavigate();
  // The pinned bot is keyed per thread; draft tabs share a slot until the
  // engine stamps a native session id (see selected-bot.ts).
  const activeSessionId = useChatStore((s) => s.active?.sessionId ?? null);
  const {
    bot: selectedBot,
    select: selectBot,
    clear: clearSelectedBot,
  } = useSelectedBot(workspacePath ?? "", activeSessionId);

  // One detection pass per input, priority `/` > `@` > `#` > `!`
  // (desktop-cc-gui parity: a line-start slash owns the completion surface;
  // `@` inside a slash query must not open the file picker on top of it;
  // only one picker is active at a time).
  const updateTriggers = useCallback(() => {
    if (updateSlashTrigger()) {
      setMention(null);
      setBot(null);
      setPrompt(null);
      return;
    }
    // `@` outranks `#`/`!`; the mention hook's update returns void, so
    // pre-check with the same finder its picker uses.
    const el = editableRef.current;
    const caret = el ? getCaretOffset(el) : -1;
    if (
      el &&
      workspacePath &&
      caret >= 0 &&
      findMentionTrigger(extractText(el), caret)
    ) {
      updateMentionTrigger();
      setBot(null);
      setPrompt(null);
      return;
    }
    setMention(null);
    if (updateBotTrigger()) {
      setPrompt(null);
      return;
    }
    updatePromptTrigger();
  }, [
    updateSlashTrigger,
    updateMentionTrigger,
    updateBotTrigger,
    updatePromptTrigger,
    setMention,
    setBot,
    setPrompt,
    workspacePath,
    editableRef,
  ]);

  /** Replace the active `@query` trigger with the picked file's mention
   *  token (+ trailing space) and render it as a chip. */
  const handleMentionSelect = useCallback(
    (entry: MentionEntry) => {
      const el = editableRef.current;
      if (!el || !workspacePath) return;
      setMention(null);
      const token = mentionToken(joinPath(workspacePath, entry.rel)) + " ";
      const caret = getCaretOffset(el);
      const text = extractText(el);
      // Recompute the trigger at select time — the caret may have moved
      // since the menu last sampled it.
      const trigger = caret >= 0 ? findMentionTrigger(text, caret) : null;
      el.focus();
      if (!trigger) {
        insertTextAtCaret(el, token);
      } else {
        const next =
          text.slice(0, trigger.start) +
          token +
          text.slice(trigger.start + 1 + trigger.query.length);
        el.innerHTML = sanitizeEditableHtml(htmlFromText(next));
        setCaretOffset(el, trigger.start + token.length);
      }
      emitChange();
      syncTags();
    },
    [workspacePath, emitChange, syncTags, setMention, editableRef],
  );
  /** Replace the active `/query` trigger with the picked command
   *  (+ trailing space). Plain text, no chip: the CLI expands `/name args`
   *  itself when the prompt is sent. The `/mcp` app command acts on the
   *  click instead — it opens a panel, not a prompt. */
  const handleSlashSelect = useCallback(
    (entry: SlashCommandEntry) => {
      if (entry.kind === "app" && entry.name === "mcp") {
        setSlash(null);
        editableRef.current?.focus();
        useMcpPanel.getState().openPanel();
        return;
      }
      const el = editableRef.current;
      if (!el) return;
      setSlash(null);
      const token = `/${entry.name} `;
      const caret = getCaretOffset(el);
      const text = extractText(el);
      // Recompute the trigger at select time — the caret may have moved
      // since the menu last sampled it.
      const trigger = caret >= 0 ? findSlashTrigger(text, caret) : null;
      el.focus();
      if (!trigger) {
        insertTextAtCaret(el, token);
      } else {
        const next =
          text.slice(0, trigger.start) +
          token +
          text.slice(trigger.start + 1 + trigger.query.length);
        el.innerHTML = sanitizeEditableHtml(htmlFromText(next));
        setCaretOffset(el, trigger.start + token.length);
      }
      emitChange();
      syncTags();
    },
    [emitChange, syncTags, setSlash, editableRef],
  );
  /** Pin the picked bot to this thread and strip the `#query` trigger
   *  from the field (the bot rides the message as a role block on send,
   *  not as text). The create row jumps to the settings page instead. */
  const handleBotSelect = useCallback(
    (entry: BotMenuEntry) => {
      setBot(null);
      if (entry.kind === "create") {
        navigate("/settings?page=agents");
        return;
      }
      const el = editableRef.current;
      if (!el) return;
      selectBot(toSelectedBot(entry));
      const caret = getCaretOffset(el);
      const text = extractText(el);
      // Recompute the trigger at select time — the caret may have moved
      // since the menu last sampled it.
      const trigger = caret >= 0 ? findHashTrigger(text, caret) : null;
      el.focus();
      if (trigger) {
        const next =
          text.slice(0, trigger.start) +
          text.slice(trigger.start + 1 + trigger.query.length);
        el.innerHTML = sanitizeEditableHtml(htmlFromText(next));
        setCaretOffset(el, trigger.start);
      }
      emitChange();
      syncTags();
    },
    [emitChange, syncTags, setBot, selectBot, navigate, editableRef],
  );
  /** Replace the active `!query` trigger with the picked prompt's content,
   *  caret to the end of the inserted text. The create row jumps to the
   *  settings page instead. */
  const handlePromptSelect = useCallback(
    (entry: CustomPromptEntry) => {
      setPrompt(null);
      if (entry.path === CREATE_NEW_PROMPT_PATH) {
        navigate("/settings?page=prompts");
        return;
      }
      const el = editableRef.current;
      if (!el) return;
      const caret = getCaretOffset(el);
      const text = extractText(el);
      // Recompute the trigger at select time — the caret may have moved
      // since the menu last sampled it.
      const trigger = caret >= 0 ? findBangTrigger(text, caret) : null;
      el.focus();
      if (!trigger) {
        insertTextAtCaret(el, entry.content);
      } else {
        const next =
          text.slice(0, trigger.start) +
          entry.content +
          text.slice(trigger.start + 1 + trigger.query.length);
        el.innerHTML = sanitizeEditableHtml(htmlFromText(next));
        setCaretOffset(el, trigger.start + entry.content.length);
      }
      emitChange();
      syncTags();
    },
    [emitChange, syncTags, setPrompt, navigate, editableRef],
  );

  return {
    // Picker trigger state + close setters + menu refs.
    mention,
    setMention,
    mentionMenuRef,
    slash,
    setSlash,
    slashMenuRef,
    updateSlashTrigger,
    bot,
    setBot,
    botMenuRef,
    prompt,
    setPrompt,
    promptMenuRef,
    // Priority-arbitrated trigger pass for the editable field.
    updateTriggers,
    // Menu select actions.
    handleMentionSelect,
    handleSlashSelect,
    handleBotSelect,
    handlePromptSelect,
    // Pinned-bot chip state.
    selectedBot,
    clearSelectedBot,
  };
}
