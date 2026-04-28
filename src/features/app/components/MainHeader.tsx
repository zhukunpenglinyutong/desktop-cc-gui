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
    if (!menuOpen && !infoOpen && !projectMenuOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const menuContains = menuRef.current?.contains(target) ?? false;
      const infoContains = infoRef.current?.contains(target) ?? false;
      const projectMenuContains = projectMenuRef.current?.contains(target) ?? false;
      if (!menuContains && !infoContains && !projectMenuContains) {
        setMenuOpen(false);
        setInfoOpen(false);
        setProjectMenuOpen(false);
        setBranchQuery("");
        setProjectQuery("");
        setError(null);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("mousedown", handleClick);
    };
  }, [infoOpen, menuOpen, projectMenuOpen]);

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
      className={`main-header${sessionTabsNode ? " has-session-tabs" : ""}`}
      data-tauri-drag-region
    >
      <div className="workspace-header">
        <div
          className={`workspace-title-line${
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
              className="workspace-project-menu"
              ref={projectMenuRef}
              onFocusCapture={showProjectDetails}
              onBlurCapture={handleProjectScopeBlur}
            >
              <button
                type="button"
                className="workspace-project-button"
                onClick={() => {
                  setProjectMenuOpen((prev) => !prev);
                  if (menuOpen) setMenuOpen(false);
                }}
                aria-haspopup="menu"
                aria-expanded={projectMenuOpen}
                data-tauri-drag-region="false"
              >
                <span className="workspace-project-icon" aria-hidden>
                  <Folder size={14} />
                </span>
                <span className="workspace-title">
                  {parentName ? parentName : workspace.name}
                </span>
                <span className="workspace-project-caret" aria-hidden>
                  ›
                </span>
              </button>
              {projectMenuOpen && (
                <div
                  className="workspace-project-dropdown popover-surface"
                  role="menu"
                  data-tauri-drag-region="false"
                >
                  <label className="workspace-project-search">
                    <span className="workspace-project-search-icon" aria-hidden>
                      <Search size={14} />
                    </span>
                    <input
                      value={projectQuery}
                      onChange={(event) => setProjectQuery(event.target.value)}
                      placeholder={t("workspace.searchProjects")}
                      className="workspace-project-search-input"
                      autoFocus
                      data-tauri-drag-region="false"
                      aria-label={t("workspace.searchProjects")}
                    />
                  </label>
                  <div className="workspace-project-list" role="none">
                    {filteredGroups.map((group) => (
                      <div key={group.id ?? "ungrouped"} className="workspace-project-group">
                        {group.name && (
                          <div className="workspace-project-group-label">{group.name}</div>
                        )}
                        {group.workspaces.map((ws) => (
                          <button
                            key={ws.id}
                            type="button"
                            className={`workspace-project-item${
                              ws.kind === "worktree" ? " is-worktree" : ""
                            }${
                              ws.id === activeWorkspaceId ? " is-active" : ""
                            }`}
                            onClick={() => handleSelectProject(ws.id)}
                            role="menuitem"
                            data-tauri-drag-region="false"
                          >
                            <span className="workspace-project-item-icon" aria-hidden>
                              {ws.kind === "worktree" ? <GitBranch size={14} /> : <Folder size={14} />}
                            </span>
                            <span className="workspace-project-item-label">
                              {ws.kind === "worktree" ? (ws.worktree?.branch ?? ws.name) : ws.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))}
                    {filteredGroups.length === 0 && (
                      <div className="workspace-project-empty">
                        {t("workspace.noProjectsFound")}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <span className="workspace-title">
              {parentName ? parentName : workspace.name}
            </span>
          )}
          {!showProjectMenu ? (
            <span className="workspace-separator" aria-hidden>
              ›
            </span>
          ) : null}
          {disableBranchMenu ? (
            <div
              className="workspace-branch-static-row"
              ref={infoRef}
              onFocusCapture={showProjectDetails}
              onBlurCapture={handleProjectScopeBlur}
            >
              <button
                type="button"
                className="workspace-branch-static-button"
                onClick={() => setInfoOpen((prev) => !prev)}
                aria-haspopup="dialog"
                aria-expanded={infoOpen}
                data-tauri-drag-region="false"
                title={t("workspace.worktreeInfo")}
              >
                {worktreeLabel || branchName}
              </button>
              {infoOpen && (
                <div className="worktree-info-popover popover-surface" role="dialog">
                  {worktreeRename && (
                    <div className="worktree-info-rename">
                      <span className="worktree-info-label">{t("common.name")}</span>
                      <div className="worktree-info-command">
                        <input
                          ref={renameInputRef}
                          className="worktree-info-input"
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
                          className="icon-button worktree-info-confirm"
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
                        <div className="worktree-info-error">{worktreeRename.error}</div>
                      )}
                      {worktreeRename.notice && (
                        <span className="worktree-info-subtle">
                          {worktreeRename.notice}
                        </span>
                      )}
                      {worktreeRename.upstream && (
                        <div className="worktree-info-upstream">
                          <span className="worktree-info-subtle">
                            {t("workspace.updateUpstreamBranchTo", { branch: worktreeRename.upstream.newBranch })}
                          </span>
                          <button
                            type="button"
                            className="ghost worktree-info-upstream-button"
                            onClick={worktreeRename.upstream.onConfirm}
                            disabled={worktreeRename.upstream.isSubmitting}
                          >
                            {t("workspace.updateUpstream")}
                          </button>
                          {worktreeRename.upstream.error && (
                            <div className="worktree-info-error">
                              {worktreeRename.upstream.error}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="worktree-info-title">{t("workspace.worktree")}</div>
                  <div className="worktree-info-row">
                    <span className="worktree-info-label">
                      {t("common.terminal")}{parentPath ? ` (${t("workspace.repoRoot")})` : ""}
                    </span>
                    <div className="worktree-info-command">
                      <code className="worktree-info-code">
                        {cdCommand}
                      </code>
                      <button
                        type="button"
                        className="worktree-info-copy"
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
                    <span className="worktree-info-subtle">
                      {t("workspace.openInTerminal")}
                    </span>
                  </div>
                  <div className="worktree-info-row">
                    <span className="worktree-info-label">{t("workspace.reveal")}</span>
                    <button
                      type="button"
                      className="worktree-info-reveal"
                      onClick={async () => {
                        await revealItemInDir(resolvedWorktreePath);
                      }}
                      data-tauri-drag-region="false"
                    >
                      {t("workspace.revealInFinder")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div
              className="workspace-branch-menu"
              ref={menuRef}
              onFocusCapture={showProjectDetails}
              onBlurCapture={handleProjectScopeBlur}
            >
              <button
                type="button"
                className="workspace-branch-button"
                onClick={() => setMenuOpen((prev) => !prev)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                data-tauri-drag-region="false"
              >
                <span className="workspace-branch">{branchName}</span>
                <span className="workspace-branch-caret" aria-hidden>
                  ›
                </span>
              </button>
              {menuOpen && (
                <div
                  className="workspace-branch-dropdown popover-surface"
                  role="menu"
                  data-tauri-drag-region="false"
                >
                  <div className="branch-actions">
                    <div className="branch-search">
                      <input
                        value={branchQuery}
                        onChange={(event) => {
                          setBranchQuery(event.target.value);
                          setError(null);
                        }}
                        onKeyDown={async (event) => {
                          if (event.key !== "Enter") {
                            return;
                          }
                          event.preventDefault();
                          if (branchValidationMessage) {
                            setError(branchValidationMessage);
                            return;
                          }
                          if (canCreate) {
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
                            return;
                          }
                          if (exactMatch && exactMatch.name !== branchName) {
                            try {
                              await onCheckoutBranch(exactMatch.name);
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
                        placeholder={t("workspace.searchOrCreateBranch")}
                        className="branch-input"
                        autoFocus
                        data-tauri-drag-region="false"
                        aria-label={t("workspace.searchBranches")}
                      />
                      <button
                        type="button"
                        className="branch-create-button"
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
                      <div className="branch-error">{branchValidationMessage}</div>
                    )}
                    {canCreate && !branchValidationMessage && (
                      <div className="branch-create-hint">
                        {t("workspace.createBranchNamed", { name: trimmedQuery })}
                      </div>
                    )}
                  </div>
                  <div className="branch-list" role="none">
                    {filteredBranches.map((branch) => (
                      <button
                        key={branch.name}
                        type="button"
                        className={`branch-item${
                          branch.name === branchName ? " is-active" : ""
                        }`}
                        onClick={async () => {
                          if (branch.name === branchName) {
                            return;
                          }
                          try {
                            await onCheckoutBranch(branch.name);
                            setMenuOpen(false);
                            setBranchQuery("");
                            setError(null);
                          } catch (err) {
                            setError(
                              err instanceof Error ? err.message : String(err),
                            );
                          }
                        }}
                        role="menuitem"
                        data-tauri-drag-region="false"
                      >
                        {branch.name}
                      </button>
                    ))}
                    {filteredBranches.length === 0 && (
                      <div className="branch-empty">{t("workspace.noBranchesFound")}</div>
                    )}
                  </div>
                  {error && <div className="branch-error">{error}</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {sessionTabsNode ? (
        <div
          className="main-header-session-tabs-slot"
          data-tauri-drag-region="false"
        >
          <div
            className="main-header-session-tabs-interactive"
            data-tauri-drag-region="false"
          >
            {sessionTabsNode}
          </div>
          <div
            className="main-header-session-tabs-drag-lane"
            data-tauri-drag-region
            aria-hidden="true"
          />
        </div>
      ) : null}
      <div className="main-header-actions">
        {showLaunchScriptControls &&
          onRunLaunchScript &&
          onOpenLaunchScriptEditor &&
          onCloseLaunchScriptEditor &&
          onLaunchScriptDraftChange &&
          onSaveLaunchScript && (
            <div className="launch-script-cluster">
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
