import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";
import { pluginIdFromRegistryKey } from "@ccgui/plugin-sdk";
import { cx } from "@/utils/cx";
import { useChatStore } from "./store";
import { ChangesTab } from "./panel-tabs";
import { resolveActivePanelTab, useSortedPanelTabs } from "./use-panel-tabs";
import type { ActiveSession } from "./store";

export function ChatSidePanel({
  active,
  panelRef,
  panelWidth,
  panelCollapsed,
  dragging,
  panelTab,
  onResizeStart,
  overlay = false,
}: {
  active: ActiveSession | null;
  panelRef: React.RefObject<HTMLDivElement>;
  panelWidth: number;
  panelCollapsed: boolean;
  dragging: "sidebar" | "panel" | null;
  panelTab: string;
  onResizeStart: (e: React.PointerEvent) => void;
  overlay?: boolean;
}) {
  const { t } = useTranslation();
  const panelTabs = useSortedPanelTabs();
  // 工作区多目录：把当前工作区的附加根传给 Git 面板，使其按根分组列出各仓库。
  const workspaces = useChatStore((s) => s.workspaces);
  const workspaceRoots = useMemo(
    () => workspaces.find((w) => w.path === active?.workspacePath)?.roots ?? [],
    [workspaces, active?.workspacePath],
  );
  // Persisted tab may point at an unloaded plugin tab; fall back to the
  // first tab so the sidebar never renders fully hidden (read-side only).
  const activeTab = active ? resolveActivePanelTab(panelTabs, panelTab) : undefined;
  if (!active) return null;
  return (
    <div
      ref={panelRef}
      className={cx(
        overlay
          ? "absolute inset-y-0 right-0 z-20 max-w-full shadow-xl"
          : "relative",
        "flex shrink-0 overflow-hidden",
        // Width transition for collapse/expand; disabled mid-drag
        // since resizes mutate style.width imperatively.
        !dragging &&
          "transition-[width] duration-200 ease-out motion-reduce:transition-none",
      )}
      style={{
        width: panelCollapsed ? 0 : panelWidth,
        maxWidth: overlay ? "100%" : undefined,
      }}
    >
      {/* Panel resize strip: full height, straddling the border. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("chat.resizePanel")}
        title={t("chat.resizePanel")}
        onPointerDown={onResizeStart}
        className={cx(
          "group absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize touch-none",
          panelCollapsed && "hidden",
        )}
      >
        <span
          className={cx(
            "absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-accent-300 opacity-0 transition-opacity group-hover:opacity-100",
            dragging === "panel" && "opacity-100",
          )}
        />
      </div>
      <div
        className={cx(
          "flex h-full w-full flex-col overflow-hidden border-separator-border bg-background-primary-default",
          !panelCollapsed && "border-l",
        )}
      >
        {panelTabs.map((tab) => {
          const TabComponent = tab.component;
          const panel = tab.id === "changes" && TabComponent === ChangesTab ? (
            <ChangesTab
              workspacePath={active.workspacePath}
              roots={workspaceRoots}
              visible={!panelCollapsed && activeTab === tab.id}
            />
          ) : (
            <TabComponent workspacePath={active.workspacePath} />
          );
          return (
            <div
              key={tab.id}
              className={cx(
                "min-h-0 flex-1",
                activeTab === tab.id ? "flex flex-col" : "hidden",
              )}
            >
              {tab.id.startsWith("plugin:") ? (
                // Plugin tabs get a crash boundary scoped to their plugin id.
                <PluginBoundary pluginId={pluginIdFromRegistryKey(tab.id)}>
                  {panel}
                </PluginBoundary>
              ) : (
                panel
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
