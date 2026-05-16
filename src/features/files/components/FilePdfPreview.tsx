import { useEffect, useMemo, useRef, useState } from "react";
import {
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import { ensurePdfPreviewWorker } from "../utils/pdfPreviewRuntime";
import { PreviewOutlineSidebar } from "./PreviewOutlineSidebar";
import {
  extractPdfPreviewOutline,
  type PreviewOutlineItem,
} from "../utils/filePreviewOutline";

type FilePdfPreviewProps = {
  assetUrl: string | null;
  isLoading: boolean;
  error: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
};

type PdfPageCanvasProps = {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  t: (key: string, options?: Record<string, unknown>) => string;
};

const MAX_PDF_PREVIEW_PAGES = 200;
const PDF_PAGE_WINDOW_OFFSET = 5;
const DEFAULT_PDF_SCALE = 1.15;
const MIN_PDF_SCALE = 0.75;
const MAX_PDF_SCALE = 3;
const PDF_SCALE_STEP = 0.1;

function PdfPageCanvas({ pdfDocument, pageNumber, scale, t }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pageRootRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(pageNumber <= 2);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const node = pageRootRef.current;
    if (!node || shouldRender || typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldRender(true);
      }
    }, { rootMargin: "240px 0px" });

    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldRender]);

  useEffect(() => {
    if (!shouldRender || !canvasRef.current) {
      return;
    }

    let disposed = false;
    let renderTask: RenderTask | null = null;
    setPageError(null);

    void (async () => {
      try {
        const page = await pdfDocument.getPage(pageNumber);
        if (disposed || !canvasRef.current) {
          return;
        }
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas context unavailable.");
        }
        const devicePixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * devicePixelRatio);
        canvas.height = Math.floor(viewport.height * devicePixelRatio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTask.promise;
        if (!disposed) {
          page.cleanup();
        }
      } catch (error) {
        if (!disposed) {
          setPageError(error instanceof Error ? error.message : String(error));
        }
      }
    })();

    return () => {
      disposed = true;
      renderTask?.cancel();
    };
  }, [pageNumber, pdfDocument, scale, shouldRender]);

  return (
    <div ref={pageRootRef} className="fvp-pdf-page flex flex-col gap-2.5 p-3.5 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[14px] bg-[color-mix(in_srgb,var(--surface-card)_88%,transparent)]" data-page-number={pageNumber}>
      <header className="fvp-pdf-page-header flex items-center justify-between text-(--fvp-reader-muted) text-[12px] font-semibold">
        <span>{t("files.pdfPreviewPageLabel", { page: pageNumber })}</span>
      </header>
      {pageError ? (
        <div className="fvp-pdf-page-error flex min-h-24 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--surface-control)_40%,transparent)] text-(--status-error) text-center text-[12px]">{pageError}</div>
      ) : shouldRender ? (
        <canvas ref={canvasRef} className="fvp-pdf-canvas w-full max-w-full self-center rounded-xl bg-white shadow-[0_12px_32px_rgba(0,0,0,0.18)]" />
      ) : (
        <div className="fvp-pdf-page-placeholder flex min-h-24 items-center justify-center rounded-[10px] bg-[color-mix(in_srgb,var(--surface-control)_40%,transparent)] text-(--fvp-reader-muted) text-center text-[12px]">{t("files.pdfPreviewPagePlaceholder")}</div>
      )}
    </div>
  );
}

