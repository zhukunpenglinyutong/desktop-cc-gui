import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";

type LatestAgentRun = {
  message: string;
  timestamp: number;
  projectName: string;
  groupName?: string | null;
  workspaceId: string;
  threadId: string;
  isProcessing: boolean;
};

type HomeProps = {
  onOpenProject: () => void;
  latestAgentRuns: LatestAgentRun[];
  isLoadingLatestAgents: boolean;
  onSelectThread: (workspaceId: string, threadId: string) => void;
};

export function Home({
  onOpenProject,
  latestAgentRuns: _latestAgentRuns,
  isLoadingLatestAgents: _isLoadingLatestAgents,
  onSelectThread: _onSelectThread,
}: HomeProps) {
  const { t } = useTranslation();

  return (
    <div className="home flex flex-col h-full w-full items-center justify-center overflow-y-auto p-10 [grid-column:1/-1] [grid-row:1/-1]">
      <div className="home-content w-full max-w-[640px] flex flex-col gap-8 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500">
        <div className="home-hero flex flex-col items-center text-center gap-3">
          <h1 className="home-title text-5xl font-medium tracking-[-0.03em] text-[var(--text-stronger)] leading-[1.1]">
            {t("home.welcome")}
          </h1>
          <p className="home-subtitle text-lg text-muted-foreground font-normal max-w-[400px] leading-[1.5]">
            {t("home.subtitle", "What would you like to build today?")}
          </p>

          <div className="home-hero-actions mt-1 w-full flex justify-center">
            <button
              className="home-primary-button inline-flex items-center justify-center gap-2.5 h-12 px-7 rounded-xl bg-card text-[var(--text-stronger)] border border-[var(--border-subtle)] text-[15px] font-medium cursor-pointer transition-[background,border-color,box-shadow] duration-200 hover:bg-[var(--surface-card-strong)] hover:border-[var(--border-muted)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)] active:bg-[var(--surface-hover)]"
              onClick={onOpenProject}
              data-tauri-drag-region="false"
            >
              <Plus size={20} />
              <span>{t("home.openProject")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
