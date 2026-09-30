import {
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { findHashTrigger } from "@/components/application/ai-chat/agent-prompt-triggers";
import { type BotMenuHandle } from "@/components/application/ai-chat/bot-menu";
import {
  useTriggerPicker,
  type TriggerState,
} from "@/components/application/ai-chat/use-trigger-picker";
import { useBotStore } from "@/features/bots/bot-store";

/** Active `#query` trigger: start offset, query text, popover x anchor. */
export type BotTriggerState = TriggerState;

/** Popover width; shared by the caret clamp and the menu surface. */
export const BOT_MENU_WIDTH = 420;

/** Prefetch the bot list on workspace switch, so the first `#` is instant.
 *  Bots are app-global (not per-root), so the root is ignored. */
const prefetchBots = (_root: string) => {
  void useBotStore.getState().refresh();
};

/**
 * useBotPicker — state for the composer's `#` bot picker: an active trigger is
 * a line-start `#` + query at the caret (findHashTrigger). The menu consumes
 * arrows/Enter/Tab/Escape through botMenuRef; `left` anchors the popover to the
 * caret's x position and stays fixed while the query grows. Selecting an entry
 * (DOM mutation) stays in the composer — this hook only tracks the trigger.
 * Thin wrapper over useTriggerPicker.
 */
export function useBotPicker({
  editableRef,
  wrapperRef,
  workspacePath,
  value,
  lastEmittedRef,
}: {
  editableRef: RefObject<HTMLDivElement | null>;
  wrapperRef: RefObject<HTMLDivElement | null>;
  workspacePath?: string;
  /** Controlled field value: external changes invalidate a live trigger. */
  value?: string;
  /** Last text the composer emitted upward; own echoes skip the reset. */
  lastEmittedRef: MutableRefObject<string>;
}): {
  bot: BotTriggerState | null;
  setBot: Dispatch<SetStateAction<BotTriggerState | null>>;
  botMenuRef: MutableRefObject<BotMenuHandle | null>;
  /** Re-derive the trigger from the DOM; returns whether one is active so
   *  the composer can prioritize between pickers. */
  updateBotTrigger: () => boolean;
} {
  const { trigger, setTrigger, menuRef, updateTrigger } =
    useTriggerPicker<BotMenuHandle>({
      editableRef,
      wrapperRef,
      workspacePath,
      value,
      lastEmittedRef,
      findTrigger: findHashTrigger,
      prefetch: prefetchBots,
      menuWidth: BOT_MENU_WIDTH,
    });
  return {
    bot: trigger,
    setBot: setTrigger,
    botMenuRef: menuRef,
    updateBotTrigger: updateTrigger,
  };
}
