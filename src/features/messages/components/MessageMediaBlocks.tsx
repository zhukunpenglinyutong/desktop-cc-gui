import { memo, useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";

export type MessageImage = {
  src: string;
  label: string;
};

export const MessageImageGrid = memo(function MessageImageGrid({
  images,
  onOpen,
  hasText,
}: {
  images: MessageImage[];
  onOpen: (index: number) => void;
  hasText: boolean;
}) {
  return (
    <div
      className={`message-image-grid mb-0 flex gap-2 overflow-x-auto overflow-y-hidden p-1.5 px-2 -mx-2 [-webkit-overflow-scrolling:touch]${hasText ? " message-image-grid--with-text mb-2 pt-2 pb-2" : ""}`}
      role="list"
    >
      {images.map((image, index) => (
        <button
          key={`${image.src}-${index}`}
          type="button"
          className="message-image-thumb border-0 p-0 bg-transparent rounded-xl overflow-hidden w-22 flex-none aspect-square cursor-zoom-in block [box-shadow:none!important] [transform:none!important] hover:outline hover:outline-1 hover:outline-offset-0 hover:outline-(--border-accent) [&_img]:block [&_img]:w-full [&_img]:h-full [&_img]:object-cover"
          onClick={() => onOpen(index)}
          aria-label={`Open image ${index + 1}`}
        >
          <img src={image.src} alt={image.label} loading="lazy" />
        </button>
      ))}
    </div>
  );
});

export const ImageLightbox = memo(function ImageLightbox({
  images,
  activeIndex,
  onClose,
}: {
  images: MessageImage[];
  activeIndex: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const activeImage = images[activeIndex];

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

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!activeImage) {
    return null;
  }

  return createPortal(
    <div
      className="message-image-lightbox fixed inset-0 z-[9999] bg-black/85 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="message-image-lightbox-content relative max-w-[90vw] max-h-[90vh] [&_img]:block [&_img]:max-w-[90vw] [&_img]:max-h-[90vh] [&_img]:rounded-2xl [&_img]:[box-shadow:0_24px_60px_rgba(0,0,0,0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="message-image-lightbox-close absolute -top-3 -right-3 w-7 h-7 rounded-full border border-(--border-strong) bg-(--surface-card-strong) text-(--text-strong) inline-flex items-center justify-center cursor-pointer p-0 hover:[transform:none] hover:[box-shadow:none] [transform:none] [box-shadow:none]"
          onClick={onClose}
          aria-label={t("messages.closeImagePreview")}
        >
          <X size={16} aria-hidden />
        </button>
        <img src={activeImage.src} alt={activeImage.label} />
      </div>
    </div>,
    document.body,
  );
});
