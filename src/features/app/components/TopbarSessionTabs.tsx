import type { TopbarSessionTabItem } from "../../layout/hooks/topbarSessionTabs";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { SharedSessionIcon } from "../../shared-session/components/SharedSessionIcon";

type TopbarTabMenuPosition = {
  x: number;
  y: number;
};

type TopbarSessionTabsProps = {
  tabs: TopbarSessionTabItem[];
  ariaLabel: string;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onCloseThread: (workspaceId: string, threadId: string) => void;
  onShowTabMenu: (
    position: TopbarTabMenuPosition,
    workspaceId: string,
    threadId: string,
  ) => void;
};

function isActivationKey(key: string) {
  return key === "Enter" || key === " " || key === "Space" || key === "Spacebar";
}

function isContextMenuKey(key: string, shiftKey: boolean) {
  return key === "ContextMenu" || (shiftKey && key === "F10");
}

function resolveMenuAnchor(target: HTMLDivElement): TopbarTabMenuPosition {
  const rect = target.getBoundingClientRect();
  return {
    x: Math.round(rect.left + rect.width / 2),
    y: Math.round(rect.bottom),
  };
}

export function TopbarSessionTabs({
  tabs,
  ariaLabel,
  onSelectThread,
  onCloseThread,
  onShowTabMenu,
}: TopbarSessionTabsProps) {
  if (tabs.length === 0) {
    return null;
  }
  return (
    <div
      className="topbar-session-tabs"
      role="tablist"
      aria-label={ariaLabel}
      data-tauri-drag-region="false"
    >
      {tabs.map((tab) => (
        <div
          key={`${tab.workspaceId}:${tab.threadId}`}
          role="tab"
          tabIndex={0}
          className={`topbar-session-tab${tab.isActive ? " is-active" : ""}`}
          aria-selected={tab.isActive}
          aria-label={`${tab.engineLabel} · ${tab.label}`}
          title={`${tab.engineLabel} · ${tab.label}`}
          data-tauri-drag-region="false"
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onShowTabMenu(
              { x: event.clientX, y: event.clientY },
              tab.workspaceId,
              tab.threadId,
            );
          }}
          onClick={() => {
            if (!tab.isActive) {
              onSelectThread(tab.workspaceId, tab.threadId);
            }
          }}
          onKeyDown={(event) => {
            if (isContextMenuKey(event.key, event.shiftKey)) {
              event.preventDefault();
              event.stopPropagation();
              onShowTabMenu(
                resolveMenuAnchor(event.currentTarget),
                tab.workspaceId,
                tab.threadId,
              );
              return;
            }
            if (isActivationKey(event.key) && !tab.isActive) {
              event.preventDefault();
              onSelectThread(tab.workspaceId, tab.threadId);
            }
          }}
        >
          <span className="topbar-session-tab-engine" aria-hidden="true">
            {tab.isShared ? (
              <SharedSessionIcon size={12} className="topbar-shared-session-icon" />
            ) : (
              <EngineIcon engine={tab.engineType} size={12} />
            )}
          </span>
          <span className="topbar-session-tab-label">{tab.displayLabel}</span>
          <button
            type="button"
            className="topbar-session-tab-close"
            aria-label={`Close ${tab.label}`}
            title={`Close ${tab.label}`}
            data-tauri-drag-region="false"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onCloseThread(tab.workspaceId, tab.threadId);
            }}
            onKeyDown={(event) => {
              if (isActivationKey(event.key)) {
                event.preventDefault();
                event.stopPropagation();
              }
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
