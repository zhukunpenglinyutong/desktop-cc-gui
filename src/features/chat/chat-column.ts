/**
 * Chat content column width (设置 → 通用 → 外观 → 宽幕布 / 对话栏宽度).
 *
 * Every surface that shares the conversation's center track — the message
 * timeline, composer, run status, attachment chips, message queue and the
 * question / plan docks — centers itself on one track, so a wide window keeps
 * a readable line length at the cost of two blank bands. Two legacy widths
 * live on that track: the timeline's `750px` and the composer surfaces'
 * `48rem` (768px).
 *
 * `wideLayout` (setting 「宽幕布」, default off) drops the cap and lets the
 * track fill its pane. The column width preset narrows that same track to one
 * of the presets below while 「宽幕布」 is off, so a 1920px window can keep a
 * comfortable line length without the default 750px gutter.
 *
 * The narrow classes read the `--chat-column-max-width` custom property and
 * fall back to the two legacy widths. The default preset leaves the property
 * unset, so the default look is unchanged. The property only reaches these
 * chat-only classes, and 「宽幕布」 removes them, so it wins without needing to
 * know the preset.
 */

import { useSyncExternalStore } from "react";
import { readStoredNumber, writeStored } from "@/lib/storage";

/** localStorage key holding the selected preset width. */
export const CHAT_COLUMN_KEY = "ccgui-next.chat-column-width:v1";
/** Presets in display order; `0` means "fill the pane". */
export const CHAT_COLUMN_PRESETS = [750, 960, 1200, 0] as const;
export const CHAT_COLUMN_DEFAULT = 750;
/** Window event fired after the preset changes, carrying the applied width. */
export const CHAT_COLUMN_CHANGE_EVENT = "ccgui:chat-column-change";
/** The custom property the narrow classes read. */
export const CHAT_COLUMN_VAR = "--chat-column-max-width";

const CHAT_COLUMN_WIDE = "mx-auto w-full";
/** `MessageTimeline`'s virtual inner (the 750px message column). Tailwind
 *  scans this literal, so the variable name cannot be interpolated. */
const CHAT_COLUMN_NARROW_TIMELINE = "mx-auto w-full max-w-[var(--chat-column-max-width,750px)]";
/** The composer track: composer, status bar, chips, queue, docks. */
const CHAT_COLUMN_NARROW_CENTER = "mx-auto w-full max-w-[var(--chat-column-max-width,48rem)]";

/** Invalid or missing stored values fall back to the default preset. */
function normalize(width: number): number {
  return (CHAT_COLUMN_PRESETS as readonly number[]).includes(width) ? width : CHAT_COLUMN_DEFAULT;
}

export function readChatColumnWidth(): number {
  return normalize(readStoredNumber(CHAT_COLUMN_KEY, CHAT_COLUMN_DEFAULT));
}

/** Write the preset onto :root. The default clears it so both classes keep
 *  their own legacy fallback; `none` lets the column fill its pane. */
function applyChatColumnCss(width: number): void {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  if (width === CHAT_COLUMN_DEFAULT) style.removeProperty(CHAT_COLUMN_VAR);
  else style.setProperty(CHAT_COLUMN_VAR, width > 0 ? `${width}px` : "none");
}

/** Persist a preset and notify the settings row; returns the applied width. */
export function applyChatColumnWidth(width: number): number {
  const next = normalize(width);
  writeStored(CHAT_COLUMN_KEY, next);
  applyChatColumnCss(next);
  window.dispatchEvent(new CustomEvent<number>(CHAT_COLUMN_CHANGE_EVENT, { detail: next }));
  return next;
}

/** Class for the timeline's column; `wide` = setting on. */
export function timelineColumnClass(wide: boolean): string {
  return wide ? CHAT_COLUMN_WIDE : CHAT_COLUMN_NARROW_TIMELINE;
}

/** Class for a composer-track surface; `wide` = setting on. */
export function centerColumnClass(wide: boolean): string {
  return wide ? CHAT_COLUMN_WIDE : CHAT_COLUMN_NARROW_CENTER;
}

function subscribe(onChange: () => void): () => void {
  const handler = () => onChange();
  window.addEventListener(CHAT_COLUMN_CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHAT_COLUMN_CHANGE_EVENT, handler);
}

/** Current preset for the settings row. */
export function useChatColumnWidth(): number {
  return useSyncExternalStore<number>(subscribe, readChatColumnWidth, () => CHAT_COLUMN_DEFAULT);
}

// Apply before the first chat render so a non-default preset does not flash
// the 750px column on startup. The stored value is read synchronously.
applyChatColumnCss(readChatColumnWidth());
