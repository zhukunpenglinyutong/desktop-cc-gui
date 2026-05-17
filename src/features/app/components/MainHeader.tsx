import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Search from "lucide-react/dist/esm/icons/search";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { BranchInfo, OpenAppTarget, WorkspaceInfo } from "../../../types";
import type { FocusEvent, ReactNode } from "react";
import { OpenAppMenu } from "./OpenAppMenu";
import { LaunchScriptButton } from "./LaunchScriptButton";
import { LaunchScriptEntryButton } from "./LaunchScriptEntryButton";
import type { WorkspaceLaunchScriptsState } from "../hooks/useWorkspaceLaunchScripts";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxPrimitive,
} from "@/components/ui/combobox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type WorkspaceGroupSection = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

const PROJECT_DETAILS_HIDE_DELAY_MS = 600;

type MainHeaderProps = {
  workspace: WorkspaceInfo;
  parentName?: string | null;
  worktreeLabel?: string | null;
  disableBranchMenu?: boolean;
  parentPath?: string | null;
  worktreePath?: string | null;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  branchName: string;
  branches: BranchInfo[];
  onCheckoutBranch: (name: string) => Promise<void> | void;
  onCreateBranch: (name: string) => Promise<void> | void;
  sessionTabsNode?: ReactNode;
  canCopyThread?: boolean;
  onCopyThread?: () => void | Promise<void>;
  onLockPanel?: () => void;
  extraActionsNode?: ReactNode;
  launchScript?: string | null;
  launchScriptEditorOpen?: boolean;
  launchScriptDraft?: string;
  launchScriptSaving?: boolean;
  launchScriptError?: string | null;
  onRunLaunchScript?: () => void;
  onOpenLaunchScriptEditor?: () => void;
  onCloseLaunchScriptEditor?: () => void;
  onLaunchScriptDraftChange?: (value: string) => void;
  onSaveLaunchScript?: () => void;
  launchScriptsState?: WorkspaceLaunchScriptsState;
  showLaunchScriptControls?: boolean;
  showOpenAppMenu?: boolean;
  worktreeRename?: {
    name: string;
    error: string | null;
    notice: string | null;
    isSubmitting: boolean;
    isDirty: boolean;
    upstream?: {
      oldBranch: string;
      newBranch: string;
      error: string | null;
      isSubmitting: boolean;
      onConfirm: () => void;
    } | null;
    onFocus: () => void;
    onChange: (value: string) => void;
    onCancel: () => void;
    onCommit: () => void;
  };
  groupedWorkspaces?: WorkspaceGroupSection[];
  activeWorkspaceId?: string | null;
  onSelectWorkspace?: (workspaceId: string) => void;
};

