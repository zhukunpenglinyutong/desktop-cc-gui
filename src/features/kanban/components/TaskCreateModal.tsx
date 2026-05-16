import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Calendar from "lucide-react/dist/esm/icons/calendar";
import Clock3 from "lucide-react/dist/esm/icons/clock-3";
import Repeat from "lucide-react/dist/esm/icons/repeat";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import Hash from "lucide-react/dist/esm/icons/hash";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import type { EngineStatus, EngineType } from "../../../types";
import type {
  KanbanNewThreadResultMode,
  KanbanRecurringUnit,
  KanbanRecurringExecutionMode,
  KanbanScheduleMode,
  KanbanTask,
  KanbanTaskChain,
  KanbanTaskSchedule,
  KanbanTaskStatus,
} from "../types";
import { pickImageFiles, generateThreadTitle } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { RichTextInput } from "../../../components/common/RichTextInput";
import { useInlineHistoryCompletion } from "../../composer/hooks/useInlineHistoryCompletion";
import { recordHistory as recordInputHistory } from "../../composer/hooks/useInputHistoryStore";
import { loadTaskDraft, saveTaskDraft, clearTaskDraft } from "../utils/kanbanStorage";
import { buildTaskChain, validateChainSelection } from "../utils/chaining";
import { buildTaskScheduleFromForm } from "../utils/scheduling";

type CreateTaskInput = {
  workspaceId: string;
  panelId: string;
  title: string;
  description: string;
  engineType: EngineType;
  modelId: string | null;
  branchName: string;
  images: string[];
  autoStart: boolean;
  schedule?: KanbanTaskSchedule;
  chain?: KanbanTaskChain;
};

