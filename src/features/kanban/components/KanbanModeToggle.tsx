import { useTranslation } from "react-i18next";
import MessageSquare from "lucide-react/dist/esm/icons/message-square";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import type { AppMode } from "../../../types";

type KanbanModeToggleProps = {
  appMode: AppMode;
  onAppModeChange: (mode: AppMode) => void;
};

export function KanbanModeToggle({
  appMode,
  onAppModeChange,
}: KanbanModeToggleProps) {
  const { t } = useTranslation();

  const btnBase =
    "kanban-mode-btn inline-flex items-center gap-[5px] h-7 px-3 border border-transparent bg-transparent rounded-md cursor-pointer text-[var(--text-tertiary,#999)] text-[13px] font-medium leading-none whitespace-nowrap transition-[background,color,border-color] duration-150 hover:text-[var(--text-secondary,#666)] [&_svg]:block [&_svg]:shrink-0";
  const btnActive =
    "is-active bg-[var(--bg-primary,#fff)] text-[var(--text-primary,#333)] border-[var(--border-color,#e0e0e0)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]";

  return (
    <div className="kanban-mode-toggle inline-flex items-center gap-0.5 bg-[var(--bg-tertiary,#f0f0f0)] rounded-lg p-[3px]">
      <button
        className={`${btnBase} ${appMode === "chat" ? btnActive : ""}`}
        onClick={() => onAppModeChange("chat")}
        title={t("kanban.mode.chat")}
        aria-label={t("kanban.mode.chat")}
        data-tauri-drag-region="false"
      >
        <span className="kanban-mode-label shrink-0">
          {t("kanban.mode.chatShort")}
        </span>
        <MessageSquare size={13} />
      </button>
      <button
        className={`${btnBase} ${appMode === "kanban" ? btnActive : ""}`}
        onClick={() => onAppModeChange("kanban")}
        title={t("kanban.mode.kanban")}
        aria-label={t("kanban.mode.kanban")}
        data-tauri-drag-region="false"
      >
        <span className="kanban-mode-label shrink-0">
          {t("kanban.mode.kanbanShort")}
        </span>
        <LayoutGrid size={13} />
      </button>
    </div>
  );
}
