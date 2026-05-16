import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Lock from "lucide-react/dist/esm/icons/lock";
import appIcon from "../../../../icon.png";
import { cn } from "@/lib/utils";

const PANEL_CLASS =
  "panel-lock-panel rounded-2xl border border-border bg-card/85 shadow-2xl";

const FACT_CLASS =
  "panel-lock-fact rounded-xl border border-border bg-muted/80 px-2.5 py-2 [&>span]:block [&>span]:mb-1 [&>span]:text-muted-foreground [&>span]:text-[11px] [&>strong]:text-foreground [&>strong]:text-[13px]";

const CONTENT_CARD_CLASS =
  "rounded-xl border border-border bg-muted/70 px-2.5 py-2 [&_h4]:m-0 [&_h4]:text-foreground [&_h4]:text-[13px] [&_p]:m-0 [&_p]:mt-1 [&_p]:text-muted-foreground [&_p]:text-xs [&_p]:leading-snug";

type FeatureCard = {
  titleKey: string;
  descriptionKey: string;
};

type JourneyStep = {
  titleKey: string;
  descriptionKey: string;
};

type LockScreenOverlayProps = {
  isOpen: boolean;
  onUnlock: (password: string) => Promise<boolean>;
  liveSessions: LiveSessionPreview[];
};

type LockTabId = "live" | "capabilities" | "workflow" | "elements";

type LiveSessionPreview = {
  id: string;
  workspaceName: string;
  threadName: string;
  engine: string;
  preview: string;
  updatedAt: number;
  isProcessing: boolean;
};

const capabilityNodes: FeatureCard[] = [
  {
    titleKey: "lockScreen.features.workspaceGraphTitle",
    descriptionKey: "lockScreen.features.workspaceGraphDesc",
  },
  {
    titleKey: "lockScreen.features.engineRoutingTitle",
    descriptionKey: "lockScreen.features.engineRoutingDesc",
  },
  {
    titleKey: "lockScreen.features.threadOrchestrationTitle",
    descriptionKey: "lockScreen.features.threadOrchestrationDesc",
  },
  {
    titleKey: "lockScreen.features.gitIntelligenceTitle",
    descriptionKey: "lockScreen.features.gitIntelligenceDesc",
  },
];

const capabilityHighlights: FeatureCard[] = [
  {
    titleKey: "lockScreen.features.kanbanDispatchTitle",
    descriptionKey: "lockScreen.features.kanbanDispatchDesc",
  },
  {
    titleKey: "lockScreen.features.memoryEngineTitle",
    descriptionKey: "lockScreen.features.memoryEngineDesc",
  },
  {
    titleKey: "lockScreen.features.unifiedSearchTitle",
    descriptionKey: "lockScreen.features.unifiedSearchDesc",
  },
  {
    titleKey: "lockScreen.features.terminalObservabilityTitle",
    descriptionKey: "lockScreen.features.terminalObservabilityDesc",
  },
];

const workflowSteps: JourneyStep[] = [
  {
    titleKey: "lockScreen.journey.planTitle",
    descriptionKey: "lockScreen.journey.planDesc",
  },
  {
    titleKey: "lockScreen.journey.executeTitle",
    descriptionKey: "lockScreen.journey.executeDesc",
  },
  {
    titleKey: "lockScreen.journey.reviewTitle",
    descriptionKey: "lockScreen.journey.reviewDesc",
  },
  {
    titleKey: "lockScreen.journey.deliverTitle",
    descriptionKey: "lockScreen.journey.deliverDesc",
  },
];

const elementCards: FeatureCard[] = [
  {
    titleKey: "lockScreen.elements.titlebarTitle",
    descriptionKey: "lockScreen.elements.titlebarDesc",
  },
  {
    titleKey: "lockScreen.elements.sidebarTitle",
    descriptionKey: "lockScreen.elements.sidebarDesc",
  },
  {
    titleKey: "lockScreen.elements.composerTitle",
    descriptionKey: "lockScreen.elements.composerDesc",
  },
  {
    titleKey: "lockScreen.elements.gitPanelTitle",
    descriptionKey: "lockScreen.elements.gitPanelDesc",
  },
  {
    titleKey: "lockScreen.elements.kanbanTitle",
    descriptionKey: "lockScreen.elements.kanbanDesc",
  },
  {
    titleKey: "lockScreen.elements.searchTitle",
    descriptionKey: "lockScreen.elements.searchDesc",
  },
  {
    titleKey: "lockScreen.elements.memoryTitle",
    descriptionKey: "lockScreen.elements.memoryDesc",
  },
  {
    titleKey: "lockScreen.elements.debugTitle",
    descriptionKey: "lockScreen.elements.debugDesc",
  },
];

