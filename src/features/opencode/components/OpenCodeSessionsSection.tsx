import Search from "lucide-react/dist/esm/icons/search";
import Star from "lucide-react/dist/esm/icons/star";
import type { OpenCodeSessionSummary } from "../types";

type OpenCodeSessionsSectionProps = {
  sessionFilter: "recent" | "favorites";
  onSessionFilterChange: (filter: "recent" | "favorites") => void;
  sessionQuery: string;
  onSessionQueryChange: (query: string) => void;
  visibleSessions: OpenCodeSessionSummary[];
  favoriteSessionIds: Record<string, true>;
  onToggleFavoriteSession: (sessionId: string) => void;
  onResumeSession: (sessionId: string) => void;
};

export function OpenCodeSessionsSection({
  sessionFilter,
  onSessionFilterChange,
  sessionQuery,
  onSessionQueryChange,
  visibleSessions,
  favoriteSessionIds,
  onToggleFavoriteSession,
  onResumeSession,
}: OpenCodeSessionsSectionProps) {
  const filterBtnBase =
    "opencode-filter-btn cursor-pointer rounded-full border px-[7px] py-0.5 text-[10px]";
  const filterBtnRecentActive = sessionFilter === "recent";
  const filterBtnFavoritesActive = sessionFilter === "favorites";
  return (
    <div className="opencode-panel-sessions mt-2.5 border-t-0 pt-0">
      <div className="opencode-provider-head mb-1.5 flex items-center justify-between">
        <div className="opencode-provider-title inline-flex items-center gap-1.5 text-[12px] font-semibold">
          <Search size={13} aria-hidden />
          <span>Sessions</span>
        </div>
        <div className="opencode-session-filters inline-flex gap-1.5">
          <button
            type="button"
            className={`${filterBtnBase} ${
              filterBtnRecentActive
                ? "is-active border-[color:var(--border-strong,#bfdbfe)] bg-[var(--surface-control-hover,#eff6ff)] text-[color:var(--text-accent,#1d4ed8)]"
                : "border-[color:var(--border-subtle,#d7dce8)] bg-[var(--surface-card,#fff)]"
            }`}
            onClick={() => onSessionFilterChange("recent")}
          >
            最近
          </button>
          <button
            type="button"
            className={`${filterBtnBase} ${
              filterBtnFavoritesActive
                ? "is-active border-[color:var(--border-strong,#bfdbfe)] bg-[var(--surface-control-hover,#eff6ff)] text-[color:var(--text-accent,#1d4ed8)]"
                : "border-[color:var(--border-subtle,#d7dce8)] bg-[var(--surface-card,#fff)]"
            }`}
            onClick={() => onSessionFilterChange("favorites")}
          >
            收藏
          </button>
        </div>
      </div>
      <input
        className="opencode-session-search w-full rounded-lg border border-[color:var(--border-subtle,#d7dce8)] px-2 py-1.5 text-[11px] mb-1.5"
        placeholder="搜索 session / title"
        value={sessionQuery}
        onChange={(event) => onSessionQueryChange(event.target.value)}
      />
      <div className="opencode-session-list flex flex-col gap-1 max-h-[320px] overflow-auto">
        {visibleSessions.length === 0 && (
          <div className="opencode-mcp-empty text-[11px] text-[color:var(--text-muted,#6b7280)]">
            没有匹配的会话
          </div>
        )}
        {visibleSessions.map((session) => (
          <div
            key={session.sessionId}
            className="opencode-session-row grid grid-cols-[auto_1fr] items-start gap-2 py-1"
          >
            <button
              type="button"
              className="opencode-session-fav cursor-pointer border-0 bg-transparent p-0 text-[#9ca3af]"
              onClick={() => onToggleFavoriteSession(session.sessionId)}
              title="收藏会话"
            >
              <Star
                size={12}
                aria-hidden
                className={
                  favoriteSessionIds[session.sessionId]
                    ? "is-favorite text-[#eab308] fill-[#eab308]"
                    : ""
                }
              />
            </button>
            <div className="opencode-session-main min-w-0">
              <div className="opencode-session-title text-[11px] text-[color:var(--text-strong,#111827)] whitespace-nowrap overflow-hidden text-ellipsis">
                {session.title}
              </div>
              <div className="opencode-session-meta flex gap-2 text-[10px] text-[color:var(--text-muted,#6b7280)]">
                <span>{session.sessionId}</span>
                <span>{session.updatedLabel}</span>
              </div>
            </div>
            <button
              type="button"
              className="opencode-provider-test inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap rounded-lg border border-[color:color-mix(in_srgb,var(--border-accent,#4a8caa)_48%,var(--border-subtle,#d7dce8))] bg-[color:color-mix(in_srgb,var(--border-accent-soft,#2a5570)_22%,var(--surface-card,#fff))] px-[9px] text-[10px] font-semibold leading-none text-[color:var(--text-accent,#1d4ed8)] h-[26px]"
              onClick={() => onResumeSession(session.sessionId)}
              title="恢复到该 OpenCode 会话"
            >
              恢复
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
