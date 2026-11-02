import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { CodexApprovalDetails, approvalTitle, approvalChoice } from "./CodexApprovalDetails";
import type { Message, QuestionSpec } from "@/lib/ipc";
import { useChatStore } from "../store";
import { useScopedSessionKey } from "../split/session-scope";

/**
 * AskUserQuestion panel (dock form): the CLI parked the question on the
 * control protocol (`can_use_tool`) and the turn only continues once it is
 * answered or ignored. The panel takes over the composer area: header chip +
 * prompt (+ page controls for multi-question asks), selectable option rows,
 * a free-form answer input, and the ignore/submit footer. Answers are the
 * chosen option labels — the contract the CLI's question reader matches
 * against; any other non-empty string travels as a typed (free-form) answer.
 */

type AnswerMap = Record<string, string | string[]>;
type TextMap = Record<string, string>;

// Stable identity: the hook below must not see a fresh array on every render.
const EMPTY_QUESTIONS: QuestionSpec[] = [];

/** Option pick, or the typed free-form answer when one is present. */
function valueFor(
  text: string,
  picked: AnswerMap,
  other: TextMap,
): string | string[] {
  const typed = (other[text] ?? "").trim();
  return typed ? typed : picked[text] ?? "";
}

/** Whether a question already has an answer (an option pick or typed text). */
function hasAnswer(text: string, picked: AnswerMap, other: TextMap): boolean {
  const value = valueFor(text, picked, other);
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/** Index of the next question still without an answer, wrapping; the current
 * page when none is open. */
function nextUnansweredIndex(
  questions: QuestionSpec[],
  picked: AnswerMap,
  other: TextMap,
  fromPage: number,
): number {
  const from = Math.min(fromPage, questions.length - 1);
  for (let step = 1; step <= questions.length; step++) {
    const at = (from + step) % questions.length;
    const spec = questions[at];
    if (spec && !hasAnswer(spec.question, picked, other)) return at;
  }
  return from;
}

/** Toggle an option label: re-picking a chosen option clears it (a pick must
 * stay revocable, and submit is then disabled until another answer arrives). */
function togglePick(
  current: string | string[] | undefined,
  label: string,
  multi: boolean,
): string | string[] {
  if (!multi) return current === label ? "" : label;
  const list = Array.isArray(current) ? current : [];
  return list.includes(label)
    ? list.filter((item) => item !== label)
    : [...list, label];
}

/** Arrow-key row cycling across the current question's interactive rows. */
function focusRow(root: HTMLElement | null, delta: 1 | -1) {
  const rows = Array.from(root?.querySelectorAll<HTMLElement>("[data-q-row]") ?? []);
  if (rows.length === 0) return;
  const at = rows.indexOf(document.activeElement as HTMLElement);
  const next = rows[(at + delta + rows.length) % rows.length];
  next?.focus();
}

/** Answering state for the docked card; kept JSX-free so the component below
 *  only composes the header, options, and footer. */
function useQuestionAnswers(questions: QuestionSpec[], seq: number) {
  const respondToQuestion = useChatStore((s) => s.respondToQuestion);
  // 会话 key 取自所属栏位：分屏时各格管各格的问答卡。
  const key = useScopedSessionKey();
  const [picked, setPicked] = useState<AnswerMap>(() => Object.fromEntries(
    questions.filter((q) => q.approval && q.options.length > 0)
      .map((q) => [q.question, q.options[0].label]),
  ));
  const [other, setOther] = useState<TextMap>({});
  const [page, setPage] = useState(0);

  const currentIndex = Math.min(page, Math.max(questions.length - 1, 0));
  const current = questions[currentIndex];
  const openQuestions = questions.filter(
    (q) => !hasAnswer(q.question, picked, other),
  ).length;
  const complete = openQuestions === 0;

  const pick = (text: string, label: string, multi: boolean) => {
    const approval = questions.some((q) => q.question === text && q.approval);
    const nextPicked = { ...picked, [text]: approval ? label : togglePick(picked[text], label, multi) };
    // An option pick replaces any typed answer for that question.
    const nextOther = { ...other, [text]: "" };
    setOther(nextOther);
    setPicked(nextPicked);
    // Submit waits for every question, so the pick answering a single-select
    // one walks the user on: leaving them to find the pager is a dead end.
    const value = nextPicked[text];
    if (!multi && typeof value === "string" && value) {
      setPage(nextUnansweredIndex(questions, nextPicked, nextOther, page));
    }
  };

  const typeOther = (text: string, value: string) => {
    setOther((cur) => ({ ...cur, [text]: value }));
    // Typing a free-form answer supersedes any option pick.
    setPicked((cur) => ({ ...cur, [text]: "" }));
  };

  const answer = () => {
    if (!key || !complete) return;
    const merged: AnswerMap = {};
    for (const q of questions) merged[q.question] = valueFor(q.question, picked, other);
    void respondToQuestion(key, seq, merged);
  };

  const skip = () => {
    if (key) void respondToQuestion(key, seq, null);
  };

  return {
    key,
    picked,
    other,
    page,
    setPage,
    currentIndex,
    current,
    openQuestions,
    complete,
    pick,
    typeOther,
    answer,
    skip,
  };
}

function OptionGlyph({ selected, multi }: { selected: boolean; multi: boolean }) {
  return (
    <span
      className={`mt-0.5 flex size-4 shrink-0 items-center justify-center border ${
        multi ? "rounded" : "rounded-full"
      } ${
        selected
          ? multi
            ? "border-button-primary bg-button-primary text-text-white"
            : "border-button-primary bg-background-primary-default"
          : "border-border-secondary"
      }`}
    >
      {selected &&
        (multi ? (
          <Check className="size-3" aria-hidden />
        ) : (
          <span className="size-2 rounded-full bg-button-primary" aria-hidden />
        ))}
    </span>
  );
}

function rowClass(selected: boolean): string {
  return `flex w-full cursor-pointer items-start gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors focus-visible:ring-1 focus-visible:ring-button-primary focus-visible:outline-none ${
    selected ? "bg-background-tertiary-default" : "hover:bg-background-tertiary-hover"
  }`;
}

function QuestionOptionRow({
  option,
  selected,
  multi,
  onPick,
  onFocusRow,
}: {
  option: QuestionSpec["options"][number];
  selected: boolean;
  multi: boolean;
  onPick: () => void;
  onFocusRow: (delta: 1 | -1) => void;
}) {
  return (
    <button
      type="button"
      data-q-row
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          onFocusRow(e.key === "ArrowDown" ? 1 : -1);
        }
      }}
      className={rowClass(selected)}
    >
      <OptionGlyph selected={selected} multi={multi} />
      <span className="flex min-w-0 flex-col">
        <span className="text-caption-1-medium text-text-primary">{option.label}</span>
        {option.description && (
          <span className="text-caption-1-regular text-text-secondary">
            {option.description}
          </span>
        )}
      </span>
    </button>
  );
}

