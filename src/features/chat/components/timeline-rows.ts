import { AGENT_STATUS_ROLE, type Message } from "@/lib/ipc";
import { isCompactCommandRow, isResumeNudgeRow } from "../internal-rows";

export type ProcessItem = {
  type: "tool" | "thinking";
  text: string;
  live?: boolean;
  /** Target file of the tool call; renders as a file-type chip. */
  path?: string | null;
  /** Tool-call arguments (object / array / string); expandable in the timeline. */
  args?: unknown;
  /** Tool-call execution result/output. */
  result?: unknown;
};

export type TimelineRow =
  | { kind: "msg"; message: Message; turnFinal: boolean }
  | { kind: "process"; items: ProcessItem[]; firstSeq: number }
  /** Host-sent compaction (/compact): renders as one grey line in place of the
   *  bubble and stays there, so the compaction is still traceable later. */
  | { kind: "curtain"; seq: number };

/** Letters, digits, or emoji make a segment real content. Harnesses emit
 * bare placeholder segments ("·", ".") between tool batches; rendered as a
 * bubble they read as an empty box with a lone dot, and each one splits what
 * should be a single folded tool run into alternating chips. */
const CONTENT_RE = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

function isPlaceholderMessage(message: Message): boolean {
  return message.role === "assistant" && !CONTENT_RE.test(message.text);
}

/** Row wrapper caches keyed by message reference. The store grows rows
 * immutably (spread-copy on change), so a message whose reference survived a
 * stream flush reuses its wrapper and memoized row views skip it entirely.
 * WeakMaps keep no message alive beyond the session state that holds it. */
type MsgRow = Extract<TimelineRow, { kind: "msg" }>;
const msgRowCache = new WeakMap<Message, { final?: MsgRow; plain?: MsgRow }>();
const curtainRowCache = new WeakMap<Message, Extract<TimelineRow, { kind: "curtain" }>>();
const processItemCache = new WeakMap<Message, ProcessItem>();
const processRowCache = new WeakMap<
  Message,
  { items: ProcessItem[]; row: Extract<TimelineRow, { kind: "process" }> }
>();

function getMsgRow(message: Message, turnFinal: boolean): MsgRow {
  let slots = msgRowCache.get(message);
  if (!slots) {
    slots = {};
    msgRowCache.set(message, slots);
  }
  const cached = turnFinal ? slots.final : slots.plain;
  if (cached) return cached;
  const row: MsgRow = { kind: "msg", message, turnFinal };
  if (turnFinal) slots.final = row;
  else slots.plain = row;
  return row;
}

function getCurtainRow(message: Message): Extract<TimelineRow, { kind: "curtain" }> {
  let row = curtainRowCache.get(message);
  if (!row) {
    row = { kind: "curtain", seq: message.seq };
    curtainRowCache.set(message, row);
  }
  return row;
}

function getProcessItem(message: Message): ProcessItem {
  let item = processItemCache.get(message);
  if (!item) {
    item = {
      type: message.role === "tool" ? "tool" : "thinking",
      text: message.text,
      live: message.live,
      path: message.path,
      args: message.args,
      result: message.result,
    };
    processItemCache.set(message, item);
  }
  return item;
}

function getProcessRow(first: Message, items: ProcessItem[]): TimelineRow {
  const cached = processRowCache.get(first);
  // Items only ever append (or swap identity wholesale on settle), so an
  // element-wise reference check is a cheap, exact staleness test.
  if (
    cached &&
    cached.items.length === items.length &&
    cached.items.every((item, i) => item === items[i])
  ) {
    return cached.row;
  }
  const row: TimelineRow = { kind: "process", items, firstSeq: first.seq };
  processRowCache.set(first, { items, row });
  return row;
}

/** Fold runs of consecutive tool / thinking messages into single process
 * rows, preserving order — between two chat bubbles there is at most one
 * collapsed chip, never an alternating stack. Row objects are cached per
 * message reference, so rows unaffected by a flush keep their identity and
 * React.memo bails out on them. */
export function buildRows(messages: Message[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  let i = 0;
  while (i < messages.length) {
    const message = messages[i];
    if (message.role === AGENT_STATUS_ROLE || isPlaceholderMessage(message) || isResumeNudgeRow(message)) {
      i++;
      continue;
    }
    // The compaction command keeps its place as a grey line in the transcript.
    if (isCompactCommandRow(message)) {
      rows.push(getCurtainRow(message));
      i++;
      continue;
    }
    if (message.role === "tool" || message.role === "thinking") {
      const first = message;
      const items: ProcessItem[] = [];
      while (i < messages.length) {
        const step = messages[i];
        if (step.role === "tool" || step.role === "thinking") {
          items.push(getProcessItem(step));
        } else if (
          step.role !== AGENT_STATUS_ROLE &&
          !isPlaceholderMessage(step) &&
          !isResumeNudgeRow(step)
        ) {
          break;
        }
        i++;
      }
      rows.push(getProcessRow(first, items));
    } else {
      rows.push(getMsgRow(message, false));
      i++;
    }
  }
  // Footer (copy + meta) renders only on a reply's final assistant segment:
  // walk backwards, resetting at each user message. Cards (grant / question /
  // plan review) render their own chrome and must not consume the slot — a
  // denied tool used to leave the last assistant reply footerless. turnFinal
  // variants are cached too — a flip swaps in the other cached wrapper, no
  // mutation.
  let seenAssistant = false;
  for (let j = rows.length - 1; j >= 0; j--) {
    const row = rows[j];
    // A curtain row is a turn boundary like the user row it replaces: the
    // reply before it is final, the one after it starts a fresh turn.
    if (row.kind === "curtain") {
      seenAssistant = false;
      continue;
    }
    if (row.kind !== "msg") continue;
    if (row.message.role === "user") {
      seenAssistant = false;
    } else if (row.message.role === "assistant") {
      const turnFinal = !seenAssistant;
      seenAssistant = true;
      if (row.turnFinal !== turnFinal) rows[j] = getMsgRow(row.message, turnFinal);
    }
  }
  return rows;
}

export function rowKey(row: TimelineRow): string | number {
  if (row.kind === "msg") return row.message.seq;
  return row.kind === "curtain" ? `curtain-${row.seq}` : `process-${row.firstSeq}`;
}

export function toolEntranceKey(processId: number, index: number): string {
  return `${processId}:${index}`;
}

export function collectToolKeys(rows: TimelineRow[]): string[] {
  const keys: string[] = [];
  for (const row of rows) {
    if (row.kind !== "process") continue;
    row.items.forEach((item, index) => {
      if (item.type === "tool") keys.push(toolEntranceKey(row.firstSeq, index));
    });
  }
  return keys;
}

export function markToolKeys(seen: Set<string>, processId: number, items: ProcessItem[]) {
  items.forEach((item, index) => {
    if (item.type === "tool") seen.add(toolEntranceKey(processId, index));
  });
}
