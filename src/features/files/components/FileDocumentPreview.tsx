import { useEffect, useMemo, useRef, useState } from "react";
import type { FilePreviewPayload } from "../hooks/useFilePreviewPayload";
import { PreviewOutlineSidebar } from "./PreviewOutlineSidebar";
import {
  extractDocumentPreviewOutline,
  type PreviewOutlineItem,
} from "../utils/filePreviewOutline";

type FileDocumentPreviewProps = {
  payload: FilePreviewPayload | null;
  isLoading: boolean;
  error: string | null;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export function FileDocumentPreview({
  payload,
  isLoading,
  error,
  t,
}: FileDocumentPreviewProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const [activeOutlineItemId, setActiveOutlineItemId] = useState<string | null>(null);
  const outlinedDocument = useMemo(
    () => payload?.kind === "extracted-structure"
      ? extractDocumentPreviewOutline(payload.html, t("files.previewOutlineUntitled"))
      : { html: "", outline: [] },
    [payload, t],
  );

  useEffect(() => {
    setActiveOutlineItemId(null);
  }, [outlinedDocument.html]);

  if (isLoading) {
    return <div className="fvp-status p-6 text-[13px] text-(--text-muted) text-center">{t("files.loadingFile")}</div>;
  }

  if (error) {
    return <div className="fvp-status fvp-error p-6 text-[13px] text-center text-[var(--text-danger,#f87171)]">{error}</div>;
  }

  if (!payload) {
    return <div className="fvp-status p-6 text-[13px] text-(--text-muted) text-center">{t("files.documentPreviewUnavailable")}</div>;
  }

  if (payload.kind === "unsupported") {
    const message = payload.reason === "legacy-doc"
      ? t("files.documentPreviewLegacyDocFallback")
      : payload.reason === "budget-exceeded"
        ? t("files.documentPreviewTooLarge", {
          maxMb: payload.budgetMegabytes ?? 2,
        })
      : payload.detail ?? t("files.documentPreviewUnavailable");
    return (
      <div className="fvp-preview-scroll flex-1 overflow-auto py-5 px-6 w-full min-w-0">
        <div className="fvp-document-preview fvp-document-preview--fallback flex flex-col gap-3 min-w-0 max-w-[760px]">
          <header className="fvp-preview-section-header flex flex-wrap items-center justify-between gap-2.5 mb-3.5 text-(--fvp-reader-muted) text-[12px] [&_strong]:text-(--fvp-reader-text) [&_strong]:text-[13px] [&_strong]:font-bold">
            <strong>{t("files.documentPreviewTitle")}</strong>
          </header>
          <p>{message}</p>
          <p className="fvp-preview-budget-hint mb-3.5 py-2.5 px-3 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[10px] bg-[color-mix(in_srgb,var(--surface-control)_42%,transparent)] text-(--fvp-reader-muted) text-[12px] leading-[1.5]">{t("files.documentPreviewFallbackHint")}</p>
        </div>
      </div>
    );
  }

  if (payload.kind !== "extracted-structure") {
    return <div className="fvp-status p-6 text-[13px] text-(--text-muted) text-center">{t("files.documentPreviewUnavailable")}</div>;
  }

  const handleSelectOutlineItem = (item: PreviewOutlineItem) => {
    if (item.target.kind !== "html-anchor") {
      return;
    }
    const articleNode = articleRef.current;
    if (!articleNode) {
      return;
    }
    const anchorNode = articleNode.ownerDocument.getElementById(item.target.anchorId);
    if (!(anchorNode instanceof HTMLElement) || !articleNode.contains(anchorNode)) {
      return;
    }
    setActiveOutlineItemId(item.id);
    anchorNode?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="fvp-preview-scroll flex-1 overflow-auto py-5 px-6 w-full min-w-0">
      <div className="fvp-preview-shell grid grid-cols-[minmax(220px,280px)_minmax(0,1fr)] max-[980px]:grid-cols-[minmax(0,1fr)] gap-5 items-start">
        <PreviewOutlineSidebar
          title={t("files.previewOutlineTitle")}
          emptyLabel={t("files.documentPreviewOutlineEmpty")}
          items={outlinedDocument.outline}
          activeItemId={activeOutlineItemId}
          onSelectItem={handleSelectOutlineItem}
        />
        <div className="fvp-document-preview fvp-preview-main flex flex-col gap-3 min-w-0">
          <header className="fvp-preview-section-header flex flex-wrap items-center justify-between gap-2.5 mb-3.5 text-(--fvp-reader-muted) text-[12px] [&_strong]:text-(--fvp-reader-text) [&_strong]:text-[13px] [&_strong]:font-bold">
            <strong>{t("files.documentPreviewTitle")}</strong>
            {payload.byteLength > 0 ? (
              <span>{t("files.documentPreviewByteLength", { bytes: payload.byteLength })}</span>
            ) : null}
          </header>
          {payload.warnings.length > 0 ? (
            <div className="fvp-preview-budget-hint mb-3.5 py-2.5 px-3 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[10px] bg-[color-mix(in_srgb,var(--surface-control)_42%,transparent)] text-(--fvp-reader-muted) text-[12px] leading-[1.5]">
              {payload.warnings[0]}
            </div>
          ) : null}
          <article
            ref={articleRef}
            className="fvp-document-preview-article flex flex-col gap-3.5 max-w-[860px] text-(--fvp-reader-text) leading-[1.7] [&_p]:m-0 [&_ul]:m-0 [&_ol]:m-0 [&_blockquote]:m-0 [&_table]:m-0 [&_h1]:m-0 [&_h2]:m-0 [&_h3]:m-0 [&_h4]:m-0 [&_h5]:m-0 [&_h6]:m-0 [&_h1]:text-(--text-stronger) [&_h2]:text-(--text-stronger) [&_h3]:text-(--text-stronger) [&_h4]:text-(--text-stronger) [&_h5]:text-(--text-stronger) [&_h6]:text-(--text-stronger) [&_h1]:leading-[1.35] [&_h2]:leading-[1.35] [&_h3]:leading-[1.35] [&_h4]:leading-[1.35] [&_h5]:leading-[1.35] [&_h6]:leading-[1.35] [&_h1]:scroll-mt-[18px] [&_h2]:scroll-mt-[18px] [&_h3]:scroll-mt-[18px] [&_h4]:scroll-mt-[18px] [&_h5]:scroll-mt-[18px] [&_h6]:scroll-mt-[18px]"
            dangerouslySetInnerHTML={{ __html: outlinedDocument.html }}
          />
        </div>
      </div>
    </div>
  );
}
