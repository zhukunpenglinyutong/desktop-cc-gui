import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import type {
  EngineType,
  ConversationItem,
} from "../../../../../../types";
import type { WorkspaceSessionCatalogEntry } from "../../../../../../services/tauri/sessionManagement";
import {
  loadClaudeSession,
  loadCodexSession,
  loadGeminiSession,
} from "../../../../../../services/tauri";
import { parseClaudeHistoryMessages } from "../../../../../threads/loaders/claudeHistoryLoader";
import { parseGeminiHistoryMessages } from "../../../../../threads/loaders/geminiHistoryParser";
import { parseCodexSessionHistory } from "../../../../../threads/loaders/codexSessionHistory";
import { formatUpdatedAt } from "./formatUpdatedAt";
import { ReadOnlyTimelineViewer } from "./ReadOnlyTimelineViewer";

type SessionDetailModalProps = {
  workspaceId: string;
  workspacePath?: string | null;
  entry: WorkspaceSessionCatalogEntry;
  folderPath: string[];
  locale: string;
  onClose: () => void;
  onOpenInMainWindow?: (entry: WorkspaceSessionCatalogEntry) => void;
};

function normalizeEngine(engine: string): EngineType {
  if (engine === "claude" || engine === "gemini" || engine === "opencode") {
    return engine;
  }
  return "codex";
}

function stripEnginePrefix(engine: EngineType, sessionId: string): string {
  const prefix = `${engine}:`;
  return sessionId.startsWith(prefix) ? sessionId.slice(prefix.length) : sessionId;
}

async function loadHistoryItems(
  engine: EngineType,
  workspaceId: string,
  workspacePath: string | null,
  sessionId: string,
): Promise<ConversationItem[]> {
  if (engine === "claude") {
    if (!workspacePath) {
      throw new Error("workspace-path-required");
    }
    const result = await loadClaudeSession(
      workspacePath,
      stripEnginePrefix("claude", sessionId),
    );
    const record = (result ?? {}) as { messages?: unknown };
    const messagesData = record.messages ?? result;
    return parseClaudeHistoryMessages(messagesData, workspacePath);
  }
  if (engine === "gemini") {
    if (!workspacePath) {
      throw new Error("workspace-path-required");
    }
    const result = await loadGeminiSession(
      workspacePath,
      stripEnginePrefix("gemini", sessionId),
    );
    const record = (result ?? {}) as { messages?: unknown };
    const messagesData = record.messages ?? result;
    return parseGeminiHistoryMessages(messagesData);
  }
  if (engine === "codex") {
    const result = await loadCodexSession(workspaceId, sessionId);
    return parseCodexSessionHistory(result);
  }
  // opencode and other engines not yet supported in this read-only viewer
  throw new Error("engine-not-supported");
}

