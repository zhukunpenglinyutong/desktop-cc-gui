import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import type { RequestUserInputRequest } from "../../../types";

export const USER_INPUT_OTHER_OPTION_MARKER = "__OTHER__";

export type UserInputSelectionState = Record<string, Set<string>>;
export type UserInputNotesState = Record<string, string>;
export type UserInputSecretVisibilityState = Record<string, boolean>;

type UserInputQuestionCardFlavor = "request" | "ask";

type UserInputQuestionCardProps = {
  flavor: UserInputQuestionCardFlavor;
  id?: string;
  role: "group" | "dialog";
  tabIndex?: number;
  className?: string;
  title: string;
  queueLabel?: string | null;
  questions: RequestUserInputRequest["params"]["questions"];
  activeQuestionIndex: number;
  remainingSecondsLabel: string;
  isTimeWarning: boolean;
  selections: UserInputSelectionState;
  notes: UserInputNotesState;
  secretVisible: UserInputSecretVisibilityState;
  submitError?: string | null;
  isSubmitting: boolean;
  includeOtherOption?: boolean;
  canProceed?: boolean;
  showStepActions?: boolean;
  customInputRef?: RefObject<HTMLTextAreaElement | null>;
  dataAttributes?: Record<string, string | number | undefined | null>;
  onQuestionTabChange: (nextQuestionIndex: number) => void;
  onOptionToggle: (questionId: string, optionKey: string, multiSelect: boolean) => void;
  onNotesChange: (questionId: string, value: string) => void;
  onToggleSecret: (questionId: string) => void;
  onBack?: () => void;
  onNext?: () => void;
  onDismiss: () => void;
  onSubmit: () => void;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function getUserInputQuestionKey(
  question: RequestUserInputRequest["params"]["questions"][number],
  index: number,
) {
  return question.id || `question-${index}`;
}

export function getUserInputOptionValue(
  option: NonNullable<RequestUserInputRequest["params"]["questions"][number]["options"]>[number],
  index: number,
) {
  return option.label?.trim() || option.description?.trim() || `option-${index + 1}`;
}

export function getUserInputOptionKey(index: number) {
  return `option-${index}`;
}

function getFlavorClass(flavor: UserInputQuestionCardFlavor, suffix: string) {
  return flavor === "ask"
    ? `ask-user-question-${suffix}`
    : `request-user-input-${suffix}`;
}

export function UserInputQuestionCard({
  flavor,
  id,
  role,
  tabIndex,
  className,
  title,
  queueLabel,
  questions,
  activeQuestionIndex,
  remainingSecondsLabel,
  isTimeWarning,
  selections,
  notes,
  secretVisible,
  submitError,
  isSubmitting,
  includeOtherOption = false,
  canProceed = true,
  showStepActions = false,
  customInputRef,
  dataAttributes,
  onQuestionTabChange,
  onOptionToggle,
  onNotesChange,
  onToggleSecret,
  onBack,
  onNext,
  onDismiss,
  onSubmit,
}: UserInputQuestionCardProps) {
  const { t } = useTranslation();
  const safeQuestionIndex = Math.min(
    Math.max(activeQuestionIndex, 0),
    Math.max(questions.length - 1, 0),
  );
  const activeQuestion = questions[safeQuestionIndex] ?? null;
  const usesStepActions = showStepActions || questions.length > 1;
  const isLastQuestion = safeQuestionIndex === questions.length - 1;
  const rootClass = getFlavorClass(flavor, "card");
  const closeClass =
    flavor === "ask"
      ? "ask-user-question-close-btn"
      : "request-user-input-close";
  const dismissLabel = t("approval.dismissUserInputRequest");

  const dataProps = Object.fromEntries(
    Object.entries(dataAttributes ?? {})
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)]),
  );

  const handlePrimaryAction = () => {
    if (!usesStepActions) {
      onSubmit();
      return;
    }
    if (!isLastQuestion) {
      if (onNext) {
        onNext();
        return;
      }
      onQuestionTabChange(safeQuestionIndex + 1);
      return;
    }
    if (showStepActions && onNext) {
      onNext();
      return;
    }
    onSubmit();
  };

  return (
    <div
      id={id}
      className={cx("user-input-question-card", rootClass, className)}
      role={role}
      aria-modal={role === "dialog" ? true : undefined}
      tabIndex={tabIndex}
      aria-label={t("approval.userInputRequested")}
      {...dataProps}
    >
      <div className={cx("user-input-question-header", getFlavorClass(flavor, "header"))}>
        <div className={cx("user-input-question-title", getFlavorClass(flavor, "title"))}>
          {title}
          {queueLabel ? (
            <span className={cx("user-input-question-queue", getFlavorClass(flavor, "queue"))}>
              {queueLabel}
            </span>
          ) : null}
        </div>
        <div
          className={cx(
            "user-input-question-timer",
            getFlavorClass(flavor, "timer"),
            isTimeWarning && "is-warning",
          )}
          aria-hidden="true"
        >
          {remainingSecondsLabel}
        </div>
        <button
          className={cx("user-input-question-close", closeClass)}
          type="button"
          onClick={onDismiss}
          disabled={isSubmitting}
          aria-label={flavor === "ask" ? dismissLabel : t("approval.close")}
          title={dismissLabel}
        >
          ×
        </button>
      </div>

      {questions.length > 1 ? (
        <div className={cx("user-input-question-tabs", getFlavorClass(flavor, "tabs"))} role="tablist">
          {questions.map((question, index) => {
            const questionId = getUserInputQuestionKey(question, index);
            const tabLabel =
              question.header?.trim() ||
              t("askUserQuestion.questionTab", { index: index + 1 });
            const isActive = index === safeQuestionIndex;
            return (
              <button
                key={questionId}
                type="button"
                className={cx(
                  "user-input-question-tab",
                  getFlavorClass(flavor, "tab"),
                  isActive && "is-active",
                )}
                role="tab"
                aria-selected={isActive}
                aria-label={`${index + 1} ${tabLabel}`}
                onClick={() => onQuestionTabChange(index)}
              >
                <span className={cx("user-input-question-tab-index", getFlavorClass(flavor, "tab-index"))}>
                  {index + 1}
                </span>
                <span className={cx("user-input-question-tab-label", getFlavorClass(flavor, "tab-label"))}>
                  {tabLabel}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={cx("user-input-question-body", getFlavorClass(flavor, "body"))}>
        {activeQuestion ? (
          (() => {
            const questionId = getUserInputQuestionKey(activeQuestion, safeQuestionIndex);
            const selectedValues = selections[questionId] ?? new Set<string>();
            const options = activeQuestion.options ?? [];
            const hasOptions = options.length > 0;
            const isOtherSelected = selectedValues.has(USER_INPUT_OTHER_OPTION_MARKER);
            const notePlaceholder = activeQuestion.isOther
              ? t("approval.typeAnswerOptional")
              : hasOptions
                ? t("approval.addNotesOptional")
                : t("approval.typeAnswerOptional");

            return (
              <section className={cx("user-input-question-section", getFlavorClass(flavor, "question"))}>
                {activeQuestion.header ? (
                  <div className={cx("user-input-question-tag", getFlavorClass(flavor, "question-header"), getFlavorClass(flavor, "tag"))}>
                    {activeQuestion.header}
                  </div>
                ) : null}
                <div className={cx("user-input-question-text", getFlavorClass(flavor, "question-text"), flavor === "ask" && "ask-user-question-text")}>
                  {activeQuestion.question}
                </div>
                {hasOptions ? (
                  <div className={cx("user-input-question-options", getFlavorClass(flavor, "options"))}>
                    {options.map((option, optionIndex) => {
                      const optionKey = getUserInputOptionKey(optionIndex);
                      const isSelected = selectedValues.has(optionKey);
                      return (
                        <button
                          key={`${questionId}-${optionKey}`}
                          type="button"
                          className={cx(
                            "user-input-question-option",
                            getFlavorClass(flavor, "option"),
                            isSelected && "is-selected",
                          )}
                          onClick={() =>
                            onOptionToggle(
                              questionId,
                              optionKey,
                              activeQuestion.multiSelect === true,
                            )
                          }
                        >
                          <span className={cx("user-input-question-option-label", getFlavorClass(flavor, "option-label"))}>
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className={cx("user-input-question-option-description", getFlavorClass(flavor, flavor === "ask" ? "option-desc" : "option-description"))}>
                              {option.description}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                    {includeOtherOption && activeQuestion.isOther !== false ? (
                      <button
                        type="button"
                        className={cx(
                          "user-input-question-option",
                          getFlavorClass(flavor, "option"),
                          "is-other",
                          isOtherSelected && "is-selected",
                        )}
                        onClick={() =>
                          onOptionToggle(
                            questionId,
                            USER_INPUT_OTHER_OPTION_MARKER,
                            activeQuestion.multiSelect === true,
                          )
                        }
                      >
                        <span className={cx("user-input-question-option-label", getFlavorClass(flavor, "option-label"))}>
                          {t("askUserQuestion.otherOption")}
                        </span>
                        <span className={cx("user-input-question-option-description", getFlavorClass(flavor, flavor === "ask" ? "option-desc" : "option-description"))}>
                          {t("askUserQuestion.otherOptionDesc")}
                        </span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {activeQuestion.isSecret ? (
                  <div className={cx("user-input-question-secret-field", getFlavorClass(flavor, "secret-field"), getFlavorClass(flavor, "secret-row"))}>
                    <input
                      className={cx("user-input-question-notes", getFlavorClass(flavor, flavor === "ask" ? "custom-input" : "notes"))}
                      type={secretVisible[questionId] ? "text" : "password"}
                      placeholder={notePlaceholder}
                      value={notes[questionId] ?? ""}
                      onChange={(event) => onNotesChange(questionId, event.target.value)}
                    />
                    <button
                      type="button"
                      className={cx("user-input-question-toggle-secret", getFlavorClass(flavor, flavor === "ask" ? "secret-toggle" : "toggle-secret"))}
                      onClick={() => onToggleSecret(questionId)}
                    >
                      {secretVisible[questionId]
                        ? t("approval.hideSecret")
                        : t("approval.showSecret")}
                    </button>
                  </div>
                ) : (
                  <textarea
                    ref={customInputRef}
                    className={cx("user-input-question-notes", getFlavorClass(flavor, flavor === "ask" ? "custom-input" : "notes"))}
                    placeholder={
                      includeOtherOption && hasOptions && isOtherSelected
                        ? t("askUserQuestion.customInputPlaceholder")
                        : notePlaceholder
                    }
                    value={notes[questionId] ?? ""}
                    onChange={(event) => onNotesChange(questionId, event.target.value)}
                    rows={flavor === "ask" ? 3 : 2}
                  />
                )}
              </section>
            );
          })()
        ) : (
          <div className={cx("user-input-question-empty", getFlavorClass(flavor, "empty"))}>
            {t("approval.noQuestionsProvided")}
          </div>
        )}
      </div>

      <div className={cx("user-input-question-actions", getFlavorClass(flavor, "actions"))}>
        {submitError ? (
          <div className={cx("user-input-question-error", getFlavorClass(flavor, "error"))}>
            {submitError}
          </div>
        ) : null}
        <button
          className={cx("user-input-question-dismiss", flavor === "ask" ? "ask-user-question-btn is-secondary" : "request-user-input-dismiss")}
          type="button"
          onClick={onDismiss}
          disabled={isSubmitting}
          aria-label={dismissLabel}
          title={dismissLabel}
        >
          {flavor === "ask" ? t("askUserQuestion.cancel") : t("approval.dismiss")}
        </button>
        <div className={cx("user-input-question-actions-right", getFlavorClass(flavor, "actions-right"))}>
          {usesStepActions && safeQuestionIndex > 0 ? (
            <button
              className="ask-user-question-btn is-secondary"
              type="button"
              onClick={onBack ?? (() => onQuestionTabChange(safeQuestionIndex - 1))}
              disabled={isSubmitting}
            >
              {t("askUserQuestion.back")}
            </button>
          ) : null}
          <button
            className={flavor === "ask" ? "ask-user-question-btn is-primary" : "primary"}
            type="button"
            onClick={handlePrimaryAction}
            disabled={isSubmitting || (usesStepActions && !canProceed)}
          >
            {usesStepActions
              ? isLastQuestion
                ? t("askUserQuestion.submit")
                : t("askUserQuestion.next")
              : t("approval.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
