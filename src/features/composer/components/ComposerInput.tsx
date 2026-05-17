import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ChangeEvent,
  ClipboardEvent,
  FocusEvent,
  KeyboardEvent,
  ReactNode,
  RefObject,
  SyntheticEvent,
} from "react";
import type { AutocompleteItem } from "../hooks/useComposerAutocomplete";
import type { AccessMode, EngineType, RateLimitSnapshot, ThreadTokenUsage } from "../../../types";
import type { OpenCodeAgentOption } from "../../../types";
import type { EngineDisplayInfo } from "../../engine/hooks/useEngineController";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus";
import Mic from "lucide-react/dist/esm/icons/mic";
import Gauge from "lucide-react/dist/esm/icons/gauge";
import Square from "lucide-react/dist/esm/icons/square";
import Brain from "lucide-react/dist/esm/icons/brain";
import GitFork from "lucide-react/dist/esm/icons/git-fork";
import PlusCircle from "lucide-react/dist/esm/icons/plus-circle";
import Layers3 from "lucide-react/dist/esm/icons/layers-3";
import Tag from "lucide-react/dist/esm/icons/tag";
import Bot from "lucide-react/dist/esm/icons/bot";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
import Circle from "lucide-react/dist/esm/icons/circle";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import Info from "lucide-react/dist/esm/icons/info";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Wrench from "lucide-react/dist/esm/icons/wrench";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Plug from "lucide-react/dist/esm/icons/plug";
import Lock from "lucide-react/dist/esm/icons/lock";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import Cpu from "lucide-react/dist/esm/icons/cpu";
import FileIcon from "../../../components/FileIcon";
import { Select, SelectItem, SelectPopup, SelectTrigger } from "../../../components/ui/select";
import { Switch } from "@/components/ui/switch";
import { EngineSelector } from "../../engine/components/EngineSelector";
import { Markdown } from "../../messages/components/Markdown";
import { useComposerImageDrop } from "../hooks/useComposerImageDrop";
import { ComposerAttachments } from "./ComposerAttachments";
import { ComposerGhostText } from "./ComposerGhostText";
import { DictationWaveform } from "../../dictation/components/DictationWaveform";
import { ReviewInlinePrompt } from "./ReviewInlinePrompt";
import type { ReviewPromptState, ReviewPromptStep } from "../../threads/hooks/useReviewPrompt";
import { ContextUsageIndicator } from "./ContextUsageIndicator";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@/components/ui/progress";
import { formatRelativeTime } from "../../../utils/time";
import { resolveManualMemoryPreview } from "../utils/manualMemoryPreview";

type ComposerInputProps = {
  text: string;
  selectionStart?: number | null;
  disabled: boolean;
  sendLabel: string;
  canStop: boolean;
  canSend: boolean;
  isProcessing: boolean;
  onStop: () => void;
  onSend: () => void;
  engineName?: string;
  dictationState?: "idle" | "listening" | "processing";
  dictationLevel?: number;
  dictationEnabled?: boolean;
  onToggleDictation?: () => void;
  onOpenDictationSettings?: () => void;
  onOpenExperimentalSettings?: () => void;
  dictationError?: string | null;
  onDismissDictationError?: () => void;
  dictationHint?: string | null;
  onDismissDictationHint?: () => void;
  attachments?: string[];
  onAddAttachment?: () => void;
  onAttachImages?: (paths: string[]) => void;
  onRemoveAttachment?: (path: string) => void;
  onTextChange: (next: string, selectionStart: number | null) => void;
  onTextPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSelectionChange: (selectionStart: number | null) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  textareaHeight?: number;
  onHeightChange?: (height: number) => void;
  onCollapseRequest?: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  suggestionsOpen: boolean;
  suggestions: AutocompleteItem[];
  autocompleteTrigger?: string | null;
  selectedManualMemoryIds?: string[];
  highlightIndex: number;
  onHighlightIndex: (index: number) => void;
  onSelectSuggestion: (item: AutocompleteItem) => void;
  suggestionsStyle?: React.CSSProperties;
  reviewPrompt?: ReviewPromptState;
  onReviewPromptClose?: () => void;
  onReviewPromptShowPreset?: () => void;
  onReviewPromptChoosePreset?: (
    preset: Exclude<ReviewPromptStep, "preset"> | "uncommitted",
  ) => void;
  highlightedPresetIndex?: number;
  onReviewPromptHighlightPreset?: (index: number) => void;
  highlightedBranchIndex?: number;
  onReviewPromptHighlightBranch?: (index: number) => void;
  highlightedCommitIndex?: number;
  onReviewPromptHighlightCommit?: (index: number) => void;
  onReviewPromptSelectBranch?: (value: string) => void;
  onReviewPromptSelectBranchAtIndex?: (index: number) => void;
  onReviewPromptConfirmBranch?: () => Promise<void>;
  onReviewPromptSelectCommit?: (sha: string, title: string) => void;
  onReviewPromptSelectCommitAtIndex?: (index: number) => void;
  onReviewPromptConfirmCommit?: () => Promise<void>;
  onReviewPromptUpdateCustomInstructions?: (value: string) => void;
  onReviewPromptConfirmCustom?: () => Promise<void>;
  // Engine props
  engines?: EngineDisplayInfo[];
  selectedEngine?: EngineType;
  onSelectEngine?: (engine: EngineType) => void;
  opencodeProviderTone?: "is-ok" | "is-runtime" | "is-fail";
  // Model props
  models?: { id: string; displayName: string; model: string }[];
  selectedModelId?: string | null;
  onSelectModel?: (id: string) => void;
  // Meta props
  collaborationModes?: { id: string; label: string }[];
  collaborationModesEnabled?: boolean;
  selectedCollaborationModeId?: string | null;
  onSelectCollaborationMode?: (id: string | null) => void;
  reasoningOptions?: string[];
  selectedEffort?: string | null;
  onSelectEffort?: (effort: string | null) => void;
  reasoningSupported?: boolean;
  opencodeAgents?: OpenCodeAgentOption[];
  selectedOpenCodeAgent?: string | null;
  onSelectOpenCodeAgent?: (agentId: string | null) => void;
  opencodeVariantOptions?: string[];
  selectedOpenCodeVariant?: string | null;
  onSelectOpenCodeVariant?: (variant: string | null) => void;
  contextUsage?: ThreadTokenUsage | null;
  accountRateLimits?: RateLimitSnapshot | null;
  usageShowRemaining?: boolean;
  onRefreshAccountRateLimits?: () => Promise<void> | void;
  accessMode?: AccessMode;
  onSelectAccessMode?: (mode: AccessMode) => void;
  ghostTextSuffix?: string;
  openCodeDock?: ReactNode;
  onOpenOpenCodePanel?: () => void;
};

const isFileSuggestion = (item: AutocompleteItem) =>
  item.label.includes("/") || item.label.includes("\\");

const isManualMemorySuggestion = (item: AutocompleteItem) =>
  item.kind === "manual-memory" && Boolean(item.memoryId);

const normalizeMemoryImportance = (value?: string) => {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) {
    return "normal";
  }
  if (normalized.includes("high")) {
    return "high";
  }
  if (normalized.includes("low")) {
    return "low";
  }
  return normalized.includes("medium") ? "medium" : "normal";
};

const getMemoryPreviewText = (item: AutocompleteItem) =>
  (item.memoryDetail || item.memorySummary || item.description || "").trim();

type MemoryPreviewSection = {
  label: string;
  content: string;
};

const MEMORY_DETAIL_SECTION_REGEX =
  /(用户输入|助手输出摘要|助手输出|User input|Assistant summary|Assistant output)[:：]/gi;

function parseMemoryPreviewSections(text: string): MemoryPreviewSection[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }
  const matches = Array.from(
    normalized.matchAll(
      new RegExp(MEMORY_DETAIL_SECTION_REGEX.source, MEMORY_DETAIL_SECTION_REGEX.flags),
    ),
  );
  if (matches.length === 0) {
    return [];
  }
  const sections: MemoryPreviewSection[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    if (!current || current.index === undefined) {
      continue;
    }
    const label = (current[1] || "").trim();
    const start = current.index + current[0].length;
    const next = matches[index + 1];
    const end = next?.index ?? normalized.length;
    const content = normalized.slice(start, end).trim();
    if (!content) {
      continue;
    }
    sections.push({ label, content });
  }
  return sections;
}

