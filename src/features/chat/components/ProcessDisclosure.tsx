import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useReducedMotion } from "motion/react";
import Brain from "lucide-react/dist/esm/icons/brain";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { cx } from "@/utils/cx";
import { StepRow, type TaskListChip } from "@/components/application/task-list/task-list";
import { getFileTreeIconSvg } from "@/features/files/fileIcons";
import { useChatFileOpener, type ChatFileOpener } from "@/features/chat/open-chat-file";
import { markToolKeys, toolEntranceKey, type ProcessItem } from "./timeline-rows";
import { ToolPayloadViewer } from "./ToolPayloadViewer";
import { useLiveReveal } from "./use-live-reveal";
import { useRevealed } from "./reveal-text";
import { createVisibleTextReader } from "./stream-reveal";

/** Classify a tool-call label (tool name or shell command) into a type chip. */
function toolTypeKey(text: string): string {
  const tokens = text.toLowerCase().split(/[^a-z_]+/).filter(Boolean);
  const tokenSet = new Set(tokens);
  const has = (...names: string[]) => names.some((name) => tokenSet.has(name));
  if (has("web_search", "websearch", "web", "fetch", "browse")) return "toolTypeWeb";
  if (has("bash", "sh", "shell", "zsh", "terminal", "run_command")) return "toolTypeShell";
  if (has("read", "cat", "view", "read_file", "open_file")) return "toolTypeRead";
  if (has("write", "edit", "write_file", "edit_file", "apply_patch", "patch", "sed")) return "toolTypeEdit";
  if (has("grep", "glob", "rg", "find", "ls", "search", "search_files")) return "toolTypeSearch";
  if (has("task", "agent", "spawn")) return "toolTypeTask";
  // Multi-word labels are shell commands surfaced by engines like codex.
  if (tokens.length > 1 || text.includes(" ")) return "toolTypeShell";
  return "toolTypeTool";
}

/** Tools whose path argument always names a file, or always a folder. The
 * rest (grep's path can be either) fall back to the extension heuristic. */
const FILE_TARGET_TOOLS = new Set(["read", "write", "edit", "multiedit", "notebookedit", "read_file", "write_file", "edit_file"]);
const FOLDER_TARGET_TOOLS = new Set(["ls", "glob", "list_directory"]);

function targetIsDir(tool: string, name: string): boolean {
  const key = tool.trim().toLowerCase();
  if (FILE_TARGET_TOOLS.has(key)) return false; // `Makefile`, `Dockerfile`
  if (FOLDER_TARGET_TOOLS.has(key)) return true; // `release/v1.2`
  // Same heuristic as the composer file tags: extension-less = folder.
  return !name.includes(".");
}

/** File chip for a tool call's target path. Glob patterns, URLs, and
 * path-less calls get no chip — a pattern is not a file you can open, and a
 * URL's last segment (search targets like `artifact://0` → "0") would render
 * as a meaningless folder chip. */
function fileChipFor(
  path: string | null | undefined,
  tool: string,
  opener: ChatFileOpener | null | undefined,
  t: TFunction,
): TaskListChip | null {
  if (!path || /[*?{}[\]]/.test(path) || path.includes("://")) return null;
  // Read selectors (`file.ts:301-591:raw`, `img.svg:img`) are read modifiers,
  // not part of the file name — strip trailing `:` segments that are line
  // ranges or selector keywords. (Windows drive `C:` survives: its segment
  // starts with a backslash path, not a digit/keyword.)
  const segments = path.split(":");
  while (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (/^\d/.test(last) || last === "raw" || last === "img" || last === "conflicts") {
      segments.pop();
    } else break;
  }
  const target = segments.join(":");
  const name = target.split(/[\\/]/).pop() ?? "";
  if (!name || name === "." || name === "..") return null;
  const isDir = targetIsDir(tool, name);
  return {
    label: name,
    icon: (
      <span
        aria-hidden
        className="text-foreground-icon-tertiary [&>svg]:size-3.5"
        dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(name, isDir) }}
      />
    ),
    // Folders have no file to open, and `~/` / `../` targets never resolve;
    // every other target opens in the center editor, which is also where
    // image targets land (ImageFileView + lightbox), so clicking a
    // screenshot's chip previews it.
    ...(opener && !isDir && opener.canOpen(target)
      ? {
          title: target,
          selectLabel: t("chat.toolFileOpen", { name }),
          onSelect: () => opener.open(target),
        }
      : {}),
  };
}

