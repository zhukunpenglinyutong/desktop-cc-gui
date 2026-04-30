import { useEffect, useMemo, useState } from "react";

export type AutocompleteItem = {
  id: string;
  label: string;
  description?: string;
  insertText?: string;
  hint?: string;
  cursorOffset?: number;
  isDirectory?: boolean;
  kind?: "manual-memory" | "note-card";
  memoryId?: string;
  memoryTitle?: string;
  memorySummary?: string;
  memoryDetail?: string;
  memoryKind?: string;
  memoryImportance?: string;
  memoryUpdatedAt?: number;
  memoryTags?: string[];
  noteCardId?: string;
  noteCardTitle?: string;
  noteCardSummary?: string;
  noteCardBodyMarkdown?: string;
  noteCardUpdatedAt?: number;
  noteCardArchived?: boolean;
  noteCardImageCount?: number;
  noteCardPreviewAttachments?: Array<{
    id: string;
    fileName: string;
    contentType: string;
    absolutePath: string;
  }>;
};

export type AutocompleteTrigger = {
  trigger: string;
  items: AutocompleteItem[];
};

type AutocompleteRange = {
  start: number;
  end: number;
};

type AutocompleteState = {
  active: boolean;
  trigger: string | null;
  query: string;
  range: AutocompleteRange | null;
};

type UseComposerAutocompleteArgs = {
  text: string;
  selectionStart: number | null;
  triggers: AutocompleteTrigger[];
  maxResults?: number;
};

const whitespaceRegex = /\s/;
const triggerPrefixRegex = /^(?:\s|["'`]|\(|\[|\{)$/;

function resolveAutocompleteState(
  text: string,
  cursor: number,
  triggers: AutocompleteTrigger[],
): AutocompleteState {
  if (cursor <= 0) {
    return { active: false, trigger: null, query: "", range: null };
  }
  const triggerValues = Array.from(
    new Set(
      triggers
        .map((entry) => entry.trigger)
        .filter((entry) => entry.length > 0),
    ),
  ).sort((a, b) => b.length - a.length);
  let index = cursor - 1;
  while (index >= 0) {
    const char = text[index] ?? "";
    if (whitespaceRegex.test(char)) {
      break;
    }
    for (const trigger of triggerValues) {
      const start = index - trigger.length + 1;
      if (start < 0) {
        continue;
      }
      if (text.slice(start, index + 1) !== trigger) {
        continue;
      }
      const prevChar = start > 0 ? (text[start - 1] ?? "") : "";
      if (prevChar && !triggerPrefixRegex.test(prevChar)) {
        continue;
      }
      const query = text.slice(start + trigger.length, cursor);
      if (whitespaceRegex.test(query)) {
        continue;
      }
      return {
        active: true,
        trigger,
        query,
        range: { start: start + trigger.length, end: cursor },
      };
    }
    index -= 1;
  }
  return { active: false, trigger: null, query: "", range: null };
}

function basename(label: string) {
  const normalized = label.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? (parts[parts.length - 1] ?? label) : label;
}

function fileParts(label: string) {
  const normalized = label.replace(/\\/g, "/").toLowerCase();
  const base = basename(normalized);
  const dotIndex = base.lastIndexOf(".");
  const name =
    dotIndex > 0 && dotIndex < base.length - 1 ? base.slice(0, dotIndex) : base;
  const ext =
    dotIndex > 0 && dotIndex < base.length - 1 ? base.slice(dotIndex + 1) : "";
  return { normalized, base, name, ext };
}

function isSubsequence(query: string, target: string) {
  let q = 0;
  let t = 0;
  while (q < query.length && t < target.length) {
    if (query[q] === target[t]) {
      q += 1;
    }
    t += 1;
  }
  return q === query.length;
}

function scoreMatch(query: string, label: string) {
  if (!query) {
    return 0;
  }
  const normalizedQuery = query.toLowerCase();
  const { normalized, base, name, ext } = fileParts(label);
  const queryParts = normalizedQuery.split(".");
  const queryName = queryParts[0] ?? "";
  const queryExt = queryParts.length > 1 ? queryParts.slice(1).join(".") : "";
  const matchExt =
    !queryExt || ext.startsWith(queryExt) || ext.includes(queryExt);
  if (!matchExt) {
    return 0;
  }

  if (!queryName) {
    if (queryExt && ext === queryExt) {
      return 60;
    }
    if (queryExt) {
      return 40;
    }
    return 0;
  }

  if (normalized === normalizedQuery || name === queryName) {
    return 110;
  }
  if (name.startsWith(queryName)) {
    return 95 + (queryExt ? 10 : 0);
  }
  if (base.startsWith(queryName)) {
    return 90 + (queryExt ? 10 : 0);
  }
  if (normalized.startsWith(queryName)) {
    return 80 + (queryExt ? 5 : 0);
  }
  if (name.includes(queryName)) {
    return 70 + (queryExt ? 5 : 0);
  }
  if (normalized.includes(queryName)) {
    return 60 + (queryExt ? 5 : 0);
  }
  if (isSubsequence(queryName, name)) {
    return 50 + (queryExt ? 5 : 0);
  }
  return 0;
}

function rankItems(items: AutocompleteItem[], query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return items.slice();
  }
  const ranked = items
    .map((item) => {
      const baseScore = Math.max(
        scoreMatch(normalized, item.label),
        item.description ? Math.max(scoreMatch(normalized, item.description) - 10, 0) : 0,
      );
      const archivedPenalty =
        item.kind === "note-card" ? (item.noteCardArchived ? -15 : 5) : 0;
      return {
        item,
        score: baseScore + archivedPenalty,
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.item.label.localeCompare(b.item.label);
    });
  return ranked.map((entry) => entry.item);
}

export function useComposerAutocomplete({
  text,
  selectionStart,
  triggers,
  maxResults = 50,
}: UseComposerAutocompleteArgs) {
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const state = useMemo(() => {
    if (selectionStart === null || selectionStart < 0) {
      return { active: false, trigger: null, query: "", range: null };
    }
    return resolveAutocompleteState(text, selectionStart, triggers);
  }, [selectionStart, text, triggers]);

  const matches = useMemo(() => {
    if (!state.active || !state.trigger) {
      return [];
    }
    const source = triggers.find((entry) => entry.trigger === state.trigger);
    if (!source) {
      return [];
    }
    if (state.trigger === "@") {
      return source.items.slice(0, Math.max(0, maxResults));
    }
    const ranked = rankItems(source.items, state.query);
    return ranked.slice(0, Math.max(0, maxResults));
  }, [state.active, state.query, state.trigger, triggers, maxResults]);

  useEffect(() => {
    setHighlightIndex(0);
    setDismissed(false);
  }, [state.active, state.query, state.trigger, state.range?.start, state.range?.end]);

  const moveHighlight = (delta: number) => {
    if (matches.length === 0) {
      return;
    }
    setHighlightIndex((prev) => {
      const next = (prev + delta + matches.length) % matches.length;
      return next;
    });
  };

  const close = () => {
    setHighlightIndex(0);
    setDismissed(true);
  };

  return {
    active: state.active && matches.length > 0 && !dismissed,
    trigger: state.trigger,
    query: state.query,
    range: state.range,
    matches,
    highlightIndex,
    setHighlightIndex,
    moveHighlight,
    close,
  };
}
