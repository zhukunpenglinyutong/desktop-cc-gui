import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ZoomIn from "lucide-react/dist/esm/icons/zoom-in";
import ZoomOut from "lucide-react/dist/esm/icons/zoom-out";
import X from "lucide-react/dist/esm/icons/x";
import { dataUrlBytes, imageMetaText } from "@/utils/image-meta";
import { useBrowserOcclusion } from "@/features/browser/occlusion";

/** Zoom bounds and button step; zoom 1 = fit the viewport. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 10;
const ZOOM_STEP = 1.25;

/** Full-screen image preview with metadata and zoom. The header shows the
 * name plus "width × height · file size"; the toolbar and the mouse wheel
 * zoom (around the cursor), and dragging pans while zoomed in. Backdrop
 * click, the × button, or Escape closes. */
export function ImageLightbox({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // Only mounted while open; hides the native browser webview so the
  // lightbox is not painted under it.
  useBrowserOcclusion(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // A modal <dialog> renders in the top layer, so no portal is needed to
  // escape the timeline's transformed virtual rows (a transformed ancestor
  // traps position: fixed). Escape closes natively (close event). The refs
  // hold the latest view state so the native wheel/press listeners subscribe
  // once instead of per render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const viewRef = useRef({ zoom: 1, x: 0, y: 0 });
  const setView = (nextZoom: number, x: number, y: number) => {
    viewRef.current = { zoom: nextZoom, x, y };
    setZoom(nextZoom);
    setOffset({ x, y });
  };

  /** Zoom keeping `center` (client coords, default dialog center) fixed.
   *  Layout keeps the image fit-centered; transform = translate(offset)
   *  scale(zoom) around the image center, so a rendered point is
   *  center + offset + content × zoom. */
  const zoomTo = (next: number, center?: { clientX: number; clientY: number }) => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    const rect = dialog.getBoundingClientRect();
    const cx = (center?.clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    const cy = (center?.clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    const { zoom: prev, x, y } = viewRef.current;
    const ratio = clamped / prev;
    let nx = cx - (cx - x) * ratio;
    let ny = cy - (cy - y) * ratio;
    if (clamped <= 1) {
      nx = 0;
      ny = 0;
    }
    setView(clamped, nx, ny);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const close = () => onCloseRef.current();
    // Press on the backdrop closes; a press on the image closes at fit zoom
    // (the historical behavior) but starts a pan while zoomed in.
    const press = (e: MouseEvent) => {
      if (e.target === dialog) close();
      else if (e.target === imgRef.current && viewRef.current.zoom <= 1) close();
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomTo(viewRef.current.zoom * Math.exp(-e.deltaY * 0.002), e);
    };
    dialog.addEventListener("mousedown", press);
    dialog.addEventListener("close", close);
    dialog.addEventListener("wheel", wheel, { passive: false });
    return () => {
      dialog.removeEventListener("mousedown", press);
      dialog.removeEventListener("close", close);
      dialog.removeEventListener("wheel", wheel);
    };
    // zoomTo reads refs only; subscribe once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
  } | null>(null);

  const sizeBytes = dataUrlBytes(src);
  const meta = imageMetaText({
    width: natural?.width,
    height: natural?.height,
    size: sizeBytes ?? undefined,
  });
  const zoomedIn = zoom > 1;
  const toolButton =
    "cursor-pointer rounded-full p-1.5 text-white/80 hover:bg-white/15 hover:text-white";

  return (
    <dialog
      ref={dialogRef}
      aria-label={name}
      className="fixed inset-0 z-50 flex h-full max-h-none w-full max-w-none items-center justify-center overflow-hidden bg-overlay-backdrop"
    >
      <img
        ref={imgRef}
        src={src}
        alt={name}
        draggable={false}
        onLoad={(e) =>
          setNatural({
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
          })
        }
        onPointerDown={(e) => {
          const { zoom: z, x, y } = viewRef.current;
          if (z <= 1) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          panRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            baseX: x,
            baseY: y,
          };
          setPanning(true);
        }}
        onPointerMove={(e) => {
          const pan = panRef.current;
          if (!pan || pan.pointerId !== e.pointerId) return;
          setView(
            viewRef.current.zoom,
            pan.baseX + e.clientX - pan.startX,
            pan.baseY + e.clientY - pan.startY,
          );
        }}
        onPointerUp={(e) => {
          if (panRef.current?.pointerId !== e.pointerId) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          panRef.current = null;
          setPanning(false);
        }}
        onPointerCancel={(e) => {
          if (panRef.current?.pointerId !== e.pointerId) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          panRef.current = null;
          setPanning(false);
        }}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          cursor: zoomedIn ? (panning ? "grabbing" : "grab") : "zoom-out",
          touchAction: "none",
        }}
        className="max-h-full max-w-full select-none object-contain"
      />
      {/* Header: name + "width × height · size". pointer-events-none keeps
          backdrop wheel/press working through the bar; the × re-enables. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 bg-gradient-to-b from-black/60 to-black/0 px-4 pt-3 pb-6">
        <div className="flex min-w-0 items-baseline gap-3 pt-1.5 text-white/90">
          <span className="truncate text-body-medium">{name}</span>
          {meta && (
            <span className="shrink-0 whitespace-nowrap text-caption-1-medium text-white/60">
              {meta}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label={t("chat.closePreview")}
          title={t("chat.closePreview")}
          className={`pointer-events-auto shrink-0 ${toolButton}`}
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
      {/* Zoom toolbar: − / percent (click = fit) / + / 1:1. */}
      <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 px-2 py-1">
        <button
          type="button"
          onClick={() => zoomTo(viewRef.current.zoom / ZOOM_STEP)}
          aria-label={t("chat.zoomOut")}
          title={t("chat.zoomOut")}
          className={toolButton}
        >
          <ZoomOut className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setView(1, 0, 0)}
          aria-label={t("chat.resetZoom")}
          title={t("chat.resetZoom")}
          className="min-w-12 cursor-pointer rounded-full px-1 py-1.5 text-center text-caption-1-medium text-white/80 tabular-nums hover:bg-white/15 hover:text-white"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          onClick={() => zoomTo(viewRef.current.zoom * ZOOM_STEP)}
          aria-label={t("chat.zoomIn")}
          title={t("chat.zoomIn")}
          className={toolButton}
        >
          <ZoomIn className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            const img = imgRef.current;
            // 1:1 = one image pixel per screen pixel, undoing the fit shrink.
            if (!img || !natural || natural.width === 0) return;
            zoomTo(img.offsetWidth / natural.width);
          }}
          aria-label={t("chat.actualSize")}
          title={t("chat.actualSize")}
          className={`${toolButton} text-caption-1-medium`}
        >
          1:1
        </button>
      </div>
    </dialog>
  );
}
