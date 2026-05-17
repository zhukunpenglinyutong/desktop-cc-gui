import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import CircleCheckBig from "lucide-react/dist/esm/icons/circle-check-big";
import Expand from "lucide-react/dist/esm/icons/expand";
import Minus from "lucide-react/dist/esm/icons/minus";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import Plus from "lucide-react/dist/esm/icons/plus";
import SquarePen from "lucide-react/dist/esm/icons/square-pen";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import FileIcon from "../../../components/FileIcon";
import { GitDiffPanelSectionActions } from "./GitDiffPanelSectionActions";
import {
  type InclusionState,
  InclusionToggle,
  getFileInclusionState,
  normalizeDiffPath,
} from "./GitDiffPanelInclusion";

export type DiffFile = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
};

export const TREE_INDENT_STEP = 10;

function splitPath(path: string) {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) {
    return { name: "", dir: "" };
  }
  if (parts.length === 1) {
    return { name: parts[0] ?? "", dir: "" };
  }
  return { name: parts[parts.length - 1], dir: parts.slice(0, -1).join("/") };
}

export function getTreeLineOpacity(depth: number): string {
  return depth === 1 ? "1" : "0";
}

function splitNameAndExtension(name: string) {
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { base: name, extension: "" };
  }
  return {
    base: name.slice(0, lastDot),
    extension: name.slice(lastDot + 1).toLowerCase(),
  };
}

function getStatusSymbol(status: string) {
  switch (status) {
    case "A":
      return "(A)";
    case "M":
      return "(U)";
    case "D":
      return "(D)";
    case "R":
      return "(R)";
    case "T":
      return "(T)";
    default:
      return "(?)";
  }
}

function getStatusClass(status: string) {
  switch (status) {
    case "A":
      return "diff-icon-added";
    case "M":
      return "diff-icon-modified";
    case "D":
      return "diff-icon-deleted";
    case "R":
      return "diff-icon-renamed";
    case "T":
      return "diff-icon-typechange";
    default:
      return "diff-icon-unknown";
  }
}

type DiffFileRowProps = {
  file: DiffFile;
  isSelected: boolean;
  isActive: boolean;
  section: "staged" | "unstaged";
  inclusionState: InclusionState;
  inclusionDisabled?: boolean;
  indentLevel?: number;
  showDirectory?: boolean;
  treeItem?: boolean;
  treeDepth?: number;
  treeParentFolderKey?: string;
  onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeySelect: () => void;
  onOpenInlinePreview?: () => void;
  onOpenPreview?: () => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onDiscardFile?: (path: string) => Promise<void> | void;
  onSetCommitSelection?: (paths: string[], selected: boolean) => void;
};