const PASSWORD_STORAGE_PATH = "~/.ccgui/client/pwd.txt";

export function LockScreenOverlay({
  isOpen,
  onUnlock,
  liveSessions,
}: LockScreenOverlayProps) {
  const { t } = useTranslation();
  const unlockInputRef = useRef<HTMLInputElement | null>(null);
  const liveListRef = useRef<HTMLDivElement | null>(null);
  const [unlockInput, setUnlockInput] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [activeTab, setActiveTab] = useState<LockTabId>("live");

  useEffect(() => {
    if (!isOpen) {
      setUnlockInput("");
      setUnlockError(null);
      setUnlocking(false);
      setActiveTab("live");
      return;
    }
    window.setTimeout(() => {
      unlockInputRef.current?.focus();
      unlockInputRef.current?.select();
    }, 32);
  }, [isOpen]);

  const tabItems = useMemo(
    () => [
      { id: "live" as const, label: t("lockScreen.tabs.live") },
      { id: "capabilities" as const, label: t("lockScreen.tabs.capabilities") },
      { id: "workflow" as const, label: t("lockScreen.tabs.workflow") },
      { id: "elements" as const, label: t("lockScreen.tabs.elements") },
    ],
    [t],
  );

  const displayedLiveSessions = liveSessions;
  const liveRowCount = Math.max(displayedLiveSessions.length, 1);

  useEffect(() => {
    if (activeTab !== "live") {
      return;
    }
    liveListRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeTab]);

  if (!isOpen) {
    return null;
  }

  const handleUnlock = async () => {
    if (unlocking) {
      return;
    }
    setUnlocking(true);
    const success = await onUnlock(unlockInput);
    setUnlocking(false);
    if (success) {
      setUnlockError(null);
      return;
    }
    setUnlockError(t("lockScreen.invalidPassword"));
  };

  return (
    <div
      className={cn(
        "panel-lock-overlay fixed inset-0 z-[120]",
        "flex items-center justify-center p-3 overflow-hidden [-webkit-app-region:no-drag]",
      )}
      role="dialog"
      aria-modal="true"
    >
      <div className="panel-lock-overlay-backdrop absolute inset-0 backdrop-blur-xl bg-background/80" />
      <div
        className={cn(
          "panel-lock-shell relative z-[1] w-full max-w-[1120px]",
          "max-h-[min(760px,calc(100vh-24px))] h-[min(760px,calc(100vh-24px))]",
          "grid gap-3",
          "grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,360px)]",
        )}
        data-tauri-drag-region="false"
      >
        <section className={cn("panel-lock-atlas grid grid-rows-[auto_auto_minmax(0,1fr)] gap-2.5 p-3.5 min-h-0", PANEL_CLASS)}>
          <header className="panel-lock-hero flex flex-col gap-2.5">
            <div className="panel-lock-brand flex items-center gap-3">
              <img
                src={appIcon}
                alt="ccgui"
                className="panel-lock-logo size-[68px] rounded-2xl border border-border shadow-xl"
              />
              <div>
                <p className="panel-lock-brand-kicker m-0 text-[11px] tracking-widest uppercase text-primary">
                  {t("lockScreen.brandKicker")}
                </p>
                <h2 className="mt-0.5 text-foreground text-[38px] leading-[1.08] tracking-tight font-heading">
                  {t("lockScreen.title")}
                </h2>
              </div>
            </div>
            <p className="panel-lock-hero-description m-0 text-muted-foreground text-[13px] leading-relaxed">
              {t("lockScreen.description")}
            </p>
            <div className="panel-lock-facts grid grid-cols-1 sm:grid-cols-3 gap-2">
              <article className={FACT_CLASS}>
                <span>{t("lockScreen.facts.integrationsLabel")}</span>
                <strong>{t("lockScreen.facts.integrationsValue")}</strong>
              </article>
              <article className={FACT_CLASS}>
                <span>{t("lockScreen.facts.workflowLabel")}</span>
                <strong>{t("lockScreen.facts.workflowValue")}</strong>
              </article>
              <article className={FACT_CLASS}>
                <span>{t("lockScreen.facts.runtimeLabel")}</span>
                <strong>{t("lockScreen.facts.runtimeValue")}</strong>
              </article>
            </div>
          </header>

          <div
            className="panel-lock-tabs grid grid-cols-2 sm:grid-cols-4 gap-2"
            role="tablist"
            aria-label={t("lockScreen.tabLabel")}
          >
            {tabItems.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={cn(
                    "panel-lock-tab rounded-xl px-2.5 py-2 text-xs font-bold transition-colors border",
                    active
                      ? "is-active border-primary bg-secondary text-foreground"
                      : "border-border bg-card/85 text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setActiveTab(tab.id)}
                  data-tauri-drag-region="false"
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div
            className={cn(
              "panel-lock-content min-h-0 rounded-xl border border-border bg-muted/70 p-3 overflow-auto",
              activeTab === "live" && "is-live flex flex-col overflow-hidden",
            )}
            role="tabpanel"
          >
            {activeTab === "live" ? (
              <>
                <div className="panel-lock-content-header">
                  <h3 className="m-0 text-foreground text-xl tracking-tight font-heading">
                    {t("lockScreen.liveTitle")}
                  </h3>
                  <p className="m-0 mt-1.5 text-muted-foreground text-xs leading-snug">
                    {t("lockScreen.liveDesc")}
                  </p>
                </div>
                {displayedLiveSessions.length === 0 ? (
                  <div className="panel-lock-live-empty mt-2.5 rounded-xl border border-dashed border-border bg-muted/70 px-3 py-3 text-muted-foreground text-xs">
                    {t("lockScreen.liveEmpty")}
                  </div>
                ) : (
                  <div
                    className="panel-lock-live-list mt-2.5 grid gap-2 flex-1 min-h-0 overflow-auto"
                    ref={liveListRef}
                    style={{
                      gridTemplateRows: `repeat(${liveRowCount}, minmax(var(--panel-lock-live-item-min-height,126px), 1fr))`,
                    }}
                  >
                    {displayedLiveSessions.map((session) => (
                      <article
                        key={session.id}
                        className="panel-lock-live-item rounded-xl border border-border bg-muted/60 px-2.5 py-2"
                      >
                        <div className="panel-lock-live-item-head grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
                          <span
                            className={cn(
                              "panel-lock-live-status size-2 rounded-full",
                              session.isProcessing
                                ? "is-running bg-green-500 shadow-[0_0_0_4px_rgba(34,197,94,0.14)]"
                                : "bg-muted-foreground/80",
                            )}
                          />
                          <h4 className="m-0 text-foreground text-[13px] truncate">{session.threadName}</h4>
                          <span className="panel-lock-live-time text-muted-foreground text-[11px]">
                            {new Date(session.updatedAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="panel-lock-live-meta mt-1.5 text-muted-foreground text-[11px]">
                          {session.workspaceName} · {session.engine} · {t("lockScreen.liveRunning")}
                        </p>
                        <p className="panel-lock-live-preview mt-1.5 text-muted-foreground/80 text-xs leading-snug max-h-[3em] overflow-hidden">
                          {session.preview}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : null}

            {activeTab === "capabilities" ? (
              <>
                <div className="panel-lock-content-header">
                  <h3 className="m-0 text-foreground text-xl tracking-tight font-heading">
                    {t("lockScreen.capabilityTitle")}
                  </h3>
                  <p className="m-0 mt-1.5 text-muted-foreground text-xs leading-snug">
                    {t("lockScreen.capabilityDesc")}
                  </p>
                </div>
                <article className="panel-lock-capability-core mt-2.5 rounded-xl border border-primary bg-secondary/60 px-3 py-2.5">
                  <h4 className="m-0 text-foreground text-[13px]">ccgui Core</h4>
                  <p className="m-0 mt-1.5 text-muted-foreground text-xs">
                    {t("lockScreen.facts.workflowValue")}
                  </p>
                </article>
                <div className="panel-lock-capability-grid mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {capabilityNodes.map((card) => (
                    <article
                      key={card.titleKey}
                      className={cn("panel-lock-capability-card", CONTENT_CARD_CLASS)}
                    >
                      <h4>{t(card.titleKey)}</h4>
                      <p>{t(card.descriptionKey)}</p>
                    </article>
                  ))}
                </div>

                <div className="panel-lock-highlight-row mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {capabilityHighlights.map((card) => (
                    <article
                      key={card.titleKey}
                      className={cn("panel-lock-highlight-card", CONTENT_CARD_CLASS)}
                    >
                      <h4>{t(card.titleKey)}</h4>
                      <p>{t(card.descriptionKey)}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}

            {activeTab === "workflow" ? (
              <>
                <div className="panel-lock-content-header">
                  <h3 className="m-0 text-foreground text-xl tracking-tight font-heading">
                    {t("lockScreen.journeyTitle")}
                  </h3>
                  <p className="m-0 mt-1.5 text-muted-foreground text-xs leading-snug">
                    {t("lockScreen.journeyDesc")}
                  </p>
                </div>
                <div className="panel-lock-workflow-list mt-2.5 grid gap-2">
                  {workflowSteps.map((step, index) => (
                    <article
                      key={step.titleKey}
                      className="panel-lock-workflow-item grid grid-cols-[26px_minmax(0,1fr)] gap-2 rounded-xl border border-border bg-muted/60 px-2.5 py-2 [&_h4]:m-0 [&_h4]:text-foreground [&_h4]:text-[13px] [&_p]:m-0 [&_p]:mt-1 [&_p]:text-muted-foreground [&_p]:text-xs [&_p]:leading-snug"
                    >
                      <span className="panel-lock-workflow-index size-6 rounded-full inline-flex items-center justify-center text-primary bg-secondary/70 text-[11px] font-bold">
                        {index + 1}
                      </span>
                      <div>
                        <h4>{t(step.titleKey)}</h4>
                        <p>{t(step.descriptionKey)}</p>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            ) : null}

            {activeTab === "elements" ? (
              <>
                <div className="panel-lock-content-header">
                  <h3 className="m-0 text-foreground text-xl tracking-tight font-heading">
                    {t("lockScreen.elementsTitle")}
                  </h3>
                  <p className="m-0 mt-1.5 text-muted-foreground text-xs leading-snug">
                    {t("lockScreen.elementsDesc")}
                  </p>
                </div>
                <div className="panel-lock-card-grid mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {elementCards.map((card, index) => (
                    <article
                      key={card.titleKey}
                      className={cn("panel-lock-card", CONTENT_CARD_CLASS)}
                    >
                      <span className="panel-lock-card-index inline-flex rounded-full px-1.5 py-px bg-secondary/70 text-primary text-[10px]">
                        {(index + 1).toString().padStart(2, "0")}
                      </span>
                      <h4 className="mt-1.5">{t(card.titleKey)}</h4>
                      <p>{t(card.descriptionKey)}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </section>

        <aside
          className={cn("panel-lock-auth min-h-0 p-3.5 flex flex-col overflow-auto lg:overflow-visible", PANEL_CLASS)}
          data-tauri-drag-region="false"
        >
          <span className="panel-lock-badge w-fit inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-secondary/70 text-primary px-2.5 py-1 text-xs font-semibold">
            <Lock size={14} />
            {t("lockScreen.locked")}
          </span>
          <h3 className="mt-3 mb-0 text-foreground text-[26px] leading-[1.1] tracking-tight font-heading">
            {t("lockScreen.unlockTitle")}
          </h3>
          <p className="mt-2 mb-0 text-muted-foreground text-[13px] leading-relaxed">
            {t("lockScreen.unlockDesc")}
          </p>

          <label className="panel-lock-label mt-3.5 mb-1.5 text-muted-foreground text-xs font-semibold" htmlFor="panel-lock-password">
            {t("lockScreen.passwordInput")}
          </label>
          <input
            id="panel-lock-password"
            ref={unlockInputRef}
            type="password"
            value={unlockInput}
            onChange={(event) => setUnlockInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleUnlock();
              }
            }}
            className={cn(
              "panel-lock-input w-full rounded-xl border border-border bg-input text-foreground text-[13px] px-3 py-2.5",
              "focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/30",
            )}
            placeholder={t("lockScreen.passwordPlaceholder")}
            data-tauri-drag-region="false"
          />
          {unlockError ? (
            <p className="panel-lock-error mt-2 text-xs text-destructive">{unlockError}</p>
          ) : (
            <p className="panel-lock-hint mt-2 text-xs text-muted-foreground">{t("lockScreen.passwordHint")}</p>
          )}

          <button
            type="button"
            className={cn(
              "panel-lock-button mt-2.5 w-full rounded-xl border border-primary text-primary-foreground bg-primary",
              "px-3 py-2.5 text-[13px] font-bold transition-opacity",
              "hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed",
            )}
            onClick={() => {
              void handleUnlock();
            }}
            disabled={unlocking}
            data-tauri-drag-region="false"
          >
            {t("lockScreen.unlock")}
          </button>

          <div className="panel-lock-divider my-3 border-t border-border" />
          <h4 className="m-0 text-foreground text-[13px]">{t("lockScreen.storageTitle")}</h4>
          <p className="panel-lock-storage-note mt-2 text-muted-foreground text-xs">
            {t("lockScreen.storageDesc")}
          </p>
          <p className="panel-lock-storage-label mt-2 mb-1 text-muted-foreground text-[11px] uppercase tracking-wider">
            {t("lockScreen.storagePathLabel")}
          </p>
          <code className="panel-lock-storage-path block px-2.5 py-2 rounded-lg border border-border bg-muted/70 text-foreground text-[11px] leading-snug break-all font-mono">
            {PASSWORD_STORAGE_PATH}
          </code>
        </aside>
      </div>
    </div>
  );
}
