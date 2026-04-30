import { useCallback, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import Image from "lucide-react/dist/esm/icons/image";
import X from "lucide-react/dist/esm/icons/x";
import { ImagePreviewOverlay } from "../ImagePreviewOverlay";
import { LocalImage } from "../LocalImage";

type RichTextInputAttachmentsProps = {
  attachments: string[];
  workspaceId?: string | null;
  disabled: boolean;
  onRemoveAttachment?: (path: string) => void;
  className?: string;
};

function fileTitle(path: string) {
  if (path.startsWith("data:")) {
    return "Pasted image";
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return "Image";
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function attachmentPreviewSrc(path: string) {
  if (path.startsWith("data:")) {
    return path;
  }
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return path;
  }
}

export function RichTextInputAttachments({
  attachments,
  workspaceId = null,
  disabled,
  onRemoveAttachment,
  className = "",
}: RichTextInputAttachmentsProps) {
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  const closePreview = useCallback(() => {
    setPreviewPath(null);
  }, []);

  if (attachments.length === 0) {
    return null;
  }

  return (
    <>
      <div className={`rich-text-attachments ${className}`.trim()}>
        {attachments.map((path) => {
          const title = fileTitle(path);
          const titleAttr = path.startsWith("data:") ? "Pasted image" : path;
          const previewSrc = attachmentPreviewSrc(path);
          return (
            <div
              key={path}
              className={`rich-text-attachment${previewSrc ? " is-clickable" : ""}`}
              title={titleAttr}
              onClick={() => {
                if (previewSrc) {
                  setPreviewPath(path);
                }
              }}
            >
              {previewSrc ? (
                <span className="rich-text-attachment-thumb" aria-hidden>
                  <LocalImage src={previewSrc} localPath={path} workspaceId={workspaceId} alt="" />
                </span>
              ) : (
                <span className="rich-text-icon" aria-hidden>
                  <Image size={14} />
                </span>
              )}
              <span className="rich-text-attachment-name">{title}</span>
              <button
                type="button"
                className="rich-text-attachment-remove"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemoveAttachment?.(path);
                }}
                aria-label={`Remove ${title}`}
                disabled={disabled}
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>

      {previewPath ? (
        <ImagePreviewOverlay
          src={attachmentPreviewSrc(previewPath)}
          localPath={previewPath}
          workspaceId={workspaceId}
          alt={fileTitle(previewPath)}
          onClose={closePreview}
        />
      ) : null}
    </>
  );
}
