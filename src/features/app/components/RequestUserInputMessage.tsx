import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";

type RequestUserInputMessageProps = {
  requests: RequestUserInputRequest[];
  activeThreadId: string | null;
  activeWorkspaceId?: string | null;
  onSubmit: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => Promise<void> | void;
  onDismiss?: (request: RequestUserInputRequest) => void;
};

type SelectionState = Record<string, Set<number>>;
type NotesState = Record<string, string>;
type SecretVisibilityState = Record<string, boolean>;
type RequestDraftState = {
  selections: SelectionState;
  notes: NotesState;
  secretVisible: SecretVisibilityState;
};

function getRequestDraftKey(request: RequestUserInputRequest) {
  return `${request.workspace_id}:${String(request.request_id)}`;
}

export function RequestUserInputMessage({
  requests,
  activeThreadId,
  activeWorkspaceId,
  onSubmit,
  onDismiss,
}: RequestUserInputMessageProps) {
  const { t } = useTranslation();
  const activeRequests = useMemo(
    () =>
      requests.filter((request) => {
        if (!activeThreadId) {
          return false;
        }
        if (request.params.thread_id !== activeThreadId) {
          return false;
        }
        if (activeWorkspaceId && request.workspace_id !== activeWorkspaceId) {
          return false;
        }
        return true;
      }),
    [requests, activeThreadId, activeWorkspaceId],
  );
  const activeRequest = activeRequests[0];
  const [draftByRequest, setDraftByRequest] = useState<
    Record<string, RequestDraftState>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeRequest) {
      return;
    }
    const requestKey = getRequestDraftKey(activeRequest);
    setDraftByRequest((current) => {
      if (current[requestKey]) {
        return current;
      }
      const nextSelections: SelectionState = {};
      const nextNotes: NotesState = {};
      const nextSecretVisible: SecretVisibilityState = {};
      activeRequest.params.questions.forEach((question, index) => {
        const key = question.id || `question-${index}`;
        nextSelections[key] = new Set<number>();
        nextNotes[key] = "";
        nextSecretVisible[key] = false;
      });
      return {
        ...current,
        [requestKey]: {
          selections: nextSelections,
          notes: nextNotes,
          secretVisible: nextSecretVisible,
        },
      };
    });
  }, [activeRequest]);

  useEffect(() => {
    setSubmitError(null);
    setIsSubmitting(false);
  }, [activeRequest]);

  if (!activeRequest) {
    return null;
  }

  const { questions } = activeRequest.params;
  const totalRequests = activeRequests.length;
  const requestKey = getRequestDraftKey(activeRequest);
  const requestAnchorId = `request-user-input-${encodeURIComponent(requestKey)}`;
  const requestDraft = draftByRequest[requestKey];
  const selections = requestDraft?.selections ?? {};
  const notes = requestDraft?.notes ?? {};
  const secretVisible = requestDraft?.secretVisible ?? {};

  const buildAnswers = () => {
    const answers: RequestUserInputResponse["answers"] = {};
    questions.forEach((question, index) => {
      if (!question.id) {
        return;
      }
      const answerList: string[] = [];
      const key = question.id || `question-${index}`;
      const selectedIndex = selections[key] ?? new Set<number>();
      const options = question.options ?? [];
      const hasOptions = options.length > 0;
      if (hasOptions && selectedIndex.size > 0) {
        const sortedIndexes = Array.from(selectedIndex).sort((left, right) => left - right);
        for (const index of sortedIndexes) {
          const selected = options[index];
          const selectedValue =
            selected?.label?.trim() || selected?.description?.trim() || "";
          if (selectedValue) {
            answerList.push(selectedValue);
          }
        }
      }
      const note = (notes[key] ?? "").trim();
      if (note) {
        if (hasOptions) {
          answerList.push(`user_note: ${note}`);
        } else {
          answerList.push(note);
        }
      }
      answers[question.id] = { answers: answerList };
    });
    return answers;
  };

  const handleSelect = (
    questionId: string,
    optionIndex: number,
    multiSelect: boolean,
  ) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      const currentSelected = draft.selections[questionId] ?? new Set<number>();
      const nextSelected = new Set(currentSelected);
      if (multiSelect) {
        if (nextSelected.has(optionIndex)) {
          nextSelected.delete(optionIndex);
        } else {
          nextSelected.add(optionIndex);
        }
      } else if (nextSelected.size === 1 && nextSelected.has(optionIndex)) {
        nextSelected.clear();
      } else {
        nextSelected.clear();
        nextSelected.add(optionIndex);
      }
      return {
        ...current,
        [requestKey]: {
          ...draft,
          selections: {
            ...draft.selections,
            [questionId]: nextSelected,
          },
        },
      };
    });
  };

  const handleNotesChange = (questionId: string, value: string) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      return {
        ...current,
        [requestKey]: {
          ...draft,
          notes: { ...draft.notes, [questionId]: value },
        },
      };
    });
  };

  const handleToggleSecretVisible = (questionId: string) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      const currentVisible = Boolean(draft.secretVisible[questionId]);
      return {
        ...current,
        [requestKey]: {
          ...draft,
          secretVisible: {
            ...draft.secretVisible,
            [questionId]: !currentVisible,
          },
        },
      };
    });
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit(activeRequest, { answers: buildAnswers() });
      setDraftByRequest((current) => {
        const next = { ...current };
        delete next[requestKey];
        return next;
      });
    } catch {
      setSubmitError(t("approval.submitFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismiss = () => {
    setSubmitError(null);
    setDraftByRequest((current) => {
      if (!current[requestKey]) {
        return current;
      }
      const next = { ...current };
      delete next[requestKey];
      return next;
    });
    onDismiss?.(activeRequest);
  };

  return (
    <div className="message request-user-input-message items-start">
      <div
        id={requestAnchorId}
        className="bubble request-user-input-card w-[min(520px,72%)] max-w-full bg-[color:var(--surface-card-strong)] border border-[color:var(--border-stronger)] rounded-2xl py-2.5 px-3 flex flex-col gap-2"
        role="group"
        tabIndex={-1}
        data-request-user-input-id={String(activeRequest.request_id)}
        data-request-user-input-key={requestKey}
        data-workspace-id={activeRequest.workspace_id}
        data-thread-id={activeRequest.params.thread_id}
        aria-label={t("approval.userInputRequested")}
      >
        <div className="request-user-input-header flex justify-between items-baseline gap-2">
          <div className="request-user-input-title text-[13px] font-semibold text-[color:var(--text-strong)]">{t("approval.inputRequested")}</div>
          {totalRequests > 1 ? (
            <div className="request-user-input-queue text-[11px] text-[color:var(--text-subtle)]">
              {t("approval.requestOf", { current: 1, total: totalRequests })}
            </div>
          ) : null}
        </div>
        <div className="request-user-input-body grid gap-2">
          {questions.length ? (
            questions.map((question, index) => {
              const questionId = question.id || `question-${index}`;
              const selectedIndex = selections[questionId];
              const options = question.options ?? [];
              const notePlaceholder = question.isOther
                ? t("approval.typeAnswerOptional")
                : options.length
                ? t("approval.addNotesOptional")
                : t("approval.typeAnswerOptional");
              return (
                <section key={questionId} className="request-user-input-question grid gap-1">
                  {question.header ? (
                    <div className="request-user-input-question-header text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--text-faint)]">
                      {question.header}
                    </div>
                  ) : null}
                  <div className="request-user-input-question-text text-xs text-[color:var(--text)]">
                    {question.question}
                  </div>
                  {options.length ? (
                    <div className="request-user-input-options grid gap-1">
                      {options.map((option, optionIndex) => {
                        const isSelected = Boolean(selectedIndex?.has(optionIndex));
                        return (
                        <button
                          key={`${questionId}-${optionIndex}`}
                          type="button"
                          className={`request-user-input-option${
                            isSelected ? " is-selected" : ""
                          } border rounded-xl py-1.5 px-2 text-left grid gap-0.5 transition-[border-color,background] duration-150 ${
                            isSelected
                              ? "border-[rgba(77,163,255,0.7)] bg-[rgba(77,163,255,0.12)]"
                              : "border-[color:var(--border-subtle)] bg-[color:var(--surface-card-muted)]"
                          }`}
                          onClick={() =>
                            handleSelect(
                              questionId,
                              optionIndex,
                              question.multiSelect === true,
                            )
                          }
                        >
                          <div className="request-user-input-option-label text-xs font-semibold text-[color:var(--text-strong)]">
                            {option.label}
                          </div>
                          {option.description ? (
                            <div className="request-user-input-option-description text-[11px] text-[color:var(--text-subtle)]">
                              {option.description}
                            </div>
                          ) : null}
                        </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {question.isSecret ? (
                    <div className="request-user-input-secret-field flex gap-1.5 items-center">
                      <input
                        className="request-user-input-notes rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-muted)] text-[color:var(--text-strong)] py-1.5 px-2 text-xs leading-snug focus:outline-2 focus:[outline-color:rgba(77,163,255,0.35)] focus:[outline-offset:1px]"
                        type={secretVisible[questionId] ? "text" : "password"}
                        placeholder={notePlaceholder}
                        value={notes[questionId] ?? ""}
                        onChange={(event) =>
                          handleNotesChange(questionId, event.target.value)
                        }
                      />
                      <button
                        type="button"
                        className="request-user-input-toggle-secret border border-[color:var(--border-subtle)] rounded-[10px] bg-[color:var(--surface-card-muted)] text-[color:var(--text-subtle)] text-[11px] py-1 px-2 cursor-pointer hover:text-[color:var(--text-strong)]"
                        onClick={() => handleToggleSecretVisible(questionId)}
                      >
                        {secretVisible[questionId]
                          ? t("approval.hideSecret")
                          : t("approval.showSecret")}
                      </button>
                    </div>
                  ) : (
                    <textarea
                      className="request-user-input-notes rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-muted)] text-[color:var(--text-strong)] py-1.5 px-2 text-xs leading-snug resize-y focus:outline-2 focus:[outline-color:rgba(77,163,255,0.35)] focus:[outline-offset:1px]"
                      placeholder={notePlaceholder}
                      value={notes[questionId] ?? ""}
                      onChange={(event) => handleNotesChange(questionId, event.target.value)}
                      rows={2}
                    />
                  )}
                </section>
              );
            })
          ) : (
            <div className="request-user-input-empty text-xs text-[color:var(--text-muted)]">
              {t("approval.noQuestionsProvided")}
            </div>
          )}
        </div>
        <div className="request-user-input-actions flex items-center justify-end gap-2">
          {submitError ? (
            <div className="request-user-input-error text-[11px] text-[color:var(--error-text,#ef4444)]">{submitError}</div>
          ) : null}
          {onDismiss ? (
            <button
              className="request-user-input-dismiss border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-subtle)] rounded-[10px] text-xs font-semibold leading-none py-2 px-2.5 enabled:hover:border-[color:var(--border-stronger)] enabled:hover:text-[color:var(--text)] disabled:cursor-not-allowed disabled:opacity-[0.58]"
              type="button"
              onClick={handleDismiss}
              disabled={isSubmitting}
              aria-label={t("approval.dismissUserInputRequest")}
              title={t("approval.dismissUserInputRequest")}
            >
              {t("approval.dismiss")}
            </button>
          ) : null}
          <button className="primary" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {t("approval.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