const MEMORY_TRIGGER_PREFIX = /^(?:\s|["'`]|\(|\[|\{)$/;
function getManualMemoryQueryText(text: string, cursor: number | null | undefined) {
  if (!text) {
    return "";
  }
  const resolvedCursor =
    typeof cursor === "number" && Number.isFinite(cursor)
      ? Math.max(0, Math.min(cursor, text.length))
      : text.length;
  const beforeCursor = text.slice(0, resolvedCursor);
  const atIndex = beforeCursor.lastIndexOf("@@");
  if (atIndex < 0) {
    return "";
  }
  const prevChar = atIndex > 0 ? beforeCursor[atIndex - 1] : "";
  if (prevChar && !MEMORY_TRIGGER_PREFIX.test(prevChar)) {
    return "";
  }
  const afterAt = beforeCursor.slice(atIndex + 2);
  if (!afterAt || /\s/.test(afterAt)) {
    return "";
  }
  return afterAt.trim();
}

const suggestionIcon = (item: AutocompleteItem) => {
  if (isFileSuggestion(item)) {
    return FileText;
  }
  if (item.id === "review") {
    return Brain;
  }
  if (item.id === "fork") {
    return GitFork;
  }
  if (item.id === "mcp") {
    return Plug;
  }
  if (item.id === "new") {
    return PlusCircle;
  }
  if (item.id === "resume") {
    return RotateCcw;
  }
  if (item.id === "status") {
    return Info;
  }
  if (item.id.startsWith("prompt:")) {
    return ScrollText;
  }
  return Wrench;
};

const fileTitle = (path: string) => {
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
};

function resolveOpenCodeAgentToneClass(agentId: string | null | undefined) {
  if (!agentId || !agentId.trim()) {
    return "composer-agent-tone--default";
  }
  const normalized = agentId.trim().toLowerCase();
  const hash = Array.from(normalized).reduce((total, char) => total + char.charCodeAt(0), 0);
  return `composer-agent-tone--${hash % 8}`;
}

function resolveOpenCodeVariantToneClass(variant: string | null | undefined) {
  if (!variant || !variant.trim()) {
    return "composer-variant-tone--default";
  }
  const normalized = variant.trim().toLowerCase();
  const hash = Array.from(normalized).reduce((total, char) => total + char.charCodeAt(0), 0);
  return `composer-variant-tone--${hash % 6}`;
}

export function ComposerInput({
  text,
  selectionStart = null,
  disabled,
  sendLabel,
  canStop,
  canSend,
  isProcessing,
  onStop,
  onSend,
  engineName,
  dictationState = "idle",
  dictationLevel = 0,
  dictationEnabled = false,
  onToggleDictation,
  onOpenDictationSettings,
  onOpenExperimentalSettings: _onOpenExperimentalSettings,
  dictationError = null,
  onDismissDictationError,
  dictationHint = null,
  onDismissDictationHint,
  attachments = [],
  onAddAttachment,
  onAttachImages,
  onRemoveAttachment,
  onTextChange,
  onTextPaste,
  onSelectionChange,
  onKeyDown,
  textareaHeight = 80,
  onHeightChange,
  onCollapseRequest,
  textareaRef,
  suggestionsOpen,
  suggestions,
  autocompleteTrigger = null,
  selectedManualMemoryIds = [],
  highlightIndex,
  onHighlightIndex,
  onSelectSuggestion,
  suggestionsStyle,
  reviewPrompt,
  onReviewPromptClose,
  onReviewPromptShowPreset,
  onReviewPromptChoosePreset,
  highlightedPresetIndex,
  onReviewPromptHighlightPreset,
  highlightedBranchIndex,
  onReviewPromptHighlightBranch,
  highlightedCommitIndex,
  onReviewPromptHighlightCommit,
  onReviewPromptSelectBranch,
  onReviewPromptSelectBranchAtIndex,
  onReviewPromptConfirmBranch,
  onReviewPromptSelectCommit,
  onReviewPromptSelectCommitAtIndex,
  onReviewPromptConfirmCommit,
  onReviewPromptUpdateCustomInstructions,
  onReviewPromptConfirmCustom,
  engines,
  selectedEngine,
  onSelectEngine,
  models,
  selectedModelId,
  onSelectModel,
  collaborationModes = [],
  collaborationModesEnabled: _collaborationModesEnabled = true,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  reasoningOptions = [],
  selectedEffort,
  onSelectEffort,
  reasoningSupported = false,
  opencodeAgents = [],
  selectedOpenCodeAgent = null,
  onSelectOpenCodeAgent,
  opencodeVariantOptions = [],
  selectedOpenCodeVariant = null,
  onSelectOpenCodeVariant,
  contextUsage,
  accountRateLimits = null,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  accessMode,
  onSelectAccessMode,
  ghostTextSuffix,
  openCodeDock,
  onOpenOpenCodePanel,
  opencodeProviderTone,
}: ComposerInputProps) {
  const { t, i18n } = useTranslation();
  const suggestionListRef = useRef<HTMLDivElement | null>(null);
  const suggestionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedPreviewMemoryId, setExpandedPreviewMemoryId] = useState<string | null>(
    null,
  );
  const [usagePopoverOpen, setUsagePopoverOpen] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const MIN_HEIGHT = 20;
  const COLLAPSE_TRIGGER_HEIGHT = 18;
  const MAX_HEIGHT = 400;
  const currentHeight = Math.max(MIN_HEIGHT, Math.min(textareaHeight, MAX_HEIGHT));
  const reviewPromptOpen = Boolean(reviewPrompt);
  const selectedManualMemoryIdSet = useMemo(
    () => new Set(selectedManualMemoryIds),
    [selectedManualMemoryIds],
  );
  const manualMemorySuggestions = useMemo(
    () => suggestions.filter((entry) => isManualMemorySuggestion(entry)),
    [suggestions],
  );
  const manualMemoryPickerEnabled =
    autocompleteTrigger === "@@" && manualMemorySuggestions.length > 0 && !reviewPromptOpen;
  const manualMemoryQueryText = useMemo(
    () =>
      manualMemoryPickerEnabled
        ? getManualMemoryQueryText(text, selectionStart)
        : "",
    [manualMemoryPickerEnabled, selectionStart, text],
  );
  const manualMemoryPickerHeading = useMemo(() => {
    if (!manualMemoryQueryText) {
      return t("composer.manualMemoryPickerTitle");
    }
    const query = `@@${manualMemoryQueryText}`;
    const translated = t("composer.manualMemoryPickerInputTitle", { query });
    return translated === "composer.manualMemoryPickerInputTitle"
      ? `用户输入：${query}`
      : translated;
  }, [manualMemoryQueryText, t]);
  const activeManualMemory =
    manualMemoryPickerEnabled
      ? manualMemorySuggestions[highlightIndex] ?? manualMemorySuggestions[0] ?? null
      : null;
  const activeManualMemoryId = activeManualMemory?.memoryId ?? null;
  const activeManualMemoryPreview = activeManualMemory
    ? getMemoryPreviewText(activeManualMemory)
    : "";
  const activeManualMemoryPreviewSections = useMemo(
    () => parseMemoryPreviewSections(activeManualMemoryPreview),
    [activeManualMemoryPreview],
  );
  const activeManualMemoryPreviewExpanded =
    Boolean(activeManualMemoryId) && expandedPreviewMemoryId === activeManualMemoryId;
  const activeManualMemoryPreviewLong = activeManualMemoryPreview.length > 220;
  const formatMemoryDate = useCallback(
    (value?: number) => {
      if (!value || !Number.isFinite(value)) {
        return "--";
      }
      return new Intl.DateTimeFormat(i18n.language || undefined, {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value));
    },
    [i18n.language],
  );

  const {
    dropTargetRef,
    isDragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handlePaste,
  } = useComposerImageDrop({
    disabled,
    onAttachImages,
  });

  useEffect(() => {
    if (!suggestionsOpen || suggestions.length === 0) {
      return;
    }
    const list = suggestionListRef.current;
    const item = suggestionRefs.current[highlightIndex];
    if (!list || !item) {
      return;
    }
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    if (itemRect.top < listRect.top) {
      item.scrollIntoView({ block: "nearest" });
      return;
    }
    if (itemRect.bottom > listRect.bottom) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [highlightIndex, suggestionsOpen, suggestions.length]);

  useEffect(() => {
    if (!manualMemoryPickerEnabled || !activeManualMemoryId) {
      setExpandedPreviewMemoryId(null);
      return;
    }
    setExpandedPreviewMemoryId((prev) =>
      prev === activeManualMemoryId ? prev : null,
    );
  }, [activeManualMemoryId, manualMemoryPickerEnabled]);

  // Textarea height management - use user-controlled height
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = `${currentHeight}px`;
    textarea.style.minHeight = `${MIN_HEIGHT}px`;
    textarea.style.maxHeight = `${MAX_HEIGHT}px`;
    textarea.style.overflowY = "auto";
  }, [currentHeight, textareaRef]);

  // Drag resize handlers
  const handleResizeStart = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      if (disabled || !onHeightChange) return;
      event.preventDefault();
      setIsDragging(true);
      const clientY =
        "touches" in event ? (event.touches[0]?.clientY ?? 0) : event.clientY;
      dragStartY.current = clientY;
      dragStartHeight.current = currentHeight;
    },
    [disabled, onHeightChange, currentHeight],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent | TouchEvent) => {
      const clientY =
        "touches" in event ? (event.touches[0]?.clientY ?? dragStartY.current) : event.clientY;
      // Dragging up (negative delta) should increase height
      const delta = dragStartY.current - clientY;
      const rawHeight = dragStartHeight.current + delta;
      if (rawHeight < COLLAPSE_TRIGGER_HEIGHT) {
        setIsDragging(false);
        onHeightChange?.(MIN_HEIGHT);
        onCollapseRequest?.();
        return;
      }
      const newHeight = Math.max(MIN_HEIGHT, Math.min(rawHeight, MAX_HEIGHT));
      onHeightChange?.(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchmove", handleMouseMove);
    document.addEventListener("touchend", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchmove", handleMouseMove);
      document.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDragging, onCollapseRequest, onHeightChange]);

  const handleActionClick = useCallback(() => {
    if (canStop) {
      onStop();
    } else {
      onSend();
    }
  }, [canStop, onSend, onStop]);
  const isDictating = dictationState === "listening";
  const isDictationBusy = dictationState !== "idle";
  const allowOpenDictationSettings = Boolean(
    onOpenDictationSettings && !dictationEnabled && !disabled,
  );
  const micDisabled =
    disabled || dictationState === "processing" || !dictationEnabled || !onToggleDictation;
  const micAriaLabel = allowOpenDictationSettings
    ? "Open dictation settings"
    : dictationState === "processing"
      ? "Dictation processing"
      : isDictating
        ? "Stop dictation"
        : "Start dictation";
  const micTitle = allowOpenDictationSettings
    ? "Dictation disabled. Open settings"
    : dictationState === "processing"
      ? "Processing dictation"
      : isDictating
        ? "Stop dictation"
        : "Start dictation";
  const handleMicClick = useCallback(() => {
    if (allowOpenDictationSettings) {
      onOpenDictationSettings?.();
      return;
    }
    if (!onToggleDictation || micDisabled) {
      return;
    }
    onToggleDictation();
  }, [
    allowOpenDictationSettings,
    micDisabled,
    onOpenDictationSettings,
    onToggleDictation,
  ]);

  const resolveUsagePercent = useCallback(
    (usedPercent: number | null | undefined) => {
      if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
        return null;
      }
      const clamped = Math.max(0, Math.min(100, Math.round(usedPercent)));
      return usageShowRemaining ? 100 - clamped : clamped;
    },
    [usageShowRemaining],
  );

  const formatUsageReset = useCallback(
    (value: number | null | undefined, labelKey: "usage.sessionReset" | "usage.weeklyReset") => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
      }
      const resetMs = value > 1_000_000_000_000 ? value : value * 1000;
      return `${t(labelKey)} ${formatRelativeTime(resetMs)}`;
    },
    [t],
  );

  const usageSnapshot = useMemo(() => {
    const sessionPercent = resolveUsagePercent(accountRateLimits?.primary?.usedPercent);
    const weeklyPercent = resolveUsagePercent(accountRateLimits?.secondary?.usedPercent);
    return {
      sessionPercent,
      weeklyPercent,
      showWeekly: Boolean(accountRateLimits?.secondary),
      sessionResetLabel: formatUsageReset(
        accountRateLimits?.primary?.resetsAt,
        "usage.sessionReset",
      ),
      weeklyResetLabel: formatUsageReset(
        accountRateLimits?.secondary?.resetsAt,
        "usage.weeklyReset",
      ),
    };
  }, [accountRateLimits, formatUsageReset, resolveUsagePercent]);

  const refreshUsageSnapshot = useCallback(async () => {
    if (!onRefreshAccountRateLimits) {
      return;
    }
    setUsageLoading(true);
    try {
      await onRefreshAccountRateLimits();
    } finally {
      setUsageLoading(false);
    }
  }, [onRefreshAccountRateLimits]);

  const handleUsageEnter = useCallback(() => {
    setUsagePopoverOpen(true);
    void refreshUsageSnapshot();
  }, [refreshUsageSnapshot]);

  const handleUsageLeave = useCallback(() => {
    setUsagePopoverOpen(false);
  }, []);

  const handleUsageBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const nextFocused = event.relatedTarget;
    if (nextFocused instanceof Node && event.currentTarget.contains(nextFocused)) {
      return;
    }
    setUsagePopoverOpen(false);
  }, []);

  const isCodexEngine = selectedEngine === "codex";
  const isGeminiEngine = selectedEngine === "gemini";
  const collaborationModeDisabled = disabled;
  const planModeId = collaborationModes.find((mode) => mode.id === "plan")?.id ?? "plan";
  const defaultModeId = collaborationModes.find((mode) => mode.id !== planModeId)?.id ?? "code";
  const resolvedCollaborationModeId = selectedCollaborationModeId ?? defaultModeId;
  const isPlanModeEnabled = resolvedCollaborationModeId === planModeId;
  const collaborationModeBadgeLabel = isPlanModeEnabled
    ? t("composer.planModeShort")
    : t("common.default");
  const accessDisplayLabel = accessMode === "read-only"
    ? t("composer.readOnly")
    : accessMode === "current"
      ? t("composer.onRequest")
      : t("composer.fullAccess");
  const AccessModeIcon =
    accessMode === "read-only"
      ? Lock
      : accessMode === "current"
        ? Clock3
        : ShieldCheck;

  const handleTextareaChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onTextChange(event.target.value, event.target.selectionStart);
    },
    [onTextChange],
  );

  const handleTextareaSelect = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      onSelectionChange((event.target as HTMLTextAreaElement).selectionStart);
    },
    [onSelectionChange],
  );

  const handleTextareaPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      void handlePaste(event);
      if (!event.defaultPrevented) {
        onTextPaste?.(event);
      }
    },
    [handlePaste, onTextPaste],
  );

  const selectedModel = models?.find((m) => m.id === selectedModelId);
  const selectedModelLabelRaw =
    selectedModel?.displayName || selectedModel?.model || selectedModelId || t("composer.noModels");
  const selectedModelDisplay =
    selectedEngine === "opencode"
      ? selectedModelLabelRaw.split("/").pop() || selectedModelLabelRaw
      : selectedModelLabelRaw;
  const sortedOpenCodeAgents = useMemo(() => {
    const primary = opencodeAgents.filter((agent) => agent.isPrimary);
    const others = opencodeAgents.filter((agent) => !agent.isPrimary);
    return [...primary, ...others];
  }, [opencodeAgents]);
  const showEngineSelector = Boolean(engines && selectedEngine && onSelectEngine);
  const showOpenCodeModelIndicator = selectedEngine === "opencode";
  const showModelPicker = Boolean(models && onSelectModel && selectedEngine !== "opencode");
  const showOpenCodeAgentPicker = Boolean(selectedEngine === "opencode" && onSelectOpenCodeAgent);
  const showOpenCodeVariantPicker = Boolean(selectedEngine === "opencode" && onSelectOpenCodeVariant);
  const hasEngineCluster =
    showEngineSelector ||
    showOpenCodeModelIndicator ||
    showModelPicker ||
    showOpenCodeAgentPicker ||
    showOpenCodeVariantPicker;
  const showAccessPicker = Boolean(accessMode && onSelectAccessMode);
  const showPlanModeToggle = Boolean(isCodexEngine && onSelectCollaborationMode);
  const showEffortPicker = Boolean(reasoningSupported && onSelectEffort);
  const effortDefaultLabel =
    selectedEngine === "claude"
      ? t("reasoning.claudeDefault", { defaultValue: "Claude 默认" })
      : t("composer.effortDefault");
  const showOpenCodeDock = Boolean(selectedEngine === "opencode" && openCodeDock);
  const canOpenOpenCodePanelFromModelIndicator = Boolean(
    selectedEngine === "opencode" && onOpenOpenCodePanel,
  );
  const hasPolicyCluster = showAccessPicker || showEffortPicker;
  const handlePlanModeToggle = useCallback(
    (checked: boolean) => {
      if (!onSelectCollaborationMode) {
        return;
      }
      onSelectCollaborationMode(checked ? planModeId : defaultModeId);
    },
    [defaultModeId, onSelectCollaborationMode, planModeId],
  );
  const handleOpenCodeModelIndicatorKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!onOpenOpenCodePanel) {
        return;
      }
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      onOpenOpenCodePanel();
    },
    [onOpenOpenCodePanel],
  );

  return (
    <div className={`composer-input flex flex-col gap-2 rounded-2xl border border-[var(--border-muted)] bg-[var(--surface-messages)] p-3 shadow-none transition-all duration-200 ease-in-out focus-within:border-[var(--border-strong)] focus-within:bg-[var(--surface-messages)] focus-within:shadow-none${isDragging ? " is-resizing cursor-ns-resize select-none" : ""}`}>
      {/* Resize handle at the top */}
      {onHeightChange && (
        <div
          ref={resizeHandleRef}
          className="composer-resize-handle -mx-2 -mt-2 flex cursor-grab items-center justify-center py-1 touch-none active:cursor-grabbing"
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeStart}
          aria-label={t("composer.dragToResize")}
          role="separator"
          aria-orientation="horizontal"
        >
          <div className="composer-resize-handle-bar h-1 w-9 rounded-sm bg-[var(--border-muted)] transition-[background,width] duration-150 ease-in-out" />
        </div>
      )}
      <div
        className={`composer-input-area relative flex min-w-0 flex-col gap-2${isDragOver ? " is-drag-over" : ""}`}
        ref={dropTargetRef}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ComposerAttachments
          attachments={attachments}
          disabled={disabled}
          onRemoveAttachment={onRemoveAttachment}
        />
        <div className="composer-textarea-wrapper relative">
          <textarea
            ref={textareaRef}
            className="composer-textarea [-webkit-app-region:no-drag] w-full min-h-5 resize-none border-none bg-transparent p-0 text-sm leading-normal text-inherit outline-none"
            placeholder={
              disabled
                ? "Review in progress. Chat will re-enable when it completes."
                : engineName
                  ? t("composer.placeholderAskWithEngine", { engineName })
                  : t("composer.placeholderAsk")
            }
            value={text}
            onChange={handleTextareaChange}
            onSelect={handleTextareaSelect}
            disabled={disabled}
            onKeyDown={onKeyDown}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handleTextareaPaste}
          />
          {ghostTextSuffix && (
            <ComposerGhostText
              text={text}
              suffix={ghostTextSuffix}
              textareaRef={textareaRef}
            />
          )}
        </div>
        
        <div className="composer-input-footer mt-1.5 flex items-center justify-start gap-2 [container-name:composer-footer] [container-type:inline-size]">
          <div className="composer-input-footer-left flex flex-1 min-w-0 items-center gap-[5px] overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="composer-footer-cluster composer-footer-cluster--attach inline-flex min-w-0 items-center gap-0.5 rounded-[10px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_82%,transparent)] p-px shadow-[inset_0_1px_0_color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_60%,transparent)]">
              <button
                type="button"
                className="composer-attach inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-[7px] border border-transparent bg-transparent p-0 text-[var(--text-muted)] transition-[background-color,color,border-color] duration-[180ms] ease-in-out disabled:cursor-not-allowed disabled:opacity-55"
                onClick={onAddAttachment}
                disabled={disabled || !onAddAttachment}
                aria-label={t("composer.addImage")}
                title={t("composer.addImage")}
              >
                <ImagePlus size={14} aria-hidden />
              </button>
              {showPlanModeToggle && (
                <label className="composer-plan-mode-toggle ml-1 inline-flex items-center gap-1.5 whitespace-nowrap px-1 text-[11px] text-[var(--text-muted)]">
                  <span className="composer-plan-mode-toggle-label leading-none">
                    {t("composer.planModeToggle")}
                  </span>
                  <Switch
                    aria-label={t("composer.planModeToggle")}
                    checked={isPlanModeEnabled}
                    disabled={collaborationModeDisabled}
                    onCheckedChange={handlePlanModeToggle}
                    className="composer-plan-mode-switch flex-none"
                  />
                </label>
              )}
            </div>

            {hasEngineCluster && (
              <div className="composer-footer-cluster composer-footer-cluster--engine inline-flex min-w-0 max-w-[min(62vw,860px)] items-center gap-0.5 rounded-[10px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_82%,transparent)] p-px shadow-[inset_0_1px_0_color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_60%,transparent)]">
                {showEngineSelector && engines && selectedEngine && onSelectEngine && (
                  <EngineSelector
                    engines={engines}
                    selectedEngine={selectedEngine}
                    onSelectEngine={onSelectEngine}
                    disabled={disabled}
                    showOnlyIfMultiple={true}
                    showLabel={true}
                    opencodeStatusTone={opencodeProviderTone}
                  />
                )}

                {showOpenCodeModelIndicator && (
                  <div
                    className={`composer-select-wrap composer-opencode-model-indicator relative inline-flex w-max max-w-full min-w-0 min-h-6 cursor-default items-center gap-[5px] rounded-lg border border-[#bfdbfe] bg-[color-mix(in_srgb,#dbeafe_78%,transparent)] px-2 py-0.5 text-[11px] font-medium text-[#1d4ed8] transition-[background-color,color,border-color] duration-[180ms] ease-in-out${canOpenOpenCodePanelFromModelIndicator ? " is-clickable cursor-pointer" : ""}`}
                    title={selectedModelLabelRaw}
                    role={canOpenOpenCodePanelFromModelIndicator ? "button" : undefined}
                    tabIndex={canOpenOpenCodePanelFromModelIndicator ? 0 : undefined}
                    aria-label={canOpenOpenCodePanelFromModelIndicator ? "打开 OpenCode 管理面板" : undefined}
                    onClick={canOpenOpenCodePanelFromModelIndicator ? onOpenOpenCodePanel : undefined}
                    onKeyDown={canOpenOpenCodePanelFromModelIndicator ? handleOpenCodeModelIndicatorKeyDown : undefined}
                  >
                    <span className="composer-icon flex items-center text-inherit [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
                      <Cpu size={14} />
                    </span>
                    <span className="composer-select-value max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap">{selectedModelDisplay}</span>
                  </div>
                )}

                {showModelPicker && (
                  <div
                    className="composer-select-wrap relative inline-flex w-max max-w-full min-w-0 min-h-6 cursor-pointer items-center gap-[5px] rounded-lg border border-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-[background-color,color,border-color] duration-[180ms] ease-in-out"
                    title={selectedModelLabelRaw}
                  >
                    <span className="composer-icon flex items-center text-inherit [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
                      <Cpu size={14} />
                    </span>
                    <span className="composer-select-value max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {selectedModelLabelRaw}
                    </span>
                    <Select
                      value={selectedModelId ?? "__none__"}
                      onValueChange={(value) => {
                        if (value && value !== "__none__") {
                          onSelectModel?.(value);
                        }
                      }}
                    >
                      <SelectTrigger
                        aria-label={t("composer.model")}
                        className="composer-inline-select-trigger"
                        disabled={disabled || !models || models.length === 0}
                      />
                      <SelectPopup
                        side="top"
                        sideOffset={8}
                        align="start"
                        className="composer-inline-select-popup"
                      >
                        {models && models.length > 0 ? (
                          models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                              <span className="composer-inline-select-item">
                                <Cpu size={14} aria-hidden />
                                <span className="composer-inline-select-item-label">
                                  {model.displayName || model.model}
                                </span>
                              </span>
                            </SelectItem>
                          ))
                        ) : (
                          <SelectItem value="__none__" disabled>
                            <span className="composer-inline-select-item">
                              <Info size={14} aria-hidden />
                              <span className="composer-inline-select-item-label">
                                {t("composer.noModels")}
                              </span>
                            </span>
                          </SelectItem>
                        )}
                      </SelectPopup>
                    </Select>
                  </div>
                )}

                {showOpenCodeAgentPicker && (
                  <div className="composer-select-wrap relative inline-flex w-max max-w-full min-w-0 min-h-6 cursor-pointer items-center gap-[5px] rounded-lg border border-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-[background-color,color,border-color] duration-[180ms] ease-in-out" title={selectedOpenCodeAgent || t("composer.agent")}>
                    <span className="composer-icon flex items-center text-inherit [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
                      <Bot size={14} />
                    </span>
                    <span
                      className={`composer-select-value composer-select-value--agent ${resolveOpenCodeAgentToneClass(selectedOpenCodeAgent)}`}
                    >
                      {selectedOpenCodeAgent || t("composer.agent")}
                    </span>
                    <Select
                      value={selectedOpenCodeAgent ?? "__none__"}
                      onValueChange={(value) => {
                        onSelectOpenCodeAgent?.(value === "__none__" ? null : value);
                      }}
                    >
                      <SelectTrigger
                        aria-label={t("composer.agent")}
                        className="composer-inline-select-trigger"
                        disabled={disabled}
                      />
                      <SelectPopup
                        side="top"
                        sideOffset={8}
                        align="start"
                        className="composer-inline-select-popup"
                      >
                        <SelectItem value="__none__">
                          <span className="composer-inline-select-item">
                            <Bot size={14} aria-hidden />
                            <span className="composer-inline-select-item-label">
                              {t("composer.agentDefault")}
                            </span>
                          </span>
                        </SelectItem>
                        {opencodeAgents.length === 0 ? (
                          <SelectItem value="__no_agents__" disabled>
                            <span className="composer-inline-select-item">
                              <Info size={14} aria-hidden />
                              <span className="composer-inline-select-item-label">
                                {t("composer.noAgents")}
                              </span>
                            </span>
                          </SelectItem>
                        ) : (
                          sortedOpenCodeAgents.map((agent) => (
                            <SelectItem key={agent.id} value={agent.id}>
                              <span className="composer-inline-select-item">
                                <Bot size={14} aria-hidden />
                                <span className="composer-inline-select-item-label">
                                  {agent.isPrimary ? `🔥 ${agent.id}` : agent.id}
                                </span>
                              </span>
                            </SelectItem>
                          ))
                        )}
                      </SelectPopup>
                    </Select>
                  </div>
                )}

                {showOpenCodeVariantPicker && (
                  <div className="composer-select-wrap relative inline-flex w-max max-w-full min-w-0 min-h-6 cursor-pointer items-center gap-[5px] rounded-lg border border-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-[background-color,color,border-color] duration-[180ms] ease-in-out" title={selectedOpenCodeVariant || t("composer.effortDefault")}>
                    <span className="composer-icon flex items-center text-inherit [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
                      <Brain size={14} />
                    </span>
                    <span
                      className={`composer-select-value composer-select-value--variant ${resolveOpenCodeVariantToneClass(selectedOpenCodeVariant)}`}
                    >
                      {selectedOpenCodeVariant || t("composer.effortDefault")}
                    </span>
                    <Select
                      value={selectedOpenCodeVariant ?? "__none__"}
                      onValueChange={(value) => {
                        onSelectOpenCodeVariant?.(value === "__none__" ? null : value);
                      }}
                    >
                      <SelectTrigger
                        aria-label={t("composer.variant")}
                        className="composer-inline-select-trigger"
                        disabled={disabled}
                      />
                      <SelectPopup
                        side="top"
                        sideOffset={8}
                        align="start"
                        className="composer-inline-select-popup"
                      >
                        <SelectItem value="__none__">
                          <span className="composer-inline-select-item">
                            <Brain size={14} aria-hidden />
                            <span className="composer-inline-select-item-label">
                              {t("composer.effortDefault")}
                            </span>
                          </span>
                        </SelectItem>
                        {opencodeVariantOptions.map((variant) => (
                          <SelectItem key={variant} value={variant}>
                            <span className="composer-inline-select-item">
                              <Brain size={14} aria-hidden />
                              <span className="composer-inline-select-item-label">{variant}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {showOpenCodeDock && (
              <div className="composer-footer-inline-dock inline-flex flex-[0_1_auto] min-w-0 items-center">{openCodeDock}</div>
            )}

            {hasPolicyCluster && (
              <div className="composer-footer-cluster composer-footer-cluster--policy inline-flex min-w-0 max-w-[min(46vw,620px)] items-center gap-0.5 rounded-[10px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_82%,transparent)] p-px shadow-[inset_0_1px_0_color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_60%,transparent)]">
                {showAccessPicker && (
                  <div className="composer-select-wrap relative inline-flex w-max max-w-full min-w-0 min-h-6 cursor-pointer items-center gap-[5px] rounded-lg border border-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-[background-color,color,border-color] duration-[180ms] ease-in-out" title={accessDisplayLabel}>
                    <span className="composer-icon flex items-center text-inherit [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
                      <AccessModeIcon size={14} />
                    </span>
                    <span className="composer-select-value max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {accessDisplayLabel}
                    </span>
                    <Select
                      value={accessMode ?? "full-access"}
                      onValueChange={(value) => {
                        onSelectAccessMode?.(value as AccessMode);
                      }}
                    >
                      <SelectTrigger
                        aria-label={t("composer.agentAccess")}
                        className="composer-inline-select-trigger"
                        disabled={disabled}
                      />
                      <SelectPopup
                        side="top"
                        sideOffset={8}
                        align="start"
                        className="composer-inline-select-popup"
                      >
                        <SelectItem value="read-only" disabled={!isGeminiEngine}>
                          <span className="composer-inline-select-item">
                            <Lock size={14} aria-hidden />
                            <span className="composer-inline-select-item-label">
                              {t("composer.readOnly")}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value="current" disabled={!isGeminiEngine}>
                          <span className="composer-inline-select-item">
                            <Clock3 size={14} aria-hidden />
                            <span className="composer-inline-select-item-label">
                              {t("composer.onRequest")}
                            </span>
                          </span>
                        </SelectItem>
                        <SelectItem value="full-access">
                          <span className="composer-inline-select-item">
                            <ShieldCheck size={14} aria-hidden />
                            <span className="composer-inline-select-item-label">
                              {t("composer.fullAccess")}
                            </span>
                          </span>
                        </SelectItem>
                      </SelectPopup>
                    </Select>
                  </div>
                )}

                {showEffortPicker && (
                  <div className="composer-select-wrap relative inline-flex w-max max-w-full min-w-0 min-h-6 cursor-pointer items-center gap-[5px] rounded-lg border border-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-[background-color,color,border-color] duration-[180ms] ease-in-out" title={selectedEffort || effortDefaultLabel}>
                    <span className="composer-icon flex items-center text-inherit [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
                      <Gauge size={14} />
                    </span>
                    <span className="composer-select-value max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {selectedEffort || effortDefaultLabel}
                    </span>
                    <Select
                      value={selectedEffort ?? "__none__"}
                      onValueChange={(value) => {
                        onSelectEffort?.(value === "__none__" ? null : value);
                      }}
                    >
                      <SelectTrigger
                        aria-label={t("composer.thinkingMode")}
                        className="composer-inline-select-trigger"
                        disabled={disabled}
                      />
                      <SelectPopup
                        side="top"
                        sideOffset={8}
                        align="start"
                        className="composer-inline-select-popup"
                      >
                        <SelectItem value="__none__" disabled={selectedEngine !== "claude" && reasoningOptions.length > 0}>
                          <span className="composer-inline-select-item">
                            <Gauge size={14} aria-hidden />
                            <span className="composer-inline-select-item-label">
                              {effortDefaultLabel}
                            </span>
                          </span>
                        </SelectItem>
                        {reasoningOptions.map((effort) => (
                          <SelectItem key={effort} value={effort}>
                            <span className="composer-inline-select-item">
                              <Gauge size={14} aria-hidden />
                              <span className="composer-inline-select-item-label">{effort}</span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                )}
              </div>
            )}
          </div>
          
          <div className="composer-input-footer-right ml-auto flex flex-none items-center gap-2">
            {showPlanModeToggle && (
              <button
                type="button"
                className={`composer-mode-badge inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--border-subtle)_84%,transparent)] bg-[color-mix(in_srgb,var(--surface-card)_88%,transparent)] px-2 text-[11px] font-medium text-[var(--text-muted)] transition-[background-color,border-color,color] duration-[180ms] ease-in-out disabled:cursor-not-allowed disabled:opacity-50${isPlanModeEnabled ? " is-plan" : ""}`}
                onClick={() => handlePlanModeToggle(!isPlanModeEnabled)}
                disabled={collaborationModeDisabled}
                aria-label={t("composer.planModeToggle")}
                title={t("composer.planModeToggle")}
              >
                <GitFork size={12} aria-hidden />
                <span>{collaborationModeBadgeLabel}</span>
              </button>
            )}
            {isCodexEngine && (
              <div
                className="composer-usage-popover relative inline-flex items-center"
                onMouseEnter={handleUsageEnter}
                onMouseLeave={handleUsageLeave}
                onFocus={handleUsageEnter}
                onBlur={handleUsageBlur}
              >
                <button
                  type="button"
                  className={`composer-action composer-action--usage relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[#808080] bg-transparent p-0 text-xs text-white [&_svg]:h-3 [&_svg]:w-3${
                    usageLoading ? " is-loading [&_svg]:[animation:composer-action-spin_0.8s_linear_infinite]" : ""
                  }`}
                  aria-label={t("home.usageSnapshot")}
                  title={t("home.usageSnapshot")}
                  aria-expanded={usagePopoverOpen}
                  onClick={() => {
                    void refreshUsageSnapshot();
                  }}
                >
                  <Gauge size={14} aria-hidden />
                </button>
                {usagePopoverOpen && (
                  <div className="composer-usage-tooltip absolute right-0 bottom-[calc(100%+8px)] z-40 w-[220px] rounded-[10px] border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] bg-[color-mix(in_srgb,var(--surface-popover)_92%,var(--surface-card))] p-2.5 text-[var(--text-strong)] shadow-[0_10px_22px_rgba(0,0,0,0.25)]" role="status" aria-live="polite">
                    <div className="composer-usage-tooltip-header mb-2 flex items-center justify-between text-[11px] font-semibold">
                      <span>{t("home.usageSnapshot")}</span>
                      {usageLoading && (
                        <span className="composer-usage-tooltip-refreshing text-[10px] font-medium text-[var(--text-muted)]">
                          {t("common.refresh")}
                        </span>
                      )}
                    </div>
                    <div className="composer-usage-row grid gap-1 [&_+_.composer-usage-row]:mt-2">
                      <div className="composer-usage-row-top flex items-center justify-between text-[11px] text-[var(--text-subtle)]">
                        <span>5h limit</span>
                        <span>
                          {usageSnapshot.sessionPercent === null
                            ? "--"
                            : `${usageSnapshot.sessionPercent}% ${t(
                                usageShowRemaining ? "usage.remaining" : "usage.used",
                              )}`}
                        </span>
                      </div>
                      <Progress
                        value={usageSnapshot.sessionPercent ?? 0}
                        className="composer-usage-progress-track w-full gap-0"
                        aria-hidden
                      >
                        <ProgressTrack className="h-1.5 bg-[color-mix(in_srgb,var(--surface-item)_80%,transparent)]">
                          <ProgressIndicator className="composer-usage-progress-fill bg-linear-to-r from-[#2563eb] to-[#60a5fa] transition-[width] duration-200 ease-in-out" />
                        </ProgressTrack>
                      </Progress>
                      {usageSnapshot.sessionResetLabel && (
                        <div className="composer-usage-reset text-[10px] text-[var(--text-muted)]">{usageSnapshot.sessionResetLabel}</div>
                      )}
                    </div>
                    {usageSnapshot.showWeekly && (
                      <div className="composer-usage-row grid gap-1 mt-2">
                        <div className="composer-usage-row-top flex items-center justify-between text-[11px] text-[var(--text-subtle)]">
                          <span>Weekly limit</span>
                          <span>
                            {usageSnapshot.weeklyPercent === null
                              ? "--"
                              : `${usageSnapshot.weeklyPercent}% ${t(
                                  usageShowRemaining ? "usage.remaining" : "usage.used",
                                )}`}
                          </span>
                        </div>
                        <Progress
                          value={usageSnapshot.weeklyPercent ?? 0}
                          className="composer-usage-progress-track w-full gap-0"
                          aria-hidden
                        >
                          <ProgressTrack className="h-1.5 bg-[color-mix(in_srgb,var(--surface-item)_80%,transparent)]">
                            <ProgressIndicator className="composer-usage-progress-fill bg-linear-to-r from-[#2563eb] to-[#60a5fa] transition-[width] duration-200 ease-in-out" />
                          </ProgressTrack>
                        </Progress>
                        {usageSnapshot.weeklyResetLabel && (
                          <div className="composer-usage-reset text-[10px] text-[var(--text-muted)]">{usageSnapshot.weeklyResetLabel}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <ContextUsageIndicator contextUsage={contextUsage} />
            <button
              className={`composer-action composer-action--mic relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[#808080] bg-transparent p-0 text-xs text-white [&_svg]:h-3 [&_svg]:w-3${
                isDictationBusy ? " is-active" : ""
              }${dictationState === "processing" ? " is-processing" : ""}${
                micDisabled ? " is-disabled" : ""
              }`}
              onClick={handleMicClick}
              disabled={
                disabled ||
                dictationState === "processing" ||
                (!onToggleDictation && !allowOpenDictationSettings)
              }
              aria-label={micAriaLabel}
              title={micTitle}
            >
              {isDictating ? <Square aria-hidden /> : <Mic aria-hidden />}
            </button>
            <button
              className={`composer-action relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-[#808080] bg-transparent p-0 text-xs text-white [&_svg]:h-3 [&_svg]:w-3${canStop ? " is-stop" : " is-send"}${
                canStop && isProcessing ? " is-loading" : ""
              }`}
              onClick={handleActionClick}
              disabled={disabled || isDictationBusy || (!canStop && !canSend)}
              aria-label={canStop ? "Stop" : sendLabel}
            >
              {canStop ? (
                <>
                  <span className="composer-action-stop-square h-1.5 w-1.5 rounded-[2px] bg-current" aria-hidden />
                  {isProcessing && (
                    <span className="composer-action-spinner absolute h-[18px] w-[18px] rounded-full border-2 border-[#5a2828] border-t-[#cc5555] [animation:composer-action-spin_0.8s_linear_infinite]" aria-hidden />
                  )}
                </>
              ) : (
                <svg viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M12 5l6 6m-6-6L6 11m6-6v14"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
        {isDictationBusy && (
          <DictationWaveform
            active={isDictating}
            processing={dictationState === "processing"}
            level={dictationLevel}
          />
        )}
        {dictationError && (
          <div className="composer-dictation-error mt-2 flex items-center justify-between gap-2.5 rounded-[10px] border border-[#7a3a3a] bg-[#2a1a1a] px-2.5 py-2 text-xs text-[var(--text-strong)]" role="status">
            <span>{t(dictationError, { defaultValue: dictationError })}</span>
            <button
              type="button"
              className="ghost composer-dictation-error-dismiss px-2 py-1 text-[11px]"
              onClick={onDismissDictationError}
            >
              {t("common.dismiss")}
            </button>
          </div>
        )}
        {dictationHint && (
          <div className="composer-dictation-hint mt-2 flex items-center justify-between gap-2.5 rounded-[10px] border border-[#3a5a7a] bg-[#1a2640] px-2.5 py-2 text-xs text-[var(--text-strong)]" role="status">
            <span>{dictationHint}</span>
            {onDismissDictationHint && (
              <button
                type="button"
                className="ghost composer-dictation-error-dismiss px-2 py-1 text-[11px]"
                onClick={onDismissDictationHint}
              >
                {t("common.dismiss")}
              </button>
            )}
          </div>
        )}
        {suggestionsOpen && (
          <div
            className={`composer-suggestions popover-surface absolute left-0 z-10 grid w-[min(100%,420px)] max-h-[220px] gap-1 overflow-x-hidden overflow-y-auto rounded-[10px] p-1.5 bottom-[calc(100%+6px)] right-auto top-auto${
              reviewPromptOpen ? " review-inline-suggestions" : ""
            }${
              manualMemoryPickerEnabled ? " composer-suggestions--manual-memory !w-[min(92vw,760px)] !max-h-[min(58vh,460px)] !p-2 !overflow-hidden max-[960px]:!w-[min(96vw,640px)]" : ""
            }`}
            role="listbox"
            ref={suggestionListRef}
            style={suggestionsStyle}
          >
            {reviewPromptOpen &&
            reviewPrompt &&
            onReviewPromptClose &&
            onReviewPromptShowPreset &&
            onReviewPromptChoosePreset &&
            highlightedPresetIndex !== undefined &&
            onReviewPromptHighlightPreset &&
            highlightedBranchIndex !== undefined &&
            onReviewPromptHighlightBranch &&
            highlightedCommitIndex !== undefined &&
            onReviewPromptHighlightCommit &&
            onReviewPromptSelectBranch &&
            onReviewPromptSelectBranchAtIndex &&
            onReviewPromptConfirmBranch &&
            onReviewPromptSelectCommit &&
            onReviewPromptSelectCommitAtIndex &&
            onReviewPromptConfirmCommit &&
            onReviewPromptUpdateCustomInstructions &&
            onReviewPromptConfirmCustom ? (
              <ReviewInlinePrompt
                reviewPrompt={reviewPrompt}
                onClose={onReviewPromptClose}
                onShowPreset={onReviewPromptShowPreset}
                onChoosePreset={onReviewPromptChoosePreset}
                highlightedPresetIndex={highlightedPresetIndex}
                onHighlightPreset={onReviewPromptHighlightPreset}
                highlightedBranchIndex={highlightedBranchIndex}
                onHighlightBranch={onReviewPromptHighlightBranch}
                highlightedCommitIndex={highlightedCommitIndex}
                onHighlightCommit={onReviewPromptHighlightCommit}
                onSelectBranch={onReviewPromptSelectBranch}
                onSelectBranchAtIndex={onReviewPromptSelectBranchAtIndex}
                onConfirmBranch={onReviewPromptConfirmBranch}
                onSelectCommit={onReviewPromptSelectCommit}
                onSelectCommitAtIndex={onReviewPromptSelectCommitAtIndex}
                onConfirmCommit={onReviewPromptConfirmCommit}
                onUpdateCustomInstructions={onReviewPromptUpdateCustomInstructions}
                onConfirmCustom={onReviewPromptConfirmCustom}
              />
            ) : manualMemoryPickerEnabled ? (
              <div className="composer-memory-picker grid grid-cols-[minmax(290px,1fr)_minmax(250px,0.9fr)] gap-2.5 min-h-0 h-[clamp(240px,58vh,440px)] overflow-hidden items-stretch max-[960px]:!grid-cols-[1fr] max-[960px]:!h-[clamp(220px,64vh,520px)]">
                <div className="composer-memory-picker-list min-h-0 h-full overflow-y-auto overflow-x-hidden overscroll-contain pr-0.5 flex flex-col gap-2">
                  <div className="composer-memory-picker-head sticky top-0 z-[1] flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 bg-[var(--surface-panel,var(--surface-card))] border border-(--border-subtle)/72 shadow-[0_1px_0_color-mix(in_srgb,var(--border-subtle)_65%,transparent)]">
                    <span className="composer-memory-picker-title text-[11px] font-bold text-(--text-strong)">
                      {manualMemoryPickerHeading}
                    </span>
                    <span className="composer-memory-picker-count text-[10px] text-(--text-muted)">
                      {t("composer.manualMemoryPickerSelectedCount", {
                        count: selectedManualMemoryIds.length,
                      })}
                    </span>
                  </div>
                  {suggestions.map((item, index) => {
                    const memoryId = item.memoryId ?? item.id;
                    const selected = selectedManualMemoryIdSet.has(memoryId);
                    const selectedMemoryIndex = selectedManualMemoryIds.indexOf(memoryId);
                    const isActive = index === highlightIndex;
                    const preview = resolveManualMemoryPreview({
                      index: selectedMemoryIndex >= 0 ? `[M${selectedMemoryIndex + 1}]` : null,
                      label: item.label,
                      title: item.memoryTitle,
                      summary: item.memorySummary,
                      detail: item.memoryDetail,
                      description: item.description,
                    });
                    const tags = (item.memoryTags || []).slice(0, 3);
                    const importanceTone = normalizeMemoryImportance(item.memoryImportance);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`composer-memory-picker-card flex items-start gap-2 border border-(--border-subtle)/76 rounded-[10px] p-2 bg-(--surface-item)/72 text-(--text-strong) text-left cursor-pointer w-full${
                          isActive ? " is-active" : ""
                        }${selected ? " is-selected" : ""}`}
                        role="option"
                        aria-selected={isActive}
                        ref={(node) => {
                          suggestionRefs.current[index] = node;
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => onSelectSuggestion(item)}
                        onMouseEnter={() => onHighlightIndex(index)}
                      >
                        <span className="composer-memory-picker-card-check flex-none text-[color:color-mix(in_srgb,var(--accent-primary,#2563eb)_74%,var(--text-muted))] mt-px" aria-hidden>
                          {selected ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                        </span>
                        <span className="composer-memory-picker-card-main flex flex-col gap-[5px] min-w-0 flex-1">
                          <span className="composer-memory-picker-card-title text-xs font-bold text-(--text-strong) leading-[1.3] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{preview.title}</span>
                          <span className="composer-memory-picker-card-summary [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden text-(--text-muted) text-[11px] leading-[1.38] [overflow-wrap:anywhere]">
                            {preview.summary}
                          </span>
                          <span className="composer-memory-picker-card-meta flex items-center gap-2 flex-nowrap min-w-0 overflow-hidden">
                            <span className="composer-memory-picker-card-meta-item inline-flex items-center gap-1 text-[10px] text-(--text-faint) min-w-0 overflow-hidden text-ellipsis whitespace-nowrap shrink">
                              <Layers3 size={12} />
                              {item.memoryKind || "note"}
                            </span>
                            <span
                              className={`composer-memory-picker-card-meta-item composer-memory-picker-importance inline-flex items-center gap-1 text-[10px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap shrink rounded-full px-1.5 py-px border border-(--border-subtle)/70 bg-(--surface-elevated)/80 is-${importanceTone}`}
                            >
                              {item.memoryImportance || "normal"}
                            </span>
                            <span className="composer-memory-picker-card-meta-item inline-flex items-center gap-1 text-[10px] text-(--text-faint) min-w-0 overflow-hidden text-ellipsis whitespace-nowrap shrink">
                              <Clock3 size={12} />
                              {formatMemoryDate(item.memoryUpdatedAt)}
                            </span>
                          </span>
                          {tags.length > 0 && (
                            <span className="composer-memory-picker-card-tags flex flex-wrap gap-1 max-h-[21px] overflow-hidden">
                              {tags.map((tag) => (
                                <span key={`${memoryId}-${tag}`} className="composer-memory-picker-tag text-[10px] rounded-full px-1.5 py-px border border-(--border-subtle)/72 bg-(--surface-elevated)/80 text-(--text-muted)">
                                  #{tag}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <aside className="composer-memory-picker-preview border border-(--border-subtle)/72 rounded-xl bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_92%,transparent),color-mix(in_srgb,var(--surface-elevated,var(--surface-card))_90%,transparent))] p-3 flex flex-col gap-2.5 min-h-0 h-full overflow-hidden max-[960px]:!max-h-[190px]">
                  {activeManualMemory ? (
                    <>
                      <div className="composer-memory-picker-preview-head flex items-center justify-between gap-2 pb-2 border-b border-(--border-subtle)/72">
                        <span className="composer-memory-picker-preview-title text-[15px] font-bold text-(--text-strong) min-w-0 whitespace-nowrap text-ellipsis overflow-hidden">
                          {activeManualMemory.memoryTitle || activeManualMemory.label}
                        </span>
                        <span className="composer-memory-picker-preview-shortcut flex-none text-[11px] text-(--text-muted) border border-(--border-subtle)/70 rounded-full px-2 py-0.5 bg-(--surface-item)/86">
                          {selectedManualMemoryIdSet.has(activeManualMemory.memoryId || "")
                            ? t("composer.manualMemoryPickerShortcutUnselect")
                            : t("composer.manualMemoryPickerShortcutSelect")}
                        </span>
                      </div>
                      <div
                        className={`composer-memory-picker-preview-body flex flex-col gap-2.5 min-h-0 max-h-[228px] overflow-hidden pt-2.5 [mask-image:linear-gradient(180deg,#000_84%,transparent_100%)] [-webkit-mask-image:linear-gradient(180deg,#000_84%,transparent_100%)]${
                          activeManualMemoryPreviewExpanded ? " is-expanded !max-h-none !overflow-y-auto ![mask-image:none] ![-webkit-mask-image:none]" : ""
                        }`}
                      >
                        {activeManualMemoryPreviewSections.length > 0 ? (
                          <div className="composer-memory-picker-preview-sections flex flex-col gap-2">
                            {activeManualMemoryPreviewSections.map((section, index) => (
                              <div
                                key={`${section.label}-${index}`}
                                className="composer-memory-picker-preview-section rounded-[10px] border border-(--border-subtle)/70 bg-(--surface-item)/85 px-2.5 py-2 flex flex-col gap-1.5"
                              >
                                <div className="composer-memory-picker-preview-section-label text-[11px] font-bold text-(--text-strong)">
                                  {section.label}
                                </div>
                                <Markdown
                                  className="markdown composer-memory-picker-preview-markdown m-0 text-xs text-(--text-muted) leading-[1.58] break-words [overflow-wrap:anywhere] [&>*]:m-0 [&>*+*]:mt-1.5 [&_:where(h1,h2,h3,h4)]:text-[13px] [&_:where(h1,h2,h3,h4)]:text-(--text-strong) [&_:where(ul,ol)]:m-0 [&_:where(ul,ol)]:pl-[18px] [&_:where(li+li)]:mt-[3px]"
                                  value={section.content}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="composer-memory-picker-preview-text rounded-[10px] border border-(--border-subtle)/68 bg-(--surface-item)/84 px-2.5 py-2">
                            <Markdown
                              className="markdown composer-memory-picker-preview-markdown m-0 text-xs text-(--text-muted) leading-[1.58] break-words [overflow-wrap:anywhere] [&>*]:m-0 [&>*+*]:mt-1.5 [&_:where(h1,h2,h3,h4)]:text-[13px] [&_:where(h1,h2,h3,h4)]:text-(--text-strong) [&_:where(ul,ol)]:m-0 [&_:where(ul,ol)]:pl-[18px] [&_:where(li+li)]:mt-[3px]"
                              value={
                                activeManualMemoryPreview ||
                                t("composer.manualMemoryPickerPreviewEmpty")
                              }
                            />
                          </div>
                        )}
                      </div>
                      {activeManualMemoryPreviewLong && (
                        <button
                          type="button"
                          className="composer-memory-picker-preview-toggle self-start border border-(--border-subtle)/76 rounded-full bg-(--surface-item)/82 text-(--text-muted) text-[10px] px-2 py-0.5 cursor-pointer"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() =>
                            setExpandedPreviewMemoryId((prev) =>
                              prev === activeManualMemoryId ? null : activeManualMemoryId,
                            )
                          }
                        >
                          {activeManualMemoryPreviewExpanded
                            ? t("composer.manualMemoryPreviewCollapse")
                            : t("composer.manualMemoryPreviewExpand")}
                        </button>
                      )}
                      <div className="composer-memory-picker-preview-meta flex flex-wrap gap-2 pt-0.5">
                        <span className="composer-memory-picker-preview-meta-item inline-flex items-center gap-1 text-[10px] text-(--text-faint)">
                          <Layers3 size={12} />
                          {activeManualMemory.memoryKind || "note"}
                        </span>
                        <span className="composer-memory-picker-preview-meta-item inline-flex items-center gap-1 text-[10px] text-(--text-faint)">
                          <Clock3 size={12} />
                          {formatMemoryDate(activeManualMemory.memoryUpdatedAt)}
                        </span>
                        {(activeManualMemory.memoryTags || []).length > 0 && (
                          <span className="composer-memory-picker-preview-meta-item inline-flex items-center gap-1 text-[10px] text-(--text-faint)">
                            <Tag size={12} />
                            {(activeManualMemory.memoryTags || []).slice(0, 5).join(" · ")}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="composer-memory-picker-preview-empty text-[11px] text-(--text-muted)">
                      {t("composer.manualMemoryPickerPreviewFallback")}
                    </span>
                  )}
                </aside>
              </div>
            ) : (
              suggestions.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`composer-suggestion flex flex-col gap-0.5 text-left border border-transparent rounded-lg px-2 py-1.5 bg-transparent text-(--text-strong) cursor-pointer w-full min-w-0 hover:bg-(--surface-item) hover:border-(--border-muted)${
                    index === highlightIndex ? " is-active bg-(--surface-item) border-(--border-muted)" : ""
                  }`}
                  role="option"
                  aria-selected={index === highlightIndex}
                  ref={(node) => {
                    suggestionRefs.current[index] = node;
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onSelectSuggestion(item)}
                  onMouseEnter={() => onHighlightIndex(index)}
                >
                  {(() => {
                    const fileSuggestion = isFileSuggestion(item);
                    const title = fileSuggestion ? fileTitle(item.label) : item.label;
                    const description = fileSuggestion ? item.label : item.description;
                    if (fileSuggestion) {
                      const isDirectory = item.isDirectory === true;
                      const displayPath = isDirectory ? item.label.replace(/\/$/, "") : item.label;
                      return (
                        <span className="composer-suggestion-row flex items-start gap-2 min-w-0">
                          <span className="composer-suggestion-icon inline-flex w-4 h-4 text-(--text-muted) flex-none mt-px [&_svg]:w-3.5 [&_svg]:h-3.5" aria-hidden>
                            <FileIcon filePath={displayPath} isFolder={isDirectory} isOpen={false} />
                          </span>
                          <span className="composer-suggestion-content flex flex-col gap-0.5 min-w-0 flex-1">
                            <span className="composer-suggestion-title text-xs font-semibold w-full whitespace-nowrap overflow-hidden text-ellipsis">{title}</span>
                            {description && (
                              <span className="composer-suggestion-description text-[10px] text-(--text-muted) w-full whitespace-nowrap overflow-hidden text-ellipsis">
                                {description}
                              </span>
                            )}
                          </span>
                        </span>
                      );
                    }
                    const Icon = suggestionIcon(item);
                    return (
                      <span className="composer-suggestion-row flex items-start gap-2 min-w-0">
                        <span className="composer-suggestion-icon inline-flex w-4 h-4 text-(--text-muted) flex-none mt-px [&_svg]:w-3.5 [&_svg]:h-3.5" aria-hidden>
                          <Icon size={14} />
                        </span>
                        <span className="composer-suggestion-content flex flex-col gap-0.5 min-w-0 flex-1">
                          <span className="composer-suggestion-title text-xs font-semibold w-full whitespace-nowrap overflow-hidden text-ellipsis">{title}</span>
                          {description && (
                            <span className="composer-suggestion-description text-[10px] text-(--text-muted) w-full whitespace-nowrap overflow-hidden text-ellipsis">
                              {description}
                            </span>
                          )}
                          {item.hint && (
                            <span className="composer-suggestion-description text-[10px] text-(--text-muted) w-full whitespace-nowrap overflow-hidden text-ellipsis">
                              {item.hint}
                            </span>
                          )}
                        </span>
                      </span>
                    );
                  })()}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
