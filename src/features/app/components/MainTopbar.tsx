import type { ReactNode } from "react";

type MainTopbarProps = {
  leftNode: ReactNode;
  actionsNode?: ReactNode;
  className?: string;
};

export function MainTopbar({ leftNode, actionsNode, className }: MainTopbarProps) {
  const classNames = [
    "main-topbar flex justify-between items-center px-[var(--main-panel-padding)] py-2.5 pb-2 h-[var(--main-topbar-height)] min-h-[var(--main-topbar-height)] border-b border-(--border-subtle) bg-(--surface-topbar) [-webkit-app-region:drag] sticky top-0 z-[3] backdrop-blur-[18px] backdrop-saturate-[1.2] box-border [&_input]:select-text [&_textarea]:select-text [&_[contenteditable=true]]:select-text [&_*]:select-none",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classNames} data-tauri-drag-region>
      <div className="main-topbar-left flex items-center gap-4 min-w-0 flex-1 [-webkit-app-region:no-drag]">{leftNode}</div>
      <div className="actions flex gap-3 shrink-0 [-webkit-app-region:no-drag]">{actionsNode ?? null}</div>
    </div>
  );
}