export function DiffFileRow({
  file,
  isSelected,
  isActive,
  section,
  inclusionState,
  inclusionDisabled = false,
  indentLevel = 0,
  showDirectory = true,
  treeItem = false,
  treeDepth = 1,
  treeParentFolderKey,
  onClick,
  onKeySelect,
  onOpenInlinePreview,
  onOpenPreview,
  onContextMenu,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onSetCommitSelection,
}: DiffFileRowProps) {
  const { t } = useTranslation();
  const { name, dir } = splitPath(file.path);
  const { base, extension } = splitNameAndExtension(name ?? "");
  const statusSymbol = getStatusSymbol(file.status);
  const statusClass = getStatusClass(file.status);
  const showStage = section === "unstaged" && Boolean(onStageFile);
  const showUnstage = section === "staged" && Boolean(onUnstageFile);
  const showDiscard = section === "unstaged" && Boolean(onDiscardFile);
  const inclusionLabel = t("git.commitSelectionToggleFile", { path: file.path });
  const treeIndentPx = indentLevel * TREE_INDENT_STEP;
  const treeRowStyle = treeItem
    ? ({
        paddingLeft: `${treeIndentPx}px`,
        ["--git-tree-indent-x" as string]: `${Math.max(treeIndentPx - 5, 0)}px`,
        ["--git-tree-line-opacity" as string]: getTreeLineOpacity(treeDepth - 1),
      } as CSSProperties)
    : undefined;

  return (
    <div
      className={`diff-row git-filetree-row ${isActive ? "active" : ""} ${isSelected ? "selected" : ""}`}
      style={treeRowStyle}
      data-section={section}
      data-status={file.status}
      data-path={file.path}
      data-tree-depth={treeItem ? treeDepth : undefined}
      data-parent-folder-key={treeItem ? treeParentFolderKey : undefined}
      role={treeItem ? "treeitem" : "button"}
      tabIndex={0}
      aria-label={file.path}
      aria-selected={isActive}
      aria-level={treeItem ? treeDepth : undefined}
      onClick={onClick}
      onKeyDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button")) {
          return;
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onKeySelect();
        }
      }}
      onDoubleClick={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest("button")) {
          return;
        }
        onOpenPreview?.();
      }}
      onContextMenu={onContextMenu}
    >
      <InclusionToggle
        state={inclusionState}
        label={inclusionLabel}
        className="diff-row-selection"
        disabled={inclusionDisabled}
        stopPropagation
        onToggle={() => {
          void onSetCommitSelection?.([file.path], inclusionState !== "all");
        }}
      />
      <span className={`diff-icon ${statusClass}`} aria-hidden>
        {statusSymbol}
      </span>
      <span className="diff-file-icon" aria-hidden>
        <FileIcon filePath={file.path} />
      </span>
      <div className="diff-file">
        <div className="diff-path">
          <span className="diff-name">
            <span className="diff-name-base">{base}</span>
            {extension && <span className="diff-name-ext">.{extension}</span>}
          </span>
        </div>
        {showDirectory && dir && <div className="diff-dir">{dir}</div>}
      </div>
      <div className="diff-row-meta">
        <span
          className="diff-counts-inline git-filetree-badge"
          aria-label={`+${file.additions} -${file.deletions}`}
        >
          <span className="diff-add">+{file.additions}</span>
          <span className="diff-sep">/</span>
          <span className="diff-del">-{file.deletions}</span>
        </span>
        <div className="diff-row-actions" role="group" aria-label={t("git.fileActions")}>
          {onOpenInlinePreview ? (
            <button
              type="button"
              className="diff-row-action diff-row-action--preview-inline"
              onClick={(event) => {
                event.stopPropagation();
                onOpenInlinePreview();
              }}
              data-tooltip={t("git.previewInline")}
              aria-label={t("git.previewInlineAction")}
            >
              <PanelRightOpen size={12} aria-hidden />
            </button>
          ) : null}
          {onOpenPreview ? (
            <button
              type="button"
              className="diff-row-action diff-row-action--preview-modal"
              onClick={(event) => {
                event.stopPropagation();
                onOpenPreview();
              }}
              data-tooltip={t("git.previewModal")}
              aria-label={t("git.previewModalAction")}
            >
              <Expand size={12} aria-hidden />
            </button>
          ) : null}
          {showStage && (
            <button
              type="button"
              className="diff-row-action diff-row-action--stage"
              onClick={(event) => {
                event.stopPropagation();
                void onStageFile?.(file.path);
              }}
              data-tooltip={t("git.stageChanges")}
              aria-label={t("git.stageFile")}
            >
              <Plus size={12} aria-hidden />
            </button>
          )}
          {showUnstage && (
            <button
              type="button"
              className="diff-row-action diff-row-action--unstage"
              onClick={(event) => {
                event.stopPropagation();
                void onUnstageFile?.(file.path);
              }}
              data-tooltip={t("git.unstageChanges")}
              aria-label={t("git.unstageFile")}
            >
              <Minus size={12} aria-hidden />
            </button>
          )}
          {showDiscard && (
            <button
              type="button"
              className="diff-row-action diff-row-action--discard"
              onClick={(event) => {
                event.stopPropagation();
                void onDiscardFile?.(file.path);
              }}
              data-tooltip={t("git.discardChanges")}
              aria-label={t("git.discardChange")}
            >
              <Undo2 size={12} aria-hidden />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export type DiffSectionProps = {
  title: string;
  files: DiffFile[];
  section: "staged" | "unstaged";
  includedPaths: string[];
  excludedPaths: string[];
  partialPaths: string[];
  rootFolderName?: string;
  leadingMeta?: ReactNode;
  compactHeader?: boolean;
  selectedFiles: Set<string>;
  selectedPath: string | null;
  onSelectFile?: (path: string | null) => void;
  onStageAllChanges?: () => Promise<void> | void;
  onStageFile?: (path: string) => Promise<void> | void;
  onUnstageFile?: (path: string) => Promise<void> | void;
  onDiscardFile?: (path: string) => Promise<void> | void;
  onDiscardFiles?: (paths: string[]) => Promise<void> | void;
  isCommitPathLocked?: (path: string) => boolean;
  onSetCommitSelection?: (paths: string[], selected: boolean) => void;
  onFileClick: (
    event: ReactMouseEvent<HTMLDivElement>,
    path: string,
    section: "staged" | "unstaged",
  ) => void;
  onOpenInlinePreview?: (path: string) => void;
  onOpenFilePreview?: (
    file: DiffFile,
    section: "staged" | "unstaged",
  ) => void;
  onShowFileMenu: (
    event: ReactMouseEvent<HTMLDivElement>,
    path: string,
    section: "staged" | "unstaged",
  ) => void;
};

export function renderSectionIndicator(
  section: "staged" | "unstaged",
  count: number,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const label = section === "staged" ? t("git.staged") : t("git.unstaged");
  const Icon = section === "staged" ? CircleCheckBig : SquarePen;
  return (
    <span
      className={`diff-section-indicator is-${section}`}
      aria-label={`${label} (${count})`}
      title={label}
    >
      <Icon size={12} aria-hidden />
      <strong>{count}</strong>
    </span>
  );
}

export function DiffSection({
  title,
  files,
  section,
  includedPaths,
  excludedPaths,
  partialPaths,
  rootFolderName,
  leadingMeta,
  compactHeader = false,
  selectedFiles,
  selectedPath,
  onSelectFile,
  onStageAllChanges,
  onStageFile,
  onUnstageFile,
  onDiscardFile,
  onDiscardFiles,
  isCommitPathLocked,
  onSetCommitSelection,
  onFileClick,
  onOpenInlinePreview,
  onOpenFilePreview,
  onShowFileMenu,
}: DiffSectionProps) {
  const { t } = useTranslation();
  const normalizedIncludedPaths = useMemo(
    () => includedPaths.map((path) => normalizeDiffPath(path)),
    [includedPaths],
  );
  const normalizedExcludedPaths = useMemo(
    () => excludedPaths.map((path) => normalizeDiffPath(path)),
    [excludedPaths],
  );
  const normalizedPartialPaths = useMemo(
    () => partialPaths.map((path) => normalizeDiffPath(path)),
    [partialPaths],
  );
  const includedPathSet = useMemo(
    () => new Set(normalizedIncludedPaths),
    [normalizedIncludedPaths],
  );
  const excludedPathSet = useMemo(
    () => new Set(normalizedExcludedPaths),
    [normalizedExcludedPaths],
  );
  const partialPathSet = useMemo(
    () => new Set(normalizedPartialPaths),
    [normalizedPartialPaths],
  );
  const filePaths = useMemo(() => files.map((file) => file.path), [files]);
  const toggleableFilePaths = useMemo(
    () =>
      files
        .map((file) => file.path)
        .filter((path) => !isCommitPathLocked?.(path)),
    [files, isCommitPathLocked],
  );
  const sectionInclusionState = useMemo(() => {
    if (files.length === 0) {
      return "none";
    }
    const fileStates = files.map((file) =>
      getFileInclusionState(
        file.path,
        includedPathSet,
        excludedPathSet,
        partialPathSet,
      ),
    );
    if (fileStates.every((state) => state === "all")) {
      return "all";
    }
    if (fileStates.every((state) => state === "none")) {
      return "none";
    }
    return "partial";
  }, [excludedPathSet, files, includedPathSet, partialPathSet]);
  const showSectionActions =
    toggleableFilePaths.length > 0 || filePaths.length > 0;
  const showCompactRoot = compactHeader && Boolean(rootFolderName?.trim());

  return (
    <div className={`diff-section git-filetree-section diff-section--${section}`}>
      <div
        className={`diff-section-title diff-section-title--row git-filetree-section-header flex items-center justify-between gap-2 text-xs text-(--text-secondary) tracking-[0.01em] pt-px px-1 pb-0 font-semibold normal-case${
          compactHeader ? " is-compact" : ""
        }`}
      >
        {showCompactRoot ? (
          <span className="diff-tree-summary-root is-static">
            <span className="diff-tree-summary-root-toggle" aria-hidden>
              <span className="diff-tree-folder-spacer w-(--git-filetree-icon-size) h-(--git-filetree-icon-size)" />
            </span>
            <FileIcon
              filePath={rootFolderName ?? ""}
              isFolder
              isOpen={false}
              className="diff-tree-summary-root-icon"
            />
            <span className="diff-tree-summary-root-name">{rootFolderName}</span>
          </span>
        ) : null}
        <span className="diff-tree-summary-section-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--text-secondary) inline-flex items-center leading-none [flex:0_1_auto]">
          {renderSectionIndicator(section, files.length, t)}
        </span>
        {leadingMeta ? (
          <span className="diff-tree-summary-meta inline-flex items-center gap-1.5 whitespace-nowrap flex-none">{leadingMeta}</span>
        ) : null}
        {showSectionActions && (
          <GitDiffPanelSectionActions
            title={title}
            section={section}
            sectionInclusionState={sectionInclusionState}
            toggleableFilePaths={toggleableFilePaths}
            filePaths={filePaths}
            onSetCommitSelection={onSetCommitSelection}
            onStageAllChanges={onStageAllChanges}
            onStageFile={onStageFile}
            onUnstageFile={onUnstageFile}
            onDiscardFiles={onDiscardFiles}
          />
        )}
      </div>
      <div className="diff-section-list git-filetree-list">
        {files.map((file) => {
          const isSelected =
            selectedFiles.size > 1 && selectedFiles.has(file.path);
          const isActive = selectedPath === file.path;
          return (
            <DiffFileRow
              key={`${section}-${file.path}`}
              file={file}
              isSelected={isSelected}
              isActive={isActive}
              section={section}
              inclusionState={getFileInclusionState(
                file.path,
                includedPathSet,
                excludedPathSet,
                partialPathSet,
              )}
              inclusionDisabled={Boolean(isCommitPathLocked?.(file.path))}
              onClick={(event) => onFileClick(event, file.path, section)}
              onKeySelect={() => onSelectFile?.(file.path)}
              onOpenInlinePreview={() => onOpenInlinePreview?.(file.path)}
              onOpenPreview={() => onOpenFilePreview?.(file, section)}
              onContextMenu={(event) =>
                onShowFileMenu(event, file.path, section)
              }
              onStageFile={onStageFile}
              onUnstageFile={onUnstageFile}
              onDiscardFile={onDiscardFile}
              onSetCommitSelection={onSetCommitSelection}
            />
          );
        })}
      </div>
    </div>
  );
}