export function FilePdfPreview({
  assetUrl,
  isLoading,
  error,
  t,
}: FilePdfPreviewProps) {
  const previewRootRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollPageNumberRef = useRef<number | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isRuntimeLoading, setIsRuntimeLoading] = useState(false);
  const [outlineItems, setOutlineItems] = useState<PreviewOutlineItem[]>([]);
  const [activeOutlineItemId, setActiveOutlineItemId] = useState<string | null>(null);
  const [pageWindowStart, setPageWindowStart] = useState(1);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(false);
  const [pdfScale, setPdfScale] = useState(DEFAULT_PDF_SCALE);

  useEffect(() => {
    if (!assetUrl) {
      setPdfDocument(null);
      setNumPages(0);
      setRuntimeError(null);
      setIsRuntimeLoading(false);
      setOutlineItems([]);
      setActiveOutlineItemId(null);
      setPageWindowStart(1);
      setIsOutlineCollapsed(false);
      setPdfScale(DEFAULT_PDF_SCALE);
      return;
    }

    ensurePdfPreviewWorker();
    setPdfDocument(null);
    setNumPages(0);
    setRuntimeError(null);
    setIsRuntimeLoading(true);
    setOutlineItems([]);
    setActiveOutlineItemId(null);
    setPageWindowStart(1);
    setIsOutlineCollapsed(false);
    setPdfScale(DEFAULT_PDF_SCALE);
    let disposed = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let loadedDocument: PDFDocumentProxy | null = null;

    void (async () => {
      try {
        loadingTask = getDocument(assetUrl);
        const nextDocument = await loadingTask.promise;
        loadedDocument = nextDocument;
        if (disposed) {
          await nextDocument.destroy();
          return;
        }
        setPdfDocument(nextDocument);
        setNumPages(nextDocument.numPages);
        setRuntimeError(null);
        setIsRuntimeLoading(false);
      } catch (loadError) {
        if (!disposed) {
          setPdfDocument(null);
          setNumPages(0);
          setRuntimeError(loadError instanceof Error ? loadError.message : String(loadError));
          setIsRuntimeLoading(false);
        }
      }
    })();

    return () => {
      disposed = true;
      if (loadedDocument) {
        void loadedDocument.destroy();
      } else {
        void loadingTask?.destroy();
      }
    };
  }, [assetUrl]);

  useEffect(() => {
    if (!pdfDocument) {
      setOutlineItems([]);
      setActiveOutlineItemId(null);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const nextOutlineItems = await extractPdfPreviewOutline(
          pdfDocument,
          t("files.previewOutlineUntitled"),
        );
        if (!cancelled) {
          setOutlineItems(nextOutlineItems);
        }
      } catch {
        if (!cancelled) {
          setOutlineItems([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfDocument, t]);

  const maxPageWindowStart = Math.max(1, numPages - MAX_PDF_PREVIEW_PAGES + 1);
  const normalizedPageWindowStart = Math.min(pageWindowStart, maxPageWindowStart);
  const visiblePageCount = Math.min(
    MAX_PDF_PREVIEW_PAGES,
    Math.max(0, numPages - normalizedPageWindowStart + 1),
  );
  const isPageCountTruncated = numPages > MAX_PDF_PREVIEW_PAGES;
  const visiblePageNumbers = useMemo(
    () => Array.from({ length: visiblePageCount }, (_, index) => normalizedPageWindowStart + index),
    [normalizedPageWindowStart, visiblePageCount],
  );

  const scrollToRenderedPage = (pageNumber: number) => {
    const pageNode = previewRootRef.current?.querySelector<HTMLElement>(
      `[data-page-number="${pageNumber}"]`,
    );
    pageNode?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const handleSelectOutlineItem = (item: PreviewOutlineItem) => {
    if (item.target.kind !== "pdf-page") {
      return;
    }
    const nextPageNumber = item.target.pageNumber;
    if (!Number.isInteger(nextPageNumber) || nextPageNumber < 1 || nextPageNumber > numPages) {
      return;
    }
    const nextWindowStart = Math.min(
      Math.max(nextPageNumber - PDF_PAGE_WINDOW_OFFSET, 1),
      maxPageWindowStart,
    );

    setActiveOutlineItemId(item.id);
    pendingScrollPageNumberRef.current = nextPageNumber;
    setPageWindowStart(nextWindowStart);

    if (
      nextWindowStart === normalizedPageWindowStart &&
      nextPageNumber >= normalizedPageWindowStart &&
      nextPageNumber < normalizedPageWindowStart + visiblePageCount
    ) {
      scrollToRenderedPage(nextPageNumber);
      pendingScrollPageNumberRef.current = null;
    }
  };

  useEffect(() => {
    const pendingPageNumber = pendingScrollPageNumberRef.current;
    if (!pendingPageNumber) {
      return;
    }
    scrollToRenderedPage(pendingPageNumber);
    pendingScrollPageNumberRef.current = null;
  }, [visiblePageNumbers]);

  const handleZoomOut = () => {
    setPdfScale((currentScale) => Math.max(
      MIN_PDF_SCALE,
      Math.round((currentScale - PDF_SCALE_STEP) * 100) / 100,
    ));
  };

  const handleZoomIn = () => {
    setPdfScale((currentScale) => Math.min(
      MAX_PDF_SCALE,
      Math.round((currentScale + PDF_SCALE_STEP) * 100) / 100,
    ));
  };

  const handleResetZoom = () => {
    setPdfScale(DEFAULT_PDF_SCALE);
  };

  if (isLoading || isRuntimeLoading) {
    return <div className="fvp-status p-6 text-[13px] text-(--text-muted) text-center">{t("files.loadingFile")}</div>;
  }

  if (error || runtimeError) {
    return <div className="fvp-status fvp-error p-6 text-[13px] text-center text-[var(--text-danger,#f87171)]">{error ?? runtimeError}</div>;
  }

  if (!assetUrl || !pdfDocument) {
    return <div className="fvp-status p-6 text-[13px] text-(--text-muted) text-center">{t("files.pdfPreviewUnavailable")}</div>;
  }

  return (
    <div className="fvp-preview-scroll flex-1 overflow-auto py-5 px-6 w-full min-w-0">
      <div className={`fvp-preview-shell grid grid-cols-[minmax(220px,280px)_minmax(0,1fr)] max-[980px]:grid-cols-[minmax(0,1fr)] gap-5 items-start ${isOutlineCollapsed ? "is-outline-collapsed !grid-cols-[minmax(0,1fr)]" : ""}`}>
        {!isOutlineCollapsed ? (
          <PreviewOutlineSidebar
            title={t("files.previewOutlineTitle")}
            emptyLabel={t("files.pdfPreviewOutlineEmpty")}
            items={outlineItems}
            activeItemId={activeOutlineItemId}
            onSelectItem={handleSelectOutlineItem}
          />
        ) : null}
        <div ref={previewRootRef} className="fvp-pdf-preview fvp-preview-main flex flex-col gap-3 min-w-0">
          <header className="fvp-preview-section-header flex flex-wrap items-center justify-between gap-2.5 mb-3.5 text-(--fvp-reader-muted) text-[12px] [&_strong]:text-(--fvp-reader-text) [&_strong]:text-[13px] [&_strong]:font-bold">
            <div className="fvp-preview-section-title flex flex-wrap items-center gap-2.5 min-w-0">
              <strong>{t("files.pdfPreviewTitle")}</strong>
              <span>{t("files.pdfPreviewPageCount", { count: numPages })}</span>
            </div>
            <div className="fvp-preview-toolbar inline-flex items-center gap-2 flex-wrap" role="toolbar" aria-label={t("files.pdfPreviewToolbarLabel")}>
              {outlineItems.length > 0 ? (
                <button
                  type="button"
                  className="fvp-preview-toolbar-button inline-flex items-center justify-center min-h-[30px] min-w-[30px] px-2.5 py-0 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[10px] bg-[color-mix(in_srgb,var(--surface-card)_86%,transparent)] text-(--fvp-reader-text) text-[12px] font-semibold transition-[background,border-color,color] duration-[140ms] enabled:hover:bg-[color-mix(in_srgb,var(--surface-hover)_70%,transparent)] disabled:opacity-[0.45]"
                  aria-label={t(
                    isOutlineCollapsed
                      ? "files.pdfPreviewExpandOutline"
                      : "files.pdfPreviewCollapseOutline",
                  )}
                  onClick={() => setIsOutlineCollapsed((current) => !current)}
                >
                  {isOutlineCollapsed ? t("files.pdfPreviewExpandOutline") : t("files.pdfPreviewCollapseOutline")}
                </button>
              ) : null}
              <button
                type="button"
                className="fvp-preview-toolbar-button inline-flex items-center justify-center min-h-[30px] min-w-[30px] px-2.5 py-0 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[10px] bg-[color-mix(in_srgb,var(--surface-card)_86%,transparent)] text-(--fvp-reader-text) text-[12px] font-semibold transition-[background,border-color,color] duration-[140ms] enabled:hover:bg-[color-mix(in_srgb,var(--surface-hover)_70%,transparent)] disabled:opacity-[0.45]"
                aria-label={t("files.pdfPreviewZoomOut")}
                disabled={pdfScale <= MIN_PDF_SCALE}
                onClick={handleZoomOut}
              >
                -
              </button>
              <button
                type="button"
                className="fvp-preview-toolbar-button fvp-preview-toolbar-value inline-flex items-center justify-center min-h-[30px] min-w-16 px-2.5 py-0 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[10px] bg-[color-mix(in_srgb,var(--surface-card)_86%,transparent)] text-(--fvp-reader-text) text-[12px] font-semibold transition-[background,border-color,color] duration-[140ms] enabled:hover:bg-[color-mix(in_srgb,var(--surface-hover)_70%,transparent)] disabled:opacity-[0.45]"
                aria-label={t("files.pdfPreviewResetZoom")}
                onClick={handleResetZoom}
              >
                {t("files.pdfPreviewZoomValue", { percent: Math.round(pdfScale * 100) })}
              </button>
              <button
                type="button"
                className="fvp-preview-toolbar-button inline-flex items-center justify-center min-h-[30px] min-w-[30px] px-2.5 py-0 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[10px] bg-[color-mix(in_srgb,var(--surface-card)_86%,transparent)] text-(--fvp-reader-text) text-[12px] font-semibold transition-[background,border-color,color] duration-[140ms] enabled:hover:bg-[color-mix(in_srgb,var(--surface-hover)_70%,transparent)] disabled:opacity-[0.45]"
                aria-label={t("files.pdfPreviewZoomIn")}
                disabled={pdfScale >= MAX_PDF_SCALE}
                onClick={handleZoomIn}
              >
                +
              </button>
            </div>
          </header>
          {isPageCountTruncated ? (
            <div className="fvp-preview-budget-hint mb-3.5 py-2.5 px-3 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[10px] bg-[color-mix(in_srgb,var(--surface-control)_42%,transparent)] text-(--fvp-reader-muted) text-[12px] leading-[1.5]">
              {t("files.pdfPreviewPageLimitHint", {
                visibleCount: visiblePageCount,
                totalCount: numPages,
                startPage: normalizedPageWindowStart,
              })}
            </div>
          ) : null}
          <div className="fvp-pdf-pages flex flex-col gap-[18px]">
            {visiblePageNumbers.map((pageNumber) => (
              <PdfPageCanvas
                key={`pdf-page-${pageNumber}`}
                pdfDocument={pdfDocument}
                pageNumber={pageNumber}
                scale={pdfScale}
                t={t}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
