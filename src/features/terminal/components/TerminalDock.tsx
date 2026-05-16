import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { TerminalTab } from "../hooks/useTerminalTabs";

type TerminalDockProps = {
  isOpen: boolean;
  terminals: TerminalTab[];
  activeTerminalId: string | null;
  onSelectTerminal: (terminalId: string) => void;
  onNewTerminal: () => void;
  onCloseTerminal: (terminalId: string) => void;
  onResizeStart?: (event: ReactMouseEvent) => void;
  terminalNode: ReactNode;
};

export function TerminalDock({
  isOpen,
  terminals,
  activeTerminalId,
  onSelectTerminal,
  onNewTerminal,
  onCloseTerminal,
  onResizeStart,
  terminalNode,
}: TerminalDockProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <section className="terminal-panel flex flex-col w-full border-t border-[color:var(--border-subtle)] bg-[var(--surface-debug)] h-[var(--terminal-panel-height,220px)] [-webkit-app-region:no-drag]">
      {onResizeStart && (
        <div
          className="terminal-panel-resizer relative h-1.5 cursor-row-resize shrink-0 after:content-[''] after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-[color:var(--border-strong)] after:opacity-40 hover:after:opacity-90"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal panel"
          onMouseDown={onResizeStart}
        />
      )}
      <div className="terminal-header flex items-center gap-3 px-3 py-1.5 text-[12px]">
        <div
          className="terminal-tabs flex items-center gap-1.5 flex-1 min-w-0 overflow-x-auto py-0.5"
          role="tablist"
          aria-label="Terminal tabs"
        >
          {terminals.map((tab) => {
            const isActive = tab.id === activeTerminalId;
            return (
              <button
                key={tab.id}
                className={`terminal-tab inline-flex items-center gap-2 border-0 border-b-2 border-transparent bg-transparent text-[color:var(--text-muted)] px-3 pt-1 pb-1.5 rounded-none text-[11px] tracking-[0.04em] uppercase cursor-pointer whitespace-nowrap shadow-none hover:[transform:none] hover:shadow-none${
                  isActive
                    ? " active text-[color:var(--text-stronger)] !border-b-[#2563eb] bg-transparent"
                    : ""
                }`}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectTerminal(tab.id)}
              >
                <span className="terminal-tab-label max-w-[140px] overflow-hidden text-ellipsis">
                  {tab.title}
                </span>
                <span
                  className="terminal-tab-close text-[12px] text-[color:var(--text-faint)]"
                  role="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTerminal(tab.id);
                  }}
                >
                  ×
                </span>
              </button>
            );
          })}
          <button
            className="terminal-tab-add border-0 border-b-2 border-transparent bg-transparent text-[color:var(--text-muted)] px-3 pt-1 pb-1.5 rounded-none text-[12px] cursor-pointer shadow-none hover:[transform:none] hover:shadow-none hover:border-b-[#2563eb]"
            type="button"
            onClick={onNewTerminal}
            aria-label="New terminal"
            title="New terminal"
          >
            +
          </button>
        </div>
      </div>
      <div className="terminal-body flex-1 min-h-0 flex overflow-hidden p-0 [&>.terminal-shell]:flex-1 [&>.terminal-shell]:min-h-0">
        {terminalNode}
      </div>
    </section>
  );
}
