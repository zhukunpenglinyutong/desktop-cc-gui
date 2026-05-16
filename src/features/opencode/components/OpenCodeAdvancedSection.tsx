import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";

type OpenCodeAdvancedSectionProps = {
  advancedOpen: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  onRunQuickCommand: (command: string) => void;
};

export function OpenCodeAdvancedSection({
  advancedOpen,
  onAdvancedOpenChange,
  onRunQuickCommand,
}: OpenCodeAdvancedSectionProps) {
  return (
    <div className="opencode-panel-advanced mt-2.5 border-t-0 pt-0">
      <button
        type="button"
        className="opencode-advanced-toggle inline-flex items-center gap-1.5 cursor-pointer rounded-lg border border-[color:var(--border-subtle,#d7dce8)] bg-[var(--surface-card,#fff)] px-2 py-1 text-[11px]"
        onClick={() => onAdvancedOpenChange(!advancedOpen)}
      >
        <ChevronDown
          size={12}
          aria-hidden
          className={`transition-transform duration-150 ${advancedOpen ? "is-open rotate-180" : ""}`}
        />
        <span>Advanced</span>
      </button>
      {advancedOpen && (
        <div className="opencode-advanced-content mt-1.5 flex flex-col gap-1 text-[11px] text-[color:var(--text-muted,#6b7280)]">
          <div>快捷命令（在当前会话执行）</div>
          <div className="opencode-session-filters inline-flex gap-1.5">
            <button
              type="button"
              className="opencode-filter-btn cursor-pointer rounded-full border border-[color:var(--border-subtle,#d7dce8)] bg-[var(--surface-card,#fff)] px-[7px] py-0.5 text-[10px]"
              onClick={() => onRunQuickCommand("/status")}
            >
              /status
            </button>
            <button
              type="button"
              className="opencode-filter-btn cursor-pointer rounded-full border border-[color:var(--border-subtle,#d7dce8)] bg-[var(--surface-card,#fff)] px-[7px] py-0.5 text-[10px]"
              onClick={() => onRunQuickCommand("/mcp")}
            >
              /mcp
            </button>
            <button
              type="button"
              className="opencode-filter-btn cursor-pointer rounded-full border border-[color:var(--border-subtle,#d7dce8)] bg-[var(--surface-card,#fff)] px-[7px] py-0.5 text-[10px]"
              onClick={() => onRunQuickCommand("/export")}
            >
              /export
            </button>
            <button
              type="button"
              className="opencode-filter-btn cursor-pointer rounded-full border border-[color:var(--border-subtle,#d7dce8)] bg-[var(--surface-card,#fff)] px-[7px] py-0.5 text-[10px]"
              onClick={() => onRunQuickCommand("/share")}
            >
              /share
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
