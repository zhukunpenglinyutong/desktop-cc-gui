import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAppSettingsController } from "../../app/hooks/useAppSettingsController";
import { useCodeCssVars } from "../../app/hooks/useCodeCssVars";
import { isMacPlatform, isWindowsPlatform } from "../../../utils/platform";
import {
  CLIENT_DOCUMENTATION_TREE,
  CLIENT_DOCUMENTATION_WINDOW_TITLE,
} from "../clientDocumentationData";
import {
  findClientDocumentationNode,
  getDefaultClientDocumentationNode,
} from "../clientDocumentationUtils";
import { ClientDocumentationDetail } from "./ClientDocumentationDetail";
import { ClientDocumentationTree } from "./ClientDocumentationTree";

export function ClientDocumentationWindow() {
  const { appSettings, reduceTransparency } = useAppSettingsController();
  useCodeCssVars(appSettings);
  const menubarRef = useRef<HTMLElement | null>(null);
  const defaultNode = getDefaultClientDocumentationNode();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    defaultNode?.id ?? null,
  );
  const isMacDesktop = isMacPlatform();
  const isWindowsDesktop = isWindowsPlatform();
  const appClassName = useMemo(
    () => `app layout-desktop${isWindowsDesktop ? " windows-desktop" : ""}${
      isMacDesktop ? " macos-desktop" : ""
    }${reduceTransparency ? " reduced-transparency" : ""}`,
    [isMacDesktop, isWindowsDesktop, reduceTransparency],
  );
  const documentationWindowStyle = useMemo(
    () =>
      ({
        "--ui-font-family": appSettings.uiFontFamily,
        "--code-font-family": appSettings.codeFontFamily,
        "--code-font-size": `${appSettings.codeFontSize}px`,
      }) as CSSProperties,
    [appSettings.codeFontFamily, appSettings.codeFontSize, appSettings.uiFontFamily],
  );
  const selectedNode =
    selectedNodeId === null ? defaultNode : findClientDocumentationNode(selectedNodeId);
  const missingNodeId =
    selectedNodeId && !findClientDocumentationNode(selectedNodeId) ? selectedNodeId : null;

  useEffect(() => {
    void getCurrentWindow().setTitle(CLIENT_DOCUMENTATION_WINDOW_TITLE).catch(() => {});
  }, []);

  useEffect(() => {
    if (!isMacDesktop) {
      return;
    }
    const menubar = menubarRef.current;
    if (!(menubar instanceof HTMLElement)) {
      return;
    }
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0 || event.detail > 1) {
        return;
      }
      const target = event.target;
      const interactiveTarget =
        target instanceof Element
          ? target.closest(
              [
                '[data-window-drag-ignore="true"]',
                "button",
                "a",
                "input",
                "textarea",
                "select",
                "[role='button']",
              ].join(","),
            )
          : null;
      if (interactiveTarget) {
        return;
      }
      event.preventDefault();
      void (async () => {
        try {
          const windowHandle = getCurrentWindow();
          const fullscreen =
            typeof windowHandle.isFullscreen === "function"
              ? await windowHandle.isFullscreen()
              : false;
          if (fullscreen || typeof windowHandle.startDragging !== "function") {
            return;
          }
          await windowHandle.startDragging();
        } catch {
          // Non-Tauri test/runtime environments cannot drag native windows.
        }
      })();
    };
    menubar.addEventListener("mousedown", handleMouseDown);
    return () => {
      menubar.removeEventListener("mousedown", handleMouseDown);
    };
  }, [isMacDesktop]);

  const resetSelection = () => {
    setSelectedNodeId(defaultNode?.id ?? null);
  };

  return (
    <div
      className={`${appClassName} client-documentation-window min-h-screen bg-[linear-gradient(90deg,rgba(37,99,235,0.07)_1px,transparent_1px),linear-gradient(rgba(15,23,42,0.045)_1px,transparent_1px),radial-gradient(circle_at_9%_4%,rgba(37,99,235,0.2),transparent_28%),radial-gradient(circle_at_96%_12%,rgba(14,165,233,0.12),transparent_24%),linear-gradient(135deg,var(--surface-base),var(--surface-raised))] bg-[size:42px_42px,42px_42px,auto,auto,auto] text-(--text-primary) flex flex-col overflow-hidden`}
      style={documentationWindowStyle}
    >
      <header
        ref={menubarRef}
        className="client-documentation-menubar h-11 flex items-center px-[18px] border-b border-(--border-subtle) bg-[color-mix(in_srgb,var(--surface-raised)_78%,transparent)] backdrop-blur-[18px] [-webkit-app-region:drag]"
        data-tauri-drag-region="true"
      >
        <div
          className="client-documentation-menubar-copy flex items-baseline gap-2.5 min-w-0"
          data-tauri-drag-region="true"
        >
          <span
            className="client-documentation-menubar-label text-(--text-muted) text-xs tracking-[0.08em] uppercase"
            data-tauri-drag-region="true"
          >
            客户端说明文档
          </span>
          <strong
            className="client-documentation-menubar-title text-(--text-stronger) text-[13px]"
            data-tauri-drag-region="true"
          >
            Client Guide
          </strong>
        </div>
      </header>
      <main className="client-documentation-shell min-h-0 flex-1 grid grid-cols-[minmax(300px,360px)_minmax(0,1fr)] max-[820px]:grid-cols-[1fr]">
        <aside
          className="client-documentation-sidebar min-w-0 min-h-0 border-r border-(--border-subtle) bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-raised)_94%,transparent),color-mix(in_srgb,var(--surface-base)_82%,transparent)),color-mix(in_srgb,var(--surface-raised)_88%,transparent)] overflow-auto pt-5 pb-6 px-4 [-webkit-app-region:no-drag] max-[820px]:max-h-[38vh] max-[820px]:border-r-0 max-[820px]:border-b max-[820px]:border-(--border-subtle)"
          data-window-drag-ignore="true"
        >
          <div className="client-documentation-sidebar-kicker w-fit border border-[rgba(37,99,235,0.24)] rounded-full text-[#2563eb] bg-[rgba(37,99,235,0.1)] text-[10px] font-extrabold tracking-[0.14em] uppercase px-2 py-[5px] mx-1 mb-3">
            Client map
          </div>
          <div className="client-documentation-sidebar-heading flex items-center justify-between text-(--text-muted) text-xs mx-1 mb-3 uppercase tracking-[0.08em]">
            <span>模块目录</span>
            <small>{CLIENT_DOCUMENTATION_TREE.length} modules</small>
          </div>
          <ClientDocumentationTree
            nodes={CLIENT_DOCUMENTATION_TREE}
            selectedNodeId={selectedNode?.id ?? selectedNodeId}
            onSelectNode={setSelectedNodeId}
          />
        </aside>
        <section
          className="client-documentation-content min-w-0 min-h-0 overflow-auto py-9 px-[clamp(26px,5vw,78px)] [-webkit-app-region:no-drag] max-[820px]:pt-[22px] max-[820px]:pb-[34px] max-[820px]:px-[18px]"
          data-window-drag-ignore="true"
        >
          <ClientDocumentationDetail
            node={selectedNode}
            missingNodeId={missingNodeId}
            onResetSelection={resetSelection}
          />
        </section>
      </main>
    </div>
  );
}
