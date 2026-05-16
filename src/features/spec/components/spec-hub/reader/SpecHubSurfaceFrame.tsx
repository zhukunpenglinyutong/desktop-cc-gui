import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import type { SpecHubProps } from "../../SpecHub.presentational";
import {
  buildDetachedSpecHubSession,
  openOrFocusDetachedSpecHub,
  writeDetachedSpecHubSessionSnapshot,
} from "../../../detachedSpecHub";
import {
  applyDetachedReaderSession,
  readSpecHubDomSnapshot,
  scrollToOutlineItem,
  selectArtifactTab,
  selectSpecSourceByCapability,
  type SpecHubDomSnapshot,
} from "./SpecHubReaderDom";
import { useSpecHubSurfaceLayout } from "./useSpecHubSurfaceLayout";

type SpecHubSurfaceFrameProps = SpecHubProps & {
  children: ReactNode;
};

type PortalHosts = {
  header: HTMLElement | null;
  changesHeader: HTMLElement | null;
  outline: HTMLElement | null;
  grid: HTMLElement | null;
};

const EMPTY_DOM_SNAPSHOT: SpecHubDomSnapshot = {
  selectedChangeId: null,
  artifactType: null,
  artifactPath: null,
  specSourcePath: null,
  artifactMaximized: false,
  controlCollapsed: false,
  outline: [],
  pendingOutlineIds: [],
  proposalCapabilities: [],
};

function arePortalHostsEqual(next: PortalHosts, previous: PortalHosts) {
  return next.header === previous.header && next.outline === previous.outline;
}

function areDomSnapshotsEqual(next: SpecHubDomSnapshot, previous: SpecHubDomSnapshot) {
  if (
    next.selectedChangeId !== previous.selectedChangeId ||
    next.artifactType !== previous.artifactType ||
    next.artifactPath !== previous.artifactPath ||
    next.specSourcePath !== previous.specSourcePath ||
    next.outline.length !== previous.outline.length ||
    next.pendingOutlineIds.length !== previous.pendingOutlineIds.length ||
    next.proposalCapabilities.length !== previous.proposalCapabilities.length
  ) {
    return false;
  }
  for (let index = 0; index < next.outline.length; index += 1) {
    const nextItem = next.outline[index];
    const previousItem = previous.outline[index];
    if (
      !previousItem ||
      nextItem.id !== previousItem.id ||
      nextItem.title !== previousItem.title ||
      nextItem.level !== previousItem.level ||
      nextItem.kind !== previousItem.kind
      ) {
      return false;
    }
  }
  for (let index = 0; index < next.pendingOutlineIds.length; index += 1) {
    if (next.pendingOutlineIds[index] !== previous.pendingOutlineIds[index]) {
      return false;
    }
  }
  if (
    next.artifactMaximized !== previous.artifactMaximized ||
    next.controlCollapsed !== previous.controlCollapsed
  ) {
    return false;
  }
  for (let index = 0; index < next.proposalCapabilities.length; index += 1) {
    if (next.proposalCapabilities[index] !== previous.proposalCapabilities[index]) {
      return false;
    }
  }
  return true;
}

function ensureHost(parent: Element | null, className: string, before?: Element | null) {
  if (!(parent instanceof HTMLElement)) {
    return null;
  }
  let host =
    (Array.from(parent.children).find((child) => child.classList.contains(className)) as HTMLElement | undefined) ??
    null;
  if (!host) {
    host = document.createElement("div");
    host.className = className;
  }
  if (before instanceof Element) {
    if (host.parentElement !== parent || host.nextElementSibling !== before) {
      parent.insertBefore(host, before);
    }
  } else if (host.parentElement !== parent || parent.lastElementChild !== host) {
    parent.appendChild(host);
  }
  return host;
}

const READER_HEADER_HOST_CLASS = "spec-hub-reader-header-host ml-auto inline-flex items-center";
const READER_OUTLINE_HOST_CLASS = "spec-hub-reader-outline-host flex flex-col gap-2";

function ensurePortalHosts(root: HTMLElement): PortalHosts {
  const changesPanelHeader = root.querySelector(".spec-hub-changes .spec-hub-panel-header");
  const artifactPanelHeader = root.querySelector(".spec-hub-artifacts .spec-hub-panel-header");
  const artifactContent = root.querySelector(".spec-hub-artifact-content");
  const headerHost = ensureHost(artifactPanelHeader, "spec-hub-reader-header-host");
  if (headerHost && !headerHost.classList.contains("ml-auto")) {
    headerHost.className = READER_HEADER_HOST_CLASS;
  }
  const outlineHost = ensureHost(artifactContent, "spec-hub-reader-outline-host");
  if (outlineHost && !outlineHost.classList.contains("flex-col")) {
    outlineHost.className = READER_OUTLINE_HOST_CLASS;
  }
  return {
    changesHeader: ensureHost(changesPanelHeader, "spec-hub-changes-header-host"),
    header: headerHost,
    outline: outlineHost,
    grid: root.querySelector(".spec-hub-grid"),
  };
}

