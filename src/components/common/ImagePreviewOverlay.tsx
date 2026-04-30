import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { LocalImage } from "./LocalImage";

type ImagePreviewOverlayProps = {
  src: string;
  localPath?: string | null;
  workspaceId?: string | null;
  alt: string;
  onClose: () => void;
};

export function ImagePreviewOverlay({
  src,
  localPath = null,
  workspaceId = null,
  alt,
  onClose,
}: ImagePreviewOverlayProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="image-preview-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      <LocalImage
        className="image-preview-content"
        src={src}
        localPath={localPath}
        workspaceId={workspaceId}
        alt={alt}
        onClick={(event) => event.stopPropagation()}
      />
      <button
        type="button"
        className="image-preview-close"
        onClick={onClose}
        aria-label={t("common.close")}
        title={t("common.close")}
      >
        ×
      </button>
    </div>
  );
}
