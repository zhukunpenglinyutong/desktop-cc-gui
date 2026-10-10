/**
 * Chat content column width (设置 → 通用 → 外观 → 宽幕布).
 *
 * Every surface that shares the conversation's center track — the message
 * timeline, composer, run status, attachment chips, message queue and the
 * question / plan docks — centers itself on one track, so a wide window keeps
 * a readable line length at the cost of two blank bands. Two legacy widths
 * live on that track: the timeline's `750px` and the composer surfaces'
 * `max-w-3xl` (768px). `wideLayout` (setting 「宽幕布」, default off) drops the
 * cap and lets the track fill its pane, keeping only the 16px gutter the pane
 * already reserves. Both narrow values are kept as-is so the default look is
 * unchanged and flipping the switch only changes the cap.
 */

const CHAT_COLUMN_WIDE = "mx-auto w-full";
/** `MessageTimeline`'s virtual inner (the 750px message column). */
const CHAT_COLUMN_NARROW_TIMELINE = "mx-auto w-full max-w-[750px]";
/** The composer track: composer, status bar, chips, queue, docks. */
const CHAT_COLUMN_NARROW_CENTER = "mx-auto w-full max-w-3xl";

/** Class for the timeline's column; `wide` = setting on. */
export function timelineColumnClass(wide: boolean): string {
  return wide ? CHAT_COLUMN_WIDE : CHAT_COLUMN_NARROW_TIMELINE;
}

/** Class for a composer-track surface; `wide` = setting on. */
export function centerColumnClass(wide: boolean): string {
  return wide ? CHAT_COLUMN_WIDE : CHAT_COLUMN_NARROW_CENTER;
}
