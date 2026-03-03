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
  homeNode: ReactNode;
  showHome: boolean;
  showWorkspace: boolean;
  showKanban: boolean;
  showGitHistory: boolean;
  hideRightPanel: boolean;
  kanbanNode: ReactNode;
  gitHistoryNode: ReactNode;
  settingsOpen: boolean;
  settingsNode: ReactNode;
  topbarLeftNode: ReactNode;
  centerMode: "chat" | "diff" | "editor" | "memory";
  editorSplitLayout: "vertical" | "horizontal";
  messagesNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  fileViewPanelNode: ReactNode;
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
  homeNode,
  showHome,
  showWorkspace,
  showKanban,
  showGitHistory,
  hideRightPanel,
  kanbanNode,
  gitHistoryNode,
  settingsOpen,
  settingsNode,
  topbarLeftNode,
  centerMode,
  editorSplitLayout,
  messagesNode,
  gitDiffViewerNode,
  fileViewPanelNode,
  gitDiffPanelNode,
  planPanelNode,
  composerNode,
  runtimeConsoleDockNode,
  terminalDockNode,
  debugPanelNode,
  hasActivePlan,
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
        centerMode === mode || (isEditorSplitMode && mode === "chat");
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
          centerMode === mode || (isEditorSplitMode && mode === "chat");
        if (ref && !isInteractive && ref.contains(activeElement)) {
          activeElement.blur();
          break;
        }
      }
    }
  }, [centerMode, isEditorSplitMode]);

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
        {runtimeConsoleDockNode}
        {terminalDockNode}
      </section>
    );
  }

  const isMemoryMode = centerMode === "memory";
  const gitHistoryDockNode = showGitHistory ? (
    <div className="git-history-dock-overlay">
      <div
        className="git-history-dock-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("layout.resizeGitHistoryPanel")}
        onPointerDown={onGitHistoryPanelResizeStart}
      />
      <div className="git-history-dock-body">{gitHistoryNode}</div>
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
                      centerMode === "chat" || isEditorSplitMode
                        ? "is-active"
                        : "is-hidden"
                    }`}
                    aria-hidden={centerMode !== "chat" && !isEditorSplitMode}
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
                    <div className={`right-panel ${hasActivePlan ? "" : "plan-collapsed"}`}>
                      <div className="right-panel-top">{gitDiffPanelNode}</div>
                      <div
                        className="right-panel-divider"
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label={t("layout.resizePlanPanel")}
                        onMouseDown={onPlanPanelResizeStart}
                      />
                      <div className="right-panel-bottom">{planPanelNode}</div>
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
