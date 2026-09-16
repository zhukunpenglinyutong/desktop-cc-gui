import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  AiChatSidebar,
  type AiChatRepo,
  type AiChatRepoSection,
  type ThreadAction,
} from "@/components/application/ai-chat/ai-chat-sidebar";
import { cx } from "@/utils/cx";
import type { ActiveSession } from "./store";

/** Left edge: the session sidebar, its full-height resize strip, and the
 * mobile drawer backdrop. Below the md breakpoint the sidebar floats over
 * the chat as a drawer instead of squishing the layout. */
export function ChatSidebarFrame({
  active,
  collapsed,
  width,
  dragging,
  sidebarRef,
  resizerRef,
  onResizeStart,
  onClose,
  repos,
  sections,
  onThreadSelect,
  onThreadAction,
  onCopyThreadId,
  onAddWorkspace,
  onRemoveWorkspace,
  onWorkspaceAlias,
  onSetWorkspaceArchived,
  onNewSessionInWorkspace,
  onNewSession,
  onReorderWorkspaces,
  onDropWorkspaceToSection,
  archivedRepos,
}: {
  active: ActiveSession | null;
  collapsed: boolean;
  width: number;
  dragging: "sidebar" | "panel" | null;
  sidebarRef: React.RefObject<HTMLElement>;
  resizerRef: React.RefObject<HTMLDivElement>;
  onResizeStart: (e: React.PointerEvent) => void;
  onClose: () => void;
  repos: AiChatRepo[];
  /** Grouped repo tree (工作区二级分类); undefined = flat list. */
  sections?: AiChatRepoSection[];
  onThreadSelect: (id: string) => void;
  onThreadAction: (id: string, action: ThreadAction) => void;
  onCopyThreadId: (id: string) => void;
  onAddWorkspace: () => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onWorkspaceAlias: (workspaceId: string) => void;
  onSetWorkspaceArchived: (workspaceId: string, archived: boolean) => void;
  onNewSessionInWorkspace: (workspaceId: string) => void;
  onNewSession: () => void;
  onReorderWorkspaces: (orderedIds: string[]) => void;
  /** Workspace row dropped onto a group / 已归档 / ungrouped container. */
  onDropWorkspaceToSection: (workspaceId: string, targetSectionId: string | null) => void;
  /** Archived workspaces for the sidebar's bottom 已归档 section. */
  archivedRepos: AiChatRepo[];
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <AiChatSidebar
        width={collapsed ? 0 : width}
        rootRef={sidebarRef}
        className={cx(
          // Width transition for collapse/expand; disabled mid-drag since
          // resizes mutate style.width imperatively per pointermove.
          !dragging &&
            "transition-[width] duration-200 ease-out motion-reduce:transition-none",
          // On phones the sidebar floats over the chat as a drawer instead of
          // squishing the layout. Absolute positioning bypasses ChatPage's
          // padding, so the drawer needs its own top safe-area inset.
          "max-md:absolute max-md:top-[env(safe-area-inset-top)] max-md:bottom-0 max-md:left-0 max-md:z-40 max-md:shadow-2xl",
        )}
        repos={repos}
        sections={sections}
        activeThreadId={active?.sessionId ? `${active.engine}/${active.sessionId}` : undefined}
        onThreadSelect={onThreadSelect}
        onThreadAction={onThreadAction}
        onCopyThreadId={onCopyThreadId}
        onAddWorkspace={onAddWorkspace}
        onRemoveWorkspace={onRemoveWorkspace}
        onWorkspaceAlias={onWorkspaceAlias}
        onSetWorkspaceArchived={onSetWorkspaceArchived}
        archivedRepos={archivedRepos}
        onNewSessionInWorkspace={onNewSessionInWorkspace}
        onNewSession={onNewSession}
        onReorderWorkspaces={onReorderWorkspaces}
        onDropWorkspaceToSection={onDropWorkspaceToSection}
        onOpenSettings={() => navigate("/settings")}
        onClose={onClose}
      />
      {/* Sidebar resize strip: full height, straddling the border. */}
      {!collapsed && (
        <div
          ref={resizerRef}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("chat.resizeSidebar")}
          title={t("chat.resizeSidebar")}
          onPointerDown={onResizeStart}
          className="group absolute inset-y-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none max-md:hidden"
          style={{ left: width }}
        >
          <span
            className={cx(
              "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-accent-300 opacity-0 transition-opacity group-hover:opacity-100",
              dragging === "sidebar" && "opacity-100",
            )}
          />
        </div>
      )}
      {/* Mobile drawer backdrop: tap outside the sidebar to close it. */}
      {!collapsed && (
        <div
          aria-hidden
          onClick={onClose}
          className="absolute inset-0 z-30 bg-black/40 md:hidden"
        />
      )}
    </>
  );
}
