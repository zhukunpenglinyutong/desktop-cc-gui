import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Search from "lucide-react/dist/esm/icons/search";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import X from "lucide-react/dist/esm/icons/x";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import HelpCircle from "lucide-react/dist/esm/icons/help-circle";
import CheckSquare from "lucide-react/dist/esm/icons/check-square";
import Square from "lucide-react/dist/esm/icons/square";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Copy from "lucide-react/dist/esm/icons/copy";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import { Markdown } from "../../messages/components/Markdown";
import { useProjectMemory } from "../hooks/useProjectMemory";
import { projectMemoryFacade } from "../services/projectMemoryFacade";
import type {
  ProjectMemoryDiagnosticsResult,
  ProjectMemoryReconcileResult,
} from "../../../services/tauri";
import type { WorkspaceInfo } from "../../../types";
import { isLikelyPollutedMemory } from "../utils/memoryMarkers";
import {
  deriveProjectMemoryHealthState,
  deriveProjectMemoryReviewState,
  getProjectMemoryDisplayRecordKind,
  isConversationTurnMemory,
  resolveProjectMemoryCompactSummary,
  resolveProjectMemoryCompactTitle,
  resolveProjectMemoryDetailText,
  resolveProjectMemorySourceLocator,
  type ProjectMemoryHealthState,
  type ProjectMemoryReviewState,
} from "../utils/projectMemoryDisplay";
import {
  getManualMemoryInjectionMode,
  setManualMemoryInjectionMode,
} from "../utils/manualInjectionMode";
/* project-memory.css migrated to inline Tailwind — CSS file deleted */

function parseTagTerms(value: string): string[] {
  return value
    .split(/[，,]/)
    .map((entry) => entry.trim())
    .filter((entry, index, arr) => entry.length > 0 && arr.indexOf(entry) === index);
}

type MemoryDetailSection = {
  label: string;
  content: string;
};

const DETAIL_SECTION_MARKER_REGEX =
  /(用户输入|AI 回复|AI 思考摘要|助手输出摘要|助手输出|User input|Assistant response|Assistant thinking summary|Assistant summary|Assistant output)[:：]/gi;

const DEFAULT_VISIBLE_QUICK_TAG_COUNT = 8;

function normalizeDetailSectionLabel(raw: string): string {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "user input") {
    return "User input";
  }
  if (normalized === "assistant summary") {
    return "Assistant summary";
  }
  if (normalized === "assistant output") {
    return "Assistant output";
  }
  return raw.trim();
}

function parseMemoryDetailSections(detail: string): MemoryDetailSection[] {
  const text = detail.trim();
  if (!text) {
    return [];
  }
  const matches = Array.from(
    text.matchAll(
      new RegExp(DETAIL_SECTION_MARKER_REGEX.source, DETAIL_SECTION_MARKER_REGEX.flags),
    ),
  );
  if (matches.length === 0) {
    return [];
  }
  const sections: MemoryDetailSection[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    if (!current || current.index === undefined) {
      continue;
    }
    const rawLabel = current[1] ?? "";
    const start = current.index + current[0].length;
    const next = matches[i + 1];
    const end = next?.index ?? text.length;
    const content = text.slice(start, end).trim();
    if (!content) {
      continue;
    }
    sections.push({
      label: normalizeDetailSectionLabel(rawLabel),
      content,
    });
  }
  return sections;
}

type ProjectMemoryPanelProps = {
  workspaceId: string | null;
  workspaces?: readonly Pick<WorkspaceInfo, "id" | "name" | "path" | "connected">[];
  onSelectWorkspace?: (workspaceId: string) => void;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  focusMemoryId?: string | null;
  focusRequestKey?: number;
};

