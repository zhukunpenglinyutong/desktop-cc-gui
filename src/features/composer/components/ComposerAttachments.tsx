import { convertFileSrc } from "@tauri-apps/api/core";
import Image from "lucide-react/dist/esm/icons/image";
import X from "lucide-react/dist/esm/icons/x";

type ComposerAttachmentsProps = {
  attachments: string[];
  disabled: boolean;
  onRemoveAttachment?: (path: string) => void;
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
    return "";
  }
}

export function ComposerAttachments({
  attachments,
  disabled,
  onRemoveAttachment,
}: ComposerAttachmentsProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="composer-attachments mb-[6px] flex flex-wrap gap-[6px]">
      {attachments.map((path) => {
        const title = fileTitle(path);
        const titleAttr = path.startsWith("data:") ? "Pasted image" : path;
        const previewSrc = attachmentPreviewSrc(path);
        return (
          <div
            key={path}
            className="composer-attachment group relative inline-flex max-w-full items-center gap-[6px] rounded-full border border-[var(--border-muted)] bg-card px-2 py-[2px] text-[11px] text-muted-foreground"
            title={titleAttr}
          >
            {previewSrc && (
              <span
                className="composer-attachment-preview pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-20 h-[180px] w-[240px] -translate-x-1/2 translate-y-[-2px] scale-[0.98] overflow-hidden rounded-xl border border-border bg-[var(--surface-quiet)] opacity-0 shadow-[0_12px_28px_rgba(0,0,0,0.24)] transition-[opacity,transform] duration-150 ease-out group-hover:pointer-events-auto group-hover:translate-y-[-6px] group-hover:scale-100 group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-[-6px] group-focus-within:scale-100 group-focus-within:opacity-100 [&_img]:block [&_img]:h-full [&_img]:w-full [&_img]:object-contain"
                aria-hidden
              >
                <img src={previewSrc} alt="" />
              </span>
            )}
            {previewSrc ? (
              <span
                className="composer-attachment-thumb h-5 w-5 flex-none overflow-hidden rounded-md border border-border bg-[var(--surface-item)] [&_img]:block [&_img]:h-full [&_img]:w-full [&_img]:object-cover"
                aria-hidden
              >
                <img src={previewSrc} alt="" />
              </span>
            ) : (
              <span className="composer-icon flex items-center text-inherit [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
                <Image size={14} />
              </span>
            )}
            <span className="composer-attachment-name max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap">
              {title}
            </span>
            <button
              type="button"
              className="composer-attachment-remove inline-flex cursor-pointer border-none bg-transparent p-0 text-[var(--text-faint)] hover:text-[var(--text-stronger)] disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => onRemoveAttachment?.(path)}
              aria-label={`Remove ${title}`}
              disabled={disabled}
            >
              <X size={12} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