export function MainHeader({
  workspace,
  parentName = null,
  worktreeLabel = null,
  disableBranchMenu = false,
  parentPath = null,
  worktreePath = null,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  branchName,
  branches,
  onCheckoutBranch,
  onCreateBranch,
  sessionTabsNode,
  canCopyThread: _canCopyThread = false,
  onCopyThread: _onCopyThread,
  onLockPanel: _onLockPanel,
  extraActionsNode,
  launchScript = null,
  launchScriptEditorOpen = false,
  launchScriptDraft = "",
  launchScriptSaving = false,
  launchScriptError = null,
  onRunLaunchScript,
  onOpenLaunchScriptEditor,
  onCloseLaunchScriptEditor,
  onLaunchScriptDraftChange,
  onSaveLaunchScript,
  launchScriptsState,
  showLaunchScriptControls = true,
  showOpenAppMenu = true,
  worktreeRename,
  groupedWorkspaces,
  activeWorkspaceId,
  onSelectWorkspace,
}: MainHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectRevealActive, setProjectRevealActive] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const infoRef = useRef<HTMLDivElement | null>(null);
  const projectMenuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameConfirmRef = useRef<HTMLButtonElement | null>(null);
  const projectRevealHideTimerRef = useRef<number | null>(null);
  const renameOnCancel = worktreeRename?.onCancel;

  // 判断是否显示项目选择菜单
  const showProjectMenu = Boolean(
    groupedWorkspaces &&
    groupedWorkspaces.length > 0 &&
    onSelectWorkspace
  );

  // 项目搜索过滤
  const trimmedProjectQuery = projectQuery.trim();
  const lowercaseProjectQuery = trimmedProjectQuery.toLowerCase();
  const filteredGroups = useMemo(() => {
    if (!groupedWorkspaces) {
      return [];
    }
    if (trimmedProjectQuery.length === 0) {
      return groupedWorkspaces;
    }
    return groupedWorkspaces
      .map((group) => ({
        ...group,
        workspaces: group.workspaces.filter((ws) =>
          ws.name.toLowerCase().includes(lowercaseProjectQuery)
        ),
      }))
      .filter((group) => group.workspaces.length > 0);
  }, [groupedWorkspaces, lowercaseProjectQuery, trimmedProjectQuery]);

  const trimmedQuery = branchQuery.trim();
  const lowercaseQuery = trimmedQuery.toLowerCase();
  const filteredBranches = useMemo(
    () =>
      trimmedQuery.length > 0
        ? branches.filter((branch) =>
            branch.name.toLowerCase().includes(lowercaseQuery),
          )
        : branches.slice(0, 12),
    [branches, lowercaseQuery, trimmedQuery],
  );
  const exactMatch = useMemo(
    () =>
      trimmedQuery
        ? branches.find((branch) => branch.name === trimmedQuery) ?? null
        : null,
    [branches, trimmedQuery],
  );
  const canCreate = trimmedQuery.length > 0 && !exactMatch;
  const branchValidationMessage = useMemo(() => {
    if (trimmedQuery.length === 0) {
      return null;
    }
    if (trimmedQuery === "." || trimmedQuery === "..") {
      return t("workspace.branchCannotBeDot");
    }
    if (/\s/.test(trimmedQuery)) {
      return t("workspace.branchCannotContainSpaces");
    }
    if (trimmedQuery.startsWith("/") || trimmedQuery.endsWith("/")) {
      return t("workspace.branchCannotStartEndSlash");
    }
    if (trimmedQuery.endsWith(".lock")) {
      return t("workspace.branchCannotEndLock");
    }
    if (trimmedQuery.includes("..")) {
      return t("workspace.branchCannotContainDotDot");
    }
    if (trimmedQuery.includes("@{")) {
      return t("workspace.branchCannotContainAtBrace");
    }
    const invalidChars = ["~", "^", ":", "?", "*", "[", "\\"];
    if (invalidChars.some((char) => trimmedQuery.includes(char))) {
      return t("workspace.branchContainsInvalidChars");
    }
    if (trimmedQuery.endsWith(".")) {
      return t("workspace.branchCannotEndDot");
    }
    return null;
  }, [trimmedQuery, t]);
  const resolvedWorktreePath = worktreePath ?? workspace.path;
  const relativeWorktreePath = useMemo(() => {
    if (!parentPath) {
      return resolvedWorktreePath;
    }
    return resolvedWorktreePath.startsWith(`${parentPath}/`)
      ? resolvedWorktreePath.slice(parentPath.length + 1)
      : resolvedWorktreePath;
  }, [parentPath, resolvedWorktreePath]);
  const cdCommand = useMemo(
    () => `cd "${relativeWorktreePath}"`,
    [relativeWorktreePath],
  );

  // 处理项目选择
  const handleSelectProject = (workspaceId: string) => {
    if (onSelectWorkspace) {
      onSelectWorkspace(workspaceId);
      setProjectMenuOpen(false);
      setProjectQuery("");
    }
  };
  const clearProjectRevealHideTimer = () => {
    if (projectRevealHideTimerRef.current !== null) {
      window.clearTimeout(projectRevealHideTimerRef.current);
      projectRevealHideTimerRef.current = null;
    }
  };
  const showProjectDetails = () => {
    clearProjectRevealHideTimer();
    setProjectRevealActive(true);
  };
  const scheduleHideProjectDetails = () => {
    clearProjectRevealHideTimer();
    projectRevealHideTimerRef.current = window.setTimeout(() => {
      setProjectRevealActive(false);
      projectRevealHideTimerRef.current = null;
    }, PROJECT_DETAILS_HIDE_DELAY_MS);
  };
  const handleProjectScopeBlur = (
    event: FocusEvent<HTMLDivElement>,
  ) => {
    const nextTarget = event.relatedTarget as Node | null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) {
      return;
    }
    scheduleHideProjectDetails();
  };
  const isProjectDetailVisible =
    !showProjectMenu || projectRevealActive || projectMenuOpen || menuOpen || infoOpen;

  useEffect(() => {
    if (!infoOpen && renameOnCancel) {
      renameOnCancel();
    }
  }, [infoOpen, renameOnCancel]);

  useEffect(() => () => {
    clearProjectRevealHideTimer();
  }, []);

  return (
    <header
      className={`main-header w-full flex justify-between items-center gap-4 min-w-0 [-webkit-app-region:drag] **:select-none [&_input]:select-text [&_textarea]:select-text [&_[contenteditable=true]]:select-text${sessionTabsNode ? " has-session-tabs gap-2.5" : ""}`}
      data-tauri-drag-region
    >
      <div className="workspace-header flex items-center min-w-0 flex-1">
        <div
          className={`workspace-title-line flex items-center gap-2 min-w-0 whitespace-nowrap flex-1${
            showProjectMenu ? " has-project-menu" : ""
          }${isProjectDetailVisible ? " is-project-detail-visible" : ""}`}
          onMouseEnter={() => {
            if (showProjectMenu) {
              showProjectDetails();
            }
          }}
          onMouseLeave={() => {
            if (showProjectMenu) {
              scheduleHideProjectDetails();
            }
          }}
          onFocusCapture={() => {
            if (showProjectMenu) {
              showProjectDetails();
            }
          }}
          onBlurCapture={(event) => {
            if (!showProjectMenu) {
              return;
            }
            handleProjectScopeBlur(event);
          }}
        >
          {showProjectMenu ? (
            <div
              className="workspace-project-menu relative inline-flex items-center min-w-0"
              ref={projectMenuRef}
              onFocusCapture={showProjectDetails}
              onBlurCapture={handleProjectScopeBlur}
            >
              <Combobox
                value={activeWorkspaceId ?? null}
                onValueChange={(next) => {
                  if (typeof next === "string") {
                    handleSelectProject(next);
                  }
                }}
                open={projectMenuOpen}
                onOpenChange={(open) => {
                  setProjectMenuOpen(open);
                  if (!open) {
                    setProjectQuery("");
                  } else if (menuOpen) {
                    setMenuOpen(false);
                  }
                }}
                onInputValueChange={(value) => setProjectQuery(value)}
              >
                <ComboboxPrimitive.Trigger
                  className="workspace-project-button inline-flex items-center gap-1 bg-transparent border-none cursor-pointer py-0.5 px-1 rounded-md min-w-0 hover:bg-(--surface-control-hover) outline-none"
                  aria-label={parentName ? parentName : workspace.name}
                  data-tauri-drag-region="false"
                >
                  <span
                    className="workspace-project-icon inline-flex items-center justify-center text-(--text-muted) shrink-0"
                    aria-hidden
                  >
                    <Folder size={14} />
                  </span>
                  <span className="workspace-title text-[15px] font-semibold tracking-[0.2px] max-w-[min(32vw,420px)] overflow-hidden text-ellipsis whitespace-nowrap">
                    {parentName ? parentName : workspace.name}
                  </span>
                  <span
                    className="workspace-project-caret text-(--text-faint) text-xs shrink-0 leading-none"
                    aria-hidden
                  >
                    ›
                  </span>
                </ComboboxPrimitive.Trigger>
                <ComboboxPopup
                  className="workspace-project-dropdown"
                  side="bottom"
                  align="start"
                  sideOffset={6}
                  data-tauri-drag-region="false"
                >
                  <div className="p-1">
                    <ComboboxInput
                      placeholder={t("workspace.searchProjects")}
                      startAddon={<Search />}
                      showTrigger={false}
                      aria-label={t("workspace.searchProjects")}
                      data-tauri-drag-region="false"
                    />
                  </div>
                  <ComboboxList>
                    <ComboboxEmpty>
                      {t("workspace.noProjectsFound")}
                    </ComboboxEmpty>
                    {filteredGroups.map((group) => (
                      <ComboboxGroup key={group.id ?? "ungrouped"}>
                        {group.name ? (
                          <ComboboxGroupLabel>{group.name}</ComboboxGroupLabel>
                        ) : null}
                        {group.workspaces.map((ws) => (
                          <ComboboxItem key={ws.id} value={ws.id}>
                            {ws.kind === "worktree" ? (
                              <GitBranch aria-hidden />
                            ) : (
                              <Folder aria-hidden />
                            )}
                            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                              {ws.kind === "worktree"
                                ? (ws.worktree?.branch ?? ws.name)
                                : ws.name}
                            </span>
                          </ComboboxItem>
                        ))}
                      </ComboboxGroup>
                    ))}
                  </ComboboxList>
                </ComboboxPopup>
              </Combobox>
            </div>
          ) : (
            <span className="workspace-title text-[15px] font-semibold tracking-[0.2px] max-w-[min(32vw,420px)] overflow-hidden text-ellipsis whitespace-nowrap">
              {parentName ? parentName : workspace.name}
            </span>
          )}
          {!showProjectMenu ? (
            <span className="workspace-separator text-(--text-faint) text-xs" aria-hidden>
              ›
            </span>
          ) : null}
          {disableBranchMenu ? (
            <div
              className="workspace-branch-static-row relative inline-flex items-center gap-1.5"
              ref={infoRef}
              onFocusCapture={showProjectDetails}
              onBlurCapture={handleProjectScopeBlur}
            >
              <Popover open={infoOpen} onOpenChange={setInfoOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="workspace-branch-static-button border border-(--border-muted) bg-(--surface-card-strong) text-(--text-stronger) rounded-full py-0.5 px-2.5 inline-flex items-center justify-center cursor-pointer text-xs font-semibold max-w-[min(44vw,520px)] overflow-hidden text-ellipsis whitespace-nowrap hover:border-(--border-strong) hover:bg-(--surface-control-hover)"
                    data-tauri-drag-region="false"
                    title={t("workspace.worktreeInfo")}
                  >
                    {worktreeLabel || branchName}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  sideOffset={8}
                  className="worktree-info-popover min-w-70 max-w-[min(360px,80vw)] z-12 rounded-[10px] p-2.5 flex flex-col gap-2 w-auto"
                >
                  {worktreeRename && (
                    <div className="worktree-info-rename flex flex-col gap-1.5">
                      <span className="worktree-info-label text-[10px] uppercase tracking-[0.08em] text-(--text-faint)">{t("common.name")}</span>
                      <div className="worktree-info-command flex items-center gap-1.5">
                        <input
                          ref={renameInputRef}
                          className="worktree-info-input border border-(--border-muted) bg-(--surface-card) text-(--text-stronger) rounded-lg py-1.5 px-2 text-xs flex-1 focus:outline-none focus:border-(--border-strong)"
                          value={worktreeRename.name}
                          onFocus={() => {
                            worktreeRename.onFocus();
                            renameInputRef.current?.select();
                          }}
                          onChange={(event) => worktreeRename.onChange(event.target.value)}
                          onBlur={(event) => {
                            const nextTarget = event.relatedTarget as Node | null;
                            if (
                              renameConfirmRef.current &&
                              nextTarget &&
                              renameConfirmRef.current.contains(nextTarget)
                            ) {
                              return;
                            }
                            if (!worktreeRename.isSubmitting && worktreeRename.isDirty) {
                              worktreeRename.onCommit();
                            }
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Escape") {
                              event.preventDefault();
                              if (!worktreeRename.isSubmitting) {
                                worktreeRename.onCancel();
                              }
                            }
                            if (event.key === "Enter" && !worktreeRename.isSubmitting) {
                              event.preventDefault();
                              worktreeRename.onCommit();
                            }
                          }}
                          data-tauri-drag-region="false"
                          disabled={worktreeRename.isSubmitting}
                        />
                        <button
                          type="button"
                          className="icon-button worktree-info-confirm border border-(--border-muted) bg-(--surface-card-strong) text-(--text-stronger) rounded-lg w-7 h-7 p-0 enabled:hover:border-(--border-strong)"
                          ref={renameConfirmRef}
                          onClick={() => worktreeRename.onCommit()}
                          disabled={
                            worktreeRename.isSubmitting || !worktreeRename.isDirty
                          }
                          aria-label={t("workspace.confirmRename")}
                          title={t("workspace.confirmRename")}
                        >
                          <Check aria-hidden />
                        </button>
                      </div>
                      {worktreeRename.error && (
                        <div className="worktree-info-error text-[11px] text-(--text-danger)">{worktreeRename.error}</div>
                      )}
                      {worktreeRename.notice && (
                        <span className="worktree-info-subtle text-wrap text-[11px] text-(--text-faint)">
                          {worktreeRename.notice}
                        </span>
                      )}
                      {worktreeRename.upstream && (
                        <div className="worktree-info-upstream flex flex-col gap-1.5">
                          <span className="worktree-info-subtle text-wrap text-[11px] text-(--text-faint)">
                            {t("workspace.updateUpstreamBranchTo", { branch: worktreeRename.upstream.newBranch })}
                          </span>
                          <button
                            type="button"
                            className="ghost worktree-info-upstream-button self-start py-1.5 px-2.5 text-xs font-semibold rounded-lg"
                            onClick={worktreeRename.upstream.onConfirm}
                            disabled={worktreeRename.upstream.isSubmitting}
                          >
                            {t("workspace.updateUpstream")}
                          </button>
                          {worktreeRename.upstream.error && (
                            <div className="worktree-info-error text-[11px] text-(--text-danger)">
                              {worktreeRename.upstream.error}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="worktree-info-title text-xs font-semibold text-(--text-stronger)">{t("workspace.worktree")}</div>
                  <div className="worktree-info-row flex flex-col gap-1">
                    <span className="worktree-info-label text-[10px] uppercase tracking-[0.08em] text-(--text-faint)">
                      {t("common.terminal")}{parentPath ? ` (${t("workspace.repoRoot")})` : ""}
                    </span>
                    <div className="worktree-info-command flex items-center gap-1.5">
                      <code className="worktree-info-code text-[11px] text-(--text-stronger) bg-(--surface-card) border border-(--border-muted) py-1.5 px-2 rounded-lg whitespace-nowrap overflow-hidden text-ellipsis flex-1">
                        {cdCommand}
                      </code>
                      <button
                        type="button"
                        className="worktree-info-copy border border-(--border-muted) bg-(--surface-card-strong) text-(--text-subtle) rounded-lg w-7 h-7 p-0 inline-flex items-center justify-center cursor-pointer hover:text-(--text-stronger) hover:border-(--border-strong) [&>svg]:w-3.5 [&>svg]:h-3.5"
                        onClick={async () => {
                          await navigator.clipboard.writeText(cdCommand);
                        }}
                        data-tauri-drag-region="false"
                        aria-label={t("workspace.copyCommand")}
                        title={t("workspace.copyCommand")}
                      >
                        <Copy aria-hidden />
                      </button>
                    </div>
                    <span className="worktree-info-subtle text-wrap text-[11px] text-(--text-faint)">
                      {t("workspace.openInTerminal")}
                    </span>
                  </div>
                  <div className="worktree-info-row flex flex-col gap-1">
                    <span className="worktree-info-label text-[10px] uppercase tracking-[0.08em] text-(--text-faint)">{t("workspace.reveal")}</span>
                    <button
                      type="button"
                      className="worktree-info-reveal border border-(--border-muted) bg-(--surface-card-strong) text-(--text-stronger) rounded-lg py-1.5 px-2.5 text-xs font-semibold cursor-pointer text-left hover:border-(--border-strong)"
                      onClick={async () => {
                        await revealItemInDir(resolvedWorktreePath);
                      }}
                      data-tauri-drag-region="false"
                    >
                      {t("workspace.revealInFinder")}
                    </button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          ) : (
            <div
              className="workspace-branch-menu relative inline-flex items-center"
              ref={menuRef}
              onFocusCapture={showProjectDetails}
              onBlurCapture={handleProjectScopeBlur}
            >
              <Combobox
                value={branchName}
                onValueChange={async (next) => {
                  if (typeof next !== "string" || next === branchName) {
                    return;
                  }
                  try {
                    await onCheckoutBranch(next);
                    setMenuOpen(false);
                    setBranchQuery("");
                    setError(null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
                open={menuOpen}
                onOpenChange={(open) => {
                  setMenuOpen(open);
                  if (!open) {
                    setBranchQuery("");
                    setError(null);
                  }
                }}
                onInputValueChange={(value) => {
                  setBranchQuery(value);
                  setError(null);
                }}
              >
                <ComboboxPrimitive.Trigger
                  className="workspace-branch-button inline-flex items-center gap-1.5 border-none bg-transparent py-0.5 px-1 rounded-md cursor-pointer text-(--text-subtle) max-w-[min(24vw,260px)] min-w-0 hover:bg-(--surface-control-hover) hover:text-(--text-stronger) outline-none"
                  aria-label={branchName}
                  data-tauri-drag-region="false"
                >
                  <span className="workspace-branch text-(--text-subtle) text-xs font-medium min-w-0 overflow-hidden text-ellipsis whitespace-nowrap block">
                    {branchName}
                  </span>
                  <span
                    className="workspace-branch-caret text-[11px] text-(--text-faint) inline-flex rotate-90 items-center leading-none mt-px"
                    aria-hidden
                  >
                    ›
                  </span>
                </ComboboxPrimitive.Trigger>
                <ComboboxPopup
                  className="workspace-branch-dropdown"
                  side="bottom"
                  align="start"
                  sideOffset={6}
                  data-tauri-drag-region="false"
                >
                  <div className="flex flex-col gap-1.5 p-1">
                    <div className="flex gap-1.5 items-center min-w-0">
                      <ComboboxInput
                        placeholder={t("workspace.searchOrCreateBranch")}
                        showTrigger={false}
                        aria-label={t("workspace.searchBranches")}
                        data-tauri-drag-region="false"
                        onKeyDown={async (event) => {
                          if (event.key !== "Enter") {
                            return;
                          }
                          if (branchValidationMessage) {
                            event.preventDefault();
                            setError(branchValidationMessage);
                            return;
                          }
                          if (canCreate) {
                            event.preventDefault();
                            try {
                              await onCreateBranch(trimmedQuery);
                              setMenuOpen(false);
                              setBranchQuery("");
                              setError(null);
                            } catch (err) {
                              setError(
                                err instanceof Error ? err.message : String(err),
                              );
                            }
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="shrink-0 rounded-md border bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground hover:bg-secondary/80 disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={!canCreate || Boolean(branchValidationMessage)}
                        onClick={async () => {
                          if (branchValidationMessage) {
                            setError(branchValidationMessage);
                            return;
                          }
                          if (!canCreate) {
                            return;
                          }
                          try {
                            await onCreateBranch(trimmedQuery);
                            setMenuOpen(false);
                            setBranchQuery("");
                            setError(null);
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : String(err),
                            );
                          }
                        }}
                        data-tauri-drag-region="false"
                      >
                        {t("common.create")}
                      </button>
                    </div>
                    {branchValidationMessage && (
                      <div className="px-2 text-[11px] text-destructive whitespace-pre-wrap">
                        {branchValidationMessage}
                      </div>
                    )}
                    {canCreate && !branchValidationMessage && (
                      <div className="px-2 text-[11px] text-muted-foreground">
                        {t("workspace.createBranchNamed", { name: trimmedQuery })}
                      </div>
                    )}
                  </div>
                  <ComboboxList>
                    <ComboboxEmpty>
                      {t("workspace.noBranchesFound")}
                    </ComboboxEmpty>
                    {filteredBranches.map((branch) => (
                      <ComboboxItem
                        key={branch.name}
                        value={branch.name}
                      >
                        {branch.name}
                      </ComboboxItem>
                    ))}
                  </ComboboxList>
                  {error ? (
                    <div className="px-2 py-1 text-[11px] text-destructive whitespace-pre-wrap">
                      {error}
                    </div>
                  ) : null}
                </ComboboxPopup>
              </Combobox>
            </div>
          )}
        </div>
      </div>
      {sessionTabsNode ? (
        <div
          className="main-header-session-tabs-slot flex items-center flex-1 min-w-0 [-webkit-app-region:no-drag]"
          data-tauri-drag-region="false"
        >
          <div
            className="main-header-session-tabs-interactive flex items-center flex-[0_1_auto] min-w-0 max-w-full [-webkit-app-region:no-drag]"
            data-tauri-drag-region="false"
          >
            {sessionTabsNode}
          </div>
          <div
            className="main-header-session-tabs-drag-lane flex-[1_1_auto] min-w-3 self-stretch [-webkit-app-region:drag]"
            data-tauri-drag-region
            aria-hidden="true"
          />
        </div>
      ) : null}
      <div className="main-header-actions flex items-center gap-0.75 [-webkit-app-region:no-drag] shrink-0">
        {showLaunchScriptControls &&
          onRunLaunchScript &&
          onOpenLaunchScriptEditor &&
          onCloseLaunchScriptEditor &&
          onLaunchScriptDraftChange &&
          onSaveLaunchScript && (
            <div className="launch-script-cluster inline-flex items-center gap-px">
              <LaunchScriptButton
                launchScript={launchScript}
                editorOpen={launchScriptEditorOpen}
                draftScript={launchScriptDraft}
                isSaving={launchScriptSaving}
                error={launchScriptError}
                onRun={onRunLaunchScript}
                onOpenEditor={onOpenLaunchScriptEditor}
                onCloseEditor={onCloseLaunchScriptEditor}
                onDraftChange={onLaunchScriptDraftChange}
                onSave={onSaveLaunchScript}
                showNew={Boolean(launchScriptsState)}
                newEditorOpen={launchScriptsState?.newEditorOpen}
                newDraftScript={launchScriptsState?.newDraftScript}
                newDraftIcon={launchScriptsState?.newDraftIcon}
                newDraftLabel={launchScriptsState?.newDraftLabel}
                newError={launchScriptsState?.newError ?? null}
                onOpenNew={launchScriptsState?.onOpenNew}
                onCloseNew={launchScriptsState?.onCloseNew}
                onNewDraftChange={launchScriptsState?.onNewDraftScriptChange}
                onNewDraftIconChange={launchScriptsState?.onNewDraftIconChange}
                onNewDraftLabelChange={launchScriptsState?.onNewDraftLabelChange}
                onCreateNew={launchScriptsState?.onCreateNew}
              />
              {launchScriptsState?.launchScripts.map((entry) => (
                <LaunchScriptEntryButton
                  key={entry.id}
                  entry={entry}
                  editorOpen={launchScriptsState.editorOpenId === entry.id}
                  draftScript={launchScriptsState.draftScript}
                  draftIcon={launchScriptsState.draftIcon}
                  draftLabel={launchScriptsState.draftLabel}
                  isSaving={launchScriptsState.isSaving}
                  error={launchScriptsState.errorById[entry.id] ?? null}
                  onRun={() => launchScriptsState.onRunScript(entry.id)}
                  onOpenEditor={() => launchScriptsState.onOpenEditor(entry.id)}
                  onCloseEditor={launchScriptsState.onCloseEditor}
                  onDraftChange={launchScriptsState.onDraftScriptChange}
                  onDraftIconChange={launchScriptsState.onDraftIconChange}
                  onDraftLabelChange={launchScriptsState.onDraftLabelChange}
                  onSave={launchScriptsState.onSaveScript}
                  onDelete={launchScriptsState.onDeleteScript}
                />
              ))}
            </div>
          )}
        {showOpenAppMenu ? (
          <OpenAppMenu
            path={resolvedWorktreePath}
            openTargets={openTargets}
            selectedOpenAppId={selectedOpenAppId}
            onSelectOpenAppId={onSelectOpenAppId}
            iconById={openAppIconById}
            iconOnly
          />
        ) : null}
        {extraActionsNode}
      </div>
    </header>
  );
}