type ProcessSection =
  | { type: "thinking"; text: string; live?: boolean; firstIndex: number }
  | {
      type: "tools";
      calls: {
        text: string;
        path: string | null;
        args?: unknown;
        result?: unknown;
        index: number;
      }[];
      firstIndex: number;
    };

const PROCESS_PAGE_SIZE = 40;

export type ProcessSearchTarget = { itemIndex: number; requestKey: string };

function groupProcessSections(items: ProcessItem[], offset: number): ProcessSection[] {
  const sections: ProcessSection[] = [];
  items.forEach((item, localIndex) => {
    const index = offset + localIndex;
    if (item.type === "thinking") {
      sections.push({ type: "thinking", text: item.text, live: item.live, firstIndex: index });
    } else {
      const last = sections[sections.length - 1];
      const call = {
        text: item.text,
        path: item.path ?? null,
        args: item.args,
        result: item.result,
        index,
      };
      if (last?.type === "tools") last.calls.push(call);
      else sections.push({ type: "tools", calls: [call], firstIndex: index });
    }
  });
  return sections;
}

/** Freeze LogRow's `reduce` on first paint so a later parent render cannot
 * flip it mid-entrance (initial only runs on mount). */
const FrozenStepRow = memo(function FrozenStepRow({
  play,
  text,
  path,
  args,
  result,
  first,
  last,
  index,
  fileOpener,
}: {
  play: boolean;
  text: string;
  path: string | null;
  args?: unknown;
  result?: unknown;
  first: boolean;
  last: boolean;
  index: number;
  /** Opens a tool call's target file; null disables the chip affordance. */
  fileOpener?: ChatFileOpener | null;
}) {
  const reduceRef = useRef(!play);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hasPayload = args != null || result != null;
  const fileChip = fileChipFor(path, text, fileOpener, t);
  const step = {
    label: text,
    chips: [
      ...(fileChip ? [fileChip] : []),
      { label: t(`chat.${toolTypeKey(text)}`) },
    ],
  };
  return (
    <StepRow
      step={step}
      active={false}
      first={first}
      last={last}
      reduce={reduceRef.current}
    >
      <span data-process-item-index={index} />
      {hasPayload ? (
        <div className="-mt-0.5 mb-1">
          <button
            type="button"
            aria-expanded={open}
            aria-label={open ? t("chat.toolCallCollapse") : t("chat.toolCallExpand")}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
            className="flex cursor-pointer items-center gap-0.5 text-caption-1-regular text-text-tertiary transition-colors hover:text-text-secondary"
          >
            <ChevronRight
              className={cx("size-3 transition-transform duration-150", open && "rotate-90")}
              aria-hidden
            />
            <span>{t("chat.toolCallArgs")}</span>
          </button>
          {open ? (
            <ToolPayloadViewer
              toolName={text}
              path={path}
              args={args}
              result={result}
            />
          ) : null}
        </div>
      ) : null}
    </StepRow>
  );
});

/** Thinking body: brain header + left-railed gray content, mirroring the
 * reference chat UI. Plain pre-wrapped text — never markdown-reparsed per
 * delta — but paced by the same reveal as assistant markdown: a provider
 * burst (at 200 tok/s OMP writes ~100 characters every ~144ms) is spread
 * across the frames of its own arrival cadence instead of landing whole. */
export function ThinkingSurface({
  text,
  title,
  live,
  itemIndex,
}: {
  text: string;
  title?: string;
  live?: boolean;
  itemIndex?: number;
}) {
  const controller = useLiveReveal(text, Boolean(live));
  const revealed = useRevealed(controller, 0, text.length);
  const reader = useMemo(() => createVisibleTextReader(text), [text]);
  const body = live ? reader.prefix(revealed) : text;
  return (
    <div className="flex flex-col gap-1" data-process-item-index={itemIndex}>
      {title && (
        <div className="flex items-center gap-1.5 text-body-regular text-text-tertiary">
          <Brain className="size-3.5" aria-hidden />
          <span>{title}</span>
        </div>
      )}
      <div
        className="ml-2 whitespace-pre-wrap break-words border-l border-foreground-icon-quaternary pl-4 text-[12px] leading-[1.65] text-text-tertiary"
      >
        {body}
      </div>
    </div>
  );
}

type ExpansionProps = { auto: boolean; live: boolean; thinking: boolean; answered: boolean };


/** Pure transition table for the expanded-state machine: given the previous
 *  and current prop snapshot plus the user's override flag, decide the next
 *  expanded/overridden pair. Automation opens a run while it is the latest
 *  one and keeps it open through thinking pauses/resumes; it folds only once
 *  the run is actually over — assistant text appeared after it, or the turn
 *  settled. Thinking settles at every tool boundary, so folding there made a
 *  still-running process disappear mid-turn. A superseded or turn-settled
 *  row folds too, until the user's own click takes over. */