type TaskCreateModalProps = {
  isOpen: boolean;
  workspaceId: string;
  workspaceBackendId: string;
  panelId: string;
  defaultStatus: KanbanTaskStatus;
  engineStatuses: EngineStatus[];
  onSubmit: (input: CreateTaskInput) => void;
  onCancel: () => void;
  availableTasks: KanbanTask[];
  editingTask?: KanbanTask;
  onUpdate?: (taskId: string, changes: Partial<KanbanTask>) => void;
};

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function toDateTimeLocalInput(timestamp: number | null | undefined): string {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return "";
  }
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-") + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function TaskCreateModal({
  isOpen,
  workspaceId,
  workspaceBackendId,
  panelId,
  defaultStatus,
  engineStatuses,
  onSubmit,
  onCancel,
  availableTasks,
  editingTask,
  onUpdate,
}: TaskCreateModalProps) {
  const { t, i18n } = useTranslation();
  const titleRef = useRef<HTMLInputElement>(null);
  const descTextareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    applySuggestion: applyInlineCompletion,
    clear: clearInlineCompletion,
    hasSuggestion: hasInlineSuggestion,
    suffix: inlineCompletionSuffix,
    updateQuery: updateInlineCompletionQuery,
  } = useInlineHistoryCompletion();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [engineType, setEngineType] = useState<EngineType>("claude");
  const [modelId, setModelId] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [autoStart, setAutoStart] = useState(false);
  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"manual" | "once" | "recurring">("manual");
  const [runAtText, setRunAtText] = useState("");
  const [recurringInterval, setRecurringInterval] = useState(1);
  const [recurringUnit, setRecurringUnit] = useState<KanbanRecurringUnit>("days");
  const [recurringExecutionMode, setRecurringExecutionMode] =
    useState<KanbanRecurringExecutionMode>("same_thread");
  const [newThreadResultMode, setNewThreadResultMode] =
    useState<KanbanNewThreadResultMode>("pass");
  const [maxRounds, setMaxRounds] = useState(10);
  const [previousTaskId, setPreviousTaskId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const scheduleModeOptions: Array<{
    value: KanbanScheduleMode;
    icon: typeof Calendar;
    label: string;
  }> = [
    { value: "manual", icon: Calendar, label: t("kanban.task.schedule.manual") },
    { value: "once", icon: Clock3, label: t("kanban.task.schedule.once") },
    { value: "recurring", icon: Repeat, label: t("kanban.task.schedule.recurring") },
  ];
  const scheduleModeIndex = Math.max(
    0,
    scheduleModeOptions.findIndex((option) => option.value === scheduleMode),
  );

  // branchName is always "main" - no UI control needed
  const branchName = "main";

  const availableEngines = engineStatuses.filter((e) => e.installed);
  const selectedEngine = engineStatuses.find(
    (e) => e.engineType === engineType
  );
  const availableModels = selectedEngine?.models ?? [];
  const chainCandidates = availableTasks.filter(
    (task) => task.id !== editingTask?.id && task.status === "todo",
  );

  const resolveValidationMessage = useCallback(
    (reason: string): string => {
      const keyMap: Record<string, string> = {
        invalid_once_time: "kanban.task.validation.invalidOnceTime",
        invalid_recurring_interval: "kanban.task.validation.invalidRecurringInterval",
        invalid_recurring_rule: "kanban.task.validation.invalidRecurringRule",
        chain_requires_todo_task: "kanban.task.validation.chainRequiresTodoTask",
        downstream_cannot_be_scheduled: "kanban.task.validation.downstreamCannotBeScheduled",
        chain_self_cycle: "kanban.task.validation.chainSelfCycle",
        chain_previous_not_found: "kanban.task.validation.chainPreviousNotFound",
        chain_requires_todo_upstream: "kanban.task.validation.chainRequiresTodoUpstream",
        chain_multi_downstream: "kanban.task.validation.chainMultiDownstream",
        chain_cycle_detected: "kanban.task.validation.chainCycleDetected",
      };
      return t(keyMap[reason] ?? "kanban.task.validation.generic");
    },
    [t],
  );

  const handlePickImages = async () => {
    try {
      const paths = await pickImageFiles();
      if (paths.length > 0) {
        setImages((prev) => [...prev, ...paths]);
      }
    } catch {
      // user cancelled
    }
  };

  const formatEngineName = (type: EngineType): string => {
    switch (type) {
      case "claude":
        return "Claude Code";
      case "codex":
        return "Codex";
      default:
        return type;
    }
  };

  const resolveTaskScheduleModeLabel = useCallback(
    (mode: KanbanScheduleMode): string => {
      if (mode === "once") {
        return t("kanban.task.schedule.once");
      }
      if (mode === "recurring") {
        return t("kanban.task.schedule.recurring");
      }
      return t("kanban.task.schedule.manual");
    },
    [t],
  );

  const formatUpstreamTaskLabel = useCallback(
    (task: KanbanTask): string => {
      const mode = task.schedule?.mode ?? "manual";
      return `[${resolveTaskScheduleModeLabel(mode)}] ${task.title}`;
    },
    [resolveTaskScheduleModeLabel],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (editingTask) {
      setTitle(editingTask.title);
      setDescription(editingTask.description);
      setEngineType(editingTask.engineType);
      setModelId(editingTask.modelId);
      setImages(editingTask.images);
      setAutoStart(editingTask.autoStart);
      setScheduleMode(editingTask.schedule?.mode ?? "manual");
      setRunAtText(toDateTimeLocalInput(editingTask.schedule?.runAt ?? null));
      setRecurringInterval(editingTask.schedule?.interval ?? 1);
      setRecurringUnit(editingTask.schedule?.unit ?? "days");
      setRecurringExecutionMode(editingTask.schedule?.recurringExecutionMode ?? "same_thread");
      setNewThreadResultMode(editingTask.schedule?.newThreadResultMode ?? "pass");
      setMaxRounds(Math.min(50, Math.max(1, editingTask.schedule?.maxRounds ?? 10)));
      setPreviousTaskId(editingTask.chain?.previousTaskId ?? "");
    } else {
      const draft = loadTaskDraft(panelId);
      if (draft && (draft.title || draft.description)) {
        setTitle(draft.title);
        setDescription(draft.description);
        setEngineType(draft.engineType as EngineType);
        setModelId(draft.modelId);
        setImages(draft.images);
      } else {
        setTitle("");
        setDescription("");
        setImages([]);
      }
      setAutoStart(defaultStatus !== "todo");
      setScheduleMode("manual");
      setRunAtText("");
      setRecurringInterval(1);
      setRecurringUnit("days");
      setRecurringExecutionMode("same_thread");
      setNewThreadResultMode("pass");
      setMaxRounds(10);
      setPreviousTaskId("");
    }
    setFormError(null);
    clearInlineCompletion();
    const focusTimer = window.setTimeout(() => titleRef.current?.focus(), 50);
    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [clearInlineCompletion, defaultStatus, editingTask, isOpen, panelId]);

  useEffect(() => {
    if (!isOpen || availableEngines.length === 0) {
      return;
    }
    if (!availableEngines.find((engine) => engine.engineType === engineType)) {
      setEngineType(availableEngines[0]?.engineType ?? "codex");
    }
  }, [availableEngines, engineType, isOpen]);

  useEffect(() => {
    const engine = engineStatuses.find((e) => e.engineType === engineType);
    if (engine?.models.length) {
      const defaultModel = engine.models.find((m) => m.isDefault);
      setModelId(defaultModel?.id ?? engine.models[0]?.id ?? null);
    } else {
      setModelId(null);
    }
  }, [engineType, engineStatuses]);

  useEffect(() => {
    if (scheduleMode !== "manual" && previousTaskId) {
      setPreviousTaskId("");
    }
  }, [scheduleMode, previousTaskId]);

  useEffect(() => {
    if (scheduleMode !== "manual" && autoStart) {
      setAutoStart(false);
    }
  }, [scheduleMode, autoStart]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const trimmedDesc = description.trim();
    if (trimmedDesc) {
      recordInputHistory(trimmedDesc);
    }
    clearInlineCompletion();

    const nextStatus = editingTask?.status ?? (autoStart ? "inprogress" : "todo");
    if (nextStatus !== "todo" && scheduleMode !== "manual") {
      setFormError(t("kanban.task.validation.scheduleTodoOnly"));
      return;
    }

    const builtSchedule = buildTaskScheduleFromForm({
      mode: scheduleMode,
      runAtText,
      interval: recurringInterval,
      unit: recurringUnit,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      recurringExecutionMode,
      newThreadResultMode,
      maxRounds,
    });
    if (!builtSchedule.ok) {
      setFormError(resolveValidationMessage(builtSchedule.reason));
      return;
    }

    const chainValidation = validateChainSelection({
      tasks: availableTasks,
      taskId: editingTask?.id,
      status: nextStatus,
      previousTaskId: previousTaskId || null,
      scheduleMode,
    });
    if (!chainValidation.ok) {
      setFormError(resolveValidationMessage(chainValidation.reason));
      return;
    }

    const chain = buildTaskChain(availableTasks, previousTaskId || null);
    const normalizedSchedule =
      builtSchedule.schedule?.mode === "recurring" &&
      builtSchedule.schedule.recurringExecutionMode === "new_thread"
        ? {
            ...builtSchedule.schedule,
            seriesId: editingTask?.schedule?.seriesId ?? editingTask?.id ?? null,
          }
        : builtSchedule.schedule;

    if (editingTask && onUpdate) {
      onUpdate(editingTask.id, {
        title: trimmedTitle,
        description: trimmedDesc,
        engineType,
        modelId,
        images,
        autoStart,
        schedule: normalizedSchedule,
        chain,
        execution: {
          ...(editingTask.execution ?? {}),
          blockedReason: null,
        },
      });
    } else {
      clearTaskDraft(panelId);
      onSubmit({
        workspaceId,
        panelId,
        title: trimmedTitle,
        description: trimmedDesc,
        engineType,
        modelId,
        branchName: branchName.trim() || "main",
        images,
        autoStart,
        schedule: normalizedSchedule,
        chain,
      });
    }
  };

  const handleGenerateTitle = async () => {
    const trimmedDesc = description.trim();
    if (!trimmedDesc || isGeneratingTitle) return;
    setIsGeneratingTitle(true);
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    try {
      const language = i18n.language.toLowerCase().startsWith("zh") ? "zh" : "en";
      const generated = await Promise.race([
        generateThreadTitle(workspaceBackendId, "temp-title-gen", trimmedDesc, language),
        new Promise<never>((_, reject) =>
          timeoutHandle = setTimeout(() => reject(new Error("timeout")), 15_000),
        ),
      ]);
      const result = generated.trim();
      if (result) {
        setTitle(result);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      pushErrorToast({
        title: t("kanban.task.generateTitleFailed"),
        message: msg === "timeout" ? t("kanban.task.generateTitleTimeout") : msg,
      });
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      setIsGeneratingTitle(false);
    }
  };

  const handleAttachImages = (paths: string[]) => {
    setImages((prev) => [...prev, ...paths]);
  };

  const handleRemoveImage = (path: string) => {
    setImages((prev) => prev.filter((p) => p !== path));
  };

  const handleDescriptionChange = useCallback(
    (next: string) => {
      setDescription(next);
      updateInlineCompletionQuery(next);
    },
    [updateInlineCompletionQuery],
  );

  const handleDescKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        e.key === "Tab" &&
        !e.shiftKey &&
        hasInlineSuggestion
      ) {
        e.preventDefault();
        const fullText = applyInlineCompletion();
        if (fullText) {
          setDescription(fullText);
          requestAnimationFrame(() => {
            const textarea = descTextareaRef.current;
            if (textarea) {
              textarea.setSelectionRange(fullText.length, fullText.length);
            }
          });
        }
      }
    },
    [applyInlineCompletion, hasInlineSuggestion],
  );

  const handleCancel = () => {
    if (!editingTask) {
      if (title.trim() || description.trim()) {
        saveTaskDraft(panelId, { title, description, engineType, modelId, images });
      } else {
        clearTaskDraft(panelId);
      }
    }
    clearInlineCompletion();
    onCancel();
  };

  if (!isOpen) return null;
  const showAutoStartToggle = !editingTask && scheduleMode === "manual";

  return (
    <div className="kanban-modal-overlay fixed top-0 left-0 right-0 bottom-0 bg-black/60 backdrop-blur-[4px] [-webkit-backdrop-filter:blur(4px)] flex items-center justify-center z-[1000]">
      <div className="kanban-modal kanban-task-modal bg-[color:var(--surface-card-strong,var(--bg-primary,#fff))] border border-[color:var(--border-strong,var(--border-color,#e5e5e5))] rounded-xl w-[560px] max-w-[90vw] max-h-[90vh] overflow-y-auto shadow-[0_16px_48px_rgba(0,0,0,0.3)]">
        <div className="kanban-modal-header flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-color,#e5e5e5)]">
          <h2 className="text-base font-semibold m-0">{editingTask ? t("kanban.task.editTitle") : t("kanban.task.createTitle")}</h2>
          <button className="kanban-icon-btn flex items-center justify-center w-7 h-7 p-0 border-none bg-transparent rounded-[6px] cursor-pointer text-[color:var(--text-secondary,#666)] transition-[background,color] duration-150 hover:bg-[color:var(--bg-tertiary,#f0f0f0)] hover:text-[color:var(--text-primary,#111)]" onClick={handleCancel}>
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="kanban-modal-body px-5 py-5 flex flex-col gap-3">
            <div className="kanban-task-title-row flex items-center gap-2">
              <input
                ref={titleRef}
                className="kanban-input kanban-task-title-input w-full px-3 py-2.5 border border-[color:var(--border-color,#e5e5e5)] rounded-lg text-sm text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none transition-[border-color] duration-150 box-border focus:border-[color:var(--accent-color,#3b82f6)] text-base font-medium flex-1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("kanban.task.titlePlaceholder")}
              />
              <button
                type="button"
                className="kanban-icon-btn kanban-task-generate-btn flex items-center justify-center w-7 h-7 p-0 border-none bg-transparent rounded-[6px] cursor-pointer text-[color:var(--text-tertiary,#999)] transition-[background,color] duration-150 shrink-0 hover:not-disabled:text-[color:var(--accent-color,#3b82f6)] disabled:opacity-35 disabled:cursor-not-allowed"
                onClick={handleGenerateTitle}
                disabled={!description.trim() || isGeneratingTitle}
                title={t("kanban.task.generateTitle")}
              >
                {isGeneratingTitle ? <Loader2 size={16} className="kanban-spin" /> : <Sparkles size={16} />}
              </button>
            </div>

            <RichTextInput
              value={description}
              onChange={handleDescriptionChange}
              placeholder={t("kanban.task.descPlaceholder")}
              attachments={images}
              onAddAttachment={handlePickImages}
              onAttachImages={handleAttachImages}
              onRemoveAttachment={handleRemoveImage}
              enableResize={true}
              initialHeight={120}
              minHeight={80}
              maxHeight={300}
              className="kanban-rich-input border border-[color:var(--border-color,#e5e5e5)] rounded-lg bg-[color:var(--bg-primary,#fff)] py-1"
              textareaRef={descTextareaRef}
              onKeyDown={handleDescKeyDown}
              ghostTextSuffix={inlineCompletionSuffix}
              footerLeft={
                <>
                  <button
                    type="button"
                    className="kanban-icon-btn kanban-rich-input-attach flex items-center justify-center w-7 h-7 p-0 border-none bg-transparent rounded-[6px] cursor-pointer text-[color:var(--text-secondary,#666)] transition-[background,color] duration-150 px-2 py-1 rounded-[6px] gap-1 hover:not-disabled:text-[color:var(--text-primary,#333)] hover:not-disabled:bg-[color:var(--bg-tertiary,#f0f0f0)]"
                    onClick={handlePickImages}
                    title={t("kanban.task.addImage")}
                  >
                    <ImagePlus size={16} />
                  </button>
                  <div className="kanban-task-selector flex">
                    <select
                      className="kanban-select px-3 py-2 border border-[color:var(--border-color,#e5e5e5)] rounded-lg text-[13px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none cursor-pointer box-border max-w-[180px]"
                      value={engineType}
                      onChange={(e) =>
                        setEngineType(e.target.value as EngineType)
                      }
                    >
                      {engineStatuses.map((engine) => (
                        <option
                          key={engine.engineType}
                          value={engine.engineType}
                          disabled={!engine.installed}
                        >
                          {formatEngineName(engine.engineType)}
                          {!engine.installed ? ` (${t("kanban.task.notInstalled")})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="kanban-task-selector flex">
                    <select
                      className="kanban-select px-3 py-2 border border-[color:var(--border-color,#e5e5e5)] rounded-lg text-[13px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none cursor-pointer box-border max-w-[180px]"
                      value={modelId ?? ""}
                      onChange={(e) => setModelId(e.target.value || null)}
                    >
                      {availableModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.displayName}
                        </option>
                      ))}
                      {availableModels.length === 0 && (
                        <option value="">{t("kanban.task.noModels")}</option>
                      )}
                    </select>
                  </div>
                </>
              }
            />

            <div className="kanban-task-config-block is-compact border border-[color:var(--border-color,#e5e5e5)] rounded-[10px] bg-[color-mix(in_srgb,var(--bg-secondary,#fafafa)_92%,var(--bg-primary,#fff))] px-2.5 py-2 flex flex-col gap-1.5">
              <div className="kanban-task-config-row grid [grid-template-columns:132px_minmax(0,1fr)] items-center gap-3 min-h-[30px]">
                <span className="kanban-task-config-label inline-flex items-center gap-1.5 text-xs text-[color:var(--text-secondary,#555)] tracking-[0.01em] whitespace-nowrap">
                  <Calendar size={13} className="kanban-task-config-label-icon text-[color:var(--text-tertiary,#8b90a0)] shrink-0" />
                  {t("kanban.task.schedule.modeLabel")}
                </span>
                <div
                  className="kanban-task-mode-segmented relative grid [grid-template-columns:repeat(3,minmax(0,1fr))] items-center w-full max-w-[280px] min-h-[32px] border border-[color:var(--border-color,#dfe3ea)] rounded-lg bg-[color-mix(in_srgb,var(--bg-secondary,#f4f6fa)_80%,var(--bg-primary,#fff))] p-0.5 box-border"
                  role="radiogroup"
                  aria-label={t("kanban.task.schedule.modeLabel")}
                >
                  <span
                    className="kanban-task-mode-segmented-thumb absolute top-0.5 left-0.5 w-[calc((100%-4px)/3)] h-[calc(100%-4px)] rounded-[6px] bg-[color-mix(in_srgb,var(--accent-color,#3b82f6)_12%,var(--bg-primary,#fff))] border border-[color-mix(in_srgb,var(--accent-color,#3b82f6)_62%,var(--border-color,#dfe3ea))] shadow-[0_1px_2px_rgba(59,130,246,0.18)] transition-transform duration-200 ease-[ease] pointer-events-none"
                    aria-hidden
                    style={{
                      transform: `translateX(${scheduleModeIndex * 100}%)`,
                    }}
                  />
                  {scheduleModeOptions.map((option) => {
                    const Icon = option.icon;
                    const isActive = scheduleMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        className={`kanban-task-mode-segmented-btn relative z-[1] h-[26px] border-none bg-transparent rounded-[6px] inline-flex items-center justify-center gap-1 px-2 text-xs cursor-pointer select-none transition-[color] duration-200 ease-[ease] whitespace-nowrap${isActive ? " is-active text-[color-mix(in_srgb,var(--accent-color,#3b82f6)_78%,#111827)] font-semibold" : " text-[color:var(--text-secondary,#5b6475)]"}`}
                        onClick={() => setScheduleMode(option.value)}
                      >
                        <Icon size={13} className="kanban-task-mode-segmented-icon shrink-0" />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {scheduleMode === "once" && (
                <div className="kanban-task-config-row grid [grid-template-columns:132px_minmax(0,1fr)] items-center gap-3 min-h-[30px]">
                  <span className="kanban-task-config-label inline-flex items-center gap-1.5 text-xs text-[color:var(--text-secondary,#555)] tracking-[0.01em] whitespace-nowrap">
                    <Clock3 size={13} className="kanban-task-config-label-icon text-[color:var(--text-tertiary,#8b90a0)] shrink-0" />
                    {t("kanban.task.schedule.runAt")}
                  </span>
                  <input
                    className="kanban-input kanban-task-date-input w-full max-w-[280px] px-2.5 py-0 h-8 min-h-8 text-xs border border-[color:var(--border-color,#e5e5e5)] rounded-[7px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none transition-[border-color] duration-150 box-border focus:border-[color:var(--accent-color,#3b82f6)]"
                    type="datetime-local"
                    value={runAtText}
                    onChange={(e) => setRunAtText(e.target.value)}
                  />
                </div>
              )}

              {scheduleMode === "recurring" && (
                <>
                  <div className="kanban-task-config-row grid [grid-template-columns:132px_minmax(0,1fr)] items-center gap-3 min-h-[30px]">
                    <span className="kanban-task-config-label inline-flex items-center gap-1.5 text-xs text-[color:var(--text-secondary,#555)] tracking-[0.01em] whitespace-nowrap">
                      <Repeat size={13} className="kanban-task-config-label-icon text-[color:var(--text-tertiary,#8b90a0)] shrink-0" />
                      {t("kanban.task.schedule.every")}
                    </span>
                    <div className="kanban-task-config-inline flex items-center justify-start gap-1.5 w-full max-w-[280px]">
                      <input
                        className="kanban-input kanban-task-recurring-interval-input h-8 min-h-8 text-xs border border-[color:var(--border-color,#e5e5e5)] rounded-[7px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none transition-[border-color] duration-150 box-border focus:border-[color:var(--accent-color,#3b82f6)] flex-[0_0_72px] w-[72px] px-2.5 py-0"
                        type="number"
                        min={1}
                        value={recurringInterval}
                        onChange={(e) => setRecurringInterval(Math.max(1, Number(e.target.value) || 1))}
                      />
                      <select
                        className="kanban-select flex-1 max-w-none min-w-0 h-8 min-h-8 text-xs border border-[color:var(--border-color,#e5e5e5)] rounded-[7px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none cursor-pointer box-border px-2.5 py-0 focus:border-[color:var(--accent-color,#3b82f6)]"
                        value={recurringUnit}
                        onChange={(e) => setRecurringUnit(e.target.value as KanbanRecurringUnit)}
                      >
                        <option value="minutes">{t("kanban.task.schedule.minutes")}</option>
                        <option value="hours">{t("kanban.task.schedule.hours")}</option>
                        <option value="days">{t("kanban.task.schedule.days")}</option>
                        <option value="weeks">{t("kanban.task.schedule.weeks")}</option>
                      </select>
                    </div>
                  </div>

                  <div className="kanban-task-config-row grid [grid-template-columns:132px_minmax(0,1fr)] items-center gap-3 min-h-[30px]">
                    <span className="kanban-task-config-label inline-flex items-center gap-1.5 text-xs text-[color:var(--text-secondary,#555)] tracking-[0.01em] whitespace-nowrap">
                      <Settings2 size={13} className="kanban-task-config-label-icon text-[color:var(--text-tertiary,#8b90a0)] shrink-0" />
                      {t("kanban.task.schedule.executionModeLabel")}
                    </span>
                    <select
                      className="kanban-select w-full max-w-[280px] justify-self-start h-8 min-h-8 text-xs border border-[color:var(--border-color,#e5e5e5)] rounded-[7px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none cursor-pointer box-border px-2.5 py-0 focus:border-[color:var(--accent-color,#3b82f6)]"
                      value={recurringExecutionMode}
                      onChange={(e) =>
                        setRecurringExecutionMode(e.target.value as KanbanRecurringExecutionMode)
                      }
                    >
                      <option value="same_thread">
                        {t("kanban.task.schedule.sameThread")}
                      </option>
                      <option value="new_thread">
                        {t("kanban.task.schedule.newThread")}
                      </option>
                    </select>
                  </div>

                  {recurringExecutionMode === "same_thread" && (
                    <div className="kanban-task-config-row grid [grid-template-columns:132px_minmax(0,1fr)] items-center gap-3 min-h-[30px]">
                      <span className="kanban-task-config-label inline-flex items-center gap-1.5 text-xs text-[color:var(--text-secondary,#555)] tracking-[0.01em] whitespace-nowrap">
                        <Hash size={13} className="kanban-task-config-label-icon text-[color:var(--text-tertiary,#8b90a0)] shrink-0" />
                        {t("kanban.task.schedule.maxRounds")}
                      </span>
                      <input
                        className="kanban-input kanban-task-rounds-input w-full max-w-[280px] h-8 min-h-8 text-xs border border-[color:var(--border-color,#e5e5e5)] rounded-[7px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none transition-[border-color] duration-150 box-border px-2.5 py-0 focus:border-[color:var(--accent-color,#3b82f6)]"
                        type="number"
                        min={1}
                        max={50}
                        value={maxRounds}
                        onChange={(e) =>
                          setMaxRounds(
                            Math.min(50, Math.max(1, Number(e.target.value) || 1)),
                          )
                        }
                      />
                    </div>
                  )}

                  {recurringExecutionMode === "new_thread" && (
                    <div className="kanban-task-config-row grid [grid-template-columns:132px_minmax(0,1fr)] items-center gap-3 min-h-[30px]">
                      <span className="kanban-task-config-label inline-flex items-center gap-1.5 text-xs text-[color:var(--text-secondary,#555)] tracking-[0.01em] whitespace-nowrap">
                        <GitBranch size={13} className="kanban-task-config-label-icon text-[color:var(--text-tertiary,#8b90a0)] shrink-0" />
                        {t("kanban.task.schedule.resultPassing")}
                      </span>
                      <select
                        className="kanban-select w-full max-w-[280px] justify-self-start h-8 min-h-8 text-xs border border-[color:var(--border-color,#e5e5e5)] rounded-[7px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none cursor-pointer box-border px-2.5 py-0 focus:border-[color:var(--accent-color,#3b82f6)]"
                        value={newThreadResultMode}
                        onChange={(e) =>
                          setNewThreadResultMode(e.target.value as KanbanNewThreadResultMode)
                        }
                      >
                        <option value="pass">
                          {t("kanban.task.schedule.passResult")}
                        </option>
                        <option value="none">
                          {t("kanban.task.schedule.blockResult")}
                        </option>
                      </select>
                    </div>
                  )}
                </>
              )}

              {scheduleMode === "manual" && (
                <div className="kanban-task-config-row grid [grid-template-columns:132px_minmax(0,1fr)] items-center gap-3 min-h-[30px]">
                  <span className="kanban-task-config-label inline-flex items-center gap-1.5 text-xs text-[color:var(--text-secondary,#555)] tracking-[0.01em] whitespace-nowrap">
                    <Link2 size={13} className="kanban-task-config-label-icon text-[color:var(--text-tertiary,#8b90a0)] shrink-0" />
                    {t("kanban.task.chain.upstreamLabel")}
                  </span>
                  <select
                    className="kanban-select w-full max-w-[280px] justify-self-start h-8 min-h-8 text-xs border border-[color:var(--border-color,#e5e5e5)] rounded-[7px] text-[color:var(--text-primary,#111)] bg-[color:var(--bg-primary,#fff)] outline-none cursor-pointer box-border px-2.5 py-0 focus:border-[color:var(--accent-color,#3b82f6)]"
                    value={previousTaskId}
                    onChange={(e) => setPreviousTaskId(e.target.value)}
                  >
                    <option value="">{t("kanban.task.chain.none")}</option>
                    {chainCandidates.map((task) => (
                      <option key={task.id} value={task.id}>
                        {formatUpstreamTaskLabel(task)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {formError && (
              <div className="kanban-task-form-error text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded-lg px-2.5 py-2 text-xs leading-[1.4]" role="alert">
                {formError}
              </div>
            )}
          </div>

          <div className="kanban-modal-footer flex items-center justify-between px-5 py-4 border-t border-[color:var(--border-color,#e5e5e5)] gap-2">
            {showAutoStartToggle ? (
              <label className="kanban-toggle-label inline-flex items-center gap-2 cursor-pointer text-[13px] text-[color:var(--text-primary,#111)] select-none">
                <input
                  type="checkbox"
                  className="kanban-toggle-input absolute opacity-0 w-0 h-0"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                />
                <span className="kanban-toggle-switch relative w-9 h-5 bg-[color:var(--bg-tertiary,#d1d5db)] rounded-[10px] transition-[background] duration-200 shrink-0 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform after:duration-200 after:shadow-[0_1px_3px_rgba(0,0,0,0.15)] [input:checked+&]:bg-[color:var(--text-primary,#111)] [input:checked+&]:after:translate-x-4" />
                <span>{t("kanban.task.start")}</span>
              </label>
            ) : <div />}
            <button
              type="submit"
              className="kanban-btn kanban-btn-primary inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium cursor-pointer bg-[color:var(--text-primary,#e6e7ea)] text-[color:var(--bg-primary,#1e1e1e)] border-transparent transition-[background,border-color] duration-150 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={!title.trim()}
            >
              {editingTask ? t("kanban.task.update") : t("kanban.task.create")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
