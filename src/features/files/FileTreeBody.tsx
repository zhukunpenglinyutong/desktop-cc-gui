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
  const roots = useFilesStore((s) => s.roots);
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

  const isRootPath = (path: string) => roots.includes(path);
  const rootErrors = roots.filter((root) => dirErrors[root]);
  const allLoading = roots.length > 0 && roots.every((root) => loadingDirs[root]);

  // 单根时保持旧行为:根出错就整体显示可恢复的错误 + 刷新,不把它折成一行。
  if (roots.length === 1 && dirErrors[roots[0]]) {
    const root = roots[0];
    return (
      <div className="flex flex-col items-start gap-2 px-3 py-2">
        <p className="text-caption-1-regular text-text-error-primary break-all">{dirErrors[root]}</p>
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

  if (visible.length === 0) {
    if (allLoading) {
      return (
        <p className="px-3 py-2 text-caption-1-regular text-text-tertiary">{t("common.loading")}</p>
      );
    }
    // 全部根都失败(且无内容):每个根各给一个可恢复的错误块。
    if (rootErrors.length > 0) {
      return (
        <div className="flex flex-col items-start gap-2 px-3 py-2">
          {rootErrors.map((root) => (
            <div key={root} className="flex flex-col items-start gap-1">
              <p className="text-caption-1-regular text-text-error-primary break-all">
                {dirErrors[root]}
              </p>
              <button
                type="button"
                onClick={() => void ensureDir(root)}
                className="text-caption-1-medium text-text-secondary underline underline-offset-2 hover:text-text-primary"
              >
                {t("common.refresh")}
              </button>
            </div>
          ))}
        </div>
      );
    }
    return (
      <p className="px-3 py-2 text-caption-1-regular text-text-tertiary">{t("files.emptyTree")}</p>
    );
  }
  return (
    <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
      {virtualizer.getVirtualItems().map((vi) => {
        const node = visible[vi.index];
        const rootError = isRootPath(node.path) ? dirErrors[node.path] : undefined;
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
              isRoot={isRootPath(node.path)}
              onToggleDir={toggleDir}
              onOpenFile={openFile}
              onSelectDir={selectPath}
              onContextMenu={onContextMenu}
              onMention={handleMention}
              mentionLabel={t("files.addToChat")}
            />
            {/* 多根下一个根(最可能是附加根)在磁盘上不存在:该根行下方给出
                可恢复的提示,其它根照常渲染,不崩溃。 */}
            {rootError ? (
              <div className="flex flex-col items-start gap-1 px-1 pb-1 pl-4">
                <p className="text-caption-1-regular text-text-error-primary break-all">
                  {rootError}
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
