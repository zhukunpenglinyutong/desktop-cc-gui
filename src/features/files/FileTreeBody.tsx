import { useCallback, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useFilesStore } from "./store";
import { TreeRow, type VisibleNode } from "./FileTreeRow";
import { useChatStore } from "@/features/chat/store";

interface FileTreeBodyProps {
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  visible: VisibleNode[];
  onContextMenu: (event: MouseEvent<HTMLElement>, node: VisibleNode) => void;
}

/**
 * Tree body: the root error / loading / empty states, or the virtualized
 * rows once a root listing is available.
 */
export function FileTreeBody({ virtualizer, visible, onContextMenu }: FileTreeBodyProps) {
  const { t } = useTranslation();
  const root = useFilesStore((s) => s.root);
  const dirErrors = useFilesStore((s) => s.dirErrors);
  const loadingDirs = useFilesStore((s) => s.loadingDirs);
  const selectedPath = useFilesStore((s) => s.selectedPath);
  const ensureDir = useFilesStore((s) => s.ensureDir);
  const toggleDir = useFilesStore((s) => s.toggleDir);
  const selectPath = useFilesStore((s) => s.selectPath);
  const openFile = useFilesStore((s) => s.openFile);

  // Hover "+" on a row: insert an @path mention into the active chat's
  // composer (renders there as an inline chip). Files and folders alike.
  const handleMention = useCallback(
    (path: string) => useChatStore.getState().requestMention(path),
    [],
  );

  const rootError = root ? dirErrors[root] : undefined;
  const rootLoading = root ? !!loadingDirs[root] : false;

  if (rootError) {
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-2">
        <p className="text-caption-1-regular text-text-error-primary break-all">{rootError}</p>
        <button
          type="button"
          onClick={() => void ensureDir(root)}
          className="text-caption-1-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
        >
          {t("common.refresh")}
        </button>
      </div>
    );
  }
  if (rootLoading && visible.length === 0) {
    return (
      <p className="px-3 py-2 text-caption-1-regular text-text-tertiary">{t("common.loading")}</p>
    );
  }
  if (visible.length === 0) {
    return (
      <p className="px-3 py-2 text-caption-1-regular text-text-tertiary">{t("files.emptyTree")}</p>
    );
  }
  return (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((vi) => {
        const node = visible[vi.index];
        // Sub-directory load error (§5 inline error): expanding a directory
        // that `list_dir` rejects (EACCES / outside boundary) used to fail
        // silently — the tree only rendered the root-level error.
        const nodeError = node.isDir ? dirErrors[node.path] : undefined;
        return (
          <div
            key={node.path}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
            }}
            className="px-1"
          >
            <TreeRow
              node={node}
              selected={selectedPath === node.path}
              isRoot={node.path === root}
              onToggleDir={toggleDir}
              onOpenFile={openFile}
              onSelectDir={selectPath}
              onContextMenu={onContextMenu}
              onMention={handleMention}
              mentionLabel={t("files.addToChat")}
            />
            {nodeError ? (
              <div
                role="alert"
                className="flex flex-col items-start gap-1 py-1 pr-2"
                style={{ paddingLeft: 14 + (node.depth + 1) * 14 }}
              >
                <p className="text-caption-1-regular text-text-error-primary break-all">
                  {nodeError}
                </p>
                <button
                  type="button"
                  onClick={() => void ensureDir(node.path)}
                  className="text-caption-1-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
                >
                  {t("common.refresh")}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
