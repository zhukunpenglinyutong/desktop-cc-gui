import { useMemo, useRef } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { DebugEntry } from "../../../types";
import { cn } from "@/lib/utils";

type DebugPanelProps = {
  entries: DebugEntry[];
  isOpen: boolean;
  onClear: () => void;
  onCopy: () => void;
  onResizeStart?: (event: ReactMouseEvent) => void;
  variant?: "dock" | "full";
};

function formatPayload(payload: unknown) {
  if (payload === undefined) {
    return "";
  }
  if (typeof payload === "string") {
    return payload;
  }
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

export function DebugPanel({
  entries,
  isOpen,
  onClear,
  onCopy,
  onResizeStart,
  variant = "dock",
}: DebugPanelProps) {
  const { t } = useTranslation();
  const isVisible = variant === "full" || isOpen;

  type FormattedDebugEntry = DebugEntry & {
    timeLabel: string;
    payloadText?: string;
  };

  const previousEntriesRef = useRef<DebugEntry[] | null>(null);
  const previousFormattedRef = useRef<FormattedDebugEntry[] | null>(null);

  const formattedEntries = useMemo(() => {
    if (!isVisible) {
      return previousFormattedRef.current ?? [];
    }
    const previousEntries = previousEntriesRef.current;
    const previousFormatted = previousFormattedRef.current;

    const canReusePrevious =
      previousEntries !== null &&
      previousFormatted !== null &&
      previousEntries.length === entries.length &&
      entries.every((entry, index) => {
        const previous = previousEntries[index];
        return (
          previous !== undefined &&
          previous.id === entry.id &&
          previous.timestamp === entry.timestamp &&
          previous.source === entry.source &&
          previous.label === entry.label &&
          previous.payload === entry.payload
        );
      });

    if (canReusePrevious) {
      return previousFormatted;
    }

    const nextFormatted = entries.map((entry) => ({
      ...entry,
      timeLabel: new Date(entry.timestamp).toLocaleTimeString(),
      payloadText:
        entry.payload !== undefined ? formatPayload(entry.payload) : undefined,
    }));

    previousEntriesRef.current = entries;
    previousFormattedRef.current = nextFormatted;

    return nextFormatted;
  }, [entries, isVisible]);

  if (!isVisible) {
    return null;
  }

  return (
    <section
      className={cn(
        "debug-panel flex flex-col [-webkit-app-region:no-drag]",
        "border-t border-border bg-muted/50",
        "col-start-1 row-start-6",
        variant === "full" && "full h-full border-t-0",
        variant !== "full" && isOpen && "open h-[var(--debug-panel-height,180px)] border-t-0",
      )}
    >
      {variant !== "full" && isOpen && onResizeStart ? (
        <div
          className={cn(
            "debug-panel-resizer h-1.5 cursor-row-resize relative shrink-0",
            "after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-border after:opacity-40",
            "hover:after:opacity-90",
          )}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize debug panel"
          onMouseDown={onResizeStart}
        />
      ) : null}
      <div className="debug-header flex items-center justify-between gap-3 px-5 py-1.5 text-xs">
        <div className="debug-title font-semibold tracking-widest uppercase text-muted-foreground">
          {t("debug.title")}
        </div>
        <div className="debug-actions flex gap-2">
          <button className="ghost" onClick={onCopy}>
            {t("debug.copy")}
          </button>
          <button className="ghost" onClick={onClear}>
            {t("debug.clear")}
          </button>
        </div>
      </div>
      {isOpen ? (
        <div className="debug-list overflow-y-auto px-4 pt-2 pb-3 flex flex-col gap-2.5 min-h-0 flex-1">
          {formattedEntries.length === 0 ? (
            <div className="debug-empty text-xs text-muted-foreground/70">
              {t("debug.noDebugEventsYet")}
            </div>
          ) : null}
          {formattedEntries.map((entry) => (
            <div key={entry.id} className="debug-row flex flex-col gap-1.5">
              <div className="debug-meta flex gap-2.5 items-center text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    "debug-source uppercase tracking-widest text-[10px] px-1.5 py-0.5 rounded-full bg-secondary",
                    entry.source === "error" && "error bg-destructive/20 text-destructive",
                    entry.source === "stderr" && "stderr bg-yellow-500/20 text-yellow-600 dark:text-yellow-300",
                  )}
                >
                  {entry.source}
                </span>
                <span className="debug-time">{entry.timeLabel}</span>
                <span className="debug-label font-semibold">{entry.label}</span>
              </div>
              {entry.payloadText !== undefined ? (
                <pre className="debug-payload m-0 text-[11px] leading-tight text-foreground whitespace-pre-wrap break-words font-mono">
                  {entry.payloadText}
                </pre>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
