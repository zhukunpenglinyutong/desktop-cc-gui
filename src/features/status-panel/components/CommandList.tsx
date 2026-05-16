import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import XCircle from "lucide-react/dist/esm/icons/x-circle";
import type { CommandSummary } from "../types";

interface CommandListProps {
  commands: CommandSummary[];
  enableExpand?: boolean;
}

const STATUS_ICON = {
  running: Loader2,
  completed: CheckCircle2,
  error: XCircle,
} as const;

const STATUS_ICON_CLASS = {
  running: "text-[#61afef] [&_svg]:animate-[sp-spin_1s_linear_infinite]",
  completed: "text-[#89d185]",
  error: "text-[#ff6b6b]",
} as const;

function stripTrailingEllipsis(text: string): string {
  return text.replace(/(?:…|\.{3})\s*$/, "");
}

export const CommandList = memo(function CommandList({
  commands,
  enableExpand = false,
}: CommandListProps) {
  const { t } = useTranslation();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((id: string) => {
    if (!enableExpand) {
      return;
    }
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, [enableExpand]);

  if (commands.length === 0) {
    return (
      <div className="sp-empty p-4 text-center text-(--text-faint) text-xs">
        {t("statusPanel.emptyCommands")}
      </div>
    );
  }
  return (
    <div className="sp-command-list flex flex-col gap-1">
      {commands.map((entry) => {
        const Icon = STATUS_ICON[entry.status] ?? Loader2;
        const isExpanded = expandedIds.has(entry.id);
        const canExpand = enableExpand && entry.command.length > 0;
        const displayCommand =
          isExpanded && canExpand
            ? stripTrailingEllipsis(entry.command)
            : entry.command;
        return (
          <div
            key={entry.id}
            className={`sp-command-item sp-command-${entry.status} flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-(--surface-hover)${
              canExpand ? " is-expandable cursor-pointer" : ""
            }`}
            onClick={() => toggleExpanded(entry.id)}
            role={canExpand ? "button" : undefined}
            tabIndex={canExpand ? 0 : undefined}
            aria-expanded={canExpand ? isExpanded : undefined}
            onKeyDown={(event) => {
              if (!canExpand) {
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleExpanded(entry.id);
              }
            }}
          >
            <span
              className={`sp-command-icon flex items-center mt-px text-(--text-muted) ${STATUS_ICON_CLASS[entry.status]}`}
            >
              <Icon size={14} />
            </span>
            <code
              className={`sp-command-text block flex-1 min-w-0 text-xs leading-snug text-(--text-strong) font-mono${
                isExpanded
                  ? " is-expanded whitespace-pre-wrap overflow-visible text-clip break-words"
                  : " whitespace-nowrap overflow-hidden text-ellipsis"
              }`}
              title={entry.command}
            >
              {displayCommand}
            </code>
          </div>
        );
      })}
    </div>
  );
});
