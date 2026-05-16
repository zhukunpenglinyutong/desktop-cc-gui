import { useEffect, useMemo, useState } from "react";
import type { FilePreviewPayload } from "../hooks/useFilePreviewPayload";

type FileTabularPreviewProps = {
  payload: FilePreviewPayload | null;
  isLoading: boolean;
  error: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
};

type ParsedSheet = {
  name: string;
  rows: string[][];
  totalRows: number;
  totalColumns: number;
  rowTruncated: boolean;
  columnTruncated: boolean;
};

const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLUMNS = 30;
const MAX_TABULAR_PREVIEW_BYTES = 8 * 1024 * 1024;
const MAX_TABULAR_PREVIEW_MB = 8;

function normalizeCell(value: unknown) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function FileTabularPreview({
  payload,
  isLoading,
  error,
  t,
}: FileTabularPreviewProps) {
  const [sheets, setSheets] = useState<ParsedSheet[]>([]);
  const [activeSheetIndex, setActiveSheetIndex] = useState(0);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  useEffect(() => {
    if (!payload || payload.kind === "unsupported") {
      setSheets([]);
      setActiveSheetIndex(0);
      setParseError(null);
      setIsParsing(false);
      return;
    }

    if (payload.kind !== "inline-bytes" && payload.kind !== "file-handle") {
      setSheets([]);
      setActiveSheetIndex(0);
      setParseError(t("files.tabularPreviewUnavailable"));
      setIsParsing(false);
      return;
    }

    if (payload.kind === "file-handle" && payload.byteLength > MAX_TABULAR_PREVIEW_BYTES) {
      setSheets([]);
      setActiveSheetIndex(0);
      setParseError(t("files.tabularPreviewTooLarge", {
        maxMb: MAX_TABULAR_PREVIEW_MB,
      }));
      setIsParsing(false);
      return;
    }

    let cancelled = false;
    const abortController = new AbortController();
    setIsParsing(true);
    setParseError(null);

    void (async () => {
      try {
        const XLSX = await import("xlsx");
        let workbook: import("xlsx").WorkBook;
        if (payload.kind === "inline-bytes") {
          workbook = XLSX.read(payload.text, {
            type: "string",
            raw: false,
          });
        } else {
          const response = await fetch(payload.assetUrl, {
            signal: abortController.signal,
          });
          if (!response.ok) {
            throw new Error(`Failed to load preview source: ${response.status}`);
          }
          const arrayBuffer = await response.arrayBuffer();
          workbook = XLSX.read(arrayBuffer, {
            type: "array",
            raw: false,
          });
        }

        const nextSheets = workbook.SheetNames.map((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const rawRows = (XLSX.utils.sheet_to_json(worksheet, {
            header: 1,
            raw: false,
            blankrows: false,
            defval: "",
          }) as unknown[][]).map((row) => row.map(normalizeCell));
          const totalColumns = rawRows.reduce(
            (maxColumns, row) => Math.max(maxColumns, row.length),
            0,
          );
          return {
            name: sheetName,
            rows: rawRows
              .slice(0, MAX_TABLE_ROWS)
              .map((row) => row.slice(0, MAX_TABLE_COLUMNS)),
            totalRows: rawRows.length,
            totalColumns,
            rowTruncated: rawRows.length > MAX_TABLE_ROWS,
            columnTruncated: totalColumns > MAX_TABLE_COLUMNS,
          };
        });

        if (!cancelled) {
          setSheets(nextSheets);
          setActiveSheetIndex(0);
          setParseError(null);
          setIsParsing(false);
        }
      } catch (parseFailure) {
        if (!cancelled) {
          setSheets([]);
          setActiveSheetIndex(0);
          setParseError(
            parseFailure instanceof Error ? parseFailure.message : String(parseFailure),
          );
          setIsParsing(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [payload, t]);

  const activeSheet = useMemo(
    () => sheets[activeSheetIndex] ?? null,
    [activeSheetIndex, sheets],
  );

  if (isLoading || isParsing) {
    return <div className="fvp-status p-6 text-[13px] text-(--text-muted) text-center">{t("files.loadingFile")}</div>;
  }

  if (error || parseError) {
    return <div className="fvp-status fvp-error p-6 text-[13px] text-center text-(--text-danger,#f87171)">{error ?? parseError}</div>;
  }

  if (!activeSheet) {
    return <div className="fvp-status p-6 text-[13px] text-(--text-muted) text-center">{t("files.tabularPreviewUnavailable")}</div>;
  }

  const hasAnyCell = activeSheet.rows.some((row) => row.some((cell) => cell.length > 0));
  const showTruncationHint =
    activeSheet.rowTruncated ||
    activeSheet.columnTruncated ||
    (payload?.kind === "inline-bytes" && payload.truncated);

  return (
    <div className="fvp-preview-scroll flex-1 overflow-auto py-5 px-6 w-full min-w-0">
      <div className="fvp-tabular-preview flex flex-col gap-3 min-w-0">
        <header className="fvp-preview-section-header flex flex-wrap items-center justify-between gap-2.5 mb-3.5 text-(--fvp-reader-muted) text-[12px] [&_strong]:text-(--fvp-reader-text) [&_strong]:text-[13px] [&_strong]:font-bold">
          <strong>{t("files.tabularPreviewTitle")}</strong>
          <span>
            {t("files.tabularPreviewSheetStats", {
              rows: activeSheet.totalRows,
              columns: activeSheet.totalColumns,
            })}
          </span>
        </header>
        {sheets.length > 1 ? (
          <div className="fvp-tabular-sheet-tabs flex flex-wrap gap-2" role="tablist" aria-label={t("files.tabularPreviewSheets")}>
            {sheets.map((sheet, index) => (
              <button
                key={sheet.name}
                type="button"
                className={`fvp-tabular-sheet-tab rounded-full px-3 py-1.5 text-[12px] font-semibold border ${index === activeSheetIndex ? "is-active border-[color-mix(in_srgb,var(--border-accent)_66%,transparent)] bg-[color-mix(in_srgb,var(--surface-active)_52%,#5f9dff_10%)] text-(--text-stronger)" : "border-[color-mix(in_srgb,var(--border-subtle)_70%,transparent)] bg-[color-mix(in_srgb,var(--surface-control)_42%,transparent)] text-(--text-muted)"}`}
                onClick={() => setActiveSheetIndex(index)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
        ) : null}
        {showTruncationHint ? (
          <div className="fvp-preview-budget-hint mb-3.5 py-2.5 px-3 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[10px] bg-[color-mix(in_srgb,var(--surface-control)_42%,transparent)] text-(--fvp-reader-muted) text-[12px] leading-normal">
            {t("files.tabularPreviewTruncatedHint", {
              rows: MAX_TABLE_ROWS,
              columns: MAX_TABLE_COLUMNS,
            })}
          </div>
        ) : null}
        {hasAnyCell ? (
          <div className="fvp-tabular-table-wrap overflow-auto border border-[color-mix(in_srgb,var(--border-subtle)_68%,transparent)] rounded-xl bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)]">
            <table className="fvp-tabular-table w-full border-collapse min-w-140 [&_td]:border-b [&_td]:border-b-[color-mix(in_srgb,var(--border-subtle)_54%,transparent)] [&_td]:border-r [&_td]:border-r-[color-mix(in_srgb,var(--border-subtle)_42%,transparent)] [&_td]:py-2 [&_td]:px-2.5 [&_td]:text-(--fvp-reader-text) [&_td]:text-[12px] [&_td]:leading-normal [&_td]:align-top [&_td]:whitespace-pre-wrap [&_td]:wrap-break-word [&_tr:nth-child(odd)_td]:bg-[color-mix(in_srgb,var(--surface-control)_18%,transparent)]">
              <tbody>
                {activeSheet.rows.map((row, rowIndex) => (
                  <tr key={`sheet-row-${rowIndex}`}>
                    {Array.from({
                      length: Math.max(row.length, 1),
                    }).map((_, columnIndex) => (
                      <td key={`sheet-cell-${rowIndex}-${columnIndex}`}>
                        {row[columnIndex] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="fvp-status p-6 text-[13px] text-(--text-muted) text-center">{t("files.tabularPreviewEmpty")}</div>
        )}
      </div>
    </div>
  );
}
