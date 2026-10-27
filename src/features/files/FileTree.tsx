import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronsDown from "lucide-react/dist/esm/icons/chevrons-down";
import ChevronsUp from "lucide-react/dist/esm/icons/chevrons-up";
import Filter from "lucide-react/dist/esm/icons/filter";
import { useFilesStore } from "./store";
import { useFileTreeVirtualList } from "./useFileTreeVirtualList";
import { useFileTreeOperations } from "./useFileTreeOperations";
import { FileTreeBody } from "./FileTreeBody";
import { FileTreeOverlays } from "./FileTreeOverlays";
import { FileTreeFilterPanel } from "./FileTreeFilterPanel";

export function FileTree() {
  const { t } = useTranslation();
  const { parentRef, virtualizer, visible } = useFileTreeVirtualList();
  const ops = useFileTreeOperations();
  const expandLoadedDirs = useFilesStore((s) => s.expandLoadedDirs);
  const collapseAllDirs = useFilesStore((s) => s.collapseAllDirs);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);
  const closeFilter = () => {
    setFilterOpen(false);
    filterButtonRef.current?.focus();
  };

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.target instanceof HTMLElement && event.target.closest("input, textarea, [contenteditable]")) return;
        if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "ArrowRight") expandLoadedDirs();
        else if (event.key === "ArrowLeft") collapseAllDirs();
        else return;
        event.preventDefault();
      }}
    >
      <div className="flex h-8 shrink-0 items-center justify-end gap-1 px-2">
        <button type="button" aria-label={t("files.expandLoadedFolders")} title={t("files.expandLoadedFolders")} aria-keyshortcuts="Alt+Shift+ArrowRight" onClick={expandLoadedDirs} className="flex size-6 items-center justify-center rounded text-foreground-icon-tertiary hover:bg-background-primary-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-border-focus-ring">
          <ChevronsDown className="size-4" aria-hidden />
        </button>
        <button type="button" aria-label={t("files.collapseAllFolders")} title={t("files.collapseAllFolders")} aria-keyshortcuts="Alt+Shift+ArrowLeft" onClick={collapseAllDirs} className="flex size-6 items-center justify-center rounded text-foreground-icon-tertiary hover:bg-background-primary-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-border-focus-ring">
          <ChevronsUp className="size-4" aria-hidden />
        </button>
        <button ref={filterButtonRef} type="button" aria-label={t("files.filterRules")} title={t("files.filterRules")} aria-expanded={filterOpen} onClick={() => setFilterOpen((open) => !open)} className="flex size-6 items-center justify-center rounded text-foreground-icon-tertiary hover:bg-background-primary-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-border-focus-ring">
          <Filter className="size-4" aria-hidden />
        </button>
      </div>
      {filterOpen && <FileTreeFilterPanel onClose={closeFilter} />}
      <div ref={parentRef} className="min-h-0 flex-1 overflow-auto py-1">
        <FileTreeBody
          virtualizer={virtualizer}
          visible={visible}
          onContextMenu={ops.openContextMenu}
        />
        <FileTreeOverlays ops={ops} />
      </div>
    </div>
  );
}
