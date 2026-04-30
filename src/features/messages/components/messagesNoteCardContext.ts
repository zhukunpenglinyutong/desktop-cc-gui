import type { ConversationItem } from "../../../types";
import { NOTE_CARD_CONTEXT_SUMMARY_PREFIX } from "../../note-cards/utils/noteCardContextInjection";
import { isEquivalentUserObservation } from "../../threads/assembly/conversationNormalization";

export type NoteCardContextAttachment = {
  fileName: string;
  absolutePath: string;
};

export type NoteCardContextNote = {
  title: string;
  archived: boolean;
  bodyMarkdown: string;
  attachments: NoteCardContextAttachment[];
};

export type NoteCardContextSummary = {
  notes: NoteCardContextNote[];
  imagePaths: string[];
};

const NOTE_CARD_CONTEXT_BLOCK_REGEX = /<note-card-context>\s*([\s\S]*?)\s*<\/note-card-context>/i;
const NOTE_CARD_BLOCK_REGEX = /<note-card\b([^>]*)>([\s\S]*?)<\/note-card>/gi;
const NOTE_CARD_CONTEXT_SUFFIX_REGEX = /(?:\r?\n){1,2}(<note-card-context>[\s\S]*<\/note-card-context>)\s*$/i;
const OPTIMISTIC_USER_MESSAGE_PREFIX = "optimistic-user-";
const QUEUED_HANDOFF_MESSAGE_PREFIX = "queued-handoff-";

function isPendingUserBubbleId(id: string) {
  return (
    id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX)
    || id.startsWith(QUEUED_HANDOFF_MESSAGE_PREFIX)
  );
}

function dedupeImagePaths(paths: string[]) {
  return Array.from(
    new Set(paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  );
}

function normalizeSummaryKeySegment(value: string) {
  return value.trim().replace(/\r\n/g, "\n").replace(/\s+/g, " ");
}

function parseNoteCardAttribute(attributes: string, key: "title" | "archived") {
  const matched = new RegExp(`${key}="([^"]*)"`, "i").exec(attributes);
  return matched?.[1]?.trim() ?? "";
}

function parseNoteCardBody(bodyWithAttachments: string) {
  const normalized = bodyWithAttachments.trim();
  if (!normalized) {
    return {
      bodyMarkdown: "",
      attachments: [] as NoteCardContextAttachment[],
    };
  }
  const lines = normalized.split(/\r?\n/);
  const imagesMarkerIndex = lines.findIndex((line) => line.trim() === "Images:");
  if (imagesMarkerIndex < 0) {
    return {
      bodyMarkdown: normalized,
      attachments: [] as NoteCardContextAttachment[],
    };
  }
  const attachmentLines = lines.slice(imagesMarkerIndex + 1);
  const attachments = attachmentLines
    .map((line) => {
      const matched = /^\s*-\s*(.+?)\s*\|\s*(.+?)\s*$/.exec(line);
      if (!matched) {
        return null;
      }
      return {
        fileName: matched[1]?.trim() ?? "",
        absolutePath: matched[2]?.trim() ?? "",
      };
    })
    .filter(
      (attachment): attachment is NoteCardContextAttachment =>
        attachment !== null && attachment.absolutePath.length > 0,
    );
  if (attachments.length === 0) {
    return {
      bodyMarkdown: normalized,
      attachments: [],
    };
  }
  return {
    bodyMarkdown: lines.slice(0, imagesMarkerIndex).join("\n").trim(),
    attachments,
  };
}

function buildNoteCardSummary(notes: NoteCardContextNote[]): NoteCardContextSummary | null {
  if (notes.length === 0) {
    return null;
  }
  return {
    notes,
    imagePaths: dedupeImagePaths(
      notes.flatMap((note) => note.attachments.map((attachment) => attachment.absolutePath)),
    ),
  };
}

export function buildNoteCardContextSummaryKey(summary: NoteCardContextSummary | null) {
  if (!summary || summary.notes.length === 0) {
    return null;
  }
  return summary.notes
    .map((note) =>
      [
        normalizeSummaryKeySegment(note.title),
        note.archived ? "1" : "0",
        normalizeSummaryKeySegment(note.bodyMarkdown),
        note.attachments
          .map((attachment) =>
            `${normalizeSummaryKeySegment(attachment.fileName)}|${normalizeSummaryKeySegment(
              attachment.absolutePath,
            )}`,
          )
          .join("||"),
      ].join("::"),
    )
    .join("###");
}

function parseNoteCardContextBlock(text: string): NoteCardContextSummary | null {
  const normalized = text.trim();
  const blockMatch = normalized.match(NOTE_CARD_CONTEXT_BLOCK_REGEX);
  if (!blockMatch?.[1]) {
    return null;
  }
  const notes: NoteCardContextNote[] = [];
  for (const noteMatch of blockMatch[1].matchAll(NOTE_CARD_BLOCK_REGEX)) {
    const attributes = noteMatch[1] ?? "";
    const rawBody = noteMatch[2] ?? "";
    const parsedBody = parseNoteCardBody(rawBody);
    notes.push({
      title: parseNoteCardAttribute(attributes, "title"),
      archived: parseNoteCardAttribute(attributes, "archived").toLowerCase() === "true",
      bodyMarkdown: parsedBody.bodyMarkdown,
      attachments: parsedBody.attachments,
    });
  }
  return buildNoteCardSummary(notes);
}

export function parseNoteCardContextSummary(text: string): NoteCardContextSummary | null {
  const normalized = text.trim();
  if (!normalized.startsWith(NOTE_CARD_CONTEXT_SUMMARY_PREFIX)) {
    return null;
  }
  const block = normalized.slice(NOTE_CARD_CONTEXT_SUMMARY_PREFIX.length).trim();
  return parseNoteCardContextBlock(block);
}

export function parseInjectedNoteCardContextFromUser(
  text: string,
): { noteCardSummary: NoteCardContextSummary; remainingText: string } | null {
  const normalized = text.trimEnd();
  const contextMatch = normalized.match(NOTE_CARD_CONTEXT_SUFFIX_REGEX);
  if (!contextMatch?.[1] || contextMatch.index === undefined) {
    return null;
  }
  const noteCardSummary = parseNoteCardContextBlock(contextMatch[1]);
  if (!noteCardSummary) {
    return null;
  }
  const remainingText = normalized.slice(0, contextMatch.index).replace(/\s+$/, "");
  return {
    noteCardSummary,
    remainingText,
  };
}

export function buildSuppressedUserNoteCardContextMessageIdSet(items: ConversationItem[]) {
  const suppressedMessageIds = new Set<string>();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "message" || item.role !== "user") {
      continue;
    }
    const legacyUserNoteCard = parseInjectedNoteCardContextFromUser(item.text);
    const userSummaryKey = buildNoteCardContextSummaryKey(
      legacyUserNoteCard?.noteCardSummary ?? null,
    );
    if (!userSummaryKey) {
      continue;
    }

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previousItem = items[previousIndex];
      if (!previousItem || previousItem.kind !== "message") {
        continue;
      }
      if (previousItem.role === "user") {
        if (
          isPendingUserBubbleId(previousItem.id)
          && isEquivalentUserObservation(previousItem, item)
        ) {
          continue;
        }
        break;
      }
      const assistantSummaryKey = buildNoteCardContextSummaryKey(
        parseNoteCardContextSummary(previousItem.text),
      );
      if (assistantSummaryKey && assistantSummaryKey === userSummaryKey) {
        suppressedMessageIds.add(item.id);
        break;
      }
    }
  }

  return suppressedMessageIds;
}
