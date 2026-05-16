import { memo } from "react";
import { useTranslation } from "react-i18next";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import XCircle from "lucide-react/dist/esm/icons/x-circle";
import type { SubagentInfo } from "../types";

interface SubagentListProps {
  subagents: SubagentInfo[];
  onSelectSubagent?: (agent: SubagentInfo) => void;
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

const BASE_ITEM_CLASS =
  "flex items-center gap-2 w-full px-2 py-1.5 rounded-lg border-0 bg-transparent text-inherit text-left transition-colors hover:bg-(--surface-hover)";

const CLICKABLE_FOCUS_CLASS =
  "cursor-pointer focus-visible:outline focus-visible:outline-1 focus-visible:[outline-color:color-mix(in_srgb,var(--accent-color,#61afef)_72%,white_12%)] focus-visible:[outline-offset:-1px]";

export const SubagentList = memo(function SubagentList({
  subagents,
  onSelectSubagent,
}: SubagentListProps) {
  const { t } = useTranslation();
  if (subagents.length === 0) {
    return (
      <div className="sp-empty p-4 text-center text-(--text-faint) text-xs">
        {t("statusPanel.emptySubagents")}
      </div>
    );
  }
  return (
    <div className="sp-subagent-list flex flex-col gap-0.5">
      {subagents.map((agent) => {
        const Icon = STATUS_ICON[agent.status] ?? Loader2;
        const isInteractive = Boolean(agent.navigationTarget && onSelectSubagent);
        const className = `sp-subagent-item sp-subagent-${agent.status}${
          isInteractive ? " is-clickable " + CLICKABLE_FOCUS_CLASS : ""
        } ${BASE_ITEM_CLASS}`;
        const content = (
          <>
            <span
              className={`sp-subagent-icon shrink-0 flex items-center ${STATUS_ICON_CLASS[agent.status]}`}
            >
              <Icon size={14} />
            </span>
            <span className="sp-subagent-type text-[10px] font-semibold uppercase tracking-wider px-1.5 py-px rounded bg-(--surface-item) text-(--text-muted) shrink-0">
              {agent.type}
            </span>
            <span
              className="sp-subagent-desc text-xs text-(--text-strong) overflow-hidden text-ellipsis whitespace-nowrap min-w-0"
              title={agent.description}
            >
              {agent.description}
            </span>
          </>
        );
        return (
          isInteractive ? (
            <button
              key={agent.id}
              type="button"
              className={className}
              onClick={() => onSelectSubagent?.(agent)}
            >
              {content}
            </button>
          ) : (
            <div
              key={agent.id}
              className={className}
            >
              {content}
            </div>
          )
        );
      })}
    </div>
  );
});
