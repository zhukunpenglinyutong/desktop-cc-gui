import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  RequestUserInputRequest,
  RequestUserInputResponse,
} from "../../../types";
import {
  getUserInputOptionKey,
  getUserInputOptionValue,
  getUserInputQuestionKey,
  UserInputQuestionCard,
  type UserInputNotesState,
  type UserInputSecretVisibilityState,
  type UserInputSelectionState,
} from "./UserInputQuestionCard";

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

type RequestDraftState = {
  selections: UserInputSelectionState;
  notes: UserInputNotesState;
  secretVisible: UserInputSecretVisibilityState;
  activeQuestionIndex: number;
};

const REQUEST_STALE_TIMEOUT_SECONDS = 300;
const REQUEST_STALE_WARNING_SECONDS = 30;

function getRequestDraftKey(request: RequestUserInputRequest) {
  return `${request.workspace_id}:${String(request.request_id)}`;
}

function formatRequestCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function RequestUserInputMessage({
  requests,
  activeThreadId,
  activeWorkspaceId,
  onSubmit,
  onDismiss,
}: RequestUserInputMessageProps) {
  const { t } = useTranslation();
  const [locallyDismissedRequestKeys, setLocallyDismissedRequestKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const activeRequests = useMemo(
    () =>
      requests.filter((request) => {
        const requestKey = getRequestDraftKey(request);
        if (locallyDismissedRequestKeys.has(requestKey)) {
          return false;
        }
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
    [requests, activeThreadId, activeWorkspaceId, locallyDismissedRequestKeys],
  );
  useEffect(() => {
    setLocallyDismissedRequestKeys((current) => {
      if (current.size === 0) {
        return current;
      }
      const liveRequestKeys = new Set(requests.map(getRequestDraftKey));
      let changed = false;
      const next = new Set<string>();
      current.forEach((requestKey) => {
        if (liveRequestKeys.has(requestKey)) {
          next.add(requestKey);
        } else {
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [requests]);
  const activeRequest = activeRequests[0];
  const activeRequestKey = activeRequest ? getRequestDraftKey(activeRequest) : null;
  const [draftByRequest, setDraftByRequest] = useState<
    Record<string, RequestDraftState>
  >({});
  const [remainingSecondsByRequest, setRemainingSecondsByRequest] = useState<
    Record<string, number>
  >({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const timeoutDismissedRequestKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeRequest) {
      return;
    }
    const requestKey = activeRequestKey;
    if (!requestKey) {
      return;
    }
    setDraftByRequest((current) => {
      if (current[requestKey]) {
        return current;
      }
      const nextSelections: UserInputSelectionState = {};
      const nextNotes: UserInputNotesState = {};
      const nextSecretVisible: UserInputSecretVisibilityState = {};
      activeRequest.params.questions.forEach((question, index) => {
        const key = getUserInputQuestionKey(question, index);
        nextSelections[key] = new Set<string>();
        nextNotes[key] = "";
        nextSecretVisible[key] = false;
      });
      return {
        ...current,
        [requestKey]: {
          selections: nextSelections,
          notes: nextNotes,
          secretVisible: nextSecretVisible,
          activeQuestionIndex: 0,
        },
      };
    });
    setRemainingSecondsByRequest((current) => {
      if (typeof current[requestKey] === "number") {
        return current;
      }
      return {
        ...current,
        [requestKey]: REQUEST_STALE_TIMEOUT_SECONDS,
      };
    });
  }, [activeRequest, activeRequestKey]);

  useEffect(() => {
    setSubmitError(null);
    setIsSubmitting(false);
  }, [activeRequestKey]);

  useEffect(() => {
    if (!activeRequestKey || isSubmitting || submitError) {
      return undefined;
    }
    const timerId = window.setInterval(() => {
      setRemainingSecondsByRequest((current) => {
        const currentSeconds =
          current[activeRequestKey] ?? REQUEST_STALE_TIMEOUT_SECONDS;
        if (currentSeconds <= 0) {
          return current;
        }
        return {
          ...current,
          [activeRequestKey]: currentSeconds - 1,
        };
      });
    }, 1000);
    return () => {
      window.clearInterval(timerId);
    };
  }, [activeRequestKey, isSubmitting, submitError]);

  const activeRemainingSeconds = activeRequestKey
    ? remainingSecondsByRequest[activeRequestKey] ?? REQUEST_STALE_TIMEOUT_SECONDS
    : REQUEST_STALE_TIMEOUT_SECONDS;

  useEffect(() => {
    if (
      !activeRequest ||
      !activeRequestKey ||
      !onDismiss ||
      isSubmitting ||
      submitError ||
      activeRemainingSeconds > 0 ||
      timeoutDismissedRequestKeysRef.current.has(activeRequestKey)
    ) {
      return;
    }
    timeoutDismissedRequestKeysRef.current.add(activeRequestKey);
    setDraftByRequest((current) => {
      if (!current[activeRequestKey]) {
        return current;
      }
      const next = { ...current };
      delete next[activeRequestKey];
      return next;
    });
    setRemainingSecondsByRequest((current) => {
      if (typeof current[activeRequestKey] !== "number") {
        return current;
      }
      const next = { ...current };
      delete next[activeRequestKey];
      return next;
    });
    setLocallyDismissedRequestKeys((current) => {
      if (current.has(activeRequestKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(activeRequestKey);
      return next;
    });
    onDismiss(activeRequest);
  }, [
    activeRemainingSeconds,
    activeRequest,
    activeRequestKey,
    isSubmitting,
    onDismiss,
    submitError,
  ]);

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
  const safeActiveQuestionIndex = Math.min(
    Math.max(requestDraft?.activeQuestionIndex ?? 0, 0),
    Math.max(questions.length - 1, 0),
  );
  const isStaleWarning =
    activeRemainingSeconds <= REQUEST_STALE_WARNING_SECONDS &&
    activeRemainingSeconds > 0;

  const buildAnswers = () => {
    const answers: RequestUserInputResponse["answers"] = {};
    questions.forEach((question, index) => {
      if (!question.id) {
        return;
      }
      const answerList: string[] = [];
      const key = getUserInputQuestionKey(question, index);
      const selectedValues = selections[key] ?? new Set<string>();
      const options = question.options ?? [];
      const hasOptions = options.length > 0;
      if (hasOptions && selectedValues.size > 0) {
        options.forEach((option, optionIndex) => {
          if (!selectedValues.has(getUserInputOptionKey(optionIndex))) {
            return;
          }
          answerList.push(getUserInputOptionValue(option, optionIndex));
        });
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

  const handleOptionToggle = (
    questionId: string,
    optionKey: string,
    multiSelect: boolean,
  ) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      const currentSelected = draft.selections[questionId] ?? new Set<string>();
      const nextSelected = new Set(currentSelected);
      if (multiSelect) {
        if (nextSelected.has(optionKey)) {
          nextSelected.delete(optionKey);
        } else {
          nextSelected.add(optionKey);
        }
      } else if (nextSelected.size === 1 && nextSelected.has(optionKey)) {
        nextSelected.clear();
      } else {
        nextSelected.clear();
        nextSelected.add(optionKey);
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

  const handleQuestionTabChange = (nextQuestionIndex: number) => {
    setDraftByRequest((current) => {
      const draft = current[requestKey];
      if (!draft) {
        return current;
      }
      return {
        ...current,
        [requestKey]: {
          ...draft,
          activeQuestionIndex: nextQuestionIndex,
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
      setRemainingSecondsByRequest((current) => {
        if (typeof current[requestKey] !== "number") {
          return current;
        }
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
    timeoutDismissedRequestKeysRef.current.delete(requestKey);
    setLocallyDismissedRequestKeys((current) => {
      if (current.has(requestKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(requestKey);
      return next;
    });
    setDraftByRequest((current) => {
      if (!current[requestKey]) {
        return current;
      }
      const next = { ...current };
      delete next[requestKey];
      return next;
    });
    setRemainingSecondsByRequest((current) => {
      if (typeof current[requestKey] !== "number") {
        return current;
      }
      const next = { ...current };
      delete next[requestKey];
      return next;
    });
    onDismiss?.(activeRequest);
  };

  return (
    <div className="message request-user-input-message">
      <UserInputQuestionCard
        id={requestAnchorId}
        flavor="request"
        className="request-user-input-live-card"
        role="group"
        tabIndex={-1}
        title={t("approval.inputRequested")}
        queueLabel={
          totalRequests > 1
            ? t("approval.requestOf", { current: 1, total: totalRequests })
            : null
        }
        questions={questions}
        activeQuestionIndex={safeActiveQuestionIndex}
        remainingSecondsLabel={formatRequestCountdown(activeRemainingSeconds)}
        isTimeWarning={isStaleWarning}
        selections={selections}
        notes={notes}
        secretVisible={secretVisible}
        submitError={submitError}
        isSubmitting={isSubmitting}
        dataAttributes={{
          "data-request-user-input-id": String(activeRequest.request_id),
          "data-request-user-input-key": requestKey,
          "data-workspace-id": activeRequest.workspace_id,
          "data-thread-id": activeRequest.params.thread_id,
        }}
        onQuestionTabChange={handleQuestionTabChange}
        onOptionToggle={handleOptionToggle}
        onNotesChange={handleNotesChange}
        onToggleSecret={handleToggleSecretVisible}
        onDismiss={handleDismiss}
        onSubmit={() => void handleSubmit()}
      />
    </div>
  );
}
