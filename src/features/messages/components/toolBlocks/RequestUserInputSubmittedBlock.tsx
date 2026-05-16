import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationItem } from '../../../../types';

type SubmittedQuestion = {
  id: string;
  header: string;
  question: string;
  options?: Array<{ label: string; description: string }>;
  selectedOptions: string[];
  note: string;
};

type SubmittedPayload = {
  schema: 'requestUserInputSubmitted/v1';
  submittedAt: number;
  questions: SubmittedQuestion[];
};

interface RequestUserInputSubmittedBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
}

function parseSubmittedPayload(detail: string): SubmittedPayload | null {
  if (!detail.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(detail) as Partial<SubmittedPayload> | null;
    if (!parsed || parsed.schema !== 'requestUserInputSubmitted/v1') {
      return null;
    }
    if (!Array.isArray(parsed.questions)) {
      return null;
    }
    return {
      schema: 'requestUserInputSubmitted/v1',
      submittedAt:
        typeof parsed.submittedAt === 'number' ? parsed.submittedAt : Date.now(),
      questions: parsed.questions.map((question) => ({
        id: typeof question?.id === 'string' ? question.id : '',
        header: typeof question?.header === 'string' ? question.header : '',
        question: typeof question?.question === 'string' ? question.question : '',
        options: Array.isArray(question?.options)
          ? question.options
              .map((option) => ({
                label: typeof option?.label === 'string' ? option.label : '',
                description:
                  typeof option?.description === 'string' ? option.description : '',
              }))
              .filter((option) => option.label || option.description)
          : undefined,
        selectedOptions: Array.isArray(question?.selectedOptions)
          ? question.selectedOptions.filter(
              (value): value is string => typeof value === 'string' && value.trim().length > 0,
            )
          : [],
        note: typeof question?.note === 'string' ? question.note : '',
      })),
    };
  } catch {
    return null;
  }
}

