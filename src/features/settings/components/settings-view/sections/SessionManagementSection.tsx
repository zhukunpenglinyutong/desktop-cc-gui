import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Archive from "lucide-react/dist/esm/icons/archive";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import FolderInput from "lucide-react/dist/esm/icons/folder-input";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EngineIcon } from "../../../../engine/components/EngineIcon";
import type { EngineType, WorkspaceInfo } from "../../../../../types";
import {
  buildWorkspaceSessionSelectionKey,
  useWorkspaceSessionCatalog,
  type WorkspaceSessionCatalogMode,
  type WorkspaceSessionCatalogFilters,
  type WorkspaceSessionCatalogMutationResponse,
  type WorkspaceSessionCatalogSource,
} from "../hooks/useWorkspaceSessionCatalog";
import { useWorkspaceSessionProjectionSummary } from "../../../../workspaces/hooks/useWorkspaceSessionProjectionSummary";
import {
  assignWorkspaceSessionFolder,
  type WorkspaceSessionCatalogEntry,
} from "../../../../../services/tauri";
import { SessionOrganizerModal } from "./sessionOrganization/SessionOrganizerModal";
import { MoveToFolderPicker } from "./sessionOrganization/MoveToFolderPicker";

type GroupedWorkspace = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

type NoticeState =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string }
  | null;

type SessionManagementSectionProps = {
  title: string;
  description: string;
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: GroupedWorkspace[];
  initialWorkspaceId?: string | null;
  onSessionsMutated?: (workspaceId: string) => void;
};

type WorkspaceOption = {
  id: string;
  label: string;
  pickerLabel: string;
};

const UNASSIGNED_WORKSPACE_ID = "__global_unassigned__";
const OWNER_UNRESOLVED_CODE = "OWNER_WORKSPACE_UNRESOLVED";
const MISSING_MUTATION_RESULT_CODE = "MISSING_MUTATION_RESULT";

const DEFAULT_FILTERS: WorkspaceSessionCatalogFilters = {
  keyword: "",
  engine: "",
  status: "active",
};

