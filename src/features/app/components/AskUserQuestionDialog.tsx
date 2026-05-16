import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";

const OTHER_OPTION_MARKER = "__OTHER__";
const MAX_CUSTOM_INPUT_LENGTH = 2000;
const TIMEOUT_SECONDS = 300; // 5 minutes
const WARNING_THRESHOLD_SECONDS = 30;

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type AskUserQuestionDialogProps = {
  requests: RequestUserInputRequest[];
  activeThreadId: string | null;
  activeWorkspaceId?: string | null;
  activeEngine?: string | null;
  onSubmit: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => Promise<void> | void;
};

type SelectionState = Record<string, Set<string>>;
type CustomInputState = Record<string, string>;
type SecretVisState = Record<string, boolean>;

export function AskUserQuestionDialog({
  requests,
  activeThreadId,
  activeWorkspaceId,
  activeEngine,
  onSubmit,
}: AskUserQuestionDialogProps) {
  const { t } = useTranslation();

  const activeRequests = useMemo(
    () =>
      requests.filter((req) => {
        if (!activeThreadId) return false;
        const requestThreadId = (req.params.thread_id ?? "").trim();
        if (requestThreadId && requestThreadId !== activeThreadId) return false;
        if (activeWorkspaceId && req.workspace_id !== activeWorkspaceId) return false;
        return true;
      }),
    [requests, activeThreadId, activeWorkspaceId],
  );

  const activeRequest = activeRequests[0] ?? null;
  const requestId = activeRequest
    ? `${activeRequest.workspace_id}:${String(activeRequest.request_id)}`
    : null;

  const [selections, setSelections] = useState<SelectionState>({});
  const [customInputs, setCustomInputs] = useState<CustomInputState>({});
  const [secretVisible, setSecretVisible] = useState<SecretVisState>({});
  const [questionIndex, setQuestionIndex] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(TIMEOUT_SECONDS);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const customInputRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevRequestIdRef = useRef<string | null>(null);

  const isTimeWarning = remainingSeconds <= WARNING_THRESHOLD_SECONDS && remainingSeconds > 0;
  const isTimedOut = remainingSeconds <= 0;

  // Reset when a new request arrives
  useEffect(() => {
    if (requestId && requestId !== prevRequestIdRef.current) {
      prevRequestIdRef.current = requestId;
      setQuestionIndex(0);
      setIsCollapsed(false);
      setRemainingSeconds(TIMEOUT_SECONDS);
      setIsSubmitting(false);
      setSubmitError(null);

      if (activeRequest) {
        const nextSelections: SelectionState = {};
        const nextCustom: CustomInputState = {};
        const nextSecret: SecretVisState = {};
        activeRequest.params.questions.forEach((q, i) => {
          const key = q.id || `q-${i}`;
          nextSelections[key] = new Set();
          nextCustom[key] = "";
          nextSecret[key] = false;
        });
        setSelections(nextSelections);
        setCustomInputs(nextCustom);
        setSecretVisible(nextSecret);
      }
    }
  }, [requestId, activeRequest]);

  // Countdown timer
  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
    if (!activeRequest) {
      clearTimer();
      return;
    }
    clearTimer();
    timerRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return clearTimer;
  }, [requestId, activeRequest]);

  const handleCancel = useCallback(() => {
    if (!activeRequest) return;
    // Submit empty answers to unblock the agent
    void onSubmit(activeRequest, { answers: {} });
  }, [activeRequest, onSubmit]);

  // Auto-cancel on timeout
  useEffect(() => {
    if (isTimedOut && activeRequest) {
      handleCancel();
    }
  }, [isTimedOut, activeRequest, handleCancel]);

  // ESC key
  useEffect(() => {
    if (!activeRequest) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeRequest, handleCancel]);

  if (!activeRequest) return null;

  const { questions } = activeRequest.params;
  if (!questions.length) return null;

  const safeIndex = Math.max(0, Math.min(questionIndex, questions.length - 1));
  const currentQ = questions[safeIndex];
  if (!currentQ) return null;

  const qKey = currentQ.id || `q-${safeIndex}`;
  const options = currentQ.options ?? [];
  const hasOptions = options.length > 0;
  const isMultiSelect = currentQ.multiSelect === true;
  const isLastQuestion = safeIndex === questions.length - 1;
  const currentSelections = selections[qKey] ?? new Set();
  const currentCustom = customInputs[qKey] ?? "";
  const isOtherSelected = currentSelections.has(OTHER_OPTION_MARKER);
  const currentSecretVis = secretVisible[qKey] ?? false;
  const isPlanBlockerQuestion = currentQ.id === "plan_blocker_resolution";
  const isCodexEngine = (activeEngine ?? "").trim().toLowerCase() === "codex";
  const useComposerOverlayMode = isPlanBlockerQuestion && isCodexEngine;

  const hasRegularSelection = Array.from(currentSelections).some((l) => l !== OTHER_OPTION_MARKER);
  const hasValidCustom = isOtherSelected && currentCustom.trim().length > 0;
  const hasPlainText = !hasOptions && currentCustom.trim().length > 0;
  const canProceed = hasRegularSelection || hasValidCustom || hasPlainText || currentQ.isSecret;

  const handleOptionToggle = (label: string) => {
    setSelections((prev) => {
      const next = { ...prev };
      const set = new Set(next[qKey] ?? []);
      if (isMultiSelect) {
        if (set.has(label)) set.delete(label);
        else set.add(label);
      } else {
        set.clear();
        set.add(label);
      }
      next[qKey] = set;
      return next;
    });
    if (label === OTHER_OPTION_MARKER) {
      setTimeout(() => customInputRef.current?.focus(), 0);
    }
  };

  const handleCustomChange = (value: string) => {
    setCustomInputs((prev) => ({
      ...prev,
      [qKey]: value.slice(0, MAX_CUSTOM_INPUT_LENGTH),
    }));
  };

  const handleToggleSecret = () => {
    setSecretVisible((prev) => ({
      ...prev,
      [qKey]: !prev[qKey],
    }));
  };

  const buildAnswers = (): RequestUserInputResponse["answers"] => {
    const answers: RequestUserInputResponse["answers"] = {};
    questions.forEach((q, i) => {
      if (!q.id) return;
      const key = q.id || `q-${i}`;
      const answerList: string[] = [];
      const selected = selections[key] ?? new Set();
      const qOptions = q.options ?? [];
      const qHasOptions = qOptions.length > 0;

      // Regular selected options
      const selectedLabels = Array.from(selected).filter((l) => l !== OTHER_OPTION_MARKER);
      answerList.push(...selectedLabels);

      // "Other" custom text
      if (selected.has(OTHER_OPTION_MARKER)) {
        const custom = (customInputs[key] ?? "").trim();
        if (custom) answerList.push(custom);
      }

      // Plain text (no options)
      const note = (customInputs[key] ?? "").trim();
      if (!qHasOptions && note) {
        answerList.push(note);
      } else if (qHasOptions && note && !selected.has(OTHER_OPTION_MARKER)) {
        answerList.push(`user_note: ${note}`);
      }

      answers[q.id] = { answers: answerList };
    });
    return answers;
  };

  const handleNext = () => {
    if (isLastQuestion) {
      void handleSubmitFinal();
    } else {
      setQuestionIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (safeIndex > 0) setQuestionIndex((prev) => Math.max(0, prev - 1));
  };

  const handleSubmitFinal = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(activeRequest, { answers: buildAnswers() });
    } catch {
      setSubmitError(t("approval.submitFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalRequests = activeRequests.length;

  const btnBase = "ask-user-question-btn py-1.5 px-4 rounded-[10px] text-xs font-medium cursor-pointer transition-[background,opacity] duration-150 whitespace-nowrap border border-transparent";
  const btnPrimary = "is-primary bg-[color:var(--primary,#7a9dcc)] text-[color:var(--primary-foreground,#0d0f14)] border-[color:var(--primary,#7a9dcc)] enabled:hover:opacity-[0.88] disabled:opacity-40 disabled:cursor-not-allowed";
  const btnSecondary = "is-secondary bg-[color:var(--surface-card-muted)] text-[color:var(--text-subtle)] border-[color:var(--border-subtle)] hover:text-[color:var(--text-strong)]";

  return (
    <div
      className={[
        "ask-user-question-overlay fixed inset-0 z-[50] flex items-center justify-center",
        isCollapsed && "is-collapsed pointer-events-none items-end pb-5",
        useComposerOverlayMode && "is-composer-overlay pointer-events-none items-end px-[var(--main-panel-padding,16px)] pb-7",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {!isCollapsed && !useComposerOverlayMode && (
        <div className="ask-user-question-backdrop absolute inset-0 bg-[rgba(8,12,20,0.64)] backdrop-blur-[8px] [.app.reduced-transparency_&]:backdrop-blur-none" onClick={handleCancel} />
      )}
      <div
        className={[
          "ask-user-question-card relative overflow-y-auto bg-[color:var(--surface-card-strong)] border border-[color:var(--border-stronger)] flex flex-col animate-[ask-dialog-slide-in_0.2s_ease-out]",
          isCollapsed
            ? "is-collapsed py-3.5 px-5 gap-2.5 overflow-hidden w-[min(520px,calc(100vw-32px))] rounded-2xl shadow-[0_-4px_20px_rgba(0,0,0,0.3)] pointer-events-auto"
            : useComposerOverlayMode
              ? "is-composer-overlay w-[min(750px,calc(100vw-32px))] max-h-[min(46vh,420px)] rounded-[14px] shadow-[0_10px_30px_rgba(0,0,0,0.34)] p-5 gap-4 pointer-events-auto"
              : "w-[min(520px,calc(100vw-32px))] max-h-[80vh] rounded-2xl shadow-[0_16px_48px_rgba(0,0,0,0.3)] p-5 gap-4",
          isTimeWarning && "is-time-warning border-[color:var(--warning-text,#e2a308)] shadow-[0_16px_48px_rgba(0,0,0,0.3),0_0_0_1px_var(--warning-text,#e2a308)]",
        ]
          .filter(Boolean)
          .join(" ")}
        role="dialog"
        aria-label={t("approval.userInputRequested")}
      >
        {/* Header */}
        <div className="ask-user-question-header flex justify-between items-center gap-2.5">
          <div className="ask-user-question-title text-sm font-semibold text-[color:var(--text-strong)] flex-1">
            {t("askUserQuestion.title")}
            {totalRequests > 1 ? (
              <span style={{ fontWeight: 400, marginLeft: 8, fontSize: 11, color: "var(--text-faint)" }}>
                {t("approval.requestOf", { current: 1, total: totalRequests })}
              </span>
            ) : null}
          </div>
          <button
            className="ask-user-question-collapse-btn shrink-0 w-[26px] h-[26px] flex items-center justify-center bg-[color:var(--surface-card-muted)] border border-[color:var(--border-subtle)] rounded-lg cursor-pointer text-[color:var(--text-subtle)] text-xs transition-[color,background] duration-150 hover:text-[color:var(--text-strong)] hover:bg-[color:var(--surface-hover,var(--surface-card-muted))]"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? t("askUserQuestion.expand") : t("askUserQuestion.collapse")}
          >
            {isCollapsed ? "\u25B2" : "\u25BC"}
          </button>
        </div>

        {/* Timeout warning */}
        {isTimeWarning && !isCollapsed && (
          <div className="ask-user-question-timeout-banner flex items-center gap-2 py-2 px-3 bg-[rgba(226,163,8,0.12)] border border-[color:var(--warning-text,#e2a308)] rounded-[10px] text-[color:var(--warning-text,#e2a308)] text-xs animate-[ask-dialog-slide-in_0.2s_ease-out]">
            {t("askUserQuestion.timeoutWarning", { seconds: remainingSeconds })}
          </div>
        )}

        {/* Collapsed hint */}
        {isCollapsed ? (
          <div className="ask-user-question-collapsed-hint flex items-center justify-between gap-3">
            <span className="ask-user-question-collapsed-progress text-xs text-[color:var(--text-subtle)]">
              {t("askUserQuestion.progress", {
                current: safeIndex + 1,
                total: questions.length,
              })}
            </span>
            {isTimeWarning && (
              <span className="ask-user-question-collapsed-timer is-warning flex items-center gap-1 text-xs [font-variant-numeric:tabular-nums] text-[color:var(--warning-text,#e2a308)] animate-[ask-timer-pulse_1s_ease-in-out_infinite]">
                {formatCountdown(remainingSeconds)}
              </span>
            )}
            <button
              className={`${btnBase} ${btnPrimary}`}
              onClick={() => setIsCollapsed(false)}
            >
              {t("askUserQuestion.clickToAnswer")}
            </button>
          </div>
        ) : (
          <>
            {/* Progress row */}
            {questions.length > 1 && (
              <div className="ask-user-question-progress-row flex items-center justify-between">
                <span className="ask-user-question-progress text-[11px] text-[color:var(--text-faint)]">
                  {t("askUserQuestion.progress", {
                    current: safeIndex + 1,
                    total: questions.length,
                  })}
                </span>
                <span
                  className={`ask-user-question-timer flex items-center gap-[5px] text-xs py-[3px] px-2 rounded-lg bg-[color:var(--surface-card-muted)] border border-[color:var(--border-subtle)] [font-variant-numeric:tabular-nums] ${
                    isTimeWarning
                      ? "is-warning text-[color:var(--warning-text,#e2a308)] bg-[rgba(226,163,8,0.08)] border-[color:var(--warning-text,#e2a308)] animate-[ask-timer-pulse_1s_ease-in-out_infinite]"
                      : "text-[color:var(--text-subtle)]"
                  }`}
                >
                  {formatCountdown(remainingSeconds)}
                </span>
              </div>
            )}

            {/* Question body */}
            <div className="ask-user-question-body flex flex-col gap-3.5">
              {currentQ.header && (
                <span className="ask-user-question-tag text-[10.5px] font-medium text-[color:var(--primary,#7a9dcc)] bg-[color:color-mix(in_srgb,var(--primary,#7a9dcc)_12%,transparent)] py-0.5 px-2 rounded-md inline-block uppercase tracking-[0.04em] self-start">{currentQ.header}</span>
              )}
              <p className="ask-user-question-text text-[13px] text-[color:var(--text)] leading-normal m-0">{currentQ.question}</p>

              {/* Options */}
              {hasOptions && (
                <div className="ask-user-question-options flex flex-col gap-1.5">
                  {options.map((option, optIdx) => {
                    const isSelected = currentSelections.has(option.label);
                    return (
                      <button
                        key={`${qKey}-opt-${optIdx}`}
                        type="button"
                        className={`ask-user-question-option flex items-start gap-2.5 py-2.5 px-3 border rounded-xl text-left w-full cursor-pointer transition-[border-color,background] duration-150 ${
                          isSelected
                            ? "is-selected border-[rgba(77,163,255,0.7)] bg-[rgba(77,163,255,0.12)]"
                            : "border-[color:var(--border-subtle)] bg-[color:var(--surface-card-muted)] hover:border-[color:color-mix(in_srgb,var(--primary,#7a9dcc)_50%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--primary,#7a9dcc)_6%,transparent)]"
                        }`}
                        onClick={() => handleOptionToggle(option.label)}
                      >
                        {isMultiSelect ? (
                          <span className={`ask-user-question-option-check shrink-0 w-4 h-4 rounded border-2 mt-px flex items-center justify-center text-[10px] transition-[border-color,background] duration-150 ${
                            isSelected
                              ? "is-selected border-[rgba(77,163,255,0.9)] bg-[rgba(77,163,255,0.9)] text-white"
                              : "border-[color:var(--border-subtle)] text-transparent"
                          }`}>
                            {isSelected ? "\u2713" : ""}
                          </span>
                        ) : (
                          <span className={`ask-user-question-option-radio shrink-0 w-4 h-4 rounded-full border-2 mt-px relative transition-[border-color] duration-150 ${
                            isSelected
                              ? "border-[rgba(77,163,255,0.9)] after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:w-1.5 after:h-1.5 after:rounded-full after:bg-[rgba(77,163,255,0.9)]"
                              : "border-[color:var(--border-subtle)]"
                          }`} />
                        )}
                        <span className="ask-user-question-option-content flex-1 flex flex-col gap-0.5">
                          <span className="ask-user-question-option-label text-xs font-semibold text-[color:var(--text-strong)]">{option.label}</span>
                          {option.description && (
                            <span className="ask-user-question-option-desc text-[11px] text-[color:var(--text-subtle)] leading-snug">{option.description}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}

                  {/* "Other" option */}
                  {currentQ.isOther !== false && (
                    <button
                      type="button"
                      className={`ask-user-question-option is-other flex items-start gap-2.5 py-2.5 px-3 border border-dashed rounded-xl text-left w-full cursor-pointer transition-[border-color,background] duration-150 ${
                        isOtherSelected
                          ? "is-selected border-[rgba(77,163,255,0.7)] bg-[rgba(77,163,255,0.12)]"
                          : "border-[color:var(--border-subtle)] bg-[color:var(--surface-card-muted)] hover:border-[color:color-mix(in_srgb,var(--primary,#7a9dcc)_50%,transparent)] hover:bg-[color:color-mix(in_srgb,var(--primary,#7a9dcc)_6%,transparent)]"
                      }`}
                      onClick={() => handleOptionToggle(OTHER_OPTION_MARKER)}
                    >
                      {isMultiSelect ? (
                        <span className={`ask-user-question-option-check shrink-0 w-4 h-4 rounded border-2 mt-px flex items-center justify-center text-[10px] transition-[border-color,background] duration-150 ${
                          isOtherSelected
                            ? "is-selected border-[rgba(77,163,255,0.9)] bg-[rgba(77,163,255,0.9)] text-white"
                            : "border-[color:var(--border-subtle)] text-transparent"
                        }`}>
                          {isOtherSelected ? "\u2713" : ""}
                        </span>
                      ) : (
                        <span className={`ask-user-question-option-radio shrink-0 w-4 h-4 rounded-full border-2 mt-px relative transition-[border-color] duration-150 ${
                          isOtherSelected
                            ? "border-[rgba(77,163,255,0.9)] after:content-[''] after:absolute after:top-[3px] after:left-[3px] after:w-1.5 after:h-1.5 after:rounded-full after:bg-[rgba(77,163,255,0.9)]"
                            : "border-[color:var(--border-subtle)]"
                        }`} />
                      )}
                      <span className="ask-user-question-option-content flex-1 flex flex-col gap-0.5">
                        <span className="ask-user-question-option-label text-xs font-semibold text-[color:var(--primary,#7a9dcc)]">
                          {t("askUserQuestion.otherOption")}
                        </span>
                        <span className="ask-user-question-option-desc text-[11px] text-[color:var(--text-subtle)] leading-snug">
                          {t("askUserQuestion.otherOptionDesc")}
                        </span>
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Custom input for "Other" or plain text questions */}
              {(isOtherSelected || !hasOptions) && !currentQ.isSecret && (
                <textarea
                  ref={customInputRef}
                  className="ask-user-question-custom-input w-full min-h-[64px] py-2.5 px-3 border border-[rgba(77,163,255,0.4)] rounded-[10px] bg-[color:var(--surface-card-muted)] text-[color:var(--text-strong)] font-[inherit] text-xs leading-[1.4] resize-y box-border focus:outline-2 focus:[outline-color:rgba(77,163,255,0.35)] focus:[outline-offset:1px] placeholder:text-[color:var(--text-faint)]"
                  value={currentCustom}
                  onChange={(e) => handleCustomChange(e.target.value)}
                  placeholder={
                    hasOptions
                      ? t("askUserQuestion.customInputPlaceholder")
                      : t("approval.typeAnswerOptional")
                  }
                  rows={3}
                  maxLength={MAX_CUSTOM_INPUT_LENGTH}
                />
              )}

              {/* Secret field */}
              {currentQ.isSecret && (
                <div className="ask-user-question-secret-row flex gap-1.5 items-center">
                  <input
                    className="ask-user-question-custom-input w-full py-2 px-3 border border-[rgba(77,163,255,0.4)] rounded-[10px] bg-[color:var(--surface-card-muted)] text-[color:var(--text-strong)] font-[inherit] text-xs leading-[1.4] box-border focus:outline-2 focus:[outline-color:rgba(77,163,255,0.35)] focus:[outline-offset:1px] placeholder:text-[color:var(--text-faint)]"
                    type={currentSecretVis ? "text" : "password"}
                    placeholder={t("approval.typeAnswerOptional")}
                    value={currentCustom}
                    onChange={(e) => handleCustomChange(e.target.value)}
                  />
                  <button
                    type="button"
                    className="ask-user-question-secret-toggle border border-[color:var(--border-subtle)] rounded-[10px] bg-[color:var(--surface-card-muted)] text-[color:var(--text-subtle)] text-[11px] py-1 px-2 cursor-pointer hover:text-[color:var(--text-strong)]"
                    onClick={handleToggleSecret}
                  >
                    {currentSecretVis ? t("approval.hideSecret") : t("approval.showSecret")}
                  </button>
                </div>
              )}

              {isMultiSelect && (
                <p className="ask-user-question-hint text-[11px] text-[color:var(--text-faint)] m-0">
                  {t("askUserQuestion.multiSelectHint")}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="ask-user-question-actions flex justify-between items-center gap-2.5">
              <button
                className={`${btnBase} ${btnSecondary}`}
                onClick={handleCancel}
              >
                {t("askUserQuestion.cancel")}
              </button>

              <div className="ask-user-question-actions-right flex gap-2">
                {submitError && (
                  <span className="ask-user-question-error text-[11px] text-[color:var(--error-text,#ef4444)]">{submitError}</span>
                )}
                {safeIndex > 0 && (
                  <button
                    className={`${btnBase} ${btnSecondary}`}
                    onClick={handleBack}
                  >
                    {t("askUserQuestion.back")}
                  </button>
                )}
                <button
                  className={`${btnBase} ${btnPrimary}`}
                  onClick={() => void handleNext()}
                  disabled={!canProceed || isSubmitting}
                >
                  {isLastQuestion
                    ? t("askUserQuestion.submit")
                    : t("askUserQuestion.next")}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
