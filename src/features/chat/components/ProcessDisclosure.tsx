import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { m, useReducedMotion } from "motion/react";
import Brain from "lucide-react/dist/esm/icons/brain";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { cx } from "@/utils/cx";
import { SOFT_EASE } from "@/components/application/agent-log/agent-log-motion";
import { StepRow, type TaskListChip, type TaskListStep } from "@/components/application/task-list/task-list";
import { getFileTreeIconSvg } from "@/features/files/fileIcons";
import { markToolKeys, toolEntranceKey, type ProcessItem } from "./timeline-rows";

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

/** File chip for a tool call's target path. Glob patterns, URLs, and
 * path-less calls get no chip — a pattern is not a file you can open, and a
 * URL's last segment (search targets like `artifact://0` → "0") would render
 * as a meaningless folder chip. */
function fileChipFor(path: string | null | undefined): TaskListChip | null {
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
  const name = segments.join(":").split(/[\\/]/).pop() ?? "";
  if (!name || name === "." || name === "..") return null;
  // Same heuristic as the composer file tags: extension-less = folder.
  const isDir = !name.includes(".");
  return {
    label: name,
    icon: (
      <span
        aria-hidden
        className="text-foreground-icon-tertiary [&>svg]:size-3.5"
        dangerouslySetInnerHTML={{ __html: getFileTreeIconSvg(name, isDir) }}
      />
    ),
  };
}

type ProcessSection =
  | { type: "thinking"; text: string; live?: boolean; firstIndex: number }
  | { type: "tools"; calls: { text: string; path: string | null; index: number }[]; firstIndex: number };

function groupProcessSections(items: ProcessItem[]): ProcessSection[] {
  const sections: ProcessSection[] = [];
  items.forEach((item, index) => {
    if (item.type === "thinking") {
      sections.push({ type: "thinking", text: item.text, live: item.live, firstIndex: index });
    } else {
      const last = sections[sections.length - 1];
      const call = { text: item.text, path: item.path ?? null, index };
      if (last?.type === "tools") last.calls.push(call);
      else sections.push({ type: "tools", calls: [call], firstIndex: index });
    }
  });
  return sections;
}

/** Freeze LogRow's `reduce` on first paint so a later parent render cannot
 * flip it mid-entrance (initial only runs on mount). */
function FrozenStepRow({
  play,
  step,
  first,
  last,
}: {
  play: boolean;
  step: TaskListStep;
  first: boolean;
  last: boolean;
}) {
  const reduceRef = useRef(!play);
  return (
    <StepRow
      step={step}
      active={false}
      first={first}
      last={last}
      reduce={reduceRef.current}
    />
  );
}

/** Live thinking window: the last ~2000 chars, cut at a LINE boundary so a
 *  row slides out as a whole instead of dissolving character by character.
 *  `truncated` tells the surface to fade its top edge, hinting at the
 *  content above the window. */
function liveThinkingWindow(text: string): { body: string; truncated: boolean } {
  const WINDOW_CHARS = 2000;
  if (text.length <= WINDOW_CHARS) return { body: text, truncated: false };
  const cut = text.length - WINDOW_CHARS;
  const newline = text.indexOf("\n", cut);
  // No newline inside the window (one enormous line): keep the char cut —
  // there is no line boundary to honor.
  const start = newline === -1 ? cut : newline + 1;
  return { body: text.slice(start), truncated: true };
}

/** Thinking body: brain header + left-railed gray content, mirroring the
 * reference chat UI. Plain pre-wrapped text — never markdown-reparsed per
 * delta. The live view is windowed to the last 2000 chars; the cut lands on
 * a line boundary and the top edge fades out, so overflow leaves as whole
 * dissolving rows rather than a hard char-by-char wipe. */
function ThinkingSurface({
  text,
  title,
  live,
}: {
  text: string;
  title?: string;
  live?: boolean;
}) {
  const { body, truncated } = live ? liveThinkingWindow(text) : { body: text, truncated: false };
  return (
    <div className="flex flex-col gap-1">
      {title && (
        <div className="flex items-center gap-1.5 text-body-regular text-text-tertiary">
          <Brain className="size-3.5" aria-hidden />
          <span>{title}</span>
        </div>
      )}
      <div
        className={cx(
          "ml-2 whitespace-pre-wrap break-words border-l border-foreground-icon-quaternary pl-4 text-[12px] leading-[1.65] text-text-tertiary",
          truncated &&
            "[mask-image:linear-gradient(to_bottom,transparent_0,#000_36px)] [-webkit-mask-image:linear-gradient(to_bottom,transparent_0,#000_36px)]",
        )}
      >
        {body}
      </div>
    </div>
  );
}