function useDomSnapshot(rootRef: RefObject<HTMLDivElement | null>) {
  const [portalHosts, setPortalHosts] = useState<PortalHosts>({
    header: null,
    changesHeader: null,
    outline: null,
    grid: null,
  });
  const [snapshot, setSnapshot] = useState<SpecHubDomSnapshot>(EMPTY_DOM_SNAPSHOT);

  useEffect(() => {
    const root = rootRef.current;
    if (!(root instanceof HTMLElement)) {
      return;
    }

    const update = () => {
      const nextPortalHosts = ensurePortalHosts(root);
      const nextSnapshot = readSpecHubDomSnapshot(root);
      setPortalHosts((previous) =>
        arePortalHostsEqual(nextPortalHosts, previous) ? previous : nextPortalHosts,
      );
      setSnapshot((previous) =>
        areDomSnapshotsEqual(nextSnapshot, previous) ? previous : nextSnapshot,
      );
    };

    update();
    const observer = new MutationObserver(() => {
      update();
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeFilter: ["class", "aria-selected", "data-selected", "data-state", "title", "id"],
    });
    return () => {
      observer.disconnect();
    };
  }, [rootRef]);

  return { portalHosts, snapshot };
}

export function SpecHubSurfaceFrame({
  children,
  workspaceId,
  workspaceName,
  files,
  directories,
  surfaceMode = "embedded",
  detachedReaderSession = null,
}: SpecHubSurfaceFrameProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const applyTimerRef = useRef<number | null>(null);
  const { t } = useTranslation();
  const { portalHosts, snapshot } = useDomSnapshot(rootRef);
  const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
  const isDetached = surfaceMode === "detached";
  const {
    changesCollapsed,
    setChangesCollapsed,
    outlineCollapsed,
    setOutlineCollapsed,
    changesWidth,
    isDraggingChanges,
    handleChangesResizeStart,
  } = useSpecHubSurfaceLayout({
    surfaceMode,
    rootRef,
    controlCollapsed: snapshot.controlCollapsed,
    artifactMaximized: snapshot.artifactMaximized,
  });

  useEffect(() => {
    setActiveOutlineId((previous) =>
      previous && snapshot.outline.some((item) => item.id === previous)
        ? previous
        : snapshot.outline[0]?.id ?? null,
    );
  }, [snapshot.outline]);

  useEffect(() => {
    if (!isDetached || !detachedReaderSession) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    const run = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const root = rootRef.current;
      if (!(root instanceof HTMLElement)) {
        if (attempts < 30) {
          applyTimerRef.current = window.setTimeout(run, 120);
        }
        return;
      }
      const changed = applyDetachedReaderSession(root, detachedReaderSession);
      if (changed && attempts < 30) {
        applyTimerRef.current = window.setTimeout(run, 120);
      }
    };
    run();
    return () => {
      cancelled = true;
      if (applyTimerRef.current !== null) {
        window.clearTimeout(applyTimerRef.current);
        applyTimerRef.current = null;
      }
    };
  }, [detachedReaderSession, isDetached]);

  useEffect(() => {
    if (!isDetached || !workspaceId || !workspaceName) {
      return;
    }
    writeDetachedSpecHubSessionSnapshot(
      buildDetachedSpecHubSession({
        workspaceId,
        workspaceName,
        files,
        directories,
        changeId: snapshot.selectedChangeId,
        artifactType: snapshot.artifactType,
        specSourcePath: snapshot.specSourcePath,
      }),
    );
  }, [
    directories,
    files,
    isDetached,
    snapshot.artifactType,
    snapshot.selectedChangeId,
    snapshot.specSourcePath,
    workspaceId,
    workspaceName,
  ]);

  const handleOpenInWindow = async () => {
    if (!workspaceId || !workspaceName) {
      return;
    }
    await openOrFocusDetachedSpecHub(
      buildDetachedSpecHubSession({
        workspaceId,
        workspaceName,
        files,
        directories,
        changeId: snapshot.selectedChangeId,
        artifactType: snapshot.artifactType,
        specSourcePath: snapshot.specSourcePath,
      }),
    );
  };

  const hasReaderOutline = snapshot.outline.length > 0 || snapshot.proposalCapabilities.length > 0;

  const relatedSpecButtons = useMemo(
    () => Array.from(new Set(snapshot.proposalCapabilities)),
    [snapshot.proposalCapabilities],
  );
  const pendingOutlineIdSet = useMemo(
    () => new Set(snapshot.pendingOutlineIds),
    [snapshot.pendingOutlineIds],
  );
  const rootStyle = useMemo(
    () =>
      ({
        "--spec-hub-changes-width": `${changesWidth}px`,
        "--spec-hub-outline-width": "296px",
      }) as CSSProperties,
    [changesWidth],
  );

  return (
    <div
      ref={rootRef}
      className={`spec-hub-surface spec-hub-surface-${surfaceMode}${
        isDetached ? " detached-spec-hub-window" : ""
      }${changesCollapsed ? " is-changes-collapsed" : ""}${
        outlineCollapsed ? " is-outline-collapsed" : ""
      }`}
      style={rootStyle}
    >
      {children}
      {portalHosts.changesHeader && typeof document !== "undefined" && !snapshot.artifactMaximized
        ? createPortal(
            <div className="spec-hub-pane-header-actions">
              <button
                type="button"
                className="spec-hub-pane-toggle-button"
                onClick={() => setChangesCollapsed(true)}
                aria-label={t("specHub.changePane.collapse")}
                title={t("specHub.changePane.collapse")}
              >
                <PanelLeftClose size={14} aria-hidden="true" />
              </button>
            </div>,
            portalHosts.changesHeader,
          )
        : null}
      {!isDetached && portalHosts.header && typeof document !== "undefined"
        ? createPortal(
            <div className="spec-hub-reader-header-actions inline-flex items-center gap-2">
              {hasReaderOutline ? (
                <button
                  type="button"
                  className="spec-hub-pane-toggle-button"
                  onClick={() => setOutlineCollapsed((previous) => !previous)}
                  aria-label={t(
                    outlineCollapsed
                      ? "specHub.readerOutline.expand"
                      : "specHub.readerOutline.collapse",
                  )}
                  title={t(
                    outlineCollapsed
                      ? "specHub.readerOutline.expand"
                      : "specHub.readerOutline.collapse",
                  )}
                >
                  {outlineCollapsed ? (
                    <PanelRightOpen size={14} aria-hidden="true" />
                  ) : (
                    <PanelRightClose size={14} aria-hidden="true" />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                className="spec-hub-reader-detach-button inline-flex items-center gap-1.5 border border-[color:var(--border-subtle)] rounded-full bg-[color:var(--surface-item)] text-[color:var(--text-secondary)] px-2.5 py-[5px] text-[11px] font-semibold hover:not-disabled:text-[color:var(--text-stronger)] hover:not-disabled:border-[color:var(--border-strong)] disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => {
                  void handleOpenInWindow();
                }}
                disabled={!workspaceId || !snapshot.selectedChangeId}
                title={t("specHub.openInWindow")}
                aria-label={t("specHub.openInWindow")}
              >
                <ExternalLink size={14} aria-hidden="true" />
                <span>{t("specHub.openInWindow")}</span>
              </button>
            </div>,
            portalHosts.header,
          )
        : null}
      {isDetached && portalHosts.header && typeof document !== "undefined" && hasReaderOutline
        ? createPortal(
            <div className="spec-hub-reader-header-actions">
              <button
                type="button"
                className="spec-hub-pane-toggle-button"
                onClick={() => setOutlineCollapsed((previous) => !previous)}
                aria-label={t(
                  outlineCollapsed
                    ? "specHub.readerOutline.expand"
                    : "specHub.readerOutline.collapse",
                )}
                title={t(
                  outlineCollapsed
                    ? "specHub.readerOutline.expand"
                    : "specHub.readerOutline.collapse",
                )}
              >
                {outlineCollapsed ? (
                  <PanelRightOpen size={14} aria-hidden="true" />
                ) : (
                  <PanelRightClose size={14} aria-hidden="true" />
                )}
              </button>
            </div>,
            portalHosts.header,
          )
        : null}
      {hasReaderOutline && portalHosts.outline && typeof document !== "undefined" && !outlineCollapsed
        ? createPortal(
            <section className="spec-hub-reader-outline flex flex-col gap-2 border border-[color:var(--border-subtle)] rounded-lg bg-[color-mix(in_srgb,var(--surface-card)_88%,var(--surface-command)_12%)] px-3 py-2.5" aria-label={t("specHub.readerOutline.title")}>
              <header className="spec-hub-reader-outline-head flex items-center justify-between gap-2 text-[color:var(--text-secondary)] text-[11px]">
                <strong className="text-[color:var(--text-stronger)] text-[12px]">{t("specHub.readerOutline.title")}</strong>
                <span>{snapshot.outline.length}</span>
              </header>
              {snapshot.outline.length > 0 ? (
                <div className="spec-hub-reader-outline-list flex flex-col gap-1 max-h-[180px] overflow-auto">
                  {snapshot.outline.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`spec-hub-reader-outline-button${
                        activeOutlineId === item.id ? " is-active" : ""
                      }${pendingOutlineIdSet.has(item.id) ? " is-pending" : ""} w-full inline-flex items-center justify-start gap-1.5 border rounded-lg bg-transparent text-[color:var(--text-secondary)] py-[5px] pr-2 text-[12px] text-left hover:text-[color:var(--text-stronger)] hover:border-[color:var(--border-subtle)] hover:bg-[color-mix(in_srgb,var(--surface-item)_72%,transparent)] focus-visible:text-[color:var(--text-stronger)] focus-visible:border-[color:var(--border-subtle)] focus-visible:bg-[color-mix(in_srgb,var(--surface-item)_72%,transparent)]${activeOutlineId === item.id ? " text-[color:var(--text-stronger)] border-[color-mix(in_srgb,var(--accent)_30%,var(--border-subtle))] bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface-item))]" : " border-transparent"}${pendingOutlineIdSet.has(item.id) && activeOutlineId !== item.id ? " border-[color-mix(in_srgb,#ffaf55_30%,transparent)]" : ""}`}
                      style={{ paddingInlineStart: `${12 + Math.max(0, item.level - 1) * 14}px` }}
                      onClick={() => {
                        if (!(rootRef.current instanceof HTMLElement)) {
                          return;
                        }
                        scrollToOutlineItem(rootRef.current, item);
                        setActiveOutlineId(item.id);
                      }}
                    >
                      <span className="spec-hub-reader-outline-label flex-[1_1_auto] min-w-0">{item.title}</span>
                      {pendingOutlineIdSet.has(item.id) ? (
                        <span className="spec-hub-reader-outline-pending-dot w-2 h-2 ml-auto rounded-full bg-[color-mix(in_srgb,#ffaf55_92%,white_8%)] [box-shadow:0_0_0_2px_color-mix(in_srgb,var(--surface-card)_92%,transparent)] flex-[0_0_auto]" aria-hidden="true" />
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="spec-hub-reader-outline-empty m-0 text-[11px] text-[color:var(--text-muted)]">
                  {t("specHub.readerOutline.empty")}
                </p>
              )}
              {snapshot.artifactType === "proposal" && relatedSpecButtons.length > 0 ? (
                <div className="spec-hub-reader-related-specs flex flex-col gap-1.5">
                  <strong className="text-[color:var(--text-stronger)] text-[12px]">{t("specHub.readerOutline.linkedSpecs")}</strong>
                  <div className="spec-hub-reader-related-spec-list flex flex-wrap gap-1.5">
                    {relatedSpecButtons.map((capabilityId) => (
                      <button
                        key={capabilityId}
                        type="button"
                        className="spec-hub-reader-related-spec-button w-auto inline-flex items-center justify-start gap-1.5 border border-[color:var(--border-subtle)] rounded-lg bg-[color:var(--surface-item)] text-[color:var(--text-secondary)] py-[5px] px-2 text-[12px] text-left whitespace-nowrap hover:text-[color:var(--text-stronger)] hover:border-[color:var(--border-subtle)] hover:bg-[color-mix(in_srgb,var(--surface-item)_72%,transparent)] focus-visible:text-[color:var(--text-stronger)] focus-visible:border-[color:var(--border-subtle)] focus-visible:bg-[color-mix(in_srgb,var(--surface-item)_72%,transparent)]"
                        onClick={() => {
                          const root = rootRef.current;
                          if (!(root instanceof HTMLElement)) {
                            return;
                          }
                          if (selectArtifactTab(root, "specs")) {
                            window.setTimeout(() => {
                              if (rootRef.current instanceof HTMLElement) {
                                selectSpecSourceByCapability(rootRef.current, capabilityId);
                              }
                            }, 120);
                            return;
                          }
                          selectSpecSourceByCapability(root, capabilityId);
                        }}
                      >
                        {capabilityId}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>,
            portalHosts.outline,
          )
        : null}
      {portalHosts.grid && typeof document !== "undefined" && !snapshot.artifactMaximized
        ? createPortal(
            <>
              {changesCollapsed ? (
              <button
                type="button"
                className="spec-hub-changes-expand-button"
                onClick={() => setChangesCollapsed(false)}
                aria-label={t("specHub.changePane.expand")}
                title={t("specHub.changePane.expand")}
              >
                <ChevronRight size={16} aria-hidden="true" />
              </button>
            ) : (
                <div
                  className={`spec-hub-changes-resizer${isDraggingChanges ? " is-dragging" : ""}`}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={t("specHub.changePane.resize")}
                  onPointerDown={handleChangesResizeStart}
                />
              )}
            </>,
            portalHosts.grid,
          )
        : null}
    </div>
  );
}