function expansionTransition(
  prev: ExpansionProps,
  next: ExpansionProps,
  expanded: boolean,
  overridden: boolean,
  thinkingAutoCollapse: boolean,
): { expanded: boolean; overridden: boolean } {
  if (next.auto && !prev.auto) {
    // Became the latest row: open it and hand control back to automation.
    return { expanded: true, overridden: false };
  }
  if (next.thinking && !prev.thinking && !overridden && !next.answered) {
    // Thinking resumed inside a still-running run (extended reasoning
    // between tool calls): show it again, unless answer text after this run
    // already marked the run as finished.
    return { expanded: true, overridden };
  }
  if (thinkingAutoCollapse && !overridden) {
    if (!next.auto && prev.auto) {
      // A newer process run took over: this one is no longer the live tail.
      return { expanded: false, overridden };
    }
    // Fold only when the run is actually over: the assistant started writing
    // text after it, or the turn settled. The thinking-settled edge alone is
    // not a boundary — it fires at every tool call.
    if (next.answered || (prev.live && !next.live)) {
      return { expanded: false, overridden };
    }
  }
  if (!next.auto && !next.live) {
    const superseded = prev.auto;
    const turnJustSettled = prev.live;
    if ((superseded || turnJustSettled) && !overridden) {
      return { expanded: false, overridden };
    }
  }
  return { expanded, overridden };
}


/** Expanded-state hook: holds the expanded flag and the user's override,
 *  delegating every prop-change decision to `expansionTransition`. */
function useProcessExpansion(
  autoExpand: boolean,
  turnLive: boolean,
  hasLiveThinking: boolean,
  answered: boolean,
  thinkingAutoCollapse: boolean,
  searchRequest?: string,
) {
  const [expanded, setExpanded] = useState(autoExpand || searchRequest !== undefined);
  // Once the user clicks the header, their choice wins over the auto
  // expand/collapse driven by streaming state.
  const [overridden, setOverridden] = useState(searchRequest !== undefined);
  // React-blessed adjust-during-render: previous prop values live in state,
  // so a prop change settles in the same commit that observed it — no
  // one-frame paint of the stale expanded value.
  const [prev, setPrev] = useState({ auto: autoExpand, live: turnLive, thinking: hasLiveThinking, answered, searchRequest });
  const next = { auto: autoExpand, live: turnLive, thinking: hasLiveThinking, answered, searchRequest };
  if (
    prev.auto !== next.auto
    || prev.live !== next.live
    || prev.thinking !== next.thinking
    || prev.answered !== next.answered
    || prev.searchRequest !== next.searchRequest
  ) {
    setPrev(next);
    const settled = searchRequest !== undefined && searchRequest !== prev.searchRequest
      ? { expanded: true, overridden: true }
      : expansionTransition(prev, next, expanded, overridden, thinkingAutoCollapse);
    // Setting state to its current value bails out without a re-render, so
    // the no-op transitions are free.
    setOverridden(settled.overridden);
    setExpanded(settled.expanded);
  }
  const toggleExpanded = () => {
    setOverridden(true);
    setExpanded((v) => !v);
  };
  return { expanded, toggleExpanded };
}

/** Count the first `limit` tool calls the entrance animation has not played for
 *  yet; a bounded scan keeps large processes cheap. */
function countUnseenTools(
  items: ProcessItem[],
  processId: number,
  seenTools: Set<string>,
  limit = 2,
): number {
  let count = 0;
  for (let index = 0; index < items.length && count < limit; index++) {
    if (items[index].type === "tool" && !seenTools.has(toolEntranceKey(processId, index))) {
      count++;
    }
  }
  return count;
}

/** Collapsed summary line: a lone thinking block is titled by the header
 * itself; mixed runs read "思考 N 次 工具调用 M 次". */
function processSummaryLabel(
  t: TFunction,
  singleThinking: boolean,
  thinkingCount: number,
  toolCount: number,
): string {
  return singleThinking
    ? t("chat.thinkingProcess")
    : thinkingCount > 0 && toolCount > 0
    ? t("chat.processSummary", { thinking: thinkingCount, tools: toolCount })
    : thinkingCount > 0
      ? t("chat.thinkingCount", { count: thinkingCount })
      : t("chat.toolCalls", { count: toolCount });
}

/** Expanded body: thinking runs as railed sections, tool sub-runs as tree
 * rows with file/type chips and a one-time blur-in per new tool call. */
