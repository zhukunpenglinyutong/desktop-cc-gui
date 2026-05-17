import { useDeferredValue, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Folder from "lucide-react/dist/esm/icons/folder";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Search from "lucide-react/dist/esm/icons/search";
import { useTranslation } from "react-i18next";
import type { EngineType } from "../../../types";
import type { WorkspaceKind } from "../../../types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { EngineIcon } from "../../engine/components/EngineIcon";

type LatestAgentRun = {
  message: string;
  timestamp: number;
  projectName: string;
  groupName?: string | null;
  workspaceId: string;
  threadId: string;
  isProcessing: boolean;
};

type HomeChatProps = {
  latestAgentRuns: LatestAgentRun[];
  isLoadingLatestAgents: boolean;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  workspaces: Array<{
    id: string;
    name: string;
    path?: string;
    kind?: WorkspaceKind;
    worktree?: {
      branch: string;
    } | null;
  }>;
  selectedWorkspaceId?: string | null;
  onSelectWorkspace: (workspaceId: string) => void;
  onAddWorkspace?: () => void;
  composerNode?: ReactNode;
  selectedEngine?: EngineType;
  selectedBranchName?: string | null;
};

function getEngineLabel(engine: EngineType): string {
  switch (engine) {
    case "claude":
      return "Claude";
    case "gemini":
      return "Gemini";
    case "opencode":
      return "OpenCode";
    case "codex":
    default:
      return "Codex";
  }
}

export function HomeChat({
  latestAgentRuns: _latestAgentRuns,
  isLoadingLatestAgents: _isLoadingLatestAgents,
  onSelectThread: _onSelectThread,
  workspaces,
  selectedWorkspaceId = null,
  onSelectWorkspace,
  onAddWorkspace,
  composerNode,
  selectedEngine = "codex",
  selectedBranchName = null,
}: HomeChatProps) {
  const { t } = useTranslation();
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const workspacePanelId = useId();
  const workspaceSearchId = useId();
  const engineLabel = getEngineLabel(selectedEngine);
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
    ?? workspaces[0]
    ?? null;
  const deferredWorkspaceQuery = useDeferredValue(workspaceQuery.trim().toLowerCase());
  const branchLabel = selectedWorkspace
    ? selectedBranchName?.trim() || selectedWorkspace.worktree?.branch || null
    : null;
  const branchDescriptor = selectedWorkspace?.kind === "worktree"
    ? t("workspace.homeBranchLabelWorktree")
    : t("workspace.homeBranchLabelMain");
  const resolvedWorkspaceId = selectedWorkspace?.id ?? workspaces[0]?.id ?? "";
  const filteredWorkspaces = deferredWorkspaceQuery.length === 0
    ? workspaces
    : workspaces.filter((workspace) => {
      const name = workspace.name.toLowerCase();
      const path = workspace.path?.toLowerCase() ?? "";
      return name.includes(deferredWorkspaceQuery) || path.includes(deferredWorkspaceQuery);
    });

  useEffect(() => {
    if (!workspaceMenuOpen) {
      setWorkspaceQuery("");
      return;
    }

    searchInputRef.current?.focus();
  }, [workspaceMenuOpen]);

  function handleWorkspaceSelect(workspaceId: string) {
    onSelectWorkspace(workspaceId);
    setWorkspaceMenuOpen(false);
    setWorkspaceQuery("");
  }

  function handleAddWorkspace() {
    setWorkspaceMenuOpen(false);
    setWorkspaceQuery("");
    onAddWorkspace?.();
  }

  return (
    <div className="home-chat w-full h-full col-[1/-1] row-[1/-1] relative flex items-center overflow-y-auto px-6 pt-6 pb-9 max-[900px]:px-4 max-[900px]:pt-4.5 max-[900px]:pb-7">
      <div className="home-chat-shell w-[min(1080px,100%)] min-h-[calc(100%-60px)] mx-auto flex flex-col items-center justify-center gap-6 relative z-[1] max-[900px]:min-h-[calc(100%-46px)] max-[900px]:gap-5.5 max-[640px]:min-h-[calc(100%-46px)] max-[640px]:gap-4">
        <header className="home-chat-hero flex flex-col items-center gap-7 text-center max-[900px]:gap-5.5 max-[640px]:gap-3">
          <div
            className="home-chat-engine-mark w-16 h-16 flex items-center justify-center text-(--home-chat-text) max-[900px]:w-14 max-[900px]:h-14"
            role="img"
            aria-label={engineLabel}
          >
            <EngineIcon
              engine={selectedEngine}
              size={50}
              className="home-chat-engine-icon w-[42px] h-[42px] object-contain opacity-[0.96] max-[900px]:w-[38px] max-[900px]:h-[38px]"
            />
          </div>

          <div className="home-chat-headline flex flex-col items-center gap-[22px] w-[min(100%,760px)] max-[900px]:gap-4">
            <h1 className="home-chat-title m-0 text-(--home-chat-text) text-[clamp(20px,2.4vw,34px)] leading-[1.08] tracking-[-0.03em] font-bold max-[900px]:text-[clamp(18px,4.8vw,26px)]">
              {t("homeChat.minimalTitle", "Create anything")}
            </h1>

            {selectedWorkspace ? (
              <div
                className="home-chat-workspace-summary flex flex-col items-center gap-[18px] w-auto max-w-[min(100%,420px)] max-[900px]:gap-3.5 max-[640px]:gap-3"
                title={selectedWorkspace.name}
              >
                <div className="home-chat-workspace-select w-auto max-w-full block" title={selectedWorkspace.name}>
                  <Popover open={workspaceMenuOpen} onOpenChange={setWorkspaceMenuOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className="home-chat-workspace-select-trigger inline-flex items-center justify-center gap-1.5 w-auto min-w-0 border-0 bg-transparent text-[color-mix(in_srgb,var(--home-chat-text)_72%,transparent)] text-[clamp(15px,1.05vw,18px)] leading-[1.2] tracking-[-0.028em] font-medium p-0 py-0.5 cursor-pointer transition-colors duration-[140ms] ease-linear hover:text-[color-mix(in_srgb,var(--home-chat-text)_88%,transparent)] hover:outline-none focus-visible:text-[color-mix(in_srgb,var(--home-chat-text)_88%,transparent)] focus-visible:outline-none max-[900px]:text-[clamp(14px,3.4vw,17px)]"
                        aria-label={t("homeChat.workspaceSelectLabel", "Workspace")}
                        aria-expanded={workspaceMenuOpen}
                        aria-controls={workspacePanelId}
                      >
                        <span className="home-chat-workspace-select-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-inherit">
                          {selectedWorkspace.name}
                        </span>
                        <ChevronDown
                          size={16}
                          aria-hidden
                          className="home-chat-workspace-select-trigger-icon flex-none text-[color-mix(in_srgb,var(--home-chat-text)_40%,transparent)] transition-[transform,color] duration-[160ms] ease-linear data-[open=true]:rotate-180"
                          data-open={workspaceMenuOpen ? "true" : undefined}
                        />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="center"
                      className="home-chat-workspace-picker-popover"
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      side="bottom"
                      sideOffset={8}
                    >
                      <div className="home-chat-workspace-picker flex flex-col gap-0 p-2">
                        <label
                          className="home-chat-workspace-picker-search grid grid-cols-[16px_1fr] items-center gap-2.5 min-h-[38px] mb-1.5 px-3.5 border border-white/8 rounded-xl bg-[#2c2c2c] [:root[data-theme=light]_&]:border-[#dde3e8] [:root[data-theme=light]_&]:bg-white max-[900px]:min-h-9 max-[900px]:px-3 max-[640px]:min-h-9 max-[640px]:mb-1.5 max-[640px]:rounded-xl"
                          htmlFor={workspaceSearchId}
                        >
                          <Search
                            size={16}
                            aria-hidden
                            className="home-chat-workspace-picker-search-icon text-white/50 [:root[data-theme=light]_&]:text-[#a1a1aa]"
                          />
                          <input
                            ref={searchInputRef}
                            id={workspaceSearchId}
                            type="text"
                            value={workspaceQuery}
                            onChange={(event) => setWorkspaceQuery(event.target.value)}
                            className="home-chat-workspace-picker-search-input w-full border-0 bg-transparent text-white/94 text-[13px] leading-[1.2] tracking-[-0.02em] outline-none placeholder:text-white/46 [:root[data-theme=light]_&]:text-[#111827] [:root[data-theme=light]_&]:placeholder:text-[#a1a1aa]"
                            placeholder={t("homeChat.workspaceSearchPlaceholder", "Search projects")}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </label>

                        <div
                          id={workspacePanelId}
                          className="home-chat-workspace-picker-list flex flex-col gap-0 max-h-[168px] overflow-y-auto"
                          role="list"
                          aria-label={t("homeChat.workspaceSelectLabel", "Workspace")}
                        >
                          {filteredWorkspaces.length > 0 ? (
                            filteredWorkspaces.map((workspace) => {
                              const isSelected = workspace.id === resolvedWorkspaceId;

                              return (
                                <button
                                  key={workspace.id}
                                  type="button"
                                  className="home-chat-workspace-picker-item grid grid-cols-[16px_minmax(0,1fr)_16px] items-center gap-2.5 w-full min-h-[30px] px-3 border-0 rounded-xl bg-transparent text-white/90 text-left text-[12.5px] leading-[1.1] tracking-[-0.026em] font-medium cursor-pointer transition-colors duration-[140ms] ease-linear hover:bg-white/6 hover:outline-none focus-visible:bg-white/6 focus-visible:outline-none data-[selected=true]:bg-white/8 data-[selected=true]:text-white/98 [:root[data-theme=light]_&]:text-[#1f2937] [:root[data-theme=light]_&]:hover:bg-[#f5f5f4] [:root[data-theme=light]_&]:focus-visible:bg-[#f5f5f4] [:root[data-theme=light]_&]:data-[selected=true]:bg-[#f7f5f2] [:root[data-theme=light]_&]:data-[selected=true]:text-[#111827] max-[640px]:min-h-[30px] max-[640px]:gap-2.5 max-[640px]:px-3"
                                  data-selected={isSelected ? "true" : undefined}
                                  onClick={() => handleWorkspaceSelect(workspace.id)}
                                >
                                  <Folder
                                    size={16}
                                    aria-hidden
                                    className="home-chat-workspace-picker-item-icon text-white/62 [:root[data-theme=light]_&]:text-[#8b929c]"
                                  />
                                  <span className="home-chat-workspace-picker-item-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                    {workspace.name}
                                  </span>
                                  {isSelected ? (
                                    <Check
                                      size={16}
                                      aria-hidden
                                      className="home-chat-workspace-picker-item-check text-white/74 justify-self-end [:root[data-theme=light]_&]:text-[#8b929c]"
                                    />
                                  ) : null}
                                </button>
                              );
                            })
                          ) : (
                            <div className="home-chat-workspace-picker-empty px-3 pt-2 pb-2.5 text-white/54 text-[12.5px] leading-[1.3] [:root[data-theme=light]_&]:text-[rgba(17,24,39,0.46)]">
                              {t("homeChat.workspaceNoMatch", "No projects found")}
                            </div>
                          )}
                        </div>

                        <div className="home-chat-workspace-picker-divider h-px mt-2 mx-1.5 mb-1.5 bg-white/8 [:root[data-theme=light]_&]:bg-[#e9edf1]" />

                        <button
                          type="button"
                          className="home-chat-workspace-picker-add grid grid-cols-[16px_minmax(0,1fr)] items-center gap-2.5 w-full min-h-[30px] px-3 border-0 rounded-xl bg-transparent text-white/90 text-left text-[12.5px] leading-[1.1] tracking-[-0.026em] font-medium cursor-pointer transition-colors duration-[140ms] ease-linear hover:bg-white/6 hover:outline-none focus-visible:bg-white/6 focus-visible:outline-none [:root[data-theme=light]_&]:text-[#1f2937] [:root[data-theme=light]_&]:hover:bg-[#f5f5f4] [:root[data-theme=light]_&]:focus-visible:bg-[#f5f5f4] max-[640px]:min-h-[30px] max-[640px]:gap-2.5 max-[640px]:px-3"
                          onClick={handleAddWorkspace}
                        >
                          <FolderPlus
                            size={16}
                            aria-hidden
                            className="home-chat-workspace-picker-add-icon text-white/62 [:root[data-theme=light]_&]:text-[#8b929c]"
                          />
                          <span>{t("homeChat.addWorkspaceAction", "Add new project")}</span>
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                {branchLabel ? (
                  <div className="home-chat-workspace-branch inline-flex items-center justify-center gap-2 flex-wrap text-(--home-chat-muted) text-[clamp(12px,0.88vw,16px)] leading-[1.34] tracking-[-0.022em] max-[900px]:gap-[7px] max-[900px]:text-[clamp(11px,3.2vw,14px)] max-[640px]:gap-1.5">
                    <GitBranch
                      size={18}
                      aria-hidden
                      className="home-chat-workspace-branch-icon text-[color-mix(in_srgb,var(--home-chat-text)_44%,transparent)] shrink-0"
                    />
                    <span className="home-chat-workspace-branch-label font-medium">{branchDescriptor}</span>
                    <span className="home-chat-workspace-branch-value text-[color-mix(in_srgb,var(--home-chat-text)_54%,transparent)] font-semibold">({branchLabel})</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>

        <section className="home-chat-stage w-[min(700px,100%)] mx-auto flex flex-col justify-center gap-[18px] max-[900px]:w-full">
          <section
            className="home-chat-composer-panel w-[min(700px,100%)] mx-auto"
            aria-label={t("home.newConversation", "New Conversation")}
          >
            <div className="home-chat-composer-host">{composerNode}</div>
          </section>
        </section>
      </div>
    </div>
  );
}
