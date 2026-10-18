"use client";

import type { ReactNode } from "react";
import { LogRow, ShimmerText } from "@/components/application/agent-log/agent-log";
import { cx } from "@/utils/cx";

/**
 * Task List — step rows for the agent's working transcript.
 *
 * Only the step-row layer lives on: the animated top-level `TaskList` (timed
 * reveal, collapsing task headers) had no production caller and was removed.
 * `StepRow` is what MessageTimeline renders for each historical step; the
 * reveal, the clipping edge and the curved guide all come from Agent Log.
 */

/* ----------------------------------------------------------------- types */

export interface TaskListChip {
  /** Chip label, e.g. a file name. */
  label: string;
  /** Optional leading glyph — a file-type or product mark. */
  icon?: ReactNode;
  /** When set, the chip is a button that opens something (the tool call's
   *  target file). Chips without it stay inert text, so a chip that names a
   *  resource nobody can open never grows a dead affordance. */
  onSelect?: () => void;
  /** Native tooltip for the selectable chip (usually the full path). */
  title?: string;
  /** Accessible name; the visible label is a truncated file name. */
  selectLabel?: string;
}

export interface TaskListStep {
  /** The line of text, e.g. `Scanning 52 files`. */
  label: string;
  /** Resource chips rendered inline after the label. */
  chips?: TaskListChip[];
}

/* ------------------------------------------------------------- internals */

function Chip({ chip }: { chip: TaskListChip }) {
  const className = cx(
    "mr-0.5 ml-[3px] inline-flex max-w-full -translate-y-px items-center gap-1 rounded-md border py-0.5 pr-1.5 align-middle",
    // Quiet at rest so a row of chips does not out-shout the step text,
    // then the border and surface firm up together under the cursor so the
    // chip reads as something you can act on.
    "border-border-button-default/50 bg-background-secondary-default",
    "transition-colors duration-150 ease hover:border-border-button-hover hover:bg-background-tertiary-default",
    chip.icon ? "pl-1" : "pl-1.5",
    // Only a selectable chip is focusable; it gets the host's focus ring so
    // keyboard users see the same affordance the pointer gets on hover.
    chip.onSelect &&
      "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
  );
  const content = (
    <>
      {chip.icon ? (
        <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
          {chip.icon}
        </span>
      ) : null}
      <span className="truncate text-caption-2-medium text-text-primary">{chip.label}</span>
    </>
  );
  if (!chip.onSelect) return <span className={className}>{content}</span>;
  return (
    <button
      type="button"
      className={className}
      title={chip.title ?? chip.label}
      aria-label={chip.selectLabel ?? chip.label}
      onClick={(event) => {
        // The chip sits inside the timeline body, whose ancestors own
        // row-level clicks (search highlight jumps, selection); opening a
        // file is a leaf action and must not also trigger those.
        event.stopPropagation();
        chip.onSelect?.();
      }}
    >
      {content}
    </button>
  );
}

export function StepRow({
  step,
  active,
  first,
  last,
  reduce,
  children,
}: {
  step: TaskListStep;
  active: boolean;
  first: boolean;
  last: boolean;
  reduce: boolean;
  children?: ReactNode;
}) {
  return (
    <LogRow first={first} last={last} reduce={reduce}>
      <span className="block py-1 break-words text-body-regular text-text-secondary">
        {active ? <ShimmerText>{step.label}</ShimmerText> : step.label}
        {step.chips?.map((chip) => (
          <Chip key={chip.label} chip={chip} />
        ))}
      </span>
      {children}
    </LogRow>
  );
}
