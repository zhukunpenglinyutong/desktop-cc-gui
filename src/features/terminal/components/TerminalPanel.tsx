import type { RefObject } from "react";
import type { TerminalStatus } from "../../../types";

type TerminalPanelProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  status: TerminalStatus;
  message: string;
};

export function TerminalPanel({ containerRef, status, message }: TerminalPanelProps) {
  return (
    <div className="terminal-shell relative flex flex-1 min-h-0 h-full p-0">
      <div
        ref={containerRef}
        className="terminal-surface flex-1 min-h-0 h-full rounded-none overflow-hidden bg-[var(--terminal-background)] border-t border-[color:rgba(255,255,255,0.08)] box-border"
      />
      {status !== "ready" && (
        <div className="terminal-overlay absolute inset-0 flex items-center justify-center rounded-[10px] text-[color:var(--text-muted)] pointer-events-none text-center text-[12px] p-4">
          <div className="terminal-status max-w-[280px] bg-[var(--surface-card)] border border-[color:var(--border-subtle)] rounded-[10px] px-3 py-2">
            {message}
          </div>
        </div>
      )}
    </div>
  );
}