export function SessionDetailModal({
  workspaceId,
  workspacePath,
  entry,
  folderPath,
  locale,
  onClose,
  onOpenInMainWindow,
}: SessionDetailModalProps) {
  const { t } = useTranslation();
  const engine = normalizeEngine(entry.engine);
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setItems([]);
    loadHistoryItems(engine, workspaceId, workspacePath ?? null, entry.sessionId)
      .then((parsed) => {
        if (cancelled) return;
        const messageOnly = parsed.filter((item) => item.kind === "message");
        setItems(messageOnly);
        setIsLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        const raw = error instanceof Error ? error.message : String(error);
        let friendly = raw;
        if (raw === "workspace-path-required") {
          friendly = t("settings.sessionOrganizationModalWorkspacePathMissing");
        } else if (raw === "engine-not-supported") {
          friendly = t("settings.sessionOrganizationModalEngineUnsupported", {
            engine: entry.engine,
          });
        }
        setLoadError(friendly);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engine, entry.engine, entry.sessionId, t, workspaceId, workspacePath]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const title = entry.title.trim() || t("settings.projectSessionItemUntitled");
  const folderPathLabel = useMemo(() => {
    if (folderPath.length === 0) {
      return t("settings.sessionOrganizationUnfiledNodeLabel");
    }
    return folderPath.join(" / ");
  }, [folderPath, t]);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="session-organization-modal-backdrop"
      role="presentation"
      onClick={onClose}
      data-testid="session-organization-modal-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1150,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-organization-modal-title"
        className="session-organization-modal"
        data-testid="session-organization-modal"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: "85vw",
          height: "85vh",
          maxWidth: "1400px",
          background: "var(--background, #fff)",
          color: "inherit",
          borderRadius: "10px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <header
          className="session-organization-modal-header"
          style={{
            padding: "0.75rem 1rem",
            borderBottom: "1px solid var(--border, rgba(0,0,0,0.1))",
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
          }}
        >
          <div
            className="session-organization-modal-meta"
            style={{ flex: 1, minWidth: 0 }}
          >
            <h3
              id="session-organization-modal-title"
              className="session-organization-modal-title"
              style={{
                margin: 0,
                fontSize: "1rem",
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </h3>
            <div
              className="session-organization-modal-meta-row"
              style={{
                marginTop: "0.25rem",
                fontSize: "0.8125rem",
                opacity: 0.75,
                display: "flex",
                flexWrap: "wrap",
                gap: "0.5rem",
              }}
            >
              <span data-testid="session-organization-modal-meta-engine">
                {t("settings.sessionOrganizationModalEngine", {
                  engine: entry.engine,
                })}
              </span>
              <span>·</span>
              <span>
                {t("settings.sessionOrganizationModalUpdated", {
                  value: formatUpdatedAt(entry.updatedAt, locale),
                })}
              </span>
              <span>·</span>
              <span data-testid="session-organization-modal-meta-folder-path">
                {t("settings.sessionOrganizationModalFolderPath", {
                  path: folderPathLabel,
                })}
              </span>
              {entry.parentSessionId ? (
                <>
                  <span>·</span>
                  <span data-testid="session-organization-modal-meta-parent-session">
                    {t("settings.sessionOrganizationModalParentSession", {
                      id: entry.parentSessionId,
                    })}
                  </span>
                </>
              ) : null}
            </div>
          </div>
          <div
            className="session-organization-modal-actions"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
            }}
          >
            <button
              type="button"
              className="session-organization-modal-open-button"
              data-testid="session-organization-modal-open-in-main"
              onClick={() => {
                onOpenInMainWindow?.(entry);
              }}
              disabled={!onOpenInMainWindow}
              title={
                onOpenInMainWindow
                  ? undefined
                  : t("settings.sessionOrganizationModalOpenInMainNotWired")
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                padding: "0.375rem 0.75rem",
                fontSize: "0.8125rem",
                borderRadius: "6px",
                border: "1px solid var(--border, rgba(0,0,0,0.15))",
                background: "transparent",
                cursor: onOpenInMainWindow ? "pointer" : "not-allowed",
                opacity: onOpenInMainWindow ? 1 : 0.6,
              }}
            >
              <ExternalLink size={14} aria-hidden />
              <span>{t("settings.sessionOrganizationModalOpenInMain")}</span>
            </button>
            <button
              type="button"
              className="session-organization-modal-close"
              data-testid="session-organization-modal-close"
              onClick={onClose}
              aria-label={t("settings.sessionOrganizationModalCloseAria")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "2rem",
                height: "2rem",
                borderRadius: "6px",
                border: "1px solid transparent",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        </header>
        <div
          className="session-organization-modal-body"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
            padding: "1rem",
          }}
        >
          {loadError ? (
            <div
              role="alert"
              data-testid="session-organization-modal-error"
              style={{ color: "var(--destructive, #c0392b)" }}
            >
              {t("settings.sessionOrganizationModalLoadError", {
                error: loadError,
              })}
            </div>
          ) : isLoading ? (
            <div data-testid="session-organization-modal-loading">
              {t("settings.sessionOrganizationModalLoading")}
            </div>
          ) : (
            <ReadOnlyTimelineViewer
              items={items}
              engine={engine}
              workspaceId={workspaceId}
              threadId={entry.sessionId}
              emptyMessage={t("settings.sessionOrganizationModalEmpty")}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
