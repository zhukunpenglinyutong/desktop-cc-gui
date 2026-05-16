import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { MainTopbar } from "../../app/components/MainTopbar";
import { MemoryPanel } from "./MemoryPanel";

type DesktopLayoutProps = {
  sidebarNode: ReactNode;
  updateToastNode: ReactNode;
  approvalToastsNode: ReactNode;
  errorToastsNode: ReactNode;
  globalRuntimeNoticeDockNode: ReactNode;
  homeNode: ReactNode;
  showHome: boolean;
  showWorkspace: boolean;
  showKanban: boolean;
  showGitHistory: boolean;
  hideRightPanel: boolean;
  isSoloMode: boolean;
  kanbanNode: ReactNode;
  gitHistoryNode: ReactNode;
  settingsOpen: boolean;
  settingsNode: ReactNode;
  topbarLeftNode: ReactNode;
  centerMode: "chat" | "diff" | "editor" | "memory";
  editorSplitLayout: "vertical" | "horizontal";
  isEditorFileMaximized: boolean;
  messagesNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  fileViewPanelNode: ReactNode;
  rightPanelToolbarNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  planPanelNode: ReactNode;
  composerNode: ReactNode;
  runtimeConsoleDockNode: ReactNode;
  terminalDockNode: ReactNode;
  debugPanelNode: ReactNode;
  hasActivePlan: boolean;
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onRightPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onPlanPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onGitHistoryPanelResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
};

