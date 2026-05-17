import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Markdown } from "../../messages/components/Markdown";
import type {
  ContextLedgerAttributionConfidence,
  ContextLedgerBlock,
  ContextLedgerCarryOverReason,
  ContextLedgerComparison,
  ContextLedgerComparisonItemChange,
  ContextLedgerGroup,
  ContextLedgerProjection,
  ContextLedgerSourceNavigationTarget,
} from "../types";
import {
  canBatchClearCarryOverBlock,
  canBatchExcludeBlock,
  canBatchKeepBlock,
  isBatchGovernableBlock,
} from "../utils/contextLedgerGovernance";
import { formatContextLedgerInspectionMarkdown } from "../utils/contextLedgerInspectionMarkdown";
import { normalizeManagedInstructionSource } from "../../skills/utils/managedInstructionSource";

type ContextLedgerPanelProps = {
  projection: ContextLedgerProjection;
  comparison?: ContextLedgerComparison | null;
  expanded: boolean;
  hidden?: boolean;
  onToggle: () => void;
  onHide?: () => void;
  onShow?: () => void;
  onExcludeBlock?: (block: ContextLedgerBlock) => void;
  onClearCarryOverBlock?: (block: ContextLedgerBlock) => void;
  onBatchKeepBlocks?: (blocks: ContextLedgerBlock[]) => void;
  onBatchExcludeBlocks?: (blocks: ContextLedgerBlock[]) => void;
  onBatchClearCarryOverBlocks?: (blocks: ContextLedgerBlock[]) => void;
  onTogglePinBlock?: (block: ContextLedgerBlock) => void;
  onOpenBlockSource?: (target: ContextLedgerSourceNavigationTarget) => void;
};

function formatCompactCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return Number.isInteger(millions) ? `${millions}m` : `${millions.toFixed(1)}m`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`;
  }
  return `${Math.round(value)}`;
}

function resolveGroupLabel(t: (key: string) => string, group: ContextLedgerGroup) {
  switch (group.kind) {
    case "recent_turns":
      return t("composer.contextLedgerGroupRecentTurns");
    case "compaction_summary":
      return t("composer.contextLedgerGroupCompaction");
    case "manual_memory":
      return t("composer.contextLedgerGroupManualMemory");
    case "attached_resource":
      return t("composer.contextLedgerGroupAttachedResource");
    case "helper_selection":
      return t("composer.contextLedgerGroupHelperSelection");
  }
}

function resolveBlockLabel(t: (key: string) => string, block: ContextLedgerBlock) {
  switch (block.kind) {
    case "usage_snapshot":
      return t("composer.contextLedgerBlockUsageSnapshot");
    case "compaction_summary":
      return t("composer.contextLedgerBlockCompactionSummary");
    case "manual_memory":
      return t("composer.contextLedgerBlockManualMemory");
    case "note_card":
      return t("composer.contextLedgerBlockNoteCard");
    case "file_reference":
      return t("composer.contextLedgerBlockFileReference");
    case "helper_selection":
      return t("composer.contextLedgerBlockHelperSelection");
  }
}

function resolveParticipationLabel(t: (key: string) => string, value: ContextLedgerBlock["participationState"]) {
  switch (value) {
    case "selected":
      return t("composer.contextLedgerParticipationSelected");
    case "pinned_next_send":
      return t("composer.contextLedgerParticipationPinnedNextSend");
    case "carried_over":
      return t("composer.contextLedgerParticipationCarriedOver");
    case "shared":
      return t("composer.contextLedgerParticipationShared");
    case "degraded":
      return t("composer.contextLedgerParticipationDegraded");
  }
}

function resolveFreshnessLabel(t: (key: string) => string, value: ContextLedgerBlock["freshness"]) {
  switch (value) {
    case "fresh":
      return t("composer.contextLedgerFreshnessFresh");
    case "pending_sync":
      return t("composer.contextLedgerFreshnessPendingSync");
    case "unknown":
      return t("composer.contextLedgerFreshnessUnknown");
  }
}

function resolveCarryOverReasonLabel(
  t: (key: string) => string,
  value: ContextLedgerCarryOverReason | null | undefined,
) {
  switch (value) {
    case "inherited_from_last_send":
      return t("composer.contextLedgerCarryOverReasonInherited");
    case "will_carry_next_send":
      return t("composer.contextLedgerCarryOverReasonWillCarry");
    default:
      return null;
  }
}

function resolveCarryOverExplanation(
  t: (key: string) => string,
  value: ContextLedgerCarryOverReason | null | undefined,
) {
  switch (value) {
    case "inherited_from_last_send":
      return t("composer.contextLedgerCarryOverExplanationInherited");
    case "will_carry_next_send":
      return t("composer.contextLedgerCarryOverExplanationWillCarry");
    default:
      return null;
  }
}

function resolveAttributionConfidenceLabel(
  t: (key: string) => string,
  value: ContextLedgerAttributionConfidence | null | undefined,
) {
  switch (value) {
    case "precise":
      return t("composer.contextLedgerAttributionConfidencePrecise");
    case "coarse":
      return t("composer.contextLedgerAttributionConfidenceCoarse");
    case "degraded":
      return t("composer.contextLedgerAttributionConfidenceDegraded");
    default:
      return null;
  }
}

function resolveAttributionConfidenceExplanation(
  t: (key: string) => string,
  value: ContextLedgerAttributionConfidence | null | undefined,
) {
  switch (value) {
    case "precise":
      return t("composer.contextLedgerAttributionExplanationPrecise");
    case "coarse":
      return t("composer.contextLedgerAttributionExplanationCoarse");
    case "degraded":
      return t("composer.contextLedgerAttributionExplanationDegraded");
    default:
      return null;
  }
}

function resolveAttributionLabel(
  t: (key: string) => string,
  value: ContextLedgerBlock["attributionKind"],
) {
  switch (value) {
    case "workspace_context":
      return t("composer.contextLedgerAttributionWorkspaceContext");
    case "engine_injected":
      return t("composer.contextLedgerAttributionEngineInjected");
    case "system_injected":
      return t("composer.contextLedgerAttributionSystemInjected");
    case "degraded":
      return t("composer.contextLedgerAttributionDegraded");
    default:
      return null;
  }
}

function resolveBackendSourceLabel(
  t: (key: string) => string,
  value: ContextLedgerBlock["backendSource"],
) {
  switch (normalizeManagedInstructionSource(value)) {
    case "workspace_managed":
      return t("composer.contextLedgerBackendSourceWorkspaceManaged");
    case "project_claude":
      return t("composer.contextLedgerBackendSourceProjectClaude");
    case "project_codex":
      return t("composer.contextLedgerBackendSourceProjectCodex");
    case "project_agents":
      return t("composer.contextLedgerBackendSourceProjectAgents");
    case "global_claude":
      return t("composer.contextLedgerBackendSourceGlobalClaude");
    case "global_claude_plugin":
      return t("composer.contextLedgerBackendSourceGlobalClaudePlugin");
    case "global_codex":
      return t("composer.contextLedgerBackendSourceGlobalCodex");
    case "global_gemini":
      return t("composer.contextLedgerBackendSourceGlobalGemini");
    case "global_agents":
      return t("composer.contextLedgerBackendSourceGlobalAgents");
    default:
      return null;
  }
}

function resolveEstimateLabel(t: (key: string, params?: Record<string, unknown>) => string, block: ContextLedgerBlock) {
  if (block.estimate.kind === "tokens" && block.estimate.value != null) {
    return t("composer.contextLedgerEstimateTokens", {
      count: formatCompactCount(block.estimate.value),
    });
  }
  if (block.estimate.kind === "chars" && block.estimate.value != null) {
    return t("composer.contextLedgerEstimateChars", {
      count: block.estimate.value,
    });
  }
  return t("composer.contextLedgerEstimateUnknown");
}

function resolveComparisonTitle(
  t: (key: string) => string,
  comparison: ContextLedgerComparison,
) {
  return comparison.basis === "pre_compaction"
    ? t("composer.contextLedgerComparisonPreCompaction")
    : t("composer.contextLedgerComparisonLastSend");
}

function resolveComparisonCountLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  change: ContextLedgerComparisonItemChange,
  count: number,
) {
  switch (change) {
    case "added":
      return t("composer.contextLedgerComparisonAdded", { count });
    case "removed":
      return t("composer.contextLedgerComparisonRemoved", { count });
    case "retained":
      return t("composer.contextLedgerComparisonRetained", { count });
    case "changed":
      return t("composer.contextLedgerComparisonChanged", { count });
  }
}

function formatSignedCompactCount(value: number) {
  const compact = formatCompactCount(Math.abs(value));
  if (value === 0) {
    return "0";
  }
  return `${value > 0 ? "+" : "-"}${compact}`;
}

function resolveComparisonUsageDeltaLabel(
  t: (key: string, params?: Record<string, unknown>) => string,
  comparison: ContextLedgerComparison,
) {
  if (comparison.usageTokenDelta == null) {
    return null;
  }
  return t("composer.contextLedgerComparisonUsageDelta", {
    delta: formatSignedCompactCount(comparison.usageTokenDelta),
  });
}

function resolveBlockTitle(t: (key: string, params?: Record<string, unknown>) => string, block: ContextLedgerBlock) {
  if (block.titleKey) {
    return t(block.titleKey, block.titleParams ?? undefined);
  }
  return block.title;
}

function resolveBlockDetail(t: (key: string, params?: Record<string, unknown>) => string, block: ContextLedgerBlock) {
  if (block.detailKey) {
    return t(block.detailKey, block.detailParams ?? undefined);
  }
  return block.detail;
}

function resolveInspectionTitle(
  t: (key: string, params?: Record<string, unknown>) => string,
  block: ContextLedgerBlock,
) {
  if (block.inspectionTitleKey) {
    return t(block.inspectionTitleKey, block.inspectionTitleParams ?? undefined);
  }
  return block.inspectionTitle ?? resolveBlockTitle(t, block);
}

function resolveInspectionContent(
  t: (key: string, params?: Record<string, unknown>) => string,
  block: ContextLedgerBlock,
) {
  if (block.inspectionContentKey) {
    return t(block.inspectionContentKey, block.inspectionContentParams ?? undefined);
  }
  return block.inspectionContent ?? resolveBlockDetail(t, block) ?? block.sourceRef ?? "";
}

function canExcludeBlock(block: ContextLedgerBlock) {
  return (
    block.kind === "manual_memory"
    || block.kind === "note_card"
    || block.kind === "helper_selection"
    || block.kind === "file_reference"
  ) && (
    block.participationState === "selected"
    || block.participationState === "pinned_next_send"
  );
}

function canTogglePinBlock(block: ContextLedgerBlock) {
  return (
    block.kind === "manual_memory"
    || block.kind === "note_card"
    || block.kind === "helper_selection"
  ) && (
    block.participationState === "selected"
    || block.participationState === "carried_over"
    || block.participationState === "pinned_next_send"
  );
}

function resolveBlockSourceNavigationTarget(
  block: ContextLedgerBlock,
): ContextLedgerSourceNavigationTarget | null {
  const sourceRef = block.sourceRef?.trim();
  if (!sourceRef) {
    return null;
  }
  if (block.kind === "manual_memory") {
    return {
      kind: "manual_memory",
      memoryId: sourceRef,
    };
  }
  if (block.kind === "note_card") {
    return {
      kind: "note_card",
      noteId: sourceRef,
    };
  }
  if (block.kind === "file_reference") {
    return {
      kind: "file_reference",
      path: sourceRef,
    };
  }
  return null;
}

function resolveOpenSourceLabel(
  t: (key: string) => string,
  block: ContextLedgerBlock,
) {
  switch (block.kind) {
    case "manual_memory":
      return t("composer.contextLedgerActionOpenMemorySource");
    case "note_card":
      return t("composer.contextLedgerActionOpenNoteSource");
    case "file_reference":
      return t("composer.contextLedgerActionOpenFileSource");
    default:
      return null;
  }
}

function resolveGroupClassName(group: ContextLedgerGroup) {
  return `composer-context-ledger-group composer-context-ledger-group--${group.kind}`;
}

function resolveBlockClassName(block: ContextLedgerBlock, batchSelected: boolean) {
  return [
    "composer-context-ledger-block",
    `composer-context-ledger-block--${block.kind}`,
    batchSelected ? "is-batch-selected" : null,
  ].filter(Boolean).join(" ");
}

export const ContextLedgerPanel = memo(function ContextLedgerPanel({
  projection,
  comparison = null,
  expanded,
  hidden = false,
  onToggle,
  onHide,
  onShow,
  onExcludeBlock,
  onClearCarryOverBlock,
  onBatchKeepBlocks,
  onBatchExcludeBlocks,
  onBatchClearCarryOverBlocks,
  onTogglePinBlock,
  onOpenBlockSource,
}: ContextLedgerPanelProps) {
  const { t } = useTranslation();
  const [inspectedBlock, setInspectedBlock] = useState<ContextLedgerBlock | null>(null);
  const [selectedBatchBlockIds, setSelectedBatchBlockIds] = useState<string[]>([]);

  const batchGovernableBlocks = useMemo(
    () =>
      projection.groups.flatMap((group) =>
        group.blocks.filter((block) => isBatchGovernableBlock(block)),
      ),
    [projection.groups],
  );
  const batchGovernableBlockIds = useMemo(
    () => new Set(batchGovernableBlocks.map((block) => block.id)),
    [batchGovernableBlocks],
  );
  const batchSelectionEnabled = batchGovernableBlocks.length > 1;
  const selectedBatchBlocks = useMemo(
    () =>
      batchGovernableBlocks.filter((block) =>
        selectedBatchBlockIds.includes(block.id),
      ),
    [batchGovernableBlocks, selectedBatchBlockIds],
  );
  const batchKeepCandidates = useMemo(
    () => selectedBatchBlocks.filter((block) => canBatchKeepBlock(block)),
    [selectedBatchBlocks],
  );
  const batchExcludeCandidates = useMemo(
    () => selectedBatchBlocks.filter((block) => canBatchExcludeBlock(block)),
    [selectedBatchBlocks],
  );
  const batchClearCandidates = useMemo(
    () => selectedBatchBlocks.filter((block) => canBatchClearCarryOverBlock(block)),
    [selectedBatchBlocks],
  );

  useEffect(() => {
    if (hidden) {
      setInspectedBlock(null);
      setSelectedBatchBlockIds([]);
    }
  }, [hidden]);

  useEffect(() => {
    setSelectedBatchBlockIds((prev) =>
      prev.filter((blockId) => batchGovernableBlockIds.has(blockId)),
    );
  }, [batchGovernableBlockIds]);

  if (!projection.visible && !comparison) {
    return null;
  }

  const summaryBits = [
    projection.totalUsageTokens != null
      ? t("composer.contextLedgerSummaryTokens", {
          tokens: formatCompactCount(projection.totalUsageTokens),
        })
      : null,
    t("composer.contextLedgerSummaryBlocks", {
      count: projection.totalBlockCount,
    }),
    t("composer.contextLedgerSummaryGroups", {
      count: projection.totalGroupCount,
    }),
  ].filter(Boolean);
  const inspectedAttributionLabel = inspectedBlock
    ? resolveAttributionLabel(t, inspectedBlock.attributionKind)
    : null;
  const inspectedBackendSourceLabel = inspectedBlock
    ? resolveBackendSourceLabel(t, inspectedBlock.backendSource)
    : null;
  const inspectedMarkdownContent = inspectedBlock
    ? formatContextLedgerInspectionMarkdown(resolveInspectionContent(t, inspectedBlock))
    : "";
  const summaryText = summaryBits.join(" · ");
  const showLabel = t("composer.contextLedgerShow");
  const toggleLabel = hidden
    ? showLabel
    : expanded
      ? t("composer.contextLedgerCollapse")
      : t("composer.contextLedgerExpand");
  const handlePrimaryToggle = hidden
    ? (onShow ?? onToggle)
    : onToggle;
  const handleSelectAllBatchBlocks = () => {
    setSelectedBatchBlockIds(batchGovernableBlocks.map((block) => block.id));
  };
  const handleClearBatchSelection = () => {
    setSelectedBatchBlockIds([]);
  };
  const runBatchAction = (
    blocks: ContextLedgerBlock[],
    handler: ((batchBlocks: ContextLedgerBlock[]) => void) | undefined,
  ) => {
    if (blocks.length === 0 || !handler) {
      return;
    }
    handler(blocks);
    setSelectedBatchBlockIds([]);
  };

  return (
    <section className={`composer-context-ledger${hidden ? " is-hidden" : ""}`}>
      <div className="composer-context-ledger-toggle">
        <button
          type="button"
          className="composer-context-ledger-toggle-main flex-1 min-w-0 flex items-center gap-2 border-none bg-transparent text-inherit p-0 m-0 text-left cursor-pointer"
          aria-expanded={!hidden && expanded}
          onClick={handlePrimaryToggle}
        >
          <span className="composer-context-ledger-title text-xs font-bold flex-shrink-0">
            {t("composer.contextLedgerTitle")}
          </span>
          <span className="composer-context-ledger-summary text-[11px] text-(--text-muted) min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
            {summaryText}
          </span>
        </button>
        <div className="composer-context-ledger-toggle-actions inline-flex items-center gap-1.5 flex-shrink-0">
          {!hidden && onHide ? (
            <button
              type="button"
              className="composer-context-ledger-icon-action"
              onClick={onHide}
              aria-label={t("composer.contextLedgerHide")}
              title={t("composer.contextLedgerHide")}
            >
              <span className="codicon codicon-eye-closed" aria-hidden />
            </button>
          ) : null}
          {!hidden ? (
            <button
              type="button"
              className="composer-context-ledger-toggle-text"
              onClick={handlePrimaryToggle}
            >
              {toggleLabel}
            </button>
          ) : null}
        </div>
      </div>
      {hidden && onShow ? (
        <button
          type="button"
          className="composer-context-ledger-peek"
          onClick={onShow}
          aria-label={showLabel}
          title={showLabel}
        >
          <span className="codicon codicon-eye" aria-hidden />
          <span>{showLabel}</span>
        </button>
      ) : null}

      {!hidden && expanded ? (
        <div
          className="composer-context-ledger-panel grid gap-2 min-h-0"
          role="region"
          aria-label={t("composer.contextLedgerTitle")}
        >
          <p className="composer-context-ledger-truth-note m-0 px-0.5 text-[10px] leading-[1.35] text-(--text-faint)">
            {t("composer.contextLedgerTruthNote")}
          </p>
          {comparison ? (
            <section className="composer-context-ledger-comparison flex items-center justify-between gap-2.5 flex-wrap py-2 px-2.5 border rounded-[10px] border-[color-mix(in_srgb,var(--border-strong)_64%,#2563eb_36%)] bg-[color-mix(in_srgb,var(--surface-panel)_90%,#2563eb_10%)]">
              <header className="composer-context-ledger-comparison-head flex items-center justify-between gap-2 flex-[0_0_auto]">
                <div className="composer-context-ledger-comparison-copy inline-flex items-center gap-2">
                  <span className="composer-context-ledger-comparison-title text-[11px] font-bold text-(--text-strong)">
                    {resolveComparisonTitle(t, comparison)}
                  </span>
                  {resolveComparisonUsageDeltaLabel(t, comparison) ? (
                    <span className="composer-context-ledger-comparison-delta text-[10px] text-(--accent-primary,#2563eb)">
                      {resolveComparisonUsageDeltaLabel(t, comparison)}
                    </span>
                  ) : null}
                </div>
                <span className="composer-context-ledger-group-count min-w-5 h-5 px-1.5 rounded-full bg-[color-mix(in_srgb,var(--surface-panel)_76%,#2563eb_24%)] text-(--text-muted) text-[10px] inline-flex items-center justify-center">
                  {comparison.items.length}
                </span>
              </header>
              <div className="composer-context-ledger-comparison-summary flex items-center gap-1.5 flex-wrap">
                <span className="composer-context-ledger-comparison-hint text-[10px] text-(--text-faint)">
                  {comparison.basis === "pre_compaction"
                    ? t("composer.contextLedgerComparisonPreCompactionHint")
                    : t("composer.contextLedgerComparisonLastSendHint")}
                </span>
                {comparison.addedCount > 0 ? (
                  <span className="composer-context-ledger-meta-badge">
                    {resolveComparisonCountLabel(t, "added", comparison.addedCount)}
                  </span>
                ) : null}
                {comparison.removedCount > 0 ? (
                  <span className="composer-context-ledger-meta-badge">
                    {resolveComparisonCountLabel(t, "removed", comparison.removedCount)}
                  </span>
                ) : null}
                {comparison.retainedCount > 0 ? (
                  <span className="composer-context-ledger-meta-badge">
                    {resolveComparisonCountLabel(t, "retained", comparison.retainedCount)}
                  </span>
                ) : null}
                {comparison.changedCount > 0 ? (
                  <span className="composer-context-ledger-meta-badge">
                    {resolveComparisonCountLabel(t, "changed", comparison.changedCount)}
                  </span>
                ) : null}
              </div>
            </section>
          ) : null}
          {batchSelectionEnabled ? (
            <section className="composer-context-ledger-batch grid gap-2 py-2.5 px-3 border rounded-xl border-[color-mix(in_srgb,var(--border-strong)_58%,#0f766e_42%)] bg-[color-mix(in_srgb,var(--surface-panel)_90%,#0f766e_10%)]">
              <header className="composer-context-ledger-batch-head flex items-start justify-between gap-2.5">
                <div className="composer-context-ledger-batch-copy grid gap-1">
                  <span className="composer-context-ledger-comparison-title text-[11px] font-bold text-(--text-strong)">
                    {t("composer.contextLedgerBatchTitle")}
                  </span>
                  <span className="composer-context-ledger-comparison-item-title min-w-0 text-[11px] text-(--text-muted) break-words">
                    {t("composer.contextLedgerBatchSummary", {
                      selected: selectedBatchBlocks.length,
                      total: batchGovernableBlocks.length,
                    })}
                  </span>
                </div>
                <div className="composer-context-ledger-batch-actions flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="composer-context-ledger-action"
                    onClick={handleSelectAllBatchBlocks}
                  >
                    {t("composer.contextLedgerBatchSelectAll")}
                  </button>
                  <button
                    type="button"
                    className="composer-context-ledger-action"
                    onClick={handleClearBatchSelection}
                    disabled={selectedBatchBlocks.length === 0}
                  >
                    {t("composer.contextLedgerBatchClearSelection")}
                  </button>
                </div>
              </header>
              <div className="composer-context-ledger-batch-actions flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="composer-context-ledger-action"
                  onClick={() => runBatchAction(batchKeepCandidates, onBatchKeepBlocks)}
                  disabled={batchKeepCandidates.length === 0}
                >
                  {t("composer.contextLedgerBatchKeepSelected", {
                    count: batchKeepCandidates.length,
                  })}
                </button>
                <button
                  type="button"
                  className="composer-context-ledger-action"
                  onClick={() =>
                    runBatchAction(batchClearCandidates, onBatchClearCarryOverBlocks)}
                  disabled={batchClearCandidates.length === 0}
                >
                  {t("composer.contextLedgerBatchClearSelected", {
                    count: batchClearCandidates.length,
                  })}
                </button>
                <button
                  type="button"
                  className="composer-context-ledger-action"
                  onClick={() =>
                    runBatchAction(batchExcludeCandidates, onBatchExcludeBlocks)}
                  disabled={batchExcludeCandidates.length === 0}
                >
                  {t("composer.contextLedgerBatchExcludeSelected", {
                    count: batchExcludeCandidates.length,
                  })}
                </button>
              </div>
            </section>
          ) : null}
          {projection.groups.map((group) => (
            <section
              key={group.kind}
              className={resolveGroupClassName(group)}
            >
              <header className="composer-context-ledger-group-head flex items-center justify-between gap-2">
                <span className="composer-context-ledger-group-title text-[11px] font-bold text-(--text-strong)">
                  {resolveGroupLabel(t, group)}
                </span>
                <span className="composer-context-ledger-group-count min-w-5 h-5 px-1.5 rounded-full bg-[color-mix(in_srgb,var(--surface-panel)_76%,#2563eb_24%)] text-(--text-muted) text-[10px] inline-flex items-center justify-center">
                  {group.blocks.length}
                </span>
              </header>
              <div className="composer-context-ledger-block-list">
                {group.blocks.map((block) => {
                  const sourceNavigationTarget = resolveBlockSourceNavigationTarget(block);
                  const carryOverReasonLabel = resolveCarryOverReasonLabel(
                    t,
                    block.carryOverReason,
                  );
                  const carryOverExplanation = resolveCarryOverExplanation(
                    t,
                    block.carryOverReason,
                  );
                  const attributionConfidenceLabel = resolveAttributionConfidenceLabel(
                    t,
                    block.attributionConfidence,
                  );
                  const attributionConfidenceExplanation =
                    resolveAttributionConfidenceExplanation(
                      t,
                      block.attributionConfidence,
                    );
                  const batchGovernable = batchSelectionEnabled && isBatchGovernableBlock(block);
                  const batchSelected = selectedBatchBlockIds.includes(block.id);
                  return (
                    <article
                      key={block.id}
                      className={resolveBlockClassName(block, batchSelected)}
                    >
                    {batchGovernable ? (
                      <label className="composer-context-ledger-block-select">
                        <input
                          type="checkbox"
                          checked={batchSelected}
                          onChange={() =>
                            setSelectedBatchBlockIds((prev) =>
                              prev.includes(block.id)
                                ? prev.filter((entry) => entry !== block.id)
                                : [...prev, block.id],
                            )}
                          aria-label={t("composer.contextLedgerBatchSelectBlock", {
                            title: resolveBlockTitle(t, block),
                          })}
                        />
                        <span>{t("composer.contextLedgerBatchSelect")}</span>
                      </label>
                    ) : null}
                    <div className="composer-context-ledger-block-head">
                      {block.kind !== "usage_snapshot" ? (
                        <span className="composer-context-ledger-block-label">
                          {resolveBlockLabel(t, block)}
                        </span>
                      ) : null}
                      <span className="composer-context-ledger-block-estimate">
                        {resolveEstimateLabel(t, block)}
                      </span>
                    </div>
                    <div className="composer-context-ledger-block-title">
                      {resolveBlockTitle(t, block)}
                    </div>
                    {resolveBlockDetail(t, block) ? (
                      <div className="composer-context-ledger-block-detail">
                        {resolveBlockDetail(t, block)}
                      </div>
                    ) : null}
                    {block.kind !== "usage_snapshot" ? (
                      <div className="composer-context-ledger-block-meta">
                        <span className="composer-context-ledger-meta-badge">
                          {resolveParticipationLabel(t, block.participationState)}
                        </span>
                        <span className="composer-context-ledger-meta-badge">
                          {resolveFreshnessLabel(t, block.freshness)}
                        </span>
                        {carryOverReasonLabel ? (
                          <span className="composer-context-ledger-meta-badge">
                            {carryOverReasonLabel}
                          </span>
                        ) : null}
                        {resolveAttributionLabel(t, block.attributionKind) ? (
                          <span className="composer-context-ledger-meta-badge">
                            {resolveAttributionLabel(t, block.attributionKind)}
                          </span>
                        ) : null}
                        {resolveBackendSourceLabel(t, block.backendSource) ? (
                          <span className="composer-context-ledger-meta-badge">
                            {resolveBackendSourceLabel(t, block.backendSource)}
                          </span>
                        ) : null}
                        {attributionConfidenceLabel ? (
                          <span className="composer-context-ledger-meta-badge">
                            {attributionConfidenceLabel}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {carryOverExplanation ? (
                      <div className="composer-context-ledger-block-detail">
                        {carryOverExplanation}
                      </div>
                    ) : null}
                    {attributionConfidenceExplanation ? (
                      <div className="composer-context-ledger-block-detail">
                        {attributionConfidenceExplanation}
                      </div>
                    ) : null}
                    {(canTogglePinBlock(block)
                      || canExcludeBlock(block)
                      || canBatchClearCarryOverBlock(block)
                      || (sourceNavigationTarget && onOpenBlockSource)
                      || resolveInspectionContent(t, block)) ? (
                      <div className="composer-context-ledger-block-actions">
                        {canTogglePinBlock(block) && onTogglePinBlock ? (
                          <button
                            type="button"
                            className="composer-context-ledger-action"
                            onClick={() => onTogglePinBlock(block)}
                          >
                            {block.participationState === "pinned_next_send"
                              ? t("composer.contextLedgerActionCancelKeepNextSend")
                              : t("composer.contextLedgerActionKeepNextSend")}
                          </button>
                        ) : null}
                        {canExcludeBlock(block) && onExcludeBlock ? (
                          <button
                            type="button"
                            className="composer-context-ledger-action"
                            onClick={() => onExcludeBlock(block)}
                          >
                            {t("composer.contextLedgerActionExcludeNextSend")}
                          </button>
                        ) : null}
                        {canBatchClearCarryOverBlock(block) && onClearCarryOverBlock ? (
                          <button
                            type="button"
                            className="composer-context-ledger-action"
                            onClick={() => onClearCarryOverBlock(block)}
                          >
                            {t("composer.contextLedgerActionClearCarriedOver")}
                          </button>
                        ) : null}
                        {sourceNavigationTarget && onOpenBlockSource ? (
                          <button
                            type="button"
                            className="composer-context-ledger-action"
                            onClick={() => onOpenBlockSource(sourceNavigationTarget)}
                          >
                            {resolveOpenSourceLabel(t, block)}
                          </button>
                        ) : null}
                        {resolveInspectionContent(t, block) ? (
                          <button
                            type="button"
                            className="composer-context-ledger-action"
                            onClick={() => setInspectedBlock(block)}
                          >
                            {t("composer.contextLedgerActionOpenSourceDetail")}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}

      {inspectedBlock ? (
        <div
          className="composer-context-ledger-detail-dialog relative z-[2]"
          role="dialog"
          aria-modal="true"
          aria-label={t("composer.contextLedgerDetailDialogTitle")}
        >
          <div className="composer-context-ledger-detail-card grid gap-2.5 p-3 border border-(--border-strong) rounded-xl bg-[color-mix(in_srgb,var(--surface-panel)_94%,#2563eb_6%)]">
            <div className="composer-context-ledger-detail-head flex items-start justify-between gap-3">
              <div className="composer-context-ledger-detail-copy grid gap-1">
                <div className="composer-context-ledger-detail-kicker text-[10px] text-(--text-faint)">
                  {t("composer.contextLedgerDetailDialogTitle")}
                </div>
                <div className="composer-context-ledger-detail-title text-xs font-bold text-(--text-strong)">
                  {resolveInspectionTitle(t, inspectedBlock)}
                </div>
              </div>
              <button
                type="button"
                className="composer-context-ledger-detail-close border-none bg-transparent text-(--accent-primary,#2563eb) text-[11px] cursor-pointer p-0"
                onClick={() => setInspectedBlock(null)}
              >
                {t("composer.contextLedgerDetailDialogClose")}
              </button>
            </div>
            {inspectedAttributionLabel || inspectedBackendSourceLabel || inspectedBlock.sourcePath ? (
              <div className="composer-context-ledger-detail-meta flex items-center gap-2 flex-wrap">
                {inspectedAttributionLabel ? (
                  <span className="composer-context-ledger-meta-badge">
                    {inspectedAttributionLabel}
                  </span>
                ) : null}
                {inspectedBackendSourceLabel ? (
                  <span className="composer-context-ledger-meta-badge">
                    {inspectedBackendSourceLabel}
                  </span>
                ) : null}
                {inspectedBlock.sourcePath ? (
                  <span className="composer-context-ledger-detail-path text-[10px] text-(--text-faint) break-all">
                    {inspectedBlock.sourcePath}
                  </span>
                ) : null}
              </div>
            ) : null}
            <div className="composer-context-ledger-detail-body max-h-60 overflow-auto min-w-0">
              <Markdown
                className="markdown composer-context-ledger-detail-markdown"
                value={inspectedMarkdownContent}
              />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
});
