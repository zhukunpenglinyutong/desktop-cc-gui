import { memo, useMemo } from "react";
import ImageOff from "lucide-react/dist/esm/icons/image-off";
import { useTranslation } from "react-i18next";

type ImageDiffCardProps = {
  path: string;
  status: string;
  oldImageData?: string | null;
  newImageData?: string | null;
  oldImageMime?: string | null;
  newImageMime?: string | null;
  isSelected: boolean;
};

function getImageMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".ico")) return "image/x-icon";
  return "image/png";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const ImageDiffCard = memo(function ImageDiffCard({
  path,
  status,
  oldImageData,
  newImageData,
  oldImageMime,
  newImageMime,
  isSelected,
}: ImageDiffCardProps) {
  const { t } = useTranslation();
  const oldDataUri = useMemo(
    () => {
      if (!oldImageData) return null;
      const mimeType = oldImageMime ?? getImageMimeType(path);
      return `data:${mimeType};base64,${oldImageData}`;
    },
    [oldImageData, oldImageMime, path],
  );

  const newDataUri = useMemo(
    () => {
      if (!newImageData) return null;
      const mimeType = newImageMime ?? getImageMimeType(path);
      return `data:${mimeType};base64,${newImageData}`;
    },
    [newImageData, newImageMime, path],
  );

  const oldSize = useMemo(() => {
    if (!oldImageData) return null;
    const bytes = Math.ceil((oldImageData.length * 3) / 4);
    return formatFileSize(bytes);
  }, [oldImageData]);

  const newSize = useMemo(() => {
    if (!newImageData) return null;
    const bytes = Math.ceil((newImageData.length * 3) / 4);
    return formatFileSize(bytes);
  }, [newImageData]);

  const isAdded = status === "A";
  const isDeleted = status === "D";
  const isModified = !isAdded && !isDeleted;
  const placeholderLabel = t("git.imageDiffUnavailable");
  const paneClass = "image-diff-pane flex flex-col items-center";
  const previewClass = "image-diff-preview max-w-full max-h-75 object-contain bg-[repeating-conic-gradient(var(--surface-control)_0%_25%,var(--surface-strong)_0%_50%)] bg-[length:16px_16px] bg-[position:50%]";
  const metaClass = "image-diff-meta text-[11px] text-(--text-faint) tabular-nums mt-2";
  const renderPlaceholder = () => (
    <div className="image-diff-placeholder flex flex-col items-center justify-center gap-1.5 min-h-35 py-3 px-4 text-(--text-subtle) text-xs text-center rounded-lg bg-(--surface-strong) border border-(--border-subtle)">
      <ImageOff className="image-diff-placeholder-icon w-5 h-5 text-(--text-faint)" aria-hidden />
      <div className="image-diff-placeholder-text leading-[1.4]">{placeholderLabel}</div>
    </div>
  );

  return (
    <div
      data-diff-path={path}
      className={`diff-viewer-item diff-viewer-item-image ${isSelected ? "active" : ""}`}
    >
      <div className="diff-viewer-header">
        <span className="diff-viewer-status" data-status={status}>
          {status}
        </span>
        <span className="diff-viewer-path">{path}</span>
      </div>
      <div className="image-diff-content p-4">
        {isModified && (
          <div className="image-diff-side-by-side grid grid-cols-2 gap-4">
            <div className={`${paneClass} image-diff-pane-old`}>
              {oldDataUri ? (
                <img
                  src={oldDataUri}
                  alt="Previous version"
                  className={previewClass}
                />
              ) : (
                renderPlaceholder()
              )}
              {oldSize && <div className={metaClass}>{oldSize}</div>}
            </div>
            <div className={`${paneClass} image-diff-pane-new`}>
              {newDataUri ? (
                <img
                  src={newDataUri}
                  alt="Current version"
                  className={previewClass}
                />
              ) : (
                renderPlaceholder()
              )}
              {newSize && <div className={metaClass}>{newSize}</div>}
            </div>
          </div>
        )}
        {isAdded && (
          <div className="image-diff-single flex justify-center [&_.image-diff-pane]:max-w-1/2">
            <div className={`${paneClass} image-diff-pane-new`}>
              {newDataUri ? (
                <img
                  src={newDataUri}
                  alt="New image"
                  className={previewClass}
                />
              ) : (
                renderPlaceholder()
              )}
              {newSize && <div className={metaClass}>{newSize}</div>}
            </div>
          </div>
        )}
        {isDeleted && (
          <div className="image-diff-single flex justify-center [&_.image-diff-pane]:max-w-1/2">
            <div className={`${paneClass} image-diff-pane-old`}>
              {oldDataUri ? (
                <img
                  src={oldDataUri}
                  alt="Deleted image"
                  className={previewClass}
                />
              ) : (
                renderPlaceholder()
              )}
              {oldSize && <div className={metaClass}>{oldSize}</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