function QuestionPager({
  page,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const pagerButton = "flex cursor-pointer items-center rounded p-0.5 hover:bg-background-tertiary-hover";
  return (
    <span className="ml-auto flex items-center gap-1 text-caption-1-regular text-text-tertiary">
      <button
        type="button"
        aria-label={t("chat.questionPrev")}
        onClick={onPrev}
        className={pagerButton}
      >
        <ChevronLeft className="size-3.5" aria-hidden />
      </button>
      <span>
        {page + 1}/{total}
      </span>
      <button
        type="button"
        aria-label={t("chat.questionNext")}
        onClick={onNext}
        className={pagerButton}
      >
        <ChevronRight className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

function QuestionOptions({
  question,
  rootRef,
  pickedValue,
  typed,
  onPick,
  onTypedChange,
  onEnter,
}: {
  question: QuestionSpec;
  rootRef: RefObject<HTMLDivElement>;
  pickedValue: string | string[] | undefined;
  typed: string;
  onPick: (label: string) => void;
  onTypedChange: (value: string) => void;
  /** Enter on the free-form input: submit when answered, else walk on. */
  onEnter: () => void;
}) {
  const { t } = useTranslation();
  const approval = question.approval;
  const multi = Boolean(question.multiSelect);
  const selectedLabels = Array.isArray(pickedValue) ? new Set(pickedValue) : null;
  return (
    <div className="flex flex-col gap-1">
      {question.options.map((opt) => {
        const selected = selectedLabels
          ? selectedLabels.has(opt.label)
          : pickedValue === opt.label;
        return (
          <QuestionOptionRow
            key={opt.label}
            option={approval && approvalChoice(approval, opt.label)
              ? { ...opt, label: t(approvalChoice(approval, opt.label)!) } : opt}
            selected={selected}
            multi={multi}
            onPick={() => onPick(opt.label)}
            onFocusRow={(delta) => focusRow(rootRef.current, delta)}
          />
        );
      })}
      {!approval && !multi && question.allowOther !== false && (
        <input
          data-q-row
          value={typed}
          onChange={(e) => onTypedChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter that confirms an IME candidate must not submit the
            // half-composed answer.
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              focusRow(rootRef.current, e.key === "ArrowDown" ? 1 : -1);
            }
          }}
          placeholder={t("chat.questionOtherPlaceholder")}
          aria-label={t("chat.questionOther")}
          className="rounded-md border border-border-secondary bg-background-tertiary-default px-2.5 py-1.5 text-caption-1-regular text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-1 focus-visible:ring-button-primary"
        />
      )}
    </div>
  );
}

export function QuestionCard({ message }: { message: Message }) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const question = message.question;
  const {
    picked,
    other,
    page,
    setPage,
    currentIndex,
    current,
    openQuestions,
    complete,
    pick,
    typeOther,
    answer,
    skip,
  } = useQuestionAnswers(question?.questions ?? EMPTY_QUESTIONS, message.seq);
  const approval = current && current.approval;
  useEffect(() => {
    if (approval) rootRef.current?.querySelector<HTMLElement>("[data-q-row]")?.focus();
  }, [Boolean(approval), message.seq, question?.runId]);
  if (!question || !current) return null;
  const { questions } = question;

  const btn =
    "inline-flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-caption-1-medium transition-colors";
  const walkToNext = () => setPage(nextUnansweredIndex(questions, picked, other, page));

  return (
    <div ref={rootRef} className="flex w-full flex-col gap-2.5 text-left"
      onKeyDownCapture={(e) => {
        if (!approval || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          e.stopPropagation();
          const at = current.options.findIndex((opt) => opt.label === picked[current.question]);
          const delta = e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey) ? -1 : 1;
          const next = (at + delta + current.options.length) % current.options.length;
          const option = current.options[next];
          if (option) {
            pick(current.question, option.label, false);
            rootRef.current?.querySelectorAll<HTMLElement>("[data-q-row]")[next]?.focus();
          }
        } else if (e.key === "Escape" || (e.key === "Enter" && (e.target as HTMLElement).closest("[data-q-row]"))) {
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat) return;
          if (e.key === "Escape") skip();
          else answer();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="rounded-md bg-background-tertiary-default px-1.5 py-0.5 text-caption-1-regular text-text-secondary">
          {approval ? t("chat.codexApproval.header") : current.header}
        </span>
        <span className="text-caption-1-medium text-text-primary">
          {approval ? t(approvalTitle(approval)) : current.question}
        </span>
        {current.multiSelect && (
          <span className="text-caption-1-regular text-text-tertiary">
            {t("chat.questionMultiTag")}
          </span>
        )}
        {questions.length > 1 && (
          <QuestionPager
            page={Math.min(page, questions.length - 1)}
            total={questions.length}
            onPrev={() => setPage((p) => (p - 1 + questions.length) % questions.length)}
            onNext={() => setPage((p) => (p + 1) % questions.length)}
          />
        )}
      </div>
      {approval && <CodexApprovalDetails approval={approval} />}
      <QuestionOptions
        question={current}
        rootRef={rootRef}
        pickedValue={picked[current.question]}
        typed={other[current.question] ?? ""}
        onPick={(label) => pick(current.question, label, Boolean(current.multiSelect))}
        onTypedChange={(value) => typeOther(current.question, value)}
        onEnter={() => {
          if (complete) answer();
          else walkToNext();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption-1-regular text-text-tertiary">
          {approval ? t("chat.codexApproval.keyboardHint") : complete
            ? t("chat.questionKeyboardHint")
            : t("chat.questionRemaining", { count: openQuestions })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={skip}
            className={`${btn} border border-border-secondary bg-background-secondary-default text-text-secondary hover:bg-background-tertiary-hover`}
          >
            {t(approval ? "chat.codexApproval.reject" : "chat.questionSkip")}
          </button>
          {current.multiSelect && !complete && hasAnswer(current.question, picked, other) && (
            <button
              type="button"
              onClick={walkToNext}
              className={`${btn} border border-border-secondary bg-background-secondary-default text-text-secondary hover:bg-background-tertiary-hover`}
            >
              {t("chat.questionConfirmAndContinue")}
            </button>
          )}
          {(!current.multiSelect || currentIndex === questions.length - 1) && (
            <button
              type="button"
              disabled={!complete}
              onClick={answer}
              className={`${btn} bg-button-primary text-text-white disabled:cursor-not-allowed disabled:text-button-primary-disabled-foreground`}
            >
              {t("chat.questionSubmit")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Timeline record for a question: the interaction itself lives in the dock
 * that takes over the composer, so while pending this row is only a muted
 * placeholder; once settled it becomes the read-only history entry.
 */
export function QuestionRecord({ message }: { message: Message }) {
  const { t } = useTranslation();
  const question = message.question;
  if (!question) return null;
  const { status, questions } = question;
  const approval = questions[0] && questions[0].approval;
  return (
    <div className="flex max-w-[85%] flex-col gap-1 rounded-xl border border-border-secondary bg-background-secondary-default px-3.5 py-2.5 text-left">
      <div className="flex items-center gap-1.5 text-caption-1-medium text-text-secondary">
        <Check className="size-3.5 shrink-0 text-foreground-icon-secondary" aria-hidden />
        {t(approval ? "chat.codexApproval.header" : "chat.questionTitle")}
      </div>
      {status === "pending" && (
        <>
          <div className="text-caption-1-regular text-text-primary">
            {approval ? t(approvalTitle(approval)) : questions[0]?.question ?? ""}
          </div>
          {approval && <CodexApprovalDetails approval={approval} />}
          <div className="text-caption-1-regular text-text-tertiary">
            {t("chat.questionWaiting")}
          </div>
        </>
      )}
      {status === "answered" && (
        <div className="flex flex-col gap-0.5 text-caption-1-regular text-text-secondary">
          {questions.map((q, qi) => {
            const value = question.answers?.[q.question];
            const approval = q.approval;
            const shown = Array.isArray(value) ? value.join(", ") : value ?? "";
            const choice = approval && approvalChoice(approval, shown);
            return (
              <div key={qi} className="break-words">
                {approval ? t(approvalTitle(approval)) : q.question} → {choice ? t(choice) : shown}
              </div>
            );
          })}
        </div>
      )}
      {status === "dismissed" && (
        <div className="text-caption-1-regular text-text-tertiary">
          {t(approval ? "chat.codexApproval.rejected" : "chat.questionSkipped")}
        </div>
      )}
      {status === "cancelled" && (
        <div className="text-caption-1-regular text-text-tertiary">
          {t("chat.questionCancelled")}
        </div>
      )}
    </div>
  );
}