export function ProjectMemoryPanel({
  workspaceId,
  workspaces = [],
  onSelectWorkspace,
  filePanelMode: _filePanelMode,
  onFilePanelModeChange,
  focusMemoryId = null,
  focusRequestKey = 0,
}: ProjectMemoryPanelProps) {
  const { t, i18n } = useTranslation();
  const kindLabel = (value: string) => {
    switch (value) {
      case "project_context":
        return t("memory.kind.projectContext");
      case "conversation":
        return t("memory.kind.conversation");
      case "code_decision":
        return t("memory.kind.codeDecision");
      case "known_issue":
        return t("memory.kind.knownIssue");
      case "note":
        return t("memory.kind.note");
      default:
        return value;
    }
  };
  const importanceLabel = (value: string) => {
    switch (value) {
      case "high":
        return t("memory.importance.high");
      case "medium":
        return t("memory.importance.medium");
      case "low":
        return t("memory.importance.low");
      default:
        return value;
    }
  };
  const recordKindLabel = (value: ReturnType<typeof getProjectMemoryDisplayRecordKind>) => {
    switch (value) {
      case "conversation_turn":
        return t("memory.recordKind.conversationTurn");
      case "manual_note":
        return t("memory.recordKind.manualNote");
      case "legacy":
        return t("memory.recordKind.legacy");
      default:
        return value;
    }
  };
  const healthStateLabel = (value: ProjectMemoryHealthState) => {
    switch (value) {
      case "complete":
        return t("memory.health.complete");
      case "input_only":
        return t("memory.health.inputOnly");
      case "assistant_only":
        return t("memory.health.assistantOnly");
      case "pending_fusion":
        return t("memory.health.pendingFusion");
      case "capture_failed":
        return t("memory.health.captureFailed");
      default:
        return value;
    }
  };
  const reviewStateLabel = (value: ProjectMemoryReviewState) => {
    switch (value) {
      case "unreviewed":
        return t("memory.review.unreviewed");
      case "kept":
        return t("memory.review.kept");
      case "converted":
        return t("memory.review.converted");
      case "obsolete":
        return t("memory.review.obsolete");
      case "dismissed":
        return t("memory.review.dismissed");
      default:
        return value;
    }
  };
  const {
    items,
    loading,
    error,
    query,
    kind,
    importance,
    tag,
    total,
    page,
    pageSize,
    selectedId,
    selectedItem,
    detailLoading,
    detailError,
    workspaceAutoEnabled,
    settingsLoading,
    setQuery,
    setKind,
    setImportance,
    setTag,
    setPage,
    setSelectedId,
    toggleWorkspaceAutoCapture,
    refresh,
    updateMemory,
    deleteMemory,
  } = useProjectMemory({
    workspaceId,
    preferredSelectedId: focusMemoryId,
    preferredSelectionKey: focusRequestKey,
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [managerOpen, setManagerOpen] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [batchUpdating, setBatchUpdating] = useState(false);
  const [detailTextDraft, setDetailTextDraft] = useState("");
  const [detailSaving, setDetailSaving] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [showAllQuickTags, setShowAllQuickTags] = useState(false);
  const [pollutionCandidateIds, setPollutionCandidateIds] = useState<string[]>([]);
  const [pollutionScannedTotal, setPollutionScannedTotal] = useState(0);
  const [pollutionBusy, setPollutionBusy] = useState<"scan" | "cleanup" | null>(null);
  const [pollutionMessage, setPollutionMessage] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<ProjectMemoryReviewState | "all">("all");
  const [healthFilter, setHealthFilter] = useState<ProjectMemoryHealthState | "all">("all");
  const [diagnostics, setDiagnostics] = useState<ProjectMemoryDiagnosticsResult | null>(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState<"diagnostics" | "dry-run" | "apply" | null>(null);
  const [reconcileResult, setReconcileResult] = useState<ProjectMemoryReconcileResult | null>(null);
  const [showReconcileApplyConfirm, setShowReconcileApplyConfirm] = useState(false);
  const [manualInjectionMode, setManualInjectionModeState] = useState<
    "summary" | "detail"
  >(() => getManualMemoryInjectionMode());
  const workspaceSelectValue = workspaceId ?? "";
  const hasWorkspacePicker = workspaces.length > 0;

  const emptyMessage = useMemo(() => {
    if (!workspaceId) {
      return t("memory.selectWorkspace");
    }
    if (loading) {
      return t("memory.loading");
    }
    if (items.length === 0) {
      return t("memory.empty");
    }
    return null;
  }, [items.length, loading, t, workspaceId]);
  const detailSections = useMemo(
    () => parseMemoryDetailSections(detailTextDraft),
    [detailTextDraft],
  );
  const selectedRecordKind = useMemo(
    () => (selectedItem ? getProjectMemoryDisplayRecordKind(selectedItem) : null),
    [selectedItem],
  );
  const selectedIsConversationTurn = Boolean(
    selectedItem && isConversationTurnMemory(selectedItem),
  );
  const selectedDetailText = useMemo(() => {
    if (!selectedItem) {
      return "";
    }
    return resolveProjectMemoryDetailText(selectedItem, {
      userInput: t("memory.turnUserInput"),
      assistantResponse: t("memory.turnAssistantResponse"),
      assistantThinkingSummary: t("memory.turnAssistantThinkingSummary"),
      threadId: "threadId",
      turnId: "turnId",
      engine: "engine",
    });
  }, [selectedItem, t]);

  const activeTagTerms = useMemo(() => parseTagTerms(tag), [tag]);

  const availableTags = useMemo(() => {
    const bag = new Set<string>();
    items.forEach((item) => {
      item.tags.forEach((entry) => {
        const normalized = entry.trim();
        if (normalized) {
          bag.add(normalized);
        }
      });
    });
    return Array.from(bag).sort((a, b) => a.localeCompare(b)).slice(0, 24);
  }, [items]);
  const visibleQuickTags = useMemo(
    () =>
      showAllQuickTags
        ? availableTags
        : availableTags.slice(0, DEFAULT_VISIBLE_QUICK_TAG_COUNT),
    [availableTags, showAllQuickTags],
  );
  const hiddenQuickTagCount = Math.max(0, availableTags.length - visibleQuickTags.length);
  const reviewInboxCount = useMemo(
    () =>
      items.filter((item) => deriveProjectMemoryReviewState(item) === "unreviewed").length,
    [items],
  );
  const healthIssueCount = useMemo(
    () =>
      items.filter((item) => deriveProjectMemoryHealthState(item) !== "complete").length,
    [items],
  );
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const reviewState = deriveProjectMemoryReviewState(item);
        const healthState = deriveProjectMemoryHealthState(item);
        return (
          (reviewFilter === "all" || reviewState === reviewFilter) &&
          (healthFilter === "all" || healthState === healthFilter)
        );
      }),
    [healthFilter, items, reviewFilter],
  );
  const selectedSourceLocator = useMemo(
    () => (selectedItem ? resolveProjectMemorySourceLocator(selectedItem) : null),
    [selectedItem],
  );

  useEffect(() => {
    if (!selectedItem) {
      setDetailTextDraft("");
      return;
    }
    setDetailTextDraft(selectedDetailText);
  }, [selectedDetailText, selectedItem]);

  useEffect(() => {
    if (!workspaceId || !focusMemoryId) {
      return;
    }
    setManagerOpen(true);
    setSelectedIds(new Set());
    setQuery("");
    setKind(null);
    setImportance(null);
    setTag("");
    setPage(0);
  }, [
    focusMemoryId,
    focusRequestKey,
    setImportance,
    setKind,
    setPage,
    setQuery,
    setTag,
    workspaceId,
  ]);

  const formatMemoryDateTime = (value?: number) => {
    if (!value || !Number.isFinite(value)) {
      return "--";
    }
    return new Intl.DateTimeFormat(i18n.language || undefined, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  };

  const closeManager = useCallback(() => {
    setManagerOpen(false);
    onFilePanelModeChange("git");
  }, [onFilePanelModeChange]);

  useEffect(() => {
    if (!managerOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeManager();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeManager, managerOpen]);

  const handleScanPollutedMemories = async () => {
    if (!workspaceId) {
      return;
    }
    setPollutionBusy("scan");
    setPollutionMessage(null);
    try {
      const hitIds: string[] = [];
      let scanned = 0;
      let currentPage = 0;
      const scanPageSize = 200;
      let hasNextPage = true;

      // Pull full memory set page-by-page, then dry-run filter on client.
      while (hasNextPage) {
        const response = await projectMemoryFacade.list({
          workspaceId,
          page: currentPage,
          pageSize: scanPageSize,
          importance: null,
          kind: null,
          query: null,
          tag: null,
        });
        if (!response.items.length) {
          break;
        }
        scanned += response.items.length;
        response.items.forEach((item) => {
          if (isLikelyPollutedMemory(item)) {
            hitIds.push(item.id);
          }
        });
        hasNextPage = (currentPage + 1) * scanPageSize < response.total;
        if (hasNextPage) {
          currentPage += 1;
        }
      }

      setPollutionScannedTotal(scanned);
      setPollutionCandidateIds(hitIds);
      setPollutionMessage(
        t("memory.cleanupPreview", {
          matched: hitIds.length,
          scanned,
        }),
      );
    } catch (err) {
      setPollutionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPollutionBusy(null);
    }
  };

  const handleCleanupPollutedMemories = async () => {
    if (!workspaceId || pollutionCandidateIds.length === 0) {
      return;
    }
    setPollutionBusy("cleanup");
    setPollutionMessage(null);
    try {
      const settled = await Promise.allSettled(
        pollutionCandidateIds.map((id) =>
          projectMemoryFacade.delete(id, workspaceId),
        ),
      );
      const successCount = settled.filter((entry) => entry.status === "fulfilled").length;
      const failedCount = settled.length - successCount;
      setPollutionCandidateIds([]);
      setPollutionScannedTotal(0);
      setPollutionMessage(
        t("memory.cleanupResult", {
          success: successCount,
          failed: failedCount,
        }),
      );
      if (successCount > 0) {
        await refresh();
      }
    } catch (err) {
      setPollutionMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setPollutionBusy(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedItem) {
      return;
    }
    setDeleteError(null);
    setShowDeleteConfirm(true);
  };

  const handleSaveManualDetail = async () => {
    if (!selectedItem || selectedIsConversationTurn) {
      return;
    }
    setDetailSaving(true);
    setDeleteError(null);
    try {
      await updateMemory(selectedItem.id, {
        detail: detailTextDraft,
        source: selectedItem.source || "manual",
      });
      setPollutionMessage(t("memory.detailSaved"));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailSaving(false);
    }
  };

  const handleCopySelectedTurn = async () => {
    if (!selectedItem || !selectedIsConversationTurn) {
      return;
    }
    setCopyMessage(null);
    const copyText = resolveProjectMemoryDetailText(selectedItem, {
      userInput: t("memory.turnUserInput"),
      assistantResponse: t("memory.turnAssistantResponse"),
      assistantThinkingSummary: t("memory.turnAssistantThinkingSummary"),
      threadId: "threadId",
      turnId: "turnId",
      engine: "engine",
    });
    try {
      if (!navigator.clipboard) {
        throw new Error(t("memory.copyUnavailable"));
      }
      await navigator.clipboard.writeText(copyText);
      setCopyMessage(t("memory.copyTurnSuccess"));
    } catch (err) {
      setCopyMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleCopySourceLocator = async () => {
    if (!selectedSourceLocator?.available) {
      return;
    }
    const lines = [
      selectedSourceLocator.threadId ? `threadId: ${selectedSourceLocator.threadId}` : null,
      selectedSourceLocator.turnId ? `turnId: ${selectedSourceLocator.turnId}` : null,
      selectedSourceLocator.engine ? `engine: ${selectedSourceLocator.engine}` : null,
    ].filter((entry): entry is string => Boolean(entry));
    try {
      if (!navigator.clipboard) {
        throw new Error(t("memory.copyUnavailable"));
      }
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopyMessage(t("memory.sourceLocatorCopied"));
    } catch (err) {
      setCopyMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSetReviewState = async (nextReviewState: ProjectMemoryReviewState) => {
    if (!selectedItem) {
      return;
    }
    setDetailSaving(true);
    setDeleteError(null);
    try {
      await updateMemory(selectedItem.id, {
        reviewState: nextReviewState,
      });
      setPollutionMessage(
        t("memory.reviewStateUpdated", {
          state: reviewStateLabel(nextReviewState),
        }),
      );
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailSaving(false);
    }
  };

  const handleConvertToManualNote = async () => {
    if (!workspaceId || !selectedItem) {
      return;
    }
    setDetailSaving(true);
    setDeleteError(null);
    try {
      await projectMemoryFacade.create({
        workspaceId,
        recordKind: "manual_note",
        kind: "note",
        title: resolveProjectMemoryCompactTitle(selectedItem),
        summary: resolveProjectMemoryCompactSummary(selectedItem),
        detail: resolveProjectMemoryDetailText(selectedItem, {
          userInput: t("memory.turnUserInput"),
          assistantResponse: t("memory.turnAssistantResponse"),
          assistantThinkingSummary: t("memory.turnAssistantThinkingSummary"),
          threadId: "threadId",
          turnId: "turnId",
          engine: "engine",
        }),
        tags: selectedItem.tags,
        importance: selectedItem.importance,
        source: "manual",
      });
      await updateMemory(selectedItem.id, {
        reviewState: "converted",
      });
      setPollutionMessage(t("memory.reviewConverted"));
      await refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailSaving(false);
    }
  };

  const handleRunDiagnostics = async () => {
    if (!workspaceId) {
      return;
    }
    setDiagnosticsBusy("diagnostics");
    setDeleteError(null);
    try {
      setDiagnostics(await projectMemoryFacade.diagnostics(workspaceId));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const handleRunReconcileDryRun = async () => {
    if (!workspaceId) {
      return;
    }
    setDiagnosticsBusy("dry-run");
    setDeleteError(null);
    try {
      const result = await projectMemoryFacade.reconcile(workspaceId, true);
      setReconcileResult(result);
      setPollutionMessage(t("memory.reconcileDryRunDone", { count: result.fixableCount }));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const handleApplyReconcile = async () => {
    if (!workspaceId) {
      return;
    }
    setShowReconcileApplyConfirm(false);
    setDiagnosticsBusy("apply");
    setDeleteError(null);
    try {
      const result = await projectMemoryFacade.reconcile(workspaceId, false);
      setReconcileResult(result);
      setPollutionMessage(t("memory.reconcileApplyDone", { count: result.fixedCount }));
      await refresh();
      setDiagnostics(await projectMemoryFacade.diagnostics(workspaceId));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDiagnosticsBusy(null);
    }
  };

  const confirmDelete = async () => {
    if (!selectedItem) {
      return;
    }
    setDeleteError(null);
    try {
      await deleteMemory(selectedItem.id);
      setShowDeleteConfirm(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((item) => item.id)));
    }
  };

  const toggleQuickTag = (targetTag: string) => {
    const terms = parseTagTerms(tag);
    const hasTag = terms.includes(targetTag);
    const nextTerms = hasTag
      ? terms.filter((entry) => entry !== targetTag)
      : [...terms, targetTag];
    setTag(nextTerms.join(", "));
  };

  const toggleSelectItem = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleBatchSetImportance = async (nextImportance: "high" | "medium" | "low") => {
    if (!workspaceId || selectedIds.size === 0) {
      return;
    }
    setBatchUpdating(true);
    setDeleteError(null);
    try {
      const settled = await Promise.allSettled(
        Array.from(selectedIds).map((id) =>
          projectMemoryFacade.update(id, workspaceId, { importance: nextImportance }),
        ),
      );
      const successCount = settled.filter((entry) => entry.status === "fulfilled").length;
      setPollutionMessage(
        t("memory.batchUpdateImportanceSuccess", {
          count: successCount,
          importance: importanceLabel(nextImportance),
        }),
      );
      if (successCount > 0) {
        await refresh();
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBatchUpdating(false);
    }
  };

  const handleBatchDelete = async () => {
    if (!workspaceId || selectedIds.size === 0) {
      return;
    }
    setShowBatchDeleteConfirm(false);
    setBatchUpdating(true);
    setDeleteError(null);
    try {
      const settled = await Promise.allSettled(
        Array.from(selectedIds).map((id) =>
          projectMemoryFacade.delete(id, workspaceId),
        ),
      );
      const successCount = settled.filter((entry) => entry.status === "fulfilled").length;
      setSelectedIds(new Set());
      setPollutionMessage(
        t("memory.batchDeleteSuccess", { count: successCount }),
      );
      await refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBatchUpdating(false);
    }
  };

  const handleClearAll = async () => {
    if (!workspaceId || total === 0) {
      return;
    }
    setShowClearAllConfirm(false);
    setDeleteError(null);
    try {
      const allIds: string[] = [];
      let currentPage = 0;
      const scanPageSize = 200;
      let hasNextPage = true;

      while (hasNextPage) {
        const response = await projectMemoryFacade.list({
          workspaceId,
          page: currentPage,
          pageSize: scanPageSize,
          importance: null,
          kind: null,
          query: null,
          tag: null,
        });
        if (!response.items.length) {
          break;
        }
        allIds.push(...response.items.map((item) => item.id));
        hasNextPage = (currentPage + 1) * scanPageSize < response.total;
        if (hasNextPage) {
          currentPage += 1;
        }
      }

      const settled = await Promise.allSettled(
        allIds.map((id) => projectMemoryFacade.delete(id, workspaceId)),
      );
      const successCount = settled.filter((entry) => entry.status === "fulfilled").length;
      setSelectedIds(new Set());
      setPollutionMessage(
        t("memory.clearAllSuccess", { count: successCount }),
      );
      await refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    }
  };

  // Shared Tailwind classes for action buttons (kept as constants for DRY inline usage)
  const actionBtnCls =
    "project-memory-action-btn border border-(--border-subtle) bg-(--bg-secondary) text-(--text-primary) rounded-lg min-h-[32px] px-3 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 ease-out hover:bg-(--bg-hover) hover:border-(--border-hover) disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5";
  const actionBtnCompactCls =
    "project-memory-action-btn compact border border-(--border-subtle) bg-(--bg-secondary) text-(--text-primary) rounded-lg text-[11px] min-h-[24px] px-2 font-medium inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 ease-out whitespace-nowrap hover:bg-(--bg-hover) hover:border-(--border-hover) disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5";
  const actionBtnDangerCls =
    "project-memory-action-btn danger border border-red-400/40 text-red-600 dark:text-red-400 rounded-lg min-h-[32px] px-3 text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 ease-out hover:bg-red-500/10 hover:border-red-500/60 disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5";
  const actionBtnCompactDangerCls =
    "project-memory-action-btn compact danger border border-red-400/40 text-red-600 dark:text-red-400 rounded-lg text-[11px] min-h-[24px] px-2 font-medium inline-flex items-center gap-1.5 cursor-pointer transition-all duration-150 ease-out whitespace-nowrap hover:bg-red-500/10 hover:border-red-500/60 disabled:opacity-40 disabled:cursor-not-allowed [&_svg]:shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5";
  const settingsBtnCls =
    "project-memory-settings-btn border border-(--border-subtle) bg-transparent text-inherit rounded-md p-1 cursor-pointer transition-all duration-150 ease-out inline-flex items-center justify-center hover:bg-(--surface-hover) hover:border-(--border-hover) disabled:opacity-40 disabled:cursor-not-allowed";

  const renderManagerBody = (isModal: boolean) => (
    <div className={`project-memory-body flex flex-col gap-2.5 min-h-0 flex-1${isModal ? " is-modal" : ""}`}>
      {/* Workbench overview strip */}
      <div
        className="project-memory-workbench-strip grid grid-cols-4 gap-2 max-[900px]:grid-cols-2 max-[760px]:grid-cols-1"
        aria-label={t("memory.workbenchOverview")}
      >
        {([
          [t("memory.workbenchTotal"), total],
          [t("memory.workbenchSelected"), selectedIds.size],
          [t("memory.workbenchReview"), reviewInboxCount],
          [t("memory.workbenchHealth"), healthIssueCount],
        ] as const).map(([label, value]) => (
          <div
            key={label}
            className="project-memory-workbench-stat border border-(--border-subtle) rounded-[10px] px-2.5 py-2 min-w-0"
            style={{
              background:
                "linear-gradient(135deg, rgba(37,99,235,0.12), transparent 58%), var(--surface-card, rgba(255,255,255,0.04))",
            }}
          >
            <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-(--text-muted)">
              {label}
            </span>
            <strong className="block overflow-hidden text-ellipsis whitespace-nowrap mt-0.5 text-[13px] text-(--text-primary)">
              {value}
            </strong>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="project-memory-toolbar flex gap-1.5 items-center flex-wrap">
        <label className="project-memory-search flex items-center gap-1 flex-1 min-w-[120px] border border-(--border-subtle) rounded-md px-1.5 bg-(--bg-input) [&_input]:flex-1 [&_input]:bg-transparent [&_input]:border-0 [&_input]:text-inherit [&_input]:text-[11px] [&_input]:min-h-6 [&_input]:outline-none">
          <Search size={14} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("memory.searchPlaceholder")}
          />
        </label>
        {/* Kind select */}
        <select
          value={kind ?? ""}
          onChange={(event) => setKind(event.target.value || null)}
          className="project-memory-kind-select border border-(--border-subtle) bg-(--bg-input) text-inherit rounded-md min-h-6 text-[11px] px-1.5 max-w-[100px] shrink-0"
        >
          <option value="">{t("memory.kind.all")}</option>
          <option value="project_context">{t("memory.kind.projectContext")}</option>
          <option value="conversation">{t("memory.kind.conversation")}</option>
          <option value="code_decision">{t("memory.kind.codeDecision")}</option>
          <option value="known_issue">{t("memory.kind.knownIssue")}</option>
          <option value="note">{t("memory.kind.note")}</option>
        </select>
        {/* Importance select */}
        <select
          value={importance ?? ""}
          onChange={(event) => setImportance(event.target.value || null)}
          className="project-memory-kind-select border border-(--border-subtle) bg-(--bg-input) text-inherit rounded-md min-h-6 text-[11px] px-1.5 max-w-[100px] shrink-0"
        >
          <option value="">{t("memory.importance.all")}</option>
          <option value="high">{t("memory.importance.high")}</option>
          <option value="medium">{t("memory.importance.medium")}</option>
          <option value="low">{t("memory.importance.low")}</option>
        </select>
        {/* Review filter select */}
        <select
          value={reviewFilter}
          onChange={(event) =>
            setReviewFilter(event.target.value as ProjectMemoryReviewState | "all")
          }
          className="project-memory-kind-select border border-(--border-subtle) bg-(--bg-input) text-inherit rounded-md min-h-6 text-[11px] px-1.5 max-w-[100px] shrink-0"
        >
          <option value="all">{t("memory.review.all")}</option>
          <option value="unreviewed">{t("memory.review.unreviewed")}</option>
          <option value="kept">{t("memory.review.kept")}</option>
          <option value="converted">{t("memory.review.converted")}</option>
          <option value="obsolete">{t("memory.review.obsolete")}</option>
          <option value="dismissed">{t("memory.review.dismissed")}</option>
        </select>
        {/* Health filter select */}
        <select
          value={healthFilter}
          onChange={(event) =>
            setHealthFilter(event.target.value as ProjectMemoryHealthState | "all")
          }
          className="project-memory-kind-select border border-(--border-subtle) bg-(--bg-input) text-inherit rounded-md min-h-6 text-[11px] px-1.5 max-w-[100px] shrink-0"
        >
          <option value="all">{t("memory.health.all")}</option>
          <option value="complete">{t("memory.health.complete")}</option>
          <option value="input_only">{t("memory.health.inputOnly")}</option>
          <option value="assistant_only">{t("memory.health.assistantOnly")}</option>
          <option value="pending_fusion">{t("memory.health.pendingFusion")}</option>
          <option value="capture_failed">{t("memory.health.captureFailed")}</option>
        </select>
        {/* Tag input */}
        <input
          className="project-memory-tag-input border border-(--border-subtle) bg-transparent text-inherit rounded-md min-h-6 text-[11px] px-1.5 w-[90px] shrink-0"
          list="project-memory-tag-suggestions"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          placeholder={t("memory.tagPlaceholder")}
        />
        <datalist id="project-memory-tag-suggestions">
          {availableTags.map((entry) => (
            <option key={entry} value={entry} />
          ))}
        </datalist>
      </div>

      {/* Quick tag filters */}
      {availableTags.length > 0 ? (
        <div className="project-memory-tag-quick-filters flex items-center gap-2 flex-wrap max-h-16 overflow-auto pr-0.5">
          <span className="project-memory-tag-quick-label text-[11px] opacity-80">{t("memory.quickTags")}</span>
          {visibleQuickTags.map((entry) => {
            const active = activeTagTerms.includes(entry);
            return (
              <button
                key={entry}
                type="button"
                className={`project-memory-tag-chip border rounded-full min-h-6 px-2 text-[11px] cursor-pointer transition-all duration-150 ease-out hover:bg-(--bg-hover) hover:border-(--border-hover) ${
                  active
                    ? "is-active bg-blue-600/14 border-blue-600/65"
                    : "border-(--border-subtle) bg-(--bg-secondary) text-inherit"
                }`}
                onClick={() => toggleQuickTag(entry)}
              >
                {entry}
              </button>
            );
          })}
          {hiddenQuickTagCount > 0 || showAllQuickTags ? (
            <button
              type="button"
              className="project-memory-tag-chip project-memory-tag-chip-more border border-dashed border-(--border-subtle) text-(--text-primary) rounded-full min-h-6 px-2 text-[11px] cursor-pointer transition-all duration-150 ease-out hover:bg-(--bg-hover) hover:border-(--border-hover)"
              onClick={() => setShowAllQuickTags((value) => !value)}
              aria-expanded={showAllQuickTags}
            >
              {showAllQuickTags
                ? t("memory.quickTagsCollapse")
                : t("memory.quickTagsMore", { count: hiddenQuickTagCount })}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Settings panel — collapsed/expanded via max-h transition */}
      <div
        className={`project-memory-settings overflow-hidden transition-[max-height,opacity,padding] duration-300 ease-out ${
          showSettings
            ? "is-open max-h-[360px] opacity-100 px-3 py-3 border border-(--border-subtle) rounded-lg mb-2.5 bg-(--bg-secondary)"
            : "max-h-0 opacity-0 px-3 py-0 border-0"
        }`}
      >
        <div className="project-memory-toggle-row flex gap-4 flex-wrap">
          <label className="project-memory-toggle flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={workspaceAutoEnabled}
              disabled={!workspaceId || settingsLoading}
              onChange={() => {
                void toggleWorkspaceAutoCapture();
              }}
            />
            <span>{t("memory.autoCaptureWorkspace")}</span>
          </label>
          <label className="project-memory-toggle project-memory-toggle-disabled flex items-center gap-2 text-xs opacity-56 cursor-not-allowed">
            <input
              type="checkbox"
              checked={false}
              disabled
              readOnly
            />
            <span>{t("memory.contextInjectionEnabled")}</span>
          </label>
        </div>
        <div className="project-memory-toggle-hint mt-1.5 text-[11px] text-(--text-muted)">
          {t("memory.contextInjectionManualHint")}
        </div>
        <div className="project-memory-injection-mode-row mt-2 flex items-center justify-between gap-2.5">
          <span className="project-memory-injection-mode-label text-xs text-(--text-secondary)">
            {t("memory.manualInjectionMode")}
          </span>
          <select
            className="project-memory-kind-select project-memory-injection-mode-select border border-(--border-subtle) bg-(--bg-input) text-inherit rounded-md min-h-6 text-[11px] px-1.5 min-w-[190px]"
            value={manualInjectionMode}
            onChange={(event) => {
              const nextMode = event.target.value === "summary" ? "summary" : "detail";
              setManualInjectionModeState(nextMode);
              setManualMemoryInjectionMode(nextMode);
            }}
          >
            <option value="detail">{t("memory.manualInjectionModeDetail")}</option>
            <option value="summary">{t("memory.manualInjectionModeSummary")}</option>
          </select>
        </div>
        <div className="project-memory-toggle-hint mt-1.5 text-[11px] text-(--text-muted)">
          {t("memory.manualInjectionModeHint")}
        </div>

        {/* Cleanup section */}
        <div className="project-memory-cleanup mt-2.5 pt-2.5 border-t border-dashed border-(--border-subtle) flex flex-col gap-1.5">
          <div className="project-memory-cleanup-header flex items-center justify-between gap-2">
            <div className="project-memory-cleanup-title text-[11px] font-semibold shrink-0">{t("memory.cleanupTitle")}</div>
            <div className="project-memory-cleanup-actions flex gap-1.5">
              <button
                type="button"
                className={actionBtnCompactCls}
                onClick={() => { void handleScanPollutedMemories(); }}
                disabled={!workspaceId || pollutionBusy !== null}
              >
                {pollutionBusy === "scan" ? t("memory.cleanupScanning") : t("memory.cleanupScan")}
              </button>
              <button
                type="button"
                className={actionBtnCompactDangerCls}
                onClick={() => { void handleCleanupPollutedMemories(); }}
                disabled={!workspaceId || pollutionBusy !== null || pollutionCandidateIds.length === 0}
              >
                {pollutionBusy === "cleanup" ? t("memory.cleanupRunning") : t("memory.cleanupRun")}
              </button>
              <button
                type="button"
                className={actionBtnCompactDangerCls}
                onClick={() => setShowClearAllConfirm(true)}
                disabled={!workspaceId || total === 0}
              >
                {t("memory.clearAll")}
              </button>
            </div>
          </div>
          <div className="project-memory-cleanup-hint text-[11px] opacity-75 leading-[1.4]">
            {pollutionMessage
              ? pollutionMessage
              : pollutionScannedTotal > 0
                ? t("memory.cleanupScanned", { total: pollutionScannedTotal })
                : t("memory.cleanupHint")}
          </div>
        </div>

        {/* Diagnostics section */}
        <div className="project-memory-cleanup project-memory-diagnostics mt-2.5 pt-2.5 border-t border-dashed border-(--border-subtle) flex flex-col gap-1.5">
          <div className="project-memory-cleanup-header flex items-center justify-between gap-2">
            <div className="project-memory-cleanup-title text-[11px] font-semibold shrink-0">{t("memory.diagnosticsTitle")}</div>
            <div className="project-memory-cleanup-actions flex gap-1.5">
              <button
                type="button"
                className={actionBtnCompactCls}
                onClick={() => { void handleRunDiagnostics(); }}
                disabled={!workspaceId || diagnosticsBusy !== null}
              >
                <ShieldCheck size={13} aria-hidden />
                <span>
                  {diagnosticsBusy === "diagnostics" ? t("memory.diagnosticsRunning") : t("memory.diagnosticsRun")}
                </span>
              </button>
              <button
                type="button"
                className={actionBtnCompactCls}
                onClick={() => { void handleRunReconcileDryRun(); }}
                disabled={!workspaceId || diagnosticsBusy !== null}
              >
                {diagnosticsBusy === "dry-run" ? t("memory.reconcileRunning") : t("memory.reconcileDryRun")}
              </button>
              <button
                type="button"
                className={actionBtnCompactDangerCls}
                onClick={() => setShowReconcileApplyConfirm(true)}
                disabled={!workspaceId || diagnosticsBusy !== null || !reconcileResult || reconcileResult.fixableCount === 0}
              >
                <Wrench size={13} aria-hidden />
                <span>
                  {diagnosticsBusy === "apply" ? t("memory.reconcileRunning") : t("memory.reconcileApply")}
                </span>
              </button>
            </div>
          </div>
          <div className="project-memory-cleanup-hint text-[11px] opacity-75 leading-[1.4]">
            {diagnostics
              ? t("memory.diagnosticsSummary", {
                  total: diagnostics.total,
                  incomplete:
                    diagnostics.healthCounts.input_only +
                    diagnostics.healthCounts.assistant_only +
                    diagnostics.healthCounts.pending_fusion +
                    diagnostics.healthCounts.capture_failed,
                  duplicates: diagnostics.duplicateTurnGroups.length,
                  badFiles: diagnostics.badFiles.length,
                })
              : t("memory.diagnosticsHint")}
          </div>
          {reconcileResult ? (
            <div className="project-memory-cleanup-hint text-[11px] opacity-75 leading-[1.4]">
              {t("memory.reconcileSummary", {
                fixable: reconcileResult.fixableCount,
                fixed: reconcileResult.fixedCount,
                skipped: reconcileResult.skippedCount,
              })}
            </div>
          ) : null}
        </div>
      </div>

      {/* List + Detail columns */}
      <div className="project-memory-content grid gap-3 min-h-0 flex-1 [grid-template-columns:minmax(280px,32%)_1fr] max-[760px]:[grid-template-columns:minmax(0,1fr)]">
        {/* Memory list */}
        <aside
          className="project-memory-list border border-(--border-subtle) rounded-lg min-h-0 overflow-y-auto p-2.5 flex flex-col gap-2 max-[760px]:max-h-[38vh]"
          aria-label={t("memory.memoryList")}
        >
          <div className="project-memory-list-toolbar sticky top-0 z-[1] flex justify-between gap-2 pb-2 text-[11px] text-(--text-muted) bg-inherit">
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{t("memory.memoryList")}</span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
              {t("memory.pageMeta", {
                from: total === 0 ? 0 : page * pageSize + 1,
                to: Math.min(total, (page + 1) * pageSize),
                total,
              })}
            </span>
          </div>
          {emptyMessage ? (
            <div className="project-memory-empty text-xs opacity-75">{emptyMessage}</div>
          ) : filteredItems.length === 0 ? (
            <div className="project-memory-empty text-xs opacity-75">{t("memory.filteredEmpty")}</div>
          ) : (
            filteredItems.map((item) => {
              const recordKind = getProjectMemoryDisplayRecordKind(item);
              const healthState = deriveProjectMemoryHealthState(item);
              const reviewState = deriveProjectMemoryReviewState(item);
              const compactTitle = resolveProjectMemoryCompactTitle(item);
              const compactSummary = resolveProjectMemoryCompactSummary(item);
              const isActive = selectedId === item.id;
              const isSelected = selectedIds.has(item.id);
              const isObsolete = reviewState === "obsolete";
              const isDismissed = reviewState === "dismissed";

              // Build importance style
              const importanceStyle: Record<string, string> = {
                high: "bg-[linear-gradient(135deg,rgba(239,68,68,0.15),rgba(239,68,68,0.08))] border-red-400/25 hover:bg-[linear-gradient(135deg,rgba(239,68,68,0.2),rgba(239,68,68,0.12))] hover:border-red-400/35",
                medium: "bg-[linear-gradient(135deg,rgba(251,191,36,0.12),rgba(251,191,36,0.06))] border-yellow-400/20 hover:bg-[linear-gradient(135deg,rgba(251,191,36,0.18),rgba(251,191,36,0.1))] hover:border-yellow-400/30",
                low: "bg-[linear-gradient(135deg,rgba(107,114,128,0.08),rgba(107,114,128,0.04))] border-gray-500/15 hover:bg-[linear-gradient(135deg,rgba(107,114,128,0.12),rgba(107,114,128,0.08))] hover:border-gray-500/25",
              };
              const baseItemCls = `project-memory-list-item flex items-start gap-2.5 p-[9px] rounded-lg cursor-pointer transition-[background-color,border-color] duration-200 border min-w-0 ${
                isActive
                  ? "is-active bg-blue-600/8 border-blue-600/20"
                  : isSelected
                    ? "is-selected bg-blue-500/8 border-blue-500/20"
                    : item.importance && importanceStyle[item.importance]
                      ? importanceStyle[item.importance]
                      : "bg-(--surface-card) border-black/8 hover:bg-(--surface-hover) hover:border-black/12"
              }${isObsolete ? " is-obsolete opacity-72 grayscale-[0.35] border-dashed" : ""}${isDismissed ? " is-dismissed opacity-72 grayscale-[0.35] border-dashed" : ""}${item.importance ? ` importance-${item.importance}` : ""}`;

              // Kind badge colors
              const kindColorMap: Record<string, string> = {
                "known-issue": "bg-red-500",
                "code-decision": "bg-purple-500",
                "project-context": "bg-blue-500",
                "note": "bg-gray-500",
                "conversation": "bg-green-500",
              };
              const kindSlug = item.kind.replace(/_/g, "-");
              const kindBgCls = kindColorMap[kindSlug] ?? "bg-gray-500";

              return (
                <div
                  key={item.id}
                  className={baseItemCls}
                  onClick={() => toggleSelectItem(item.id)}
                >
                  {/* Checkbox */}
                  <label
                    className="project-memory-list-checkbox shrink-0 flex items-center justify-center cursor-pointer relative w-[18px] h-[18px] mt-px"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectItem(item.id)}
                      className="absolute opacity-0 w-full h-full cursor-pointer inset-0"
                    />
                    <span className="checkbox-indicator absolute w-[18px] h-[18px] border-2 border-slate-400/40 rounded pointer-events-none transition-all duration-200 after:content-[''] after:absolute after:left-[5px] after:top-[2px] after:w-[5px] after:h-[9px] after:border-solid after:border-white after:border-r-2 after:border-b-2 after:border-t-0 after:border-l-0 after:scale-0 after:opacity-0 after:transition-all after:duration-200 after:[transform:rotate(45deg)_scale(0)]" />
                  </label>

                  {/* Content */}
                  <div
                    className="project-memory-list-item-content flex-1 min-w-0 text-left cursor-pointer p-0 flex flex-col gap-1 h-auto min-h-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedId(item.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(item.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="project-memory-list-item-head flex justify-between items-center text-[11px] opacity-90 mb-0.5 gap-1.5 min-w-0">
                      <div className="project-memory-list-head-left inline-flex items-center gap-1.5 min-w-0 overflow-hidden">
                        <span
                          className={`project-memory-list-kind kind-${kindSlug} inline-flex items-center px-2.5 py-[3px] rounded-md font-semibold text-[10px] tracking-[0.3px] text-white ${kindBgCls}`}
                        >
                          {kindLabel(item.kind)}
                        </span>
                        <span
                          className={`project-memory-record-kind record-${recordKind.replace(/_/g, "-")} inline-flex items-center py-[2px] px-[7px] rounded-[5px] text-[9px] font-bold text-(--text-primary) border border-(--border-subtle) bg-(--surface-elevated) tracking-[0] ${
                            recordKind === "conversation_turn"
                              ? "border-blue-600/36 bg-blue-600/12"
                              : recordKind === "manual_note"
                                ? "border-teal-500/35 bg-teal-500/12"
                                : "border-gray-500/32 bg-gray-500/10"
                          }`}
                        >
                          {recordKindLabel(recordKind)}
                        </span>
                        {isConversationTurnMemory(item) && item.engine ? (
                          <span className="project-memory-list-engine inline-flex items-center py-[2px] px-[7px] rounded-[5px] bg-orange-500 text-white font-semibold text-[9px] uppercase tracking-[0.5px]">
                            {item.engine.toUpperCase()}
                          </span>
                        ) : null}
                      </div>
                      <span className="project-memory-list-importance">
                        {importanceLabel(item.importance)}
                      </span>
                    </div>
                    <div className="project-memory-list-title mt-0.5 text-[13px] font-bold leading-[1.3] text-(--text-primary) overflow-hidden text-ellipsis whitespace-nowrap break-words">
                      {compactTitle}
                    </div>
                    <div className="project-memory-list-summary mt-0.5 text-xs font-normal leading-[1.42] text-(--text-secondary) [-webkit-line-clamp:3] [-webkit-box-orient:vertical] [display:-webkit-box] overflow-hidden text-ellipsis max-h-[4.26em] overflow-wrap-anywhere">
                      {compactSummary}
                    </div>
                    <div className="project-memory-list-meta-row flex items-center gap-1.5 min-w-0 mt-0.5 text-[10px] text-(--text-muted) whitespace-nowrap overflow-hidden [&_span]:min-w-0 [&_span]:overflow-hidden [&_span]:text-ellipsis [&_span+span]:before:content-['·'] [&_span+span]:before:mr-1.5 [&_span+span]:before:opacity-65">
                      <span>{formatMemoryDateTime(item.updatedAt)}</span>
                      <span>{healthStateLabel(healthState)}</span>
                      <span>{reviewStateLabel(reviewState)}</span>
                    </div>
                    {item.tags && item.tags.length > 0 ? (
                      <div className="project-memory-list-tags flex gap-1.5 flex-wrap mt-1 max-h-[23px] overflow-hidden">
                        {item.tags.slice(0, 3).map((entry, idx) => {
                          const tagColors = ["bg-cyan-500", "bg-violet-500", "bg-pink-500", "bg-teal-500"];
                          const colorCls = tagColors[idx % 4];
                          return (
                            <span
                              key={entry}
                              className={`project-memory-list-tag inline-flex items-center py-[2px] px-2 rounded-[5px] text-[10px] text-white font-medium ${colorCls}`}
                            >
                              {entry}
                            </span>
                          );
                        })}
                        {item.tags.length > 3 ? (
                          <span className="project-memory-list-tag project-memory-list-tag-muted inline-flex items-center py-[2px] px-2 rounded-[5px] text-[10px] text-white font-medium bg-gray-500/55">
                            +{item.tags.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </aside>

        {/* Detail pane */}
        <div
          className="project-memory-detail border border-(--border-subtle) rounded-lg min-h-0 overflow-y-auto p-3 flex flex-col gap-2.5"
          aria-label={t("memory.memoryDetail")}
        >
          {selectedItem ? (
            <>
              {/* Read-only head */}
              <div className="project-memory-detail-readonly-head border border-(--border-subtle) rounded-[10px] bg-[color-mix(in_srgb,var(--surface-card,rgba(0,0,0,0.02))_86%,transparent)] p-2.5 flex flex-col gap-2">
                <div className="project-memory-detail-readonly-title text-[15px] font-bold leading-[1.35] text-(--text-primary) break-words">
                  {selectedItem.title || selectedItem.summary || selectedItem.kind}
                </div>
                <div className="project-memory-detail-readonly-meta flex items-center gap-2 flex-wrap text-[11px] text-(--text-muted) [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1 [&>span]:rounded-full [&>span]:px-2 [&>span]:py-0.5 [&>span]:border [&>span]:border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] [&>span]:bg-[color-mix(in_srgb,var(--surface-elevated,rgba(0,0,0,0.04))_86%,transparent)]">
                  {selectedRecordKind ? (
                    <span>{recordKindLabel(selectedRecordKind)}</span>
                  ) : null}
                  <span>{kindLabel(selectedItem.kind)}</span>
                  <span>{importanceLabel(selectedItem.importance)}</span>
                  <span>{formatMemoryDateTime(selectedItem.updatedAt)}</span>
                  {selectedItem.threadId ? <span>{selectedItem.threadId}</span> : null}
                  {selectedItem.turnId ? <span>{selectedItem.turnId}</span> : null}
                  {selectedItem.engine ? <span>{selectedItem.engine}</span> : null}
                </div>
                {selectedItem.tags.length > 0 ? (
                  <div className="project-memory-detail-readonly-tags flex flex-wrap gap-1.5">
                    {selectedItem.tags.slice(0, 8).map((entry) => (
                      <span
                        key={entry}
                        className="project-memory-detail-readonly-tag text-[11px] rounded-full px-2 py-0.5 text-(--text-muted) border border-[color-mix(in_srgb,var(--border-subtle)_75%,transparent)] bg-[color-mix(in_srgb,var(--surface-elevated,rgba(0,0,0,0.04))_84%,transparent)]"
                      >
                        #{entry}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="project-memory-source-locator flex items-center justify-between gap-2 border-t border-dashed border-(--border-subtle) pt-2">
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <span className="project-memory-source-locator-label text-[11px] font-bold text-(--text-primary)">
                      {t("memory.sourceLocator")}
                    </span>
                    <span className="project-memory-source-locator-status text-[11px] text-(--text-muted) overflow-hidden text-ellipsis whitespace-nowrap">
                      {selectedSourceLocator?.available
                        ? t("memory.sourceLocatorAvailable")
                        : t("memory.sourceLocatorUnavailable")}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={actionBtnCompactCls}
                    onClick={() => { void handleCopySourceLocator(); }}
                    disabled={!selectedSourceLocator?.available}
                    aria-label={t("memory.copySourceLocator")}
                  >
                    <Copy size={13} aria-hidden />
                    <span>{t("memory.copySourceLocator")}</span>
                  </button>
                </div>
              </div>

              {detailLoading ? (
                <div className="project-memory-detail-status border border-(--border-subtle) rounded-lg px-2.5 py-2 text-xs text-(--text-muted) bg-(--surface-card)">
                  {t("memory.detailLoading")}
                </div>
              ) : null}
              {detailError ? (
                <div className="project-memory-error text-xs text-red-300 dark:text-red-400">{detailError}</div>
              ) : null}

              {selectedIsConversationTurn ? (
                <div className="project-memory-turn-grid grid gap-2.5 [grid-template-columns:minmax(0,1fr)_minmax(0,1fr)] max-[900px]:[grid-template-columns:minmax(0,1fr)]">
                  <section className="project-memory-turn-section border border-(--border-subtle) rounded-lg bg-(--surface-card) p-2.5 min-w-0 [&_h3]:m-0 [&_h3]:mb-2 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-(--text-primary)">
                    <h3>{t("memory.turnUserInput")}</h3>
                    <Markdown
                      className="markdown project-memory-detail-preview-markdown text-xs leading-[1.65] break-words text-(--text-secondary) [&>*]:m-0 [&>*+*]:mt-1.5 [&_:where(h1,h2,h3,h4)]:text-[13px] [&_:where(h1,h2,h3,h4)]:font-bold [&_:where(h1,h2,h3,h4)]:text-(--text-primary) [&_:where(ul,ol)]:m-0 [&_:where(ul,ol)]:pl-[18px] [&_:where(li+li)]:mt-[3px] [&_:where(code)]:text-[11px]"
                      value={selectedItem.userInput?.trim() || t("memory.detailPreviewEmpty")}
                    />
                  </section>
                  {selectedItem.assistantThinkingSummary?.trim() ? (
                    <section className="project-memory-turn-section border border-(--border-subtle) rounded-lg bg-(--surface-card) p-2.5 min-w-0 [&_h3]:m-0 [&_h3]:mb-2 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-(--text-primary)">
                      <h3>{t("memory.turnAssistantThinkingSummary")}</h3>
                      <Markdown
                        className="markdown project-memory-detail-preview-markdown text-xs leading-[1.65] break-words text-(--text-secondary) [&>*]:m-0 [&>*+*]:mt-1.5 [&_:where(h1,h2,h3,h4)]:text-[13px] [&_:where(h1,h2,h3,h4)]:font-bold [&_:where(h1,h2,h3,h4)]:text-(--text-primary) [&_:where(ul,ol)]:m-0 [&_:where(ul,ol)]:pl-[18px] [&_:where(li+li)]:mt-[3px] [&_:where(code)]:text-[11px]"
                        value={selectedItem.assistantThinkingSummary.trim()}
                      />
                    </section>
                  ) : null}
                  <section className="project-memory-turn-section border border-(--border-subtle) rounded-lg bg-(--surface-card) p-2.5 min-w-0 [&_h3]:m-0 [&_h3]:mb-2 [&_h3]:text-xs [&_h3]:font-bold [&_h3]:text-(--text-primary)">
                    <h3>{t("memory.turnAssistantResponse")}</h3>
                    <Markdown
                      className="markdown project-memory-detail-preview-markdown text-xs leading-[1.65] break-words text-(--text-secondary) [&>*]:m-0 [&>*+*]:mt-1.5 [&_:where(h1,h2,h3,h4)]:text-[13px] [&_:where(h1,h2,h3,h4)]:font-bold [&_:where(h1,h2,h3,h4)]:text-(--text-primary) [&_:where(ul,ol)]:m-0 [&_:where(ul,ol)]:pl-[18px] [&_:where(li+li)]:mt-[3px] [&_:where(code)]:text-[11px]"
                      value={selectedItem.assistantResponse?.trim() || t("memory.detailPreviewEmpty")}
                    />
                  </section>
                </div>
              ) : (
                <div className="project-memory-detail-editor flex flex-col gap-1.5">
                  <label
                    className="project-memory-detail-editor-label text-[11px] font-bold text-(--text-muted)"
                    htmlFor="project-memory-detail-editor"
                  >
                    {t("memory.editManualDetail")}
                  </label>
                  <textarea
                    id="project-memory-detail-editor"
                    className="project-memory-detail-text w-full border border-(--border-subtle) bg-(--bg-input) text-inherit rounded-md text-xs p-2 outline-none flex-1 min-h-[200px] leading-[1.6] text-[13px] resize-y"
                    value={detailTextDraft}
                    onChange={(event) => setDetailTextDraft(event.target.value)}
                  />
                </div>
              )}

              {!selectedIsConversationTurn ? (
                <div className="project-memory-detail-preview border border-(--border-subtle) rounded-lg bg-(--bg-input) p-2.5 flex flex-col gap-2 flex-1 min-h-0 overflow-auto">
                  <div className="project-memory-detail-preview-title text-[11px] font-bold text-(--text-muted)">
                    {t("memory.detailPreviewTitle")}
                  </div>
                  {detailSections.length > 0 ? (
                    <div className="project-memory-detail-preview-sections flex flex-col gap-2">
                      {detailSections.map((section, index) => (
                        <div
                          key={`${section.label}-${index}`}
                          className="project-memory-detail-preview-section rounded-lg border border-(--border-subtle) bg-(--surface-card) p-2 flex flex-col gap-1.5"
                        >
                          <div className="project-memory-detail-preview-section-label text-[11px] font-bold text-(--text-primary)">
                            {section.label}
                          </div>
                          <div className="project-memory-detail-preview-section-content text-xs leading-[1.6] text-(--text-secondary)">
                            <Markdown
                              className="markdown project-memory-detail-preview-markdown text-xs leading-[1.65] break-words text-(--text-secondary) [&>*]:m-0 [&>*+*]:mt-1.5 [&_:where(h1,h2,h3,h4)]:text-[13px] [&_:where(h1,h2,h3,h4)]:font-bold [&_:where(h1,h2,h3,h4)]:text-(--text-primary) [&_:where(ul,ol)]:m-0 [&_:where(ul,ol)]:pl-[18px] [&_:where(li+li)]:mt-[3px] [&_:where(code)]:text-[11px]"
                              value={section.content}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="project-memory-detail-preview-plain text-xs leading-[1.6] text-(--text-secondary)">
                      <Markdown
                        className="markdown project-memory-detail-preview-markdown text-xs leading-[1.65] break-words text-(--text-secondary) [&>*]:m-0 [&>*+*]:mt-1.5 [&_:where(h1,h2,h3,h4)]:text-[13px] [&_:where(h1,h2,h3,h4)]:font-bold [&_:where(h1,h2,h3,h4)]:text-(--text-primary) [&_:where(ul,ol)]:m-0 [&_:where(ul,ol)]:pl-[18px] [&_:where(li+li)]:mt-[3px] [&_:where(code)]:text-[11px]"
                        value={detailTextDraft.trim() || t("memory.detailPreviewEmpty")}
                      />
                    </div>
                  )}
                </div>
              ) : null}

              {copyMessage ? (
                <div className="project-memory-detail-status border border-(--border-subtle) rounded-lg px-2.5 py-2 text-xs text-(--text-muted) bg-(--surface-card)">
                  {copyMessage}
                </div>
              ) : null}

              {/* Review actions */}
              <div
                className="project-memory-review-actions flex gap-2 flex-wrap p-2.5 border border-dashed border-(--border-subtle) rounded-[10px] bg-[color-mix(in_srgb,var(--surface-card,rgba(0,0,0,0.02))_82%,transparent)]"
                aria-label={t("memory.reviewActions")}
              >
                <button type="button" className={actionBtnCompactCls} onClick={() => { void handleSetReviewState("kept"); }} disabled={detailSaving}>
                  {t("memory.reviewKeep")}
                </button>
                <button type="button" className={actionBtnCompactCls} onClick={() => { void handleConvertToManualNote(); }} disabled={detailSaving || !selectedIsConversationTurn}>
                  {t("memory.reviewConvert")}
                </button>
                <button type="button" className={actionBtnCompactCls} onClick={() => { void handleSetReviewState("obsolete"); }} disabled={detailSaving}>
                  {t("memory.reviewObsolete")}
                </button>
                <button type="button" className={actionBtnCompactCls} onClick={() => { void handleSetReviewState("dismissed"); }} disabled={detailSaving}>
                  {t("memory.reviewDismiss")}
                </button>
              </div>
            </>
          ) : (
            <div className="project-memory-empty text-xs opacity-75">{t("memory.selectRecord")}</div>
          )}
        </div>
      </div>

      {/* Actions bar */}
      {items.length > 0 && (
        <div className="project-memory-actions flex items-center gap-2 flex-wrap max-[768px]:flex-col max-[768px]:items-stretch max-[768px]:gap-2.5">
          <div className="project-memory-batch-actions flex items-center gap-1.5 flex-wrap max-[768px]:w-full max-[768px]:justify-center">
            <button
              type="button"
              className={actionBtnCompactCls}
              onClick={toggleSelectAll}
              aria-label={selectedIds.size === items.length ? t("memory.unselectAll") : t("memory.selectAll")}
            >
              {selectedIds.size === items.length ? (
                <><Square size={14} aria-hidden /><span>{t("memory.unselectAll")}</span></>
              ) : (
                <><CheckSquare size={14} aria-hidden /><span>{t("memory.selectAll")}</span></>
              )}
            </button>
            {selectedIds.size > 0 && (
              <>
                <button type="button" className={actionBtnCompactCls} onClick={() => { void handleBatchSetImportance("high"); }} disabled={batchUpdating}>
                  {t("memory.batchSetHigh")}
                </button>
                <button type="button" className={actionBtnCompactCls} onClick={() => { void handleBatchSetImportance("medium"); }} disabled={batchUpdating}>
                  {t("memory.batchSetMedium")}
                </button>
                <button type="button" className={actionBtnCompactCls} onClick={() => { void handleBatchSetImportance("low"); }} disabled={batchUpdating}>
                  {t("memory.batchSetLow")}
                </button>
                <button type="button" className={actionBtnCompactDangerCls} onClick={() => setShowBatchDeleteConfirm(true)} disabled={batchUpdating} aria-label={t("memory.batchDelete")}>
                  <Trash2 size={14} aria-hidden />
                  <span>{t("memory.batchDelete")} ({selectedIds.size})</span>
                </button>
              </>
            )}
          </div>

          {/* Divider */}
          <div className="project-memory-actions-divider w-px h-5 bg-(--border-subtle) mx-1 max-[768px]:w-full max-[768px]:h-px max-[768px]:mx-0" />

          <div className="project-memory-main-actions flex items-center gap-2 ml-auto max-[768px]:w-full max-[768px]:justify-center">
            {selectedIsConversationTurn ? (
              <button type="button" className={`${actionBtnCls} max-[768px]:min-h-11 max-[768px]:w-full max-[768px]:justify-center max-[768px]:px-4`} onClick={() => { void handleCopySelectedTurn(); }} disabled={!selectedItem} aria-label={t("memory.copyTurn")}>
                <Copy size={14} aria-hidden />
                <span>{t("memory.copyTurn")}</span>
              </button>
            ) : (
              <button type="button" className={`${actionBtnCls} max-[768px]:min-h-11 max-[768px]:w-full max-[768px]:justify-center max-[768px]:px-4`} onClick={() => { void handleSaveManualDetail(); }} disabled={!selectedItem || detailSaving} aria-label={t("memory.save")}>
                <span>{detailSaving ? t("memory.saving") : t("memory.save")}</span>
              </button>
            )}
            <button type="button" className={`${actionBtnDangerCls} max-[768px]:min-h-11 max-[768px]:w-full max-[768px]:justify-center max-[768px]:px-4`} onClick={() => { handleDelete(); }} disabled={!selectedItem} aria-label={t("memory.delete")}>
              <Trash2 size={14} aria-hidden />
              <span>{t("memory.delete")}</span>
            </button>
          </div>
        </div>
      )}

      {/* Help tooltip */}
      <div
        className={`project-memory-help fixed bottom-[70px] right-5 w-[340px] max-w-[calc(100vw-40px)] z-[60] border border-(--border-subtle) rounded-lg px-3 py-2.5 bg-(--bg-primary) shadow-[0_12px_40px_rgba(0,0,0,0.6)] transition-[opacity,transform] duration-[250ms] ease-out ${
          showHelp
            ? "is-visible opacity-100 pointer-events-auto translate-y-0"
            : "opacity-0 pointer-events-none translate-y-2.5"
        }`}
      >
        <button
          type="button"
          className="project-memory-help-close absolute top-2 right-2 border-0 bg-transparent text-inherit cursor-pointer p-1 opacity-70 transition-opacity duration-150 ease-out hover:opacity-100"
          onClick={() => setShowHelp(false)}
          aria-label={t("memory.closeHelp")}
        >
          <X size={14} aria-hidden />
        </button>
        <h4 className="project-memory-help-title m-0 mb-1.5 text-xs font-semibold opacity-90">{t("memory.helpTitle")}</h4>
        <ul className="project-memory-help-list m-0 pl-4 text-[11px] leading-[1.7] opacity-75 [&_li+li]:mt-0.5">
          <li>{t("memory.helpAutoCapture")}</li>
          <li>{t("memory.helpContextInjection")}</li>
          <li>{t("memory.helpBatchOps")}</li>
          <li>{t("memory.helpMemoryTypes")}</li>
          <li>{t("memory.helpButtons")}</li>
          <li>{t("memory.helpFilters")}</li>
        </ul>
      </div>

      {/* Pagination */}
      <div className="project-memory-pagination flex items-center justify-center gap-3 pt-3 mt-auto border-t border-(--border-subtle) max-w-[300px] mx-auto">
        <button
          type="button"
          className={actionBtnCompactCls}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
          disabled={page === 0 || loading}
          aria-label={t("memory.prevPage")}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="project-memory-page-indicator text-xs opacity-85 font-medium min-w-[60px] text-center">
          {page + 1} / {Math.max(1, Math.ceil(total / pageSize))}
        </span>
        <button
          type="button"
          className={actionBtnCompactCls}
          onClick={() => setPage((current) => current + 1)}
          disabled={(page + 1) * pageSize >= total || loading}
          aria-label={t("memory.nextPage")}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      </div>

      {(error || deleteError) && (
        <div className="project-memory-error text-xs text-red-300 dark:text-red-400">{error ?? deleteError}</div>
      )}

      {/* Confirm dialogs */}
      {showBatchDeleteConfirm && (
        <ConfirmDialog
          title={t("memory.batchDelete")}
          message={t("memory.batchDeleteConfirm", { count: selectedIds.size })}
          onCancel={() => setShowBatchDeleteConfirm(false)}
          onConfirm={() => { void handleBatchDelete(); }}
          confirmCls={actionBtnDangerCls}
          cancelCls={actionBtnCls}
          t={t}
        />
      )}
      {showClearAllConfirm && (
        <ConfirmDialog
          title={t("memory.clearAll")}
          message={t("memory.clearAllConfirm")}
          onCancel={() => setShowClearAllConfirm(false)}
          onConfirm={() => { void handleClearAll(); }}
          confirmCls={actionBtnDangerCls}
          cancelCls={actionBtnCls}
          t={t}
        />
      )}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={t("memory.delete")}
          message={t("memory.deleteConfirm")}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={() => { void confirmDelete(); }}
          confirmCls={actionBtnDangerCls}
          cancelCls={actionBtnCls}
          t={t}
        />
      )}
      {showReconcileApplyConfirm && (
        <ConfirmDialog
          title={t("memory.reconcileApply")}
          message={t("memory.reconcileApplyConfirm")}
          onCancel={() => setShowReconcileApplyConfirm(false)}
          onConfirm={() => { void handleApplyReconcile(); }}
          confirmLabel={t("memory.reconcileApply")}
          confirmCls={actionBtnDangerCls}
          cancelCls={actionBtnCls}
          t={t}
        />
      )}
    </div>
  );

  return (
    <>
      <section className="project-memory-panel flex flex-col gap-2.5 h-full p-2.5 bg-(--bg-primary) text-(--text-primary)" />

      {managerOpen && (
        <div className="project-memory-modal fixed inset-0 z-[45]" role="dialog" aria-modal="true">
          <div
            className="project-memory-modal-backdrop absolute inset-0 bg-black/72 backdrop-blur-[3px]"
            onClick={closeManager}
          />
          <div className="project-memory-modal-card absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-24px)] h-[calc(100vh-24px)] max-w-[1720px] max-h-[1120px] rounded-2xl border border-(--border-subtle) bg-(--bg-primary) shadow-[0_24px_60px_rgba(0,0,0,0.5)] p-4 flex flex-col gap-3 max-[760px]:w-[calc(100vw-12px)] max-[760px]:h-[calc(100vh-12px)] max-[760px]:p-3">
            <div className="project-memory-modal-header flex items-center justify-between gap-2 pb-2 border-b border-(--border-subtle) max-[760px]:items-stretch max-[760px]:flex-wrap">
              <h2 className="project-memory-modal-title m-0 text-sm font-semibold tracking-[0.2px]">{t("memory.title")}</h2>
              <label className="project-memory-workspace-picker flex items-center gap-2 min-w-[220px] max-w-[min(460px,40vw)] mr-auto text-(--text-muted) text-[11px] font-semibold max-[760px]:order-3 max-[760px]:w-full max-[760px]:max-w-none max-[760px]:mr-0 [&_span]:shrink-0 [&_select]:min-w-0 [&_select]:flex-1 [&_select]:border [&_select]:border-(--border-subtle) [&_select]:bg-(--bg-input) [&_select]:text-inherit [&_select]:rounded-lg [&_select]:min-h-[30px] [&_select]:px-2.5 [&_select]:text-xs">
                <span>{t("memory.workspacePickerLabel")}</span>
                <select
                  value={workspaceSelectValue}
                  onChange={(event) => {
                    const nextWorkspaceId = event.target.value;
                    if (nextWorkspaceId && nextWorkspaceId !== workspaceId) {
                      onSelectWorkspace?.(nextWorkspaceId);
                    }
                  }}
                  disabled={!hasWorkspacePicker || !onSelectWorkspace}
                  aria-label={t("memory.workspacePickerLabel")}
                >
                  {hasWorkspacePicker ? (
                    workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name || workspace.path || workspace.id}
                        {workspace.connected ? "" : " (disconnected)"}
                      </option>
                    ))
                  ) : (
                    <option value={workspaceSelectValue}>
                      {workspaceId ?? t("memory.workspacePickerEmpty")}
                    </option>
                  )}
                </select>
              </label>
              <div className="project-memory-modal-actions flex items-center gap-1">
                <button type="button" className={settingsBtnCls} onClick={() => { void refresh(); }} title={t("memory.refresh")} aria-label={t("memory.refresh")} disabled={loading}>
                  <RefreshCw size={14} aria-hidden />
                </button>
                <button type="button" className={settingsBtnCls} onClick={() => setShowSettings((prev) => !prev)} title={t("memory.settings")} aria-label={t("memory.settings")}>
                  <Settings2 size={14} aria-hidden />
                </button>
                <button type="button" className={settingsBtnCls} onClick={() => setShowHelp((prev) => !prev)} title={t("memory.help")} aria-label={t("memory.help")}>
                  <HelpCircle size={14} aria-hidden />
                </button>
                <button type="button" className={settingsBtnCls} onClick={closeManager} title={t("memory.closeManager")} aria-label={t("memory.closeManager")}>
                  <X size={14} aria-hidden />
                </button>
              </div>
            </div>
            {renderManagerBody(true)}
          </div>
        </div>
      )}
    </>
  );
}

/** Reusable confirm dialog — extracted to reduce repetition. */
function ConfirmDialog({
  title,
  message,
  onCancel,
  onConfirm,
  confirmLabel,
  confirmCls,
  cancelCls,
  t,
}: {
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmCls: string;
  cancelCls: string;
  t: (key: string) => string;
}) {
  return (
    <div className="project-memory-confirm-dialog fixed inset-0 z-[70] flex items-center justify-center">
      <div className="project-memory-confirm-backdrop absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onCancel} />
      <div className="project-memory-confirm-card relative bg-(--bg-primary) border border-(--border-subtle) rounded-xl p-5 w-[min(400px,calc(100vw-40px))] shadow-[0_10px_40px_rgba(0,0,0,0.15)] flex flex-col gap-4">
        <h3 className="project-memory-confirm-title m-0 text-base font-semibold text-(--text-primary)">{title}</h3>
        <p className="project-memory-confirm-message m-0 text-sm leading-[1.6] text-(--text-secondary)">{message}</p>
        <div className="project-memory-confirm-actions flex gap-2.5 justify-end">
          <button type="button" className={cancelCls} onClick={onCancel}>{t("memory.cancel")}</button>
          <button type="button" className={confirmCls} onClick={onConfirm}>{confirmLabel ?? t("memory.confirmDelete")}</button>
        </div>
      </div>
    </div>
  );
}
