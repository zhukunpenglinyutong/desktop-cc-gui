import { useEffect, useRef, useState, type RefObject } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isWeb } from "@/lib/transport";

/** Drag OS files onto the chat composer.
 *
 * Desktop: with Tauri's default `dragDropEnabled` the webview never sees
 * HTML5 drops — the window drag-drop stream reports absolute native paths
 * instead, so the same partition as the file picker applies (images become
 * attachments, everything else an @mention at the caret).
 *
 * Web bridge: no native paths exist, so the footer itself takes HTML5 drops
 * and only image File blobs make it through (paste pipeline).
 *
 * Returns the drop-zone ref plus `isDragOver` for the visual hint. */
export function useComposerFileDrop({
  disabled,
  onDropPaths,
  onDropFiles,
}: {
  /** No active session, or the host opted out: ignore drops entirely. */
  disabled: boolean;
  /** Desktop drop: absolute native paths. */
  onDropPaths?: (paths: string[]) => void;
  /** Web drop: image File blobs (no path available in a browser). */
  onDropFiles?: (files: File[]) => void;
}): { dropRef: RefObject<HTMLDivElement>; isDragOver: boolean } {
  const dropRef = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Latest-callback refs keep the window subscription stable across renders.
  // Written in an effect (not during render) so discarded render work
  // cannot leak stale callbacks into the event subscriptions below.
  const disabledRef = useRef(disabled);
  const pathsRef = useRef(onDropPaths);
  const filesRef = useRef(onDropFiles);
  useEffect(() => {
    disabledRef.current = disabled;
    pathsRef.current = onDropPaths;
    filesRef.current = onDropFiles;
  });

  useEffect(() => {
    if (disabled || isWeb) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    // Tauri emits native file-drop events to the Webview target. Subscribe
    // with that same target instead of the Window-scoped compatibility helper.
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const el = dropRef.current;
        if (!el) return;
        const payload = event.payload;
        if (payload.type === "leave") {
          setIsDragOver(false);
          return;
        }
        // Position space differs by platform (physical vs logical px);
        // accept either rather than guessing from devicePixelRatio alone.
        const rect = el.getBoundingClientRect();
        const { x, y } = payload.position;
        const scale = window.devicePixelRatio || 1;
        const inside =
          (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) ||
          (scale !== 1 &&
            x / scale >= rect.left &&
            x / scale <= rect.right &&
            y / scale >= rect.top &&
            y / scale <= rect.bottom);
        if (payload.type === "enter" || payload.type === "over") {
          setIsDragOver(inside);
          return;
        }
        if (payload.type === "drop") {
          setIsDragOver(false);
          if (!inside || disabledRef.current) return;
          const paths = payload.paths.map((p) => p.trim()).filter(Boolean);
          if (paths.length > 0) pathsRef.current?.(paths);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [disabled]);

  useEffect(() => {
    if (disabled || !isWeb) return;
    const el = dropRef.current;
    if (!el) return;
    // dragenter/dragleave bubble from children; a depth counter keeps the
    // hint from flickering while the pointer moves inside the zone.
    let depth = 0;
    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth += 1;
      setIsDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      // preventDefault is required or the drop event never fires.
      if (isFileDrag(e)) e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      depth = 0;
      setIsDragOver(false);
      if (disabledRef.current) return;
      const images = Array.from(e.dataTransfer?.files ?? []).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (images.length > 0) filesRef.current?.(images);
    };
    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [disabled]);

  return { dropRef, isDragOver };
}