/** Expanded-state machine: automation opens the latest row and folds older
 * ones as the turn settles, until the user's own click takes over. */
function useProcessExpansion(autoExpand: boolean, turnLive: boolean) {
  const [expanded, setExpanded] = useState(autoExpand);
  // Once the user clicks the header, their choice wins over the auto
  // expand/collapse driven by newer rows appearing below.
  const [overridden, setOverridden] = useState(false);
  // React-blessed adjust-during-render: previous prop values live in state,
  // so a prop change settles in the same commit that observed it — no
  // one-frame paint of the stale expanded value.
  const [prev, setPrev] = useState({ auto: autoExpand, live: turnLive });
  if (prev.auto !== autoExpand || prev.live !== turnLive) {
    setPrev({ auto: autoExpand, live: turnLive });
    if (autoExpand && !prev.auto) {
      // Became the latest row: open it and hand control back to automation.
      setOverridden(false);
      setExpanded(true);
    } else if (!autoExpand && !turnLive) {
      const superseded = prev.auto;
      const turnJustSettled = prev.live;
      if ((superseded || turnJustSettled) && !overridden) {
        setExpanded(false);
      }
    }
  }
  const toggleExpanded = () => {
    setOverridden(true);
    setExpanded((v) => !v);
  };
  return { expanded, toggleExpanded };
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
  sections,
  expanded,
  reduceMotion,
  singleThinking,
  processId,
  seenTools,
}: {
  sections: ProcessSection[];
  expanded: boolean;
  reduceMotion: boolean;
  singleThinking: boolean;
  processId: number;
  seenTools: Set<string>;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex flex-col gap-3">
      {sections.map((section) =>
        section.type === "thinking" ? (
          <ThinkingSurface key={section.firstIndex} text={section.text} title={singleThinking ? undefined : t("chat.thinkingProcess")} live={section.live} />
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
                  play={play}
                  step={{
                    label: call.text,
                    chips: [
                      ...[fileChipFor(call.path)].filter((c): c is TaskListChip => c !== null),
                      { label: t(`chat.${toolTypeKey(call.text)}`) },
                    ],
                  }}
                  first={j === 0}
                  last={j === section.calls.length - 1}
                />
              );
            })}
          </ul>
        ),
      )}
    </div>
  );
}

/** A run of middle steps (thinking + tool calls) between chat bubbles: one
 * collapsed summary line ("思考 N 次 工具调用 M 次 >").
 * Expanding shows every step in order — thinking as railed sections, tool
 * sub-runs as tree rows. The wrapper stays mounted and collapses by transform so
 * AnimatePresence cannot swallow each StepRow's blur-in; historical bodies
 * unmount while collapsed so the virtualizer does not keep every SVG tree. */
export const ProcessDisclosure = memo(function ProcessDisclosure({
  items,
  autoExpand = false,
  turnLive = false,
  processId,
  seenTools,
}: {
  items: ProcessItem[];
  autoExpand?: boolean;
  /** True while the turn is still streaming: nothing folds away mid-turn —
   * the reader may be watching a row grow. Older rows fold when the turn
   * settles instead. */
  turnLive?: boolean;
  processId: number;
  seenTools: Set<string>;
}) {
  const { t } = useTranslation();
  const { expanded, toggleExpanded } = useProcessExpansion(autoExpand, turnLive);
  const reduceMotion = useReducedMotion() ?? false;
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
  // Regrouping per render walks every item; items are reference-stable
  // between flushes (see buildRows caches), so memo on identity.
  const sections = useMemo(() => groupProcessSections(items), [items]);
  const showBody = expanded || turnLive;
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
      {/* Scale-animate in place rather than through AnimatePresence: a presence
          context with initial={false} silently cancels each StepRow's blur-in.
          initial={false} here only pins THIS element's first paint, so a
          virtualized remount of an already-open row does not flash shut. */}
      <m.div
        initial={false}
        animate={{ scaleY: expanded ? 1 : 0, opacity: expanded ? 1 : 0 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : {
                scaleY: { duration: 0.3, ease: SOFT_EASE },
                opacity: { duration: 0.22, ease: "easeOut" },
              }
        }
        style={{ transformOrigin: "top" }}
        className={cx("overflow-hidden", !expanded && "h-0")}
        aria-hidden={!expanded}
      >
        {showBody ? (
          <ProcessDisclosureBody
            sections={sections}
            expanded={expanded}
            reduceMotion={reduceMotion}
            singleThinking={singleThinking}
            processId={processId}
            seenTools={seenTools}
          />
        ) : null}
      </m.div>
    </div>
  );
});
