import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import { useTranslation } from "react-i18next";
import type { WorkspaceInfo } from "../../../types";
import type { EngineType } from "../../../types";
import type { EngineDisplayInfo } from "../../engine/hooks/useEngineController";
import type { ThreadDeleteErrorCode } from "../../threads/hooks/useThreads";
import { EngineIcon } from "../../engine/components/EngineIcon";

export type WorkspaceHomeThreadSummary = {
  id: string;
  workspaceId: string;
  threadId: string;
  title: string;
  updatedAt: number;
  isProcessing: boolean;
  isReviewing: boolean;
};

export type WorkspaceHomeDeleteResult = {
  succeededThreadIds: string[];
  failed: Array<{ threadId: string; code: ThreadDeleteErrorCode; message: string }>;
};

type WorkspaceHomeProps = {
  workspace: WorkspaceInfo;
  engines?: EngineDisplayInfo[];
  currentBranch: string | null;
  recentThreads: WorkspaceHomeThreadSummary[];
  onSelectConversation: (workspaceId: string, threadId: string) => void;
  onStartConversation: (engine: EngineType) => Promise<void>;
  onStartSharedConversation?: (engine: EngineType) => Promise<void>;
  onContinueLatestConversation: () => void;
  onStartGuidedConversation: (prompt: string, engine: EngineType) => Promise<void>;
  onOpenSpecHub: () => void;
  onRevealWorkspace: () => Promise<void>;
  onDeleteConversations: (threadIds: string[]) => Promise<WorkspaceHomeDeleteResult>;
};

function splitWorkspacePath(path: string, fallbackName: string) {
  const normalizedPath = path.trim().replace(/\\/g, "/").replace(/\/+$/, "");

  if (!normalizedPath) {
    return {
      prefix: "",
      name: fallbackName,
    };
  }

  const lastSlashIndex = normalizedPath.lastIndexOf("/");

  if (lastSlashIndex === -1) {
    return {
      prefix: "",
      name: normalizedPath,
    };
  }

  return {
    prefix: normalizedPath.slice(0, lastSlashIndex + 1),
    name: normalizedPath.slice(lastSlashIndex + 1) || fallbackName,
  };
}

export function WorkspaceHome({
  workspace,
  currentBranch,
}: WorkspaceHomeProps) {
  const { t } = useTranslation();
  const branchLabel = currentBranch || workspace.worktree?.branch || null;
  const branchDescriptor = workspace.kind === "worktree"
    ? t("workspace.homeBranchLabelWorktree")
    : t("workspace.homeBranchLabelMain");
  const { prefix: pathPrefix, name: pathName } = splitWorkspacePath(workspace.path, workspace.name);

  return (
    <section className="workspace-home workspace-home-minimal">
      <div className="workspace-home-shell">
        <header className="workspace-home-hero">
          <div
            className="workspace-home-mark"
            role="img"
            aria-label={t("workspace.engineOpenCode")}
          >
            <EngineIcon engine="opencode" size={72} className="workspace-home-mark-icon" />
          </div>

          <div className="workspace-home-copy">
            <h1 className="workspace-home-title">{t("workspace.homeHeroTitle")}</h1>

            <p className="workspace-home-path-line" title={workspace.path}>
              {pathPrefix ? <span className="workspace-home-path-prefix">{pathPrefix}</span> : null}
              <span className="workspace-home-path-name">{pathName}</span>
            </p>

            {branchLabel ? (
              <div className="workspace-home-branch-line">
                <GitBranch size={20} aria-hidden className="workspace-home-branch-icon" />
                <span className="workspace-home-branch-label">{branchDescriptor}</span>
                <span className="workspace-home-branch-value">({branchLabel})</span>
              </div>
            ) : null}
          </div>
        </header>
      </div>
    </section>
  );
}