export function DesktopLayout({
  sidebarNode,
  updateToastNode,
  approvalToastsNode,
  errorToastsNode,
  globalRuntimeNoticeDockNode,
  homeNode,
  showHome,
  showWorkspace,
  showKanban,
  showGitHistory,
  hideRightPanel,
  isSoloMode,
  kanbanNode,
  gitHistoryNode,
  settingsOpen,
  settingsNode,
  topbarLeftNode,
  centerMode,
  editorSplitLayout,
  isEditorFileMaximized,
  messagesNode,
  gitDiffViewerNode,
  fileViewPanelNode,
  rightPanelToolbarNode,
  gitDiffPanelNode,
  planPanelNode,
  composerNode,
  runtimeConsoleDockNode,
  terminalDockNode,
  debugPanelNode,
  onSidebarResizeStart,
  onRightPanelResizeStart,
  onPlanPanelResizeStart,
  onGitHistoryPanelResizeStart,
}: DesktopLayoutProps) {
  const { t } = useTranslation();
  const diffLayerRef = useRef<HTMLDivElement | null>(null);
  const chatLayerRef = useRef<HTMLDivElement | null>(null);
  const editorLayerRef = useRef<HTMLDivElement | null>(null);
  const memoryLayerRef = useRef<HTMLDivElement | null>(null);
  const splitResizeCleanupRef = useRef<(() => void) | null>(null);
  const isEditorSplitMode = centerMode === "editor";
  const isEditorHorizontalSplitMode =
    isEditorSplitMode && editorSplitLayout === "horizontal";
  const isEditorSplitChatVisible = isEditorSplitMode && !isEditorFileMaximized;
  const hasBottomPanel = Boolean(planPanelNode);

  useEffect(() => {
    const diffLayer = diffLayerRef.current;
    const chatLayer = chatLayerRef.current;
    const editorLayer = editorLayerRef.current;

    const layers = [
      { ref: diffLayer, mode: "diff" as const },
      { ref: chatLayer, mode: "chat" as const },
      { ref: editorLayer, mode: "editor" as const },
    ];

    for (const { ref, mode } of layers) {
      if (!ref) continue;
      const isInteractive =
        centerMode === mode || (isEditorSplitChatVisible && mode === "chat");
      if (isInteractive) {
        ref.removeAttribute("inert");
      } else {
        ref.setAttribute("inert", "");
      }
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      for (const { ref, mode } of layers) {
        const isInteractive =
          centerMode === mode || (isEditorSplitChatVisible && mode === "chat");
        if (ref && !isInteractive && ref.contains(activeElement)) {
          activeElement.blur();
          break;
        }
      }
    }
  }, [centerMode, isEditorSplitChatVisible]);

  useEffect(() => {
    return () => {
      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = null;
    };
  }, []);

  const handleHorizontalSplitPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      const divider = event.currentTarget;
      const splitRoot = divider.closest(".content.is-editor-split-horizontal") as HTMLElement | null;
      if (!splitRoot) {
        return;
      }
      const editorLayer = splitRoot.querySelector(
        ".content-layer--editor",
      ) as HTMLElement | null;
      const chatLayer = splitRoot.querySelector(
        ".content-layer--chat",
      ) as HTMLElement | null;
      if (!editorLayer || !chatLayer) {
        return;
      }
      const editorRect = editorLayer.getBoundingClientRect();
      const chatRect = chatLayer.getBoundingClientRect();
      const totalWidth = editorRect.width + chatRect.width;
      if (totalWidth <= 0) {
        return;
      }

      event.preventDefault();

      const startX = event.clientX;
      const startEditorWidth = editorRect.width;
      const minEditorWidth = Math.max(320, totalWidth * 0.28);
      const maxEditorWidth = Math.min(totalWidth - 260, totalWidth * 0.8);
      if (maxEditorWidth <= minEditorWidth) {
        return;
      }

      document.body.classList.add("editor-horizontal-split-resizing");

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.classList.remove("editor-horizontal-split-resizing");
        splitResizeCleanupRef.current = null;
      };

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const nextEditorWidth = Math.min(
          maxEditorWidth,
          Math.max(minEditorWidth, startEditorWidth - deltaX),
        );
        const nextRatio = (nextEditorWidth / totalWidth) * 100;
        splitRoot.style.setProperty("--editor-horizontal-split-ratio", nextRatio.toFixed(2));
      };

      const handlePointerUp = () => {
        cleanup();
      };

      splitResizeCleanupRef.current?.();
      splitResizeCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [],
  );

  if (showKanban) {
    return (
      <section className="main kanban-fullscreen">
        {kanbanNode}
        {globalRuntimeNoticeDockNode}
        {runtimeConsoleDockNode}
        {terminalDockNode}
      </section>
    );
  }

  const isMemoryMode = centerMode === "memory";
  const gitHistoryDockNode = showGitHistory ? (
    <div className="git-history-dock-overlay fixed left-0 right-0 bottom-0 z-[48] flex flex-col h-[var(--git-history-panel-height,50vh)] min-h-[240px] max-h-[calc(100vh-var(--main-topbar-height,44px))] border-t border-[color:var(--border-default)] bg-[color-mix(in_srgb,var(--surface-messages,#0d0f14)_94%,transparent)] transition-[height] duration-[120ms] ease-in-out">
      <div
        className="git-history-dock-resizer relative h-2 cursor-row-resize flex-none touch-none bg-transparent after:content-[''] after:absolute after:left-1/2 after:w-[68px] after:top-1/2 after:h-[2px] after:rounded-full after:-translate-x-1/2 after:-translate-y-1/2 after:bg-[color-mix(in_srgb,var(--border-default)_90%,transparent)] hover:after:bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_70%,transparent)]"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("layout.resizeGitHistoryPanel")}
        onPointerDown={onGitHistoryPanelResizeStart}
      />
      <div className="git-history-dock-body flex-1 min-h-0 overflow-hidden">{gitHistoryNode}</div>
    </div>
  ) : null;

  return (
    <>
      {!settingsOpen && sidebarNode}
      {!settingsOpen && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("layout.resizeSidebar")}
          onMouseDown={onSidebarResizeStart}
        />
      )}

      <section
        className={`main${settingsOpen ? " settings-open" : ""}${
          hideRightPanel ? " spec-focus" : ""
        }`}
        style={settingsOpen ? { gridColumn: "1 / -1" } : undefined}
      >
        {errorToastsNode}
        {globalRuntimeNoticeDockNode}

        {settingsOpen && settingsNode}

        {!settingsOpen && isMemoryMode && (
          <div
            ref={memoryLayerRef}
            style={{ position: "absolute", inset: 0, zIndex: 10 }}
          >
            <MemoryPanel />
          </div>
        )}

        {!settingsOpen && !isMemoryMode && (
          <>
            {updateToastNode}
            {showHome && homeNode}

            {showWorkspace && (
              <>
                <MainTopbar leftNode={topbarLeftNode} />
                {approvalToastsNode}
                <div
                  className={`content${isEditorSplitMode ? " is-editor-split" : ""}${
                    isEditorSplitMode
                      ? isEditorHorizontalSplitMode
                        ? " is-editor-split-horizontal"
                        : " is-editor-split-vertical"
                      : ""
                  }${
                    isEditorSplitChatVisible ? "" : isEditorSplitMode ? " is-editor-file-maximized" : ""
                  }`}
                >
                  <div
                    className={`content-layer content-layer--diff ${
                      centerMode === "diff" ? "is-active" : "is-hidden"
                    }`}
                    aria-hidden={centerMode !== "diff"}
                    ref={diffLayerRef}
                  >
                    {gitDiffViewerNode}
                  </div>
                  <div
                    className={`content-layer content-layer--editor ${
                      centerMode === "editor" ? "is-active" : "is-hidden"
                    }`}
                    aria-hidden={centerMode !== "editor"}
                    ref={editorLayerRef}
                  >
                    {fileViewPanelNode}
                  </div>
                  {isEditorHorizontalSplitMode ? (
                    <div
                      className="content-editor-split-divider"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t("layout.resizeEditorSplit")}
                      onPointerDown={handleHorizontalSplitPointerDown}
                    />
                  ) : null}
                  <div
                    className={`content-layer content-layer--chat ${
                      centerMode === "chat" || isEditorSplitChatVisible
                        ? "is-active"
                        : "is-hidden"
                    }`}
                    aria-hidden={centerMode !== "chat" && !isEditorSplitChatVisible}
                    ref={chatLayerRef}
                  >
                    {messagesNode}
                  </div>
                </div>

                {!hideRightPanel && (
                  <>
                    <div
                      className="right-panel-resizer"
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={t("layout.resizeRightPanel")}
                      onMouseDown={onRightPanelResizeStart}
                    />
                    <div
                      className={`right-panel ${
                        hasBottomPanel && !isSoloMode ? "" : "plan-collapsed"
                      }${isSoloMode ? " is-solo" : ""}`}
                    >
                      {rightPanelToolbarNode}
                      <div className="right-panel-top">{gitDiffPanelNode}</div>
                      {hasBottomPanel ? (
                        <>
                          <div
                            className="right-panel-divider"
                            role="separator"
                            aria-orientation="horizontal"
                            aria-label={t("layout.resizePlanPanel")}
                            onMouseDown={onPlanPanelResizeStart}
                          />
                          <div className="right-panel-bottom">{planPanelNode}</div>
                        </>
                      ) : null}
                    </div>
                  </>
                )}
                {composerNode}
                {runtimeConsoleDockNode}
                {terminalDockNode}
                {debugPanelNode}
                {gitHistoryDockNode}
              </>
            )}
            {!showWorkspace && gitHistoryDockNode}
          </>
        )}
      </section>
    </>
  );
}
