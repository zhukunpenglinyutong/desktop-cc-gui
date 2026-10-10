import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer, type ReactVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import { IconButton } from "@/components/base/buttons/icon-button";
import { ipc, type GitFileEntry, type GitStatus } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { cx } from "@/utils/cx";
import type { DiffTarget } from "./store";

/* -------------------------------------------------------------------------- */

const DIFF_TRUNCATE_LINES = 2000;
const DIFF_VIRTUALIZE_LINES = 500;

export function DiffView({
  workspacePath,
  target,
  status,
  onBack,
}: {
  workspacePath: string;
  target: DiffTarget;
  status: GitStatus | undefined;
  onBack: () => void;
}) {
  const [diffText, setDiffText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reload when the target changes or when THIS file's status row changes
  // (stage/unstage flips its list membership, edits move add/del counts).
  // Depending on the whole `status` object reloaded the diff on every
  // background poll refresh — a new object each time — even when this file
  // was untouched.
  const entry = findStatusEntry(status, target);
  const entrySig = entrySignature(entry);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    ipc
      .gitDiff(workspacePath, target.file, target.staged)
      .then((text) => {
        if (!cancelled) setDiffText(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, target.file, target.staged, entrySig]);

  const { lines, truncated } = useMemo<{ lines: AnnotatedLine[] | null; truncated: boolean }>(() => {
    if (diffText === null) return { lines: null, truncated: false };
    const all = diffText.split("\n");
    const over = all.length > DIFF_TRUNCATE_LINES;
    return { lines: annotateDiff(over ? all.slice(0, DIFF_TRUNCATE_LINES) : all), truncated: over };
  }, [diffText]);

  const virtualize = lines !== null && lines.length > DIFF_VIRTUALIZE_LINES;

  const rowVirtualizer = useVirtualizer({
    count: virtualize && lines ? lines.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DiffViewHeader file={target.file} staged={target.staged} onBack={onBack} />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <DiffContent
          error={error}
          lines={lines}
          truncated={truncated}
          virtualize={virtualize}
          rowVirtualizer={rowVirtualizer}
        />
      </div>
    </div>
  );
}

/** Back button + file path + staged/unstaged label above the diff. */
function DiffViewHeader({
  file,
  staged,
  onBack,
}: {
  file: string;
  staged: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 border-b border-separator-border px-2 py-1.5">
      <IconButton
        icon={ArrowLeft}
        size="small"
        aria-label={t("git.back")}
        onClick={onBack}
      />
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-text-secondary"
        title={file}
      >
        {file}
      </span>
      <span className="shrink-0 text-xs text-text-tertiary">
        {staged ? t("git.staged") : t("git.unstaged")}
      </span>
    </div>
  );
}

/** Error / loading / virtualized / plain render branches of the diff body. */
function DiffContent({
  error,
  lines,
  truncated,
  virtualize,
  rowVirtualizer,
}: {
  error: string | null;
  lines: AnnotatedLine[] | null;
  truncated: boolean;
  virtualize: boolean;
  rowVirtualizer: ReactVirtualizer<HTMLDivElement, Element>;
}) {
  const { t } = useTranslation();
  return (
    <>
      {error ? (
        <p className="p-3 text-xs text-text-error-primary">{error}</p>
      ) : lines === null ? (
        <p className="p-3 text-body-medium text-text-tertiary">{t("common.loading")}</p>
      ) : virtualize ? (
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-index={row.index}
              ref={rowVirtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                transform: `translateY(${row.start}px)`,
              }}
              className="w-full"
            >
              <DiffLine line={lines[row.index]} />
            </div>
          ))}
        </div>
      ) : (
        <div className="py-1">
          {lines.map((line) => (
            <DiffLine key={`${line.oldNo ?? ""}-${line.newNo ?? ""}-${line.text}`} line={line} />
          ))}
        </div>
      )}
      {truncated && lines !== null && (
        <p className="sticky bottom-0 bg-background-primary-default px-3 py-1.5 text-xs text-text-tertiary">
          {t("git.diffTooLarge")}
        </p>
      )}
    </>
  );
}

interface AnnotatedLine {
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** The status row for the diff target: staged list, else unstaged/untracked. */
function findStatusEntry(
  status: GitStatus | undefined,
  target: DiffTarget,
): GitFileEntry | undefined {
  return target.staged
    ? status?.staged.find((e) => e.path === target.file)
    : (status?.unstaged.find((e) => e.path === target.file) ??
        status?.untracked.find((e) => e.path === target.file));
}

/** Changes when the file's status row does — used to retrigger the diff load. */
function entrySignature(entry: GitFileEntry | undefined): string {
  return entry
    ? `${entry.status}:${entry.additions ?? ""}:${entry.deletions ?? ""}`
    : "";
}

/** Assign old/new line numbers from @@ hunk headers (unified diff). */
function annotateDiff(lines: string[]): AnnotatedLine[] {
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  return lines.map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
      return { text, oldNo: null, newNo: null };
    }
    if (!inHunk) return { text, oldNo: null, newNo: null };
    if (text.startsWith("+")) return { text, oldNo: null, newNo: newLine++ };
    if (text.startsWith("-")) return { text, oldNo: oldLine++, newNo: null };
    return { text, oldNo: oldLine++, newNo: newLine++ };
  });
}

/** Classify a unified-diff line; `+++`/`---` file headers are not add/del. */
function diffLineKind(text: string): "add" | "del" | "hunk" | null {
  if (text.startsWith("+") && !text.startsWith("+++")) return "add";
  if (text.startsWith("-") && !text.startsWith("---")) return "del";
  if (text.startsWith("@@")) return "hunk";
  return null;
}

const DiffLine = memo(function DiffLine({ line }: { line: AnnotatedLine }) {
  const text = line.text;
  const kind = diffLineKind(text);
  return (
    <div
      className={cx(
        "code-typography flex whitespace-pre-wrap break-all font-mono leading-[1.6]",
        kind === "add" && "bg-green-500/10",
        kind === "del" && "bg-red-500/10",
      )}
    >
      <span className="w-9 shrink-0 pr-2 text-right text-text-tertiary select-none">
        {line.oldNo ?? ""}
      </span>
      <span className="w-9 shrink-0 pr-2 text-right text-text-tertiary select-none">
        {line.newNo ?? ""}
      </span>
      <span
        className={cx(
          "min-w-0 flex-1 pr-3",
          kind === "add" && "text-state-success-text",
          kind === "del" && "text-text-error-primary",
          kind === "hunk" && "text-status-blue-text",
          kind === null && "text-text-secondary",
        )}
      >
        {text.length > 0 ? text : " "}
      </span>
    </div>
  );
});