function ProcessDisclosureBody({
  items,
  expanded,
  reduceMotion,
  singleThinking,
  processId,
  seenTools,
  searchTarget,
  fileOpener,
}: {
  items: ProcessItem[];
  expanded: boolean;
  reduceMotion: boolean;
  singleThinking: boolean;
  processId: number;
  seenTools: Set<string>;
  searchTarget?: ProcessSearchTarget;
  fileOpener?: ChatFileOpener | null;
}) {
  const { t } = useTranslation();
  const bodyRef = useRef<HTMLDivElement>(null);
  const [selectedPage, setSelectedPage] = useState<number | null>(() => searchTarget ? Math.floor(searchTarget.itemIndex / PROCESS_PAGE_SIZE) : null);
  const [handledSearch, setHandledSearch] = useState(searchTarget?.requestKey);
  if (handledSearch !== searchTarget?.requestKey) {
    setHandledSearch(searchTarget?.requestKey);
    if (searchTarget) setSelectedPage(Math.floor(searchTarget.itemIndex / PROCESS_PAGE_SIZE));
  }
  const lastPage = Math.max(0, Math.ceil(items.length / PROCESS_PAGE_SIZE) - 1);
  const page = Math.min(selectedPage ?? lastPage, lastPage);
  const start = page * PROCESS_PAGE_SIZE;
  const end = Math.min(start + PROCESS_PAGE_SIZE, items.length);
  const sections = useMemo(
    () => groupProcessSections(items.slice(start, end), start),
    [items, start, end],
  );
  const searchItemIndex = searchTarget?.itemIndex ?? null;
  const searchRequestKey = searchTarget?.requestKey;
  useEffect(() => {
    if (!expanded || searchItemIndex === null || Math.floor(searchItemIndex / PROCESS_PAGE_SIZE) !== page) return;
    const frame = requestAnimationFrame(() => {
      const marker = bodyRef.current?.querySelector<HTMLElement>(`[data-process-item-index="${searchItemIndex}"]`);
      const target = marker?.closest("li") ?? marker;
      target?.scrollIntoView?.({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [expanded, searchItemIndex, searchRequestKey, page]);
  const pageButtonClass = "cursor-pointer rounded px-2 py-1 text-caption-1-regular text-text-secondary hover:bg-background-secondary-default disabled:cursor-default disabled:opacity-40";
  return (
    <div ref={bodyRef} className="mt-2 flex flex-col gap-3">
      {lastPage > 0 && (
        <nav aria-label={t("chat.processHistoryPages")} className="flex flex-wrap items-center gap-1">
          <button type="button" className={pageButtonClass} disabled={page === 0} onClick={() => setSelectedPage(page - 1)}>
            {t("chat.processPreviousPage")}
          </button>
          <span className="text-caption-1-regular text-text-tertiary" aria-live="off">
            {t("chat.processPageRange", { start: start + 1, end, total: items.length })}
          </span>
          <button type="button" className={pageButtonClass} disabled={page === lastPage} onClick={() => setSelectedPage(page + 1 === lastPage ? null : page + 1)}>
            {t("chat.processNextPage")}
          </button>
          <button type="button" className={pageButtonClass} disabled={selectedPage === null} onClick={() => setSelectedPage(null)}>
            {t("chat.processLatestPage")}
          </button>
        </nav>
      )}
      {sections.map((section) =>
        section.type === "thinking" ? (
          <ThinkingSurface key={section.firstIndex} text={section.text} title={singleThinking ? undefined : t("chat.thinkingProcess")} live={section.live} itemIndex={section.firstIndex} />
        ) : (
          <ul key={section.firstIndex} className="ml-2 flex flex-col">
            {section.calls.map((call, j) => {
              const play =
                expanded &&
                !reduceMotion &&
                !seenTools.has(toolEntranceKey(processId, call.index));
              return (
                <FrozenStepRow
                  key={call.index}
                  index={call.index}
                  play={play}
                  text={call.text}
                  path={call.path}
                  args={call.args}
                  result={call.result}
                  first={j === 0}
                  last={j === section.calls.length - 1}
                  fileOpener={fileOpener}
                />
              );
            })}
          </ul>
        ),
      )}
    </div>
  );
}

const PROCESS_COLLAPSE_MS = 300;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A run of middle steps (thinking + tool calls) between chat bubbles: one
 * collapsed summary line ("思考 N 次 工具调用 M 次 >").
 * Expanding shows every step in order — thinking as railed sections, tool
 * sub-runs as tree rows. Height clips via grid-rows (no scaleY/opacity — those
 * leave a compositor ghost over the next bubble). Historical bodies unmount
 * after the close animation so the virtualizer does not keep every SVG tree. */

export const ProcessDisclosure = memo(function ProcessDisclosure({
  items,
  autoExpand = false,
  turnLive = false,
  answered = false,
  thinkingAutoCollapse = true,
  processId,
  seenTools,
  searchTarget,
  workspacePath = "",
}: {
  items: ProcessItem[];
  autoExpand?: boolean;
  /** True while the turn is still streaming. A run folds when assistant text
   *  starts after it or, with no answer text, when this goes false. */
  turnLive?: boolean;
  /** True once assistant text exists after this process run in the same turn.
   *  That — not a thinking-settled edge at a tool boundary — is when the run
   *  may fold. */
  answered?: boolean;
  /** True (default): fold a process run, including tools only, once answer
   *  text follows it or the turn settles. False (设置 → 通用 → 行为): keep the
   *  run expanded; the user can still fold it by hand. */
  thinkingAutoCollapse?: boolean;
  processId: number;
  seenTools: Set<string>;
  searchTarget?: ProcessSearchTarget;
  /** Session workspace root, anchoring relative tool paths for the
   *  click-to-open chips. Empty keeps the chips inert. */
  workspacePath?: string;
}) {
  const { t } = useTranslation();
  const fileOpener = useChatFileOpener(workspacePath);
  const hasLiveThinking = items.some((item) => item.type === "thinking" && item.live);
  const { expanded, toggleExpanded } = useProcessExpansion(
    autoExpand,
    turnLive,
    hasLiveThinking,
    answered,
    thinkingAutoCollapse,
    searchTarget?.requestKey,
  );
  const reduceMotion = useReducedMotion() ?? false;
  const largeProcess = items.length > PROCESS_PAGE_SIZE;
  const unseenToolCount = largeProcess
    ? 0
    : countUnseenTools(items, processId, seenTools);
  const skipProcessAnimation = reduceMotion || largeProcess || unseenToolCount > 1;
  // Mark after paint, not at animation complete: a virtualizer remount
  // mid-entrance must skip the replay. New keys still play on this first
  // paint because the set is read before this effect runs.
  useLayoutEffect(() => {
    markToolKeys(seenTools, processId, items);
  }, [items, processId, seenTools]);
  const thinkingCount = items.filter((item) => item.type === "thinking").length;
  const toolCount = items.length - thinkingCount;
  // A lone thinking block skips the "思考 1 次" summary: the header is the
  // "思考过程" title itself, and the expanded body drops the inner repeat.
  const singleThinking = items.length === 1 && items[0].type === "thinking";
  const label = processSummaryLabel(t, singleThinking, thinkingCount, toolCount);
  // A folded row does not keep live thinking mounted (or revealing) behind
  // the clipped grid: expanding is the user's explicit request, and a fresh
  // mount publishes everything already received.
  const showBody = expanded;
  const [bodyMounted, setBodyMounted] = useState(showBody);
  useLayoutEffect(() => {
    if (showBody) {
      setBodyMounted(true);
      return;
    }
    if (skipProcessAnimation || prefersReducedMotion()) {
      setBodyMounted(false);
      return;
    }
    const timeout = window.setTimeout(() => setBodyMounted(false), PROCESS_COLLAPSE_MS);
    return () => window.clearTimeout(timeout);
  }, [showBody, skipProcessAnimation]);
  return (
    <div className="mb-1.5 flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={toggleExpanded}
        className="flex w-full cursor-pointer flex-col text-left"
      >
        <span className="flex items-center gap-1 py-0.5 text-body-regular text-text-secondary transition-colors hover:text-text-primary">
          {singleThinking && <Brain className="size-3.5" aria-hidden />}
          {label}
          <ChevronRight
            className={cx("size-3.5 transition-transform duration-200", expanded && "rotate-90")}
            aria-hidden
          />
        </span>
      </button>
      {/* Height-only clip, not AnimatePresence / scaleY: a presence context
          with initial={false} silently cancels each StepRow's blur-in, and
          scaleY+opacity leaves a compositor ghost over the next bubble. */}
      <div
        aria-hidden={!expanded}
        className={cx(
          "grid",
          !skipProcessAnimation && "transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {bodyMounted ? (
            <ProcessDisclosureBody
              key={processId}
              items={items}
              expanded={expanded}
              reduceMotion={skipProcessAnimation}
              singleThinking={singleThinking}
              processId={processId}
              seenTools={seenTools}
              searchTarget={searchTarget}
              fileOpener={fileOpener}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
});