export const RequestUserInputSubmittedBlock = memo(
  function RequestUserInputSubmittedBlock({
    item,
  }: RequestUserInputSubmittedBlockProps) {
    const { t } = useTranslation();
    const payload = useMemo(() => parseSubmittedPayload(item.detail), [item.detail]);

    if (!payload || payload.questions.length === 0) {
      return (
        <div className="message request-user-input-message request-user-input-history items-end">
          <div className="bubble request-user-input-card is-submitted w-[min(760px,92%)] max-w-full bg-[color:var(--surface-card-strong)] border border-[color:color-mix(in_srgb,var(--border-stronger)_80%,#5b9dff_20%)] shadow-[0_8px_20px_color-mix(in_srgb,#5b9dff_16%,transparent)] rounded-2xl py-2.5 px-3 flex flex-col gap-2">
            <div className="request-user-input-header flex justify-between items-baseline gap-2">
              <div className="request-user-input-title text-[13px] font-semibold text-[color:var(--text-strong)]">{t('approval.inputRequested')}</div>
              <div className="request-user-input-badge text-[11px] font-semibold text-[#1d4ed8] bg-[color:color-mix(in_srgb,#bfdbfe_78%,transparent)] border border-[color:color-mix(in_srgb,#93c5fd_82%,transparent)] rounded-full py-0.5 px-2">{t('approval.submitted')}</div>
            </div>
            <div className="request-user-input-submitted-fallback text-xs text-[color:var(--text)] whitespace-pre-wrap leading-[1.45]">
              {item.output || t('approval.none')}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="message request-user-input-message request-user-input-history items-end">
        <div
          className="bubble request-user-input-card is-submitted w-[min(760px,92%)] max-w-full bg-[color:var(--surface-card-strong)] border border-[color:color-mix(in_srgb,var(--border-stronger)_80%,#5b9dff_20%)] shadow-[0_8px_20px_color-mix(in_srgb,#5b9dff_16%,transparent)] rounded-2xl py-2.5 px-3 flex flex-col gap-2"
          role="group"
          aria-label={t('approval.userInputRequested')}
        >
          <div className="request-user-input-header flex justify-between items-baseline gap-2">
            <div className="request-user-input-title text-[13px] font-semibold text-[color:var(--text-strong)]">{t('approval.inputRequested')}</div>
            <div className="request-user-input-badge text-[11px] font-semibold text-[#1d4ed8] bg-[color:color-mix(in_srgb,#bfdbfe_78%,transparent)] border border-[color:color-mix(in_srgb,#93c5fd_82%,transparent)] rounded-full py-0.5 px-2">{t('approval.submitted')}</div>
          </div>
          <div className="request-user-input-body grid gap-2">
            {payload.questions.map((question, index) => {
              const questionId = question.id || `submitted-question-${index}`;
              const selectedSet = new Set(question.selectedOptions);
              const hasOptions = Array.isArray(question.options) && question.options.length > 0;
              const optionLabelSet = new Set(
                (question.options ?? []).map((option) => option.label).filter(Boolean),
              );
              const unmatchedSelectedOptions = question.selectedOptions.filter(
                (value) => !optionLabelSet.has(value),
              );
              const hasSelectedOptions = question.selectedOptions.length > 0;
              const hasNote = question.note.trim().length > 0;
              const hasAnswer = hasSelectedOptions || hasNote;
              return (
                <section key={questionId} className="request-user-input-question grid gap-1">
                  {question.header ? (
                    <div className="request-user-input-question-header text-[10.5px] uppercase tracking-[0.06em] text-[color:var(--text-faint)]">{question.header}</div>
                  ) : null}
                  <div className="request-user-input-question-text text-xs text-[color:var(--text)]">{question.question}</div>
                  {hasOptions ? (
                    <div className="request-user-input-options grid gap-1">
                      {question.options?.map((option, optionIndex) => {
                        const isSelected = selectedSet.has(option.label);
                        return (
                          <div
                            key={`${questionId}-${optionIndex}`}
                            className={`request-user-input-option${
                              isSelected ? ' is-selected' : ''
                            } border rounded-xl py-1.5 px-2 grid gap-0.5 ${
                              isSelected
                                ? 'border-[rgba(77,163,255,0.7)] bg-[rgba(77,163,255,0.12)]'
                                : 'border-[color:var(--border-subtle)] bg-[color:var(--surface-card-muted)]'
                            }`}
                          >
                            <div className="request-user-input-option-label text-xs font-semibold text-[color:var(--text-strong)]">
                              {option.label}
                            </div>
                            {option.description ? (
                              <div className="request-user-input-option-description text-[11px] text-[color:var(--text-subtle)]">
                                {option.description}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {hasSelectedOptions && !hasOptions ? (
                    <div className="request-user-input-submitted-answer-list flex flex-wrap gap-1.5">
                      {question.selectedOptions.map((answer, answerIndex) => (
                        <div
                          key={`${questionId}-answer-${answerIndex}`}
                          className="request-user-input-submitted-answer-chip border border-[color:color-mix(in_srgb,#93c5fd_68%,transparent)] bg-[color:color-mix(in_srgb,#bfdbfe_74%,transparent)] text-[#1e3a8a] rounded-full text-xs font-semibold leading-[1.2] py-1 px-2.5"
                        >
                          {answer}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {hasOptions && unmatchedSelectedOptions.length > 0 ? (
                    <div className="request-user-input-submitted-answer-list flex flex-wrap gap-1.5">
                      {unmatchedSelectedOptions.map((answer, answerIndex) => (
                        <div
                          key={`${questionId}-unmatched-${answerIndex}`}
                          className="request-user-input-submitted-answer-chip border border-[color:color-mix(in_srgb,#93c5fd_68%,transparent)] bg-[color:color-mix(in_srgb,#bfdbfe_74%,transparent)] text-[#1e3a8a] rounded-full text-xs font-semibold leading-[1.2] py-1 px-2.5"
                        >
                          {answer}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {hasNote ? (
                    <div className="request-user-input-notes is-readonly rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--surface-card-muted)] text-[color:var(--text-strong)] py-1.5 px-2 text-xs leading-snug min-h-[38px] whitespace-pre-wrap cursor-default">
                      {question.note}
                    </div>
                  ) : null}
                  {!hasAnswer ? (
                    <div className="request-user-input-answer-empty text-xs text-[color:var(--text-muted)]">
                      {t('approval.none')}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        </div>
      </div>
    );
  },
);

export default RequestUserInputSubmittedBlock;
