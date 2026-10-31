import type { MouseEvent as ReactMouseEvent } from "react";
import { cx } from "@/utils/cx";

/**
 * Shared visual pieces for the editor find card and the read-only preview find
 * card. Colors/sizes follow `docs/ui-ux-spec.zh-CN.md`; keep both surfaces on
 * the same tokens so switching between edit and preview does not restyle the
 * search UI.
 */

export const FIND_PANEL_CARD_CLASS =
  "absolute top-2 right-3 z-20 flex w-[460px] max-w-[calc(100%-1.5rem)] flex-col gap-1 rounded-lg border border-border-button-default bg-background-primary-default p-1.5 text-text-primary shadow-lg";

export const FIND_PANEL_ANIMATION_CLASS =
  "animate-editor-search-in motion-reduce:animate-none";

export const FIND_ICON_BUTTON_CLASS =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-icon-tertiary outline-none transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-foreground-icon-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground-icon-tertiary motion-reduce:transition-none";

export const FIND_FIELD_CLASS =
  "flex h-7 min-w-0 flex-1 items-center rounded-md border border-border-button-default bg-background-primary-default focus-within:border-border-focus-ring focus-within:ring-1 focus-within:ring-border-focus-ring";

export const FIND_INPUT_CLASS =
  "editor-search-input h-full min-w-0 flex-1 bg-transparent px-2 text-body-2-regular text-text-primary outline-none placeholder:text-text-tertiary";

export function findToggleClass(active: boolean) {
  return cx(
    "flex h-5 min-w-6 shrink-0 cursor-pointer items-center justify-center rounded px-1 text-caption-1-medium outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring motion-reduce:transition-none",
    active
      ? "bg-background-tertiary-default text-text-primary"
      : "text-text-tertiary hover:bg-background-secondary-hover hover:text-text-secondary",
  );
}

/** Keeps focus in the find field while a toolbar button is pressed. */
export function keepFindInputFocus(event: ReactMouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}