type SessionListSectionProps = {
  title: string;
  description?: string;
  entries: WorkspaceSessionCatalogEntry[];
  selectedIds: Record<string, true>;
  workspaceLabelById: Map<string, string>;
  engineFilterLabel: Record<string, string>;
  locale: string;
  onToggleSelection: (selectionKey: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
};

function getSortOrderValue(value: number | null | undefined) {
  return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
}

function buildWorkspaceOptions(
  workspaces: WorkspaceInfo[],
  groupedWorkspaces: GroupedWorkspace[],
  scopeLabels: {
    project: string;
    worktree: string;
  },
): WorkspaceOption[] {
  const rootById = new Map<string, WorkspaceInfo>();
  const worktreesByParent = new Map<string, WorkspaceInfo[]>();

  workspaces.forEach((workspace) => {
    if ((workspace.kind ?? "main") === "worktree" && workspace.parentId) {
      const bucket = worktreesByParent.get(workspace.parentId) ?? [];
      bucket.push(workspace);
      worktreesByParent.set(workspace.parentId, bucket);
      return;
    }
    rootById.set(workspace.id, workspace);
  });

  const appendOptionsForWorkspace = (workspace: WorkspaceInfo, output: WorkspaceOption[]) => {
    const groupPrefix =
      groupedWorkspaces.find((group) => group.workspaces.some((item) => item.id === workspace.id))
        ?.name ?? "";
    const baseLabel = groupPrefix ? `${groupPrefix} / ${workspace.name}` : workspace.name;
    output.push({
      id: workspace.id,
      label: baseLabel,
      pickerLabel: groupPrefix
        ? `${groupPrefix} / ${scopeLabels.project} ${workspace.name}`
        : `${scopeLabels.project} ${workspace.name}`,
    });
    const worktrees = [...(worktreesByParent.get(workspace.id) ?? [])].sort((left, right) => {
      const sortDiff =
        getSortOrderValue(left.settings.sortOrder) - getSortOrderValue(right.settings.sortOrder);
      if (sortDiff !== 0) {
        return sortDiff;
      }
      return left.name.localeCompare(right.name);
    });
    worktrees.forEach((worktree) => {
      const scopedLabel = `${scopeLabels.worktree} ${worktree.name}`;
      output.push({
        id: worktree.id,
        label: `${groupPrefix ? `${groupPrefix} / ` : ""}${scopedLabel}`,
        pickerLabel: `${groupPrefix ? `${groupPrefix} / ` : ""}${scopedLabel}`,
      });
    });
  };

  const orderedRoots = [...rootById.values()].sort((left, right) => {
    const sortDiff =
      getSortOrderValue(left.settings.sortOrder) - getSortOrderValue(right.settings.sortOrder);
    if (sortDiff !== 0) {
      return sortDiff;
    }
    return left.name.localeCompare(right.name);
  });

  const options: WorkspaceOption[] = [];
  orderedRoots.forEach((workspace) => appendOptionsForWorkspace(workspace, options));
  return options;
}

function normalizeEngineType(engine: string): EngineType {
  if (engine === "claude" || engine === "gemini" || engine === "opencode") {
    return engine;
  }
  return "codex";
}

function formatUpdatedAtDisplay(updatedAt: number, locale: string) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return "--";
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveMutationFailureReason(
  result: WorkspaceSessionCatalogMutationResponse["results"][number],
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (result.code === OWNER_UNRESOLVED_CODE) {
    return t("settings.sessionManagementOwnerUnresolved");
  }
  if (result.code === MISSING_MUTATION_RESULT_CODE) {
    return t("settings.sessionManagementMissingMutationResult");
  }
  return result.error?.trim() || t("settings.projectSessionDeleteUnknownReason");
}

function resolveAttributionReasonLabel(
  entry: WorkspaceSessionCatalogEntry,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (entry.attributionReason === "shared-worktree-family") {
    return t("settings.sessionManagementAttributionReasonWorktreeFamily");
  }
  if (entry.attributionReason === "shared-git-root") {
    return t("settings.sessionManagementAttributionReasonGitRoot");
  }
  if (entry.attributionReason === "parent-scope") {
    return t("settings.sessionManagementAttributionReasonParentScope");
  }
  return null;
}

function resolveAttributionConfidenceLabel(
  entry: WorkspaceSessionCatalogEntry,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (entry.attributionConfidence === "high") {
    return t("settings.sessionManagementAttributionConfidenceHigh");
  }
  if (entry.attributionConfidence === "medium") {
    return t("settings.sessionManagementAttributionConfidenceMedium");
  }
  return null;
}

function SessionListSection({
  title,
  description,
  entries,
  selectedIds,
  workspaceLabelById,
  engineFilterLabel,
  locale,
  onToggleSelection,
  t,
}: SessionListSectionProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-sm font-semibold">{title}</div>
        {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
      </div>
      <ul className="settings-project-sessions-list">
        {entries.map((entry) => {
          const selectionKey = buildWorkspaceSessionSelectionKey(entry);
          const selected = Boolean(selectedIds[selectionKey]);
          const engineLabel = engineFilterLabel[normalizeEngineType(entry.engine)] ?? entry.engine;
          const ownerWorkspaceLabel =
            entry.workspaceId === UNASSIGNED_WORKSPACE_ID
              ? t("settings.sessionManagementWorkspaceUnassigned")
              : entry.workspaceLabel ?? workspaceLabelById.get(entry.workspaceId) ?? entry.workspaceId;
          const attributionReason = resolveAttributionReasonLabel(entry, t);
          const attributionConfidence = resolveAttributionConfidenceLabel(entry, t);
          return (
            <li key={selectionKey}>
              <label className={`settings-project-sessions-item${selected ? " is-selected" : ""}`}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelection(selectionKey)}
                  aria-label={entry.title}
                />
                <span className="settings-project-sessions-item-engine" aria-hidden>
                  <EngineIcon engine={normalizeEngineType(entry.engine)} size={14} />
                </span>
                <span className="settings-project-sessions-item-content">
                  <span className="flex items-center gap-2">
                    <span className="settings-project-sessions-item-title">
                      {entry.title.trim() || t("settings.projectSessionItemUntitled")}
                    </span>
                    {entry.archivedAt ? (
                      <Badge variant="secondary" size="sm">
                        {t("settings.sessionManagementBadgeArchived")}
                      </Badge>
                    ) : null}
                    {entry.attributionStatus === "inferred-related" ? (
                      <Badge variant="outline" size="sm">
                        {t("settings.sessionManagementBadgeRelated")}
                      </Badge>
                    ) : null}
                    {attributionConfidence ? (
                      <Badge variant="outline" size="sm">
                        {attributionConfidence}
                      </Badge>
                    ) : null}
                  </span>
                  <span className="settings-project-sessions-item-meta">
                    <span>{engineLabel}</span>
                    <span>·</span>
                    <span>{formatUpdatedAtDisplay(entry.updatedAt, locale)}</span>
                    <span>·</span>
                    <span>{ownerWorkspaceLabel}</span>
                    {entry.sourceLabel ? (
                      <>
                        <span>·</span>
                        <span>{entry.sourceLabel}</span>
                      </>
                    ) : null}
                    {attributionReason ? (
                      <>
                        <span>·</span>
                        <span>{attributionReason}</span>
                      </>
                    ) : null}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function collectSucceededWorkspaceIds(
  results: WorkspaceSessionCatalogMutationResponse["results"],
): string[] {
  return [...new Set(results.filter((item) => item.ok).map((item) => item.workspaceId))];
}

export function SessionManagementSection({
  title,
  description,
  workspaces,
  groupedWorkspaces,
  initialWorkspaceId = null,
  onSessionsMutated,
}: SessionManagementSectionProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const workspaceScopeLabels = useMemo(
    () => ({
      project: t("settings.sessionManagementScopeTagProject"),
      worktree: t("settings.sessionManagementScopeTagWorktree"),
    }),
    [t],
  );
  const workspaceOptions = useMemo(
    () => buildWorkspaceOptions(workspaces, groupedWorkspaces, workspaceScopeLabels),
    [groupedWorkspaces, workspaceScopeLabels, workspaces],
  );
  const workspaceLabelById = useMemo(
    () => new Map(workspaceOptions.map((option) => [option.id, option.label])),
    [workspaceOptions],
  );
  const workspacePickerLabelById = useMemo(
    () => new Map(workspaceOptions.map((option) => [option.id, option.pickerLabel])),
    [workspaceOptions],
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    initialWorkspaceId && workspaceOptions.some((item) => item.id === initialWorkspaceId)
      ? initialWorkspaceId
      : workspaceOptions[0]?.id ?? null,
  );
  const [mode, setMode] = useState<WorkspaceSessionCatalogMode>("project");
  const [organizerOpen, setOrganizerOpen] = useState(false);
  const [filters, setFilters] = useState<WorkspaceSessionCatalogFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({});
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [isMovingToFolder, setIsMovingToFolder] = useState(false);
  const primarySource: WorkspaceSessionCatalogSource = "strict";
  const summaryQuery = useMemo(
    () => ({
      keyword: filters.keyword,
      engine: filters.engine,
      status: filters.status,
    }),
    [filters.engine, filters.keyword, filters.status],
  );
  const {
    summary: _projectionSummary,
    error: _projectionSummaryError,
    isLoading: _projectionSummaryLoading,
    reload: reloadProjectionSummary,
  } = useWorkspaceSessionProjectionSummary({
    workspaceId: mode === "project" ? workspaceId : null,
    query: summaryQuery,
    enabled: mode === "project" && Boolean(workspaceId),
  });
  const {
    entries: primaryEntries,
    nextCursor: primaryNextCursor,
    partialSource: _primaryPartialSource,
    error: primaryError,
    isLoading: primaryIsLoading,
    isLoadingMore: primaryIsLoadingMore,
    isMutating,
    reload: reloadPrimary,
    loadMore: loadMorePrimary,
    mutate,
  } = useWorkspaceSessionCatalog({ mode, workspaceId, filters, source: primarySource });
  const {
    entries: _relatedEntries,
    nextCursor: _relatedNextCursor,
    partialSource: _relatedPartialSource,
    error: _relatedError,
    isLoading: _relatedIsLoading,
    isLoadingMore: _relatedIsLoadingMore,
    reload: _reloadRelated,
    loadMore: _loadMoreRelated,
  } = useWorkspaceSessionCatalog({
    mode: "project",
    workspaceId,
    filters,
    source: "related",
    enabled: mode === "project",
  });

  const visibleEntries = useMemo(
    () => (mode === "global" ? primaryEntries : primaryEntries),
    [mode, primaryEntries],
  );

  const selectedCount = useMemo(() => Object.keys(selectedIds).length, [selectedIds]);
  const allSelected =
    visibleEntries.length > 0 &&
    visibleEntries.every((entry) => Boolean(selectedIds[buildWorkspaceSessionSelectionKey(entry)]));

  const engineFilterLabel = useMemo(
    () => ({
      all: t("settings.sessionManagementEngineAll"),
      codex: t("settings.projectSessionEngineCodex"),
      claude: t("settings.projectSessionEngineClaude"),
      gemini: t("settings.projectSessionEngineGemini"),
      opencode: t("settings.projectSessionEngineOpencode"),
    }),
    [t],
  );

  const toggleSelection = (selectionKey: string) => {
    setSelectedIds((current) => {
      if (current[selectionKey]) {
        const next = { ...current };
        delete next[selectionKey];
        return next;
      }
      return { ...current, [selectionKey]: true };
    });
  };

  const resetSelection = () => {
    setSelectedIds({});
    setDeleteArmed(false);
  };

  const keepOnlySelected = (selectionKeys: string[]) => {
    const next: Record<string, true> = {};
    selectionKeys.forEach((selectionKey) => {
      next[selectionKey] = true;
    });
    setSelectedIds(next);
    setDeleteArmed(false);
  };

  const handleSelectAll = () => {
    const next: Record<string, true> = {};
    visibleEntries.forEach((entry) => {
      next[buildWorkspaceSessionSelectionKey(entry)] = true;
    });
    setSelectedIds(next);
  };

  const handleSelectAllInOrganizer = () => {
    if (primaryEntries.length === 0) return;
    const next: Record<string, true> = {};
    primaryEntries.forEach((entry) => {
      next[buildWorkspaceSessionSelectionKey(entry)] = true;
    });
    setSelectedIds(next);
  };

  const openOrganizer = () => {
    resetSelection();
    setMovePickerOpen(false);
    setNotice(null);
    setOrganizerOpen(true);
  };

  const closeOrganizer = () => {
    if (isMovingToFolder) return;
    resetSelection();
    setMovePickerOpen(false);
    setOrganizerOpen(false);
  };

  const handleWorkspaceChange = (nextWorkspaceId: string | null) => {
    setWorkspaceId(nextWorkspaceId ?? null);
    resetSelection();
    setNotice(null);
  };

  const handleFiltersChange = (
    nextFilters: Partial<WorkspaceSessionCatalogFilters>,
  ) => {
    setFilters((current) => ({ ...current, ...nextFilters }));
    resetSelection();
    setNotice(null);
  };

  const handleRefresh = async () => {
    await Promise.all([
      reloadPrimary(),
      mode === "project" && workspaceId ? reloadProjectionSummary() : Promise.resolve(),
    ]);
    resetSelection();
  };

  const handleModeChange = (nextMode: WorkspaceSessionCatalogMode) => {
    setMode(nextMode);
    resetSelection();
    setNotice(null);
  };

  useEffect(() => {
    if (workspaceOptions.length === 0) {
      if (workspaceId !== null) {
        setWorkspaceId(null);
      }
      return;
    }
    if (workspaceId && workspaceLabelById.has(workspaceId)) {
      return;
    }
    setWorkspaceId(workspaceOptions[0]?.id ?? null);
  }, [workspaceId, workspaceLabelById, workspaceOptions]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [workspaceId, workspaces],
  );

  const handleMutation = async (kind: "archive" | "unarchive" | "delete") => {
    const selectedEntries = visibleEntries.filter((entry) =>
      Boolean(selectedIds[buildWorkspaceSessionSelectionKey(entry)]),
    );
    if (selectedEntries.length === 0) {
      return;
    }
    if (kind === "delete" && !deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      const response = await mutate(kind, selectedEntries);
      const succeeded = response.results.filter((item) => item.ok);
      const failed = response.results.filter((item) => !item.ok);
      if (failed.length === 0) {
        const successKey =
          kind === "archive"
            ? "settings.sessionManagementArchiveSuccess"
            : kind === "unarchive"
              ? "settings.sessionManagementUnarchiveSuccess"
              : "settings.sessionManagementDeleteSuccess";
        setNotice({
          kind: "success",
          text: t(successKey, { count: succeeded.length }),
        });
      } else {
        const failureText = failed
          .map((item) => resolveMutationFailureReason(item, t))
          .join(" · ");
        setNotice({
          kind: "error",
          text: t("settings.sessionManagementMutationPartial", {
            succeeded: succeeded.length,
            failed: failed.length,
            reason: failureText,
          }),
        });
      }
      const shouldReloadPrimary = kind !== "delete" || failed.length > 0;
      const shouldReloadProjectionSummary =
        mode === "project" && Boolean(workspaceId);
      if (shouldReloadPrimary) {
        void Promise.all([
          reloadPrimary(),
          shouldReloadProjectionSummary ? reloadProjectionSummary() : Promise.resolve(),
        ]);
      } else if (shouldReloadProjectionSummary) {
        void reloadProjectionSummary();
      }
      const succeededWorkspaceIds = collectSucceededWorkspaceIds(response.results);
      succeededWorkspaceIds.forEach((ownerWorkspaceId) => {
        onSessionsMutated?.(ownerWorkspaceId);
      });
      if (failed.length > 0) {
        keepOnlySelected(failed.map((item) => item.selectionKey));
      } else {
        resetSelection();
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleApplyMoveToFolder = async (folderId: string | null) => {
    if (!workspaceId || isMovingToFolder) {
      return;
    }
    const selectedEntries = visibleEntries.filter((entry) =>
      Boolean(selectedIds[buildWorkspaceSessionSelectionKey(entry)]),
    );
    if (selectedEntries.length === 0) {
      setMovePickerOpen(false);
      return;
    }
    setIsMovingToFolder(true);
    let succeeded = 0;
    const failures: { sessionId: string; error: string }[] = [];
    try {
      for (const entry of selectedEntries) {
        try {
          await assignWorkspaceSessionFolder(
            workspaceId,
            entry.sessionId,
            folderId,
          );
          succeeded += 1;
        } catch (error) {
          failures.push({
            sessionId: entry.sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (failures.length === 0) {
        setNotice({
          kind: "success",
          text: t("settings.sessionOrganizationMoveSuccess", {
            count: succeeded,
          }),
        });
        resetSelection();
      } else {
        setNotice({
          kind: "error",
          text: t("settings.sessionOrganizationMovePartial", {
            succeeded,
            failed: failures.length,
            reason: failures[0]?.error ?? "",
          }),
        });
      }
      await Promise.all([
        reloadPrimary(),
        mode === "project" && workspaceId
          ? reloadProjectionSummary()
          : Promise.resolve(),
      ]);
      const succeededWorkspaceIds = new Set(
        selectedEntries
          .filter(
            (entry) =>
              !failures.some(
                (failure) => failure.sessionId === entry.sessionId,
              ),
          )
          .map((entry) => entry.workspaceId),
      );
      succeededWorkspaceIds.forEach((ownerWorkspaceId) => {
        onSessionsMutated?.(ownerWorkspaceId);
      });
    } finally {
      setIsMovingToFolder(false);
      setMovePickerOpen(false);
    }
  };

  const expandCount = mode === "global" ? primaryEntries.length : primaryEntries.length;

  return (
    <div className={`settings-project-sessions${expanded ? " is-open" : ""}`}>
      <button
        type="button"
        className={`settings-project-sessions-expand-btn${expanded ? " is-open" : ""}`}
        onClick={() => setExpanded((current) => !current)}
        data-testid="settings-project-sessions-expand-toggle"
      >
        {expanded ? (
          <ChevronDown className="settings-project-sessions-expand-icon" size={14} aria-hidden />
        ) : (
          <ChevronRight className="settings-project-sessions-expand-icon" size={14} aria-hidden />
        )}
        <span className="settings-project-sessions-expand-label">{title}</span>
        <span className="settings-project-sessions-expand-count">({expandCount})</span>
      </button>

      {expanded ? (
        <div className="mt-4 space-y-4">
          <div className="settings-project-sessions-header">
            <div className="settings-project-sessions-title-wrap">
              <h3 className="text-sm font-semibold">{title}</h3>
              <p>{description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleRefresh()}
                disabled={(mode === "project" && !workspaceId) || primaryIsLoading || isMutating}
              >
                <RotateCw size={14} aria-hidden />
                {t("settings.projectSessionRefresh")}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "project" ? "default" : "outline"}
              onClick={() => handleModeChange("project")}
            >
              {t("settings.sessionManagementModeProject")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "global" ? "default" : "outline"}
              onClick={() => handleModeChange("global")}
            >
              {t("settings.sessionManagementModeGlobal")}
            </Button>
          </div>

          {mode === "project" ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)]">
                <Select value={workspaceId ?? undefined} onValueChange={handleWorkspaceChange}>
                  <SelectTrigger data-testid="settings-project-sessions-workspace-picker-trigger">
                    <SelectValue placeholder={t("settings.workspacePickerLabel")}>
                      {workspaceId ? workspacePickerLabelById.get(workspaceId) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {workspaceOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.pickerLabel}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex justify-center py-8">
                <Button
                  type="button"
                  size="lg"
                  onClick={openOrganizer}
                  disabled={!workspaceId || primaryIsLoading || isMutating}
                  data-testid="settings-project-sessions-open-organizer"
                >
                  <FolderInput size={16} aria-hidden />
                  {t("settings.sessionOrganizerOpenButton")}
                </Button>
              </div>

              {!workspaceId ? (
                <div className="settings-project-sessions-empty">
                  {t("settings.projectSessionWorkspaceRequired")}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-[minmax(180px,1.1fr)_minmax(160px,.8fr)_minmax(140px,.7fr)_minmax(140px,.7fr)]">
                <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  {t("settings.sessionManagementGlobalHistoryAllEngines")}
                </div>

                <Input
                  value={filters.keyword}
                  onChange={(event) => handleFiltersChange({ keyword: event.target.value })}
                  placeholder={t("settings.sessionManagementSearchPlaceholder")}
                  aria-label={t("settings.sessionManagementSearchPlaceholder")}
                />

                <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                  {t("settings.projectSessionEngineCodex")}
                </div>

                <Select
                  value={filters.status}
                  onValueChange={(value) =>
                    handleFiltersChange({
                      status: value as WorkspaceSessionCatalogFilters["status"],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue>
                      {filters.status === "archived"
                        ? t("settings.sessionManagementStatusArchived")
                        : filters.status === "all"
                          ? t("settings.sessionManagementStatusAll")
                          : t("settings.sessionManagementStatusActive")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">{t("settings.sessionManagementStatusActive")}</SelectItem>
                    <SelectItem value="archived">
                      {t("settings.sessionManagementStatusArchived")}
                    </SelectItem>
                    <SelectItem value="all">{t("settings.sessionManagementStatusAll")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="settings-project-sessions-toolbar">
                <span className="settings-project-sessions-selected">
                  {t("settings.projectSessionSelectedCount", { count: selectedCount })}
                </span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="settings-project-sessions-btn"
                    onClick={handleSelectAll}
                    disabled={visibleEntries.length === 0 || allSelected}
                  >
                    {t("settings.projectSessionSelectAll")}
                  </button>
                  <button
                    type="button"
                    className="settings-project-sessions-btn"
                    onClick={resetSelection}
                    disabled={selectedCount === 0}
                  >
                    {t("settings.projectSessionClearSelection")}
                  </button>
                  <button
                    type="button"
                    className="settings-project-sessions-btn"
                    onClick={() => void handleMutation("archive")}
                    disabled={selectedCount === 0 || isMutating}
                  >
                    <Archive size={14} aria-hidden />
                    {t("settings.sessionManagementArchiveSelected")}
                  </button>
                  <button
                    type="button"
                    className="settings-project-sessions-btn"
                    onClick={() => void handleMutation("unarchive")}
                    disabled={selectedCount === 0 || isMutating}
                  >
                    <Undo2 size={14} aria-hidden />
                    {t("settings.sessionManagementUnarchiveSelected")}
                  </button>
                  <button
                    type="button"
                    className="settings-project-sessions-btn is-danger"
                    onClick={() => void handleMutation("delete")}
                    disabled={selectedCount === 0 || isMutating}
                    data-testid="settings-project-sessions-delete-selected"
                  >
                    <Trash2 size={14} aria-hidden />
                    {deleteArmed
                      ? t("settings.projectSessionConfirmDeleteSelected", { count: selectedCount })
                      : t("settings.projectSessionDeleteSelected")}
                  </button>
                </div>
              </div>

              {notice ? (
                <div className={`settings-project-sessions-notice is-${notice.kind}`}>{notice.text}</div>
              ) : null}

              {primaryError ? (
                <div className="settings-project-sessions-notice is-error">{primaryError}</div>
              ) : null}

              {primaryIsLoading ? (
                <div className="settings-project-sessions-empty">{t("settings.projectSessionLoading")}</div>
              ) : primaryEntries.length === 0 ? (
                <div className="settings-project-sessions-empty space-y-3">
                  <div>
                    {t("settings.sessionManagementGlobalEmpty")}
                  </div>
                </div>
              ) : (
                <>
                  <SessionListSection
                    title={t("settings.sessionManagementGlobalSectionTitle")}
                    description={t("settings.sessionManagementGlobalSectionDescription")}
                    entries={primaryEntries}
                    selectedIds={selectedIds}
                    workspaceLabelById={workspaceLabelById}
                    engineFilterLabel={engineFilterLabel}
                    locale={i18n.language}
                    onToggleSelection={toggleSelection}
                    t={t}
                  />
                  {primaryNextCursor ? (
                    <div className="flex justify-center">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void loadMorePrimary()}
                        disabled={primaryIsLoadingMore}
                      >
                        {primaryIsLoadingMore
                          ? t("settings.sessionManagementLoadingMore")
                          : t("settings.sessionManagementLoadMore")}
                      </Button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      ) : null}
      {movePickerOpen && workspaceId ? (
        <MoveToFolderPicker
          workspaceId={workspaceId}
          selectedCount={selectedCount}
          onClose={() => {
            if (!isMovingToFolder) {
              setMovePickerOpen(false);
            }
          }}
          onApply={(folderId) => handleApplyMoveToFolder(folderId)}
        />
      ) : null}
      {organizerOpen && workspaceId ? (
        <SessionOrganizerModal
          workspaceId={workspaceId}
          workspacePath={selectedWorkspace?.path ?? null}
          workspaceLabel={
            workspaceLabelById.get(workspaceId) ?? selectedWorkspace?.name ?? ""
          }
          entries={primaryEntries}
          selectedIds={selectedIds}
          selectedCount={selectedCount}
          deleteArmed={deleteArmed}
          isMutating={isMutating}
          isMovingToFolder={isMovingToFolder}
          locale={i18n.language}
          onClose={closeOrganizer}
          onToggleSelection={toggleSelection}
          onSelectAll={handleSelectAllInOrganizer}
          onClearSelection={resetSelection}
          onArchive={() => void handleMutation("archive")}
          onUnarchive={() => void handleMutation("unarchive")}
          onDelete={() => void handleMutation("delete")}
          onOpenMovePicker={() => setMovePickerOpen(true)}
          onCatalogMutated={() => {
            void reloadPrimary();
            void reloadProjectionSummary();
          }}
        />
      ) : null}
    </div>
  );
}
