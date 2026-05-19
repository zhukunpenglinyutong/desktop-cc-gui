import type { ConversationItem } from "../types";
import i18n from "../i18n";

type AskUserQuestionOption = {
  label: string;
  description: string;
};

type AskUserQuestionTemplate = {
  id: string;
  header: string;
  question: string;
  options?: AskUserQuestionOption[];
};

type AskUserQuestionAnswer = {
  selectedOptions: string[];
  note: string;
};

type AskUserQuestionAnswerParseResult = {
  rawSelectionText: string;
  answers: AskUserQuestionAnswer[];
};

function asString(value: unknown) {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseJsonRecordFromText(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function isAskUserQuestionToolItem(
  item: Extract<ConversationItem, { kind: "tool" }>,
) {
  const toolType = asString(item.toolType).trim().toLowerCase();
  if (toolType === "askuserquestion" || toolType === "ask_user_question") {
    return true;
  }
  const title = asString(item.title).toLowerCase();
  if (title.includes("askuserquestion") || title.includes("ask_user_question")) {
    return true;
  }
  if (toolType === "mcptoolcall") {
    return title.includes("askuserquestion") || title.includes("ask_user_question");
  }
  return false;
}

function parseAskUserQuestionTemplatesFromDetail(
  detail: string,
): AskUserQuestionTemplate[] {
  const record = parseJsonRecordFromText(detail);
  if (!record) {
    return [];
  }
  const hasSingleQuestionShape =
    "question" in record ||
    "prompt" in record ||
    "header" in record ||
    "title" in record ||
    "options" in record;
  const rawQuestions = Array.isArray(record.questions)
    ? record.questions
    : hasSingleQuestionShape
      ? [record]
      : [];
  const templates: AskUserQuestionTemplate[] = [];
  rawQuestions.forEach((entry, index) => {
    const question = asRecord(entry);
    if (!question) {
      return;
    }
    const id = asString(question.id ?? `q-${index}`).trim() || `q-${index}`;
    const header = asString(question.header ?? question.title ?? "").trim();
    const questionText = asString(question.question ?? question.prompt ?? "").trim();
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = rawOptions
      .map((rawOption) => {
        const option = asRecord(rawOption);
        if (!option) {
          return null;
        }
        const label = asString(option.label ?? "").trim();
        const description = asString(option.description ?? "").trim();
        if (!label && !description) {
          return null;
        }
        return { label, description };
      })
      .filter((option): option is AskUserQuestionOption => option !== null);
    if (!questionText && options.length === 0) {
      return;
    }
    templates.push({
      id,
      header,
      question: questionText,
      options: options.length > 0 ? options : undefined,
    });
  });
  return templates;
}

function parseAskUserAnswerParts(raw: string): AskUserQuestionAnswer {
  const segments = raw
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const selectedOptions: string[] = [];
  let note = "";
  for (const segment of segments) {
    if (/^user_note\s*:/i.test(segment)) {
      const parsedNote = segment.replace(/^user_note\s*:/i, "").trim();
      if (parsedNote) {
        note = parsedNote;
      }
      continue;
    }
    selectedOptions.push(segment);
  }
  return { selectedOptions, note };
}

function parseAskUserQuestionAnswerText(
  text: string,
): AskUserQuestionAnswerParseResult | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (/^The user dismissed the question without selecting an option\.?$/i.test(trimmed)) {
    return {
      rawSelectionText: "",
      answers: [{ selectedOptions: [], note: "" }],
    };
  }
  const answeredMatch = trimmed.match(
    /^The user answered the AskUserQuestion[:：]\s*([\s\S]*?)(?:[。.]?\s*Please continue based on this selection\.?)$/i,
  );
  if (!answeredMatch) {
    return null;
  }
  const rawSelectionText = asString(answeredMatch[1] ?? "").trim();
  if (!rawSelectionText) {
    return null;
  }
  const baseSegments = rawSelectionText
    .split(/[;；]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (baseSegments.length === 0) {
    return null;
  }
  return {
    rawSelectionText,
    answers: baseSegments.map((segment) => parseAskUserAnswerParts(segment)),
  };
}

function buildRequestUserInputSubmittedDetail(
  templates: AskUserQuestionTemplate[],
  parsedAnswer: AskUserQuestionAnswerParseResult,
) {
  const payload = {
    schema: "requestUserInputSubmitted/v1",
    submittedAt: Date.now(),
    questions: templates.map((template, index) => ({
      id: template.id || `q-${index}`,
      header: template.header,
      question: template.question,
      options: template.options,
      selectedOptions: parsedAnswer.answers[index]?.selectedOptions ?? [],
      note: parsedAnswer.answers[index]?.note ?? "",
    })),
  };
  return JSON.stringify(payload);
}

export function normalizeAskUserQuestionHistoryItems(items: ConversationItem[]) {
  if (items.length === 0) {
    return items;
  }
  const normalized: ConversationItem[] = [];
  const askToolOrder: string[] = [];
  const askTemplatesByToolId = new Map<string, AskUserQuestionTemplate[]>();
  const askToolIndexById = new Map<string, number>();
  const existingSubmittedToolIds = new Set<string>();

  for (const item of items) {
    if (item.kind === "tool" && item.toolType === "requestUserInputSubmitted") {
      const submittedId = item.id;
      const prefix = "request-user-input-submitted-";
      if (submittedId.startsWith(prefix) && submittedId.length > prefix.length) {
        existingSubmittedToolIds.add(submittedId.slice(prefix.length));
      }
    }
  }

  const consumeAskToolId = () => {
    while (askToolOrder.length > 0) {
      const candidate = askToolOrder.shift() ?? "";
      if (!candidate) {
        continue;
      }
      return candidate;
    }
    return "";
  };

  for (const item of items) {
    if (item.kind === "tool" && isAskUserQuestionToolItem(item)) {
      askToolOrder.push(item.id);
      askTemplatesByToolId.set(item.id, parseAskUserQuestionTemplatesFromDetail(item.detail));
      askToolIndexById.set(item.id, normalized.length);
      normalized.push(item);
      continue;
    }

    if (item.kind === "message" && item.role === "user") {
      const parsedAnswer = parseAskUserQuestionAnswerText(item.text);
      if (parsedAnswer) {
        const matchedToolId = consumeAskToolId();
        if (matchedToolId) {
          const askToolIndex = askToolIndexById.get(matchedToolId);
          if (askToolIndex !== undefined) {
            const askItem = normalized[askToolIndex];
            if (askItem?.kind === "tool") {
              normalized[askToolIndex] = {
                ...askItem,
                status: "completed",
                output: parsedAnswer.rawSelectionText || askItem.output,
              };
            }
          }
          if (!existingSubmittedToolIds.has(matchedToolId)) {
            const templates = askTemplatesByToolId.get(matchedToolId) ?? [];
            normalized.push({
              id: `request-user-input-submitted-${matchedToolId}`,
              kind: "tool",
              toolType: "requestUserInputSubmitted",
              title: i18n.t("approval.inputRequested"),
              detail: buildRequestUserInputSubmittedDetail(templates, parsedAnswer),
              status: "completed",
              output: parsedAnswer.rawSelectionText,
            });
          }
          continue;
        }
      }
    }

    normalized.push(item);
  }

  return normalized;
}
