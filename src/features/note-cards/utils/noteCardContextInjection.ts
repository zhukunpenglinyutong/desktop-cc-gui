import type { WorkspaceNoteCard } from "../../../services/tauri";

const MAX_NOTE_BODY_CHARS = 2400;
const MAX_TOTAL_NOTE_CHARS = 9000;
export const NOTE_CARD_CONTEXT_SUMMARY_PREFIX = "【便签上下文】";

function clampChars(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}

function sanitizeNoteCardText(value: string) {
  return value
    .replace(/<\/note-card-context>/gi, "[note-card-context-close]")
    .replace(/<\/note-card>/gi, "[note-card-close]")
    .trim();
}

function dedupeImagePaths(paths: string[]) {
  return Array.from(
    new Set(paths.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
  );
}

function normalizeInjectedAttachmentPath(path: string) {
  return path.replace(/\\/g, "/");
}

function buildNoteBlock(note: WorkspaceNoteCard) {
  const body = clampChars(sanitizeNoteCardText(note.bodyMarkdown || note.plainTextExcerpt), MAX_NOTE_BODY_CHARS);
  const lines = [
    `<note-card title="${note.title.replace(/"/g, "'")}" archived="${note.archivedAt ? "true" : "false"}">`,
    body ? body : note.plainTextExcerpt || note.title,
  ];
  if (note.attachments.length > 0) {
    lines.push("");
    lines.push("Images:");
    for (const attachment of note.attachments) {
      lines.push(`- ${attachment.fileName} | ${normalizeInjectedAttachmentPath(attachment.absolutePath)}`);
    }
  }
  lines.push("</note-card>");
  return lines.join("\n");
}

export type NoteCardInjectionResult = {
  finalText: string;
  injectedCount: number;
  injectedChars: number;
  imagePaths: string[];
  previewText: string | null;
};

export function injectSelectedNoteCardsContext({
  userText,
  noteCards,
}: {
  userText: string;
  noteCards: WorkspaceNoteCard[];
}): NoteCardInjectionResult {
  if (noteCards.length === 0) {
    return {
      finalText: userText,
      injectedCount: 0,
      injectedChars: 0,
      imagePaths: [],
      previewText: null,
    };
  }

  const blocks: string[] = [];
  let totalChars = 0;
  for (const note of noteCards) {
    const block = buildNoteBlock(note);
    if (totalChars >= MAX_TOTAL_NOTE_CHARS) {
      break;
    }
    const remaining = MAX_TOTAL_NOTE_CHARS - totalChars;
    const normalizedBlock =
      block.length > remaining ? clampChars(block, remaining) : block;
    blocks.push(normalizedBlock);
    totalChars += normalizedBlock.length;
  }

  if (blocks.length === 0) {
    return {
      finalText: userText,
      injectedCount: 0,
      injectedChars: 0,
      imagePaths: [],
      previewText: null,
    };
  }

  const noteBlock = `<note-card-context>\n${blocks.join("\n\n")}\n</note-card-context>`;
  const finalText = userText.trim()
    ? `${userText}\n\n${noteBlock}`
    : noteBlock;
  const imagePaths = dedupeImagePaths(
    noteCards.flatMap((note) =>
      note.attachments.map((attachment) => attachment.absolutePath),
    ),
  );

  return {
    finalText,
    injectedCount: blocks.length,
    injectedChars: noteBlock.length,
    imagePaths,
    previewText: noteBlock,
  };
}
