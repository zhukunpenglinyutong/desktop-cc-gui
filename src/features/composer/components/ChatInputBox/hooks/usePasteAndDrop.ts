import { useCallback, useEffect, useRef, useState } from 'react';
import type { Attachment } from '../types.js';
import { generateId } from '../utils/generateId.js';
import { insertTextAtCursor } from '../utils/selectionUtils.js';
import {
  dedupeAndValidateFilePaths,
  insertFilePathReferences,
  normalizePathForComparison,
  parsePathsFromDropText,
} from '../utils/filePathReferences.js';
import { subscribeWindowDragDrop } from '../../../../../services/dragDrop.js';
import { perfTimer } from '../../../utils/debug.js';

declare global {
  interface Window {
    getClipboardFilePath?: () => Promise<string>;
  }
}

interface UsePasteAndDropOptions {
  disabled?: boolean;
  editableRef: React.RefObject<HTMLDivElement | null>;
  dropZoneRef?: React.RefObject<HTMLElement | null>;
  pathMappingRef: React.MutableRefObject<Map<string, string>>;
  getTextContent: () => string;
  adjustHeight: () => void;
  renderFileTags: () => void;
  setHasContent: (hasContent: boolean) => void;
  setInternalAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;
  onInput?: (content: string) => void;
  fileCompletion: { close: () => void };
  commandCompletion: { close: () => void };
  handleInput: (isComposingFromEvent?: boolean) => void;
  /** Immediately flush pending debounced onInput to sync parent state */
  flushInput: () => void;
}

interface UsePasteAndDropReturn {
  /** Handle paste event - detect images and plain text */
  handlePaste: (e: React.ClipboardEvent) => void;
  /** Handle drag over event */
  handleDragOver: (e: React.DragEvent) => void;
  /** Handle drag enter event */
  handleDragEnter: (e: React.DragEvent) => void;
  /** Handle drag leave event */
  handleDragLeave: (e: React.DragEvent) => void;
  /** Handle drop event - detect images and file paths */
  handleDrop: (e: React.DragEvent) => void;
  /** Drag-over state for visual hint */
  isDragOver: boolean;
  /** Preview names for drag hint chip */
  dragPreviewNames: string[];
}

const MAX_DROP_TEXT_LENGTH = 100000;
const FILE_TREE_DRAG_BRIDGE_MAX_AGE_MS = 15000;

function clearFileTreeDragBridge() {
  if (typeof window === "undefined") {
    return;
  }
  if (typeof window.__fileTreeDragCleanup === "function") {
    try {
      window.__fileTreeDragCleanup();
    } catch {
      // Ignore cleanup errors.
    }
  }
  delete window.__fileTreeDragPaths;
  delete window.__fileTreeDragStamp;
  delete window.__fileTreeDragActive;
  delete window.__fileTreeDragPosition;
  delete window.__fileTreeDragOverChat;
  delete window.__fileTreeDragDropped;
  delete window.__fileTreeDragCleanup;
  const highlighted = document.querySelectorAll(".chat-input-box.file-tree-drop-target-active");
  highlighted.forEach((element) => {
    element.classList.remove("file-tree-drop-target-active");
  });
}

function readFileTreeDragBridgePaths(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  const rawPaths = window.__fileTreeDragPaths;
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
    return [];
  }
  const stamp = window.__fileTreeDragStamp;
  if (
    typeof stamp !== "number" ||
    Date.now() - stamp > FILE_TREE_DRAG_BRIDGE_MAX_AGE_MS
  ) {
    clearFileTreeDragBridge();
    return [];
  }
  return rawPaths
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function hasActiveFileTreeDragBridge() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.__fileTreeDragActive === true && readFileTreeDragBridgePaths().length > 0;
}

function isDropInsideElement(
  element: Element | null,
  point: { x: number; y: number },
) {
  if (!element) {
    return false;
  }
  const rect = element.getBoundingClientRect();
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

function hasUsableDragPosition(point: { x: number; y: number } | null | undefined): boolean {
  if (!point) {
    return false;
  }
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    !(point.x === 0 && point.y === 0)
  );
}

function resolveDragPositionFromEvent(event: DragEvent): { x: number; y: number } | null {
  const fromEvent = { x: event.clientX, y: event.clientY };
  if (hasUsableDragPosition(fromEvent)) {
    return fromEvent;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return hasUsableDragPosition(window.__fileTreeDragPosition)
    ? window.__fileTreeDragPosition ?? null
    : null;
}

function extractPathCandidatesFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): string[] {
  if (!dataTransfer) {
    return readFileTreeDragBridgePaths();
  }

  const customPayload = dataTransfer.getData('application/x-codemoss-file-paths');
  if (customPayload) {
    const paths = dedupeAndValidateFilePaths(parsePathsFromDropText(customPayload));
    if (paths.length > 0) {
      return paths;
    }
  }

  const textPaths = parsePathsFromDropText(
    dataTransfer.getData('text/plain') || dataTransfer.getData('text/uri-list'),
  );

  const filePaths = Array.from(dataTransfer.files ?? [])
    .map((file) => (file as File & { path?: string }).path ?? '')
    .filter(Boolean);

  const mergedPaths = dedupeAndValidateFilePaths([...textPaths, ...filePaths]);
  if (mergedPaths.length > 0) {
    return mergedPaths;
  }
  return readFileTreeDragBridgePaths();
}

function toPreviewNames(paths: string[]): string[] {
  const deduped = dedupeAndValidateFilePaths(paths);
  return deduped.map((path) => path.split(/[/\\]/).pop() || path).slice(0, 3);
}

function hasPathLikeDragType(
  dataTransfer: DataTransfer | null | undefined,
): boolean {
  if (!dataTransfer) {
    return false;
  }
  const types = Array.from(dataTransfer.types ?? []);
  return (
    types.includes('application/x-codemoss-file-paths') ||
    types.includes('text/plain') ||
    types.includes('text/uri-list')
  );
}

/**
 * usePasteAndDrop - Handle paste and drag-drop operations
 *
 * Features:
 * - Paste images as attachments (Base64 encoded)
 * - Paste text including file paths
 * - Drag and drop files/images
 * - Auto-create file references from dropped paths
 */
export function usePasteAndDrop({
  disabled = false,
  editableRef,
  dropZoneRef,
  pathMappingRef,
  getTextContent,
  adjustHeight,
  renderFileTags,
  setHasContent,
  setInternalAttachments,
  onInput,
  fileCompletion,
  commandCompletion,
  handleInput,
  flushInput,
}: UsePasteAndDropOptions): UsePasteAndDropReturn {
  const lastDropSignatureRef = useRef<{ signature: string; time: number } | null>(null);
  const isDragOverRef = useRef(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dragPreviewNames, setDragPreviewNames] = useState<string[]>([]);

  useEffect(() => {
    isDragOverRef.current = isDragOver;
  }, [isDragOver]);

  const handlePathInsertion = useCallback(
    (paths: string[]) => {
      insertFilePathReferences({
        editableRef,
        pathMappingRef,
        filePaths: paths,
        getTextContent,
        adjustHeight,
        renderFileTags,
        setHasContent,
        onInput,
        fileCompletion,
        commandCompletion,
        flushInput,
      });
    },
    [
      editableRef,
      pathMappingRef,
      getTextContent,
      adjustHeight,
      renderFileTags,
      setHasContent,
      onInput,
      fileCompletion,
      commandCompletion,
      flushInput,
    ],
  );

  const handlePathInsertionWithDedupGuard = useCallback(
    (paths: string[]) => {
      const validPaths = dedupeAndValidateFilePaths(paths);
      if (validPaths.length === 0) {
        return;
      }
      const signature = validPaths
        .map((path) => normalizePathForComparison(path))
        .sort()
        .join("\n");
      const now = Date.now();
      if (
        lastDropSignatureRef.current &&
        lastDropSignatureRef.current.signature === signature &&
        now - lastDropSignatureRef.current.time < 400
      ) {
        return;
      }
      lastDropSignatureRef.current = { signature, time: now };
      handlePathInsertion(validPaths);
    },
    [handlePathInsertion],
  );

  const resetDragHint = useCallback(() => {
    setIsDragOver(false);
    setDragPreviewNames([]);
  }, []);

  useEffect(() => {
    if (disabled) {
      return undefined;
    }
    const unlisten = subscribeWindowDragDrop((event) => {
      const dropZone = dropZoneRef?.current ?? editableRef.current;
      if (!dropZone) {
        return;
      }
      const position = event.payload.position;
      const isInside = isDropInsideElement(dropZone, position);
      const droppedPaths = event.payload.paths ?? [];

      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        if (!isInside) {
          if (isDragOverRef.current) {
            resetDragHint();
          }
          return;
        }
        setIsDragOver(true);
        if (droppedPaths.length > 0) {
          setDragPreviewNames(toPreviewNames(droppedPaths));
        } else {
          setDragPreviewNames([]);
        }
        return;
      }

      if (event.payload.type === 'drop') {
        resetDragHint();
        if (!isInside) {
          return;
        }
        if (droppedPaths.length > 0) {
          handlePathInsertionWithDedupGuard(droppedPaths);
        }
        return;
      }
      if (event.payload.type === 'leave') {
        resetDragHint();
      }
    });
    return () => {
      unlisten();
    };
  }, [
    disabled,
    dropZoneRef,
    editableRef,
    handlePathInsertionWithDedupGuard,
    resetDragHint,
  ]);

  useEffect(() => {
    if (disabled) {
      return undefined;
    }

    const getDropZone = () => dropZoneRef?.current ?? editableRef.current;

    const handleDocumentDragOver = (event: DragEvent) => {
      if (!hasActiveFileTreeDragBridge()) {
        return;
      }
      const point = resolveDragPositionFromEvent(event);
      if (point) {
        window.__fileTreeDragPosition = point;
      }
      const dropZone = getDropZone();
      if (!dropZone) {
        return;
      }
      const bridgePaths = readFileTreeDragBridgePaths();
      if (bridgePaths.length === 0) {
        window.__fileTreeDragOverChat = false;
        resetDragHint();
        return;
      }
      const isInsideByPosition = point ? isDropInsideElement(dropZone, point) : false;
      const isInsideByBridgeHint = window.__fileTreeDragOverChat === true;
      if (!isInsideByPosition && !isInsideByBridgeHint) {
        window.__fileTreeDragOverChat = false;
        resetDragHint();
        return;
      }
      window.__fileTreeDragOverChat = true;
      event.preventDefault();
      setIsDragOver(true);
      setDragPreviewNames(toPreviewNames(bridgePaths));
    };

    const handleDocumentDrop = (event: DragEvent) => {
      if (!hasActiveFileTreeDragBridge()) {
        return;
      }
      const point = resolveDragPositionFromEvent(event);
      if (point) {
        window.__fileTreeDragPosition = point;
      }
      const dropZone = getDropZone();
      if (!dropZone) {
        window.__fileTreeDragOverChat = false;
        clearFileTreeDragBridge();
        resetDragHint();
        return;
      }
      const bridgePaths = readFileTreeDragBridgePaths();
      if (bridgePaths.length === 0) {
        window.__fileTreeDragOverChat = false;
        clearFileTreeDragBridge();
        resetDragHint();
        return;
      }
      const isInsideByPosition = point ? isDropInsideElement(dropZone, point) : false;
      const isInsideByBridgeHint = window.__fileTreeDragOverChat === true;
      if (!isInsideByPosition && !isInsideByBridgeHint) {
        window.__fileTreeDragOverChat = false;
        clearFileTreeDragBridge();
        resetDragHint();
        return;
      }
      window.__fileTreeDragOverChat = true;
      event.preventDefault();
      handlePathInsertionWithDedupGuard(bridgePaths);
      window.__fileTreeDragDropped = true;
      clearFileTreeDragBridge();
      resetDragHint();
    };

    document.addEventListener('dragover', handleDocumentDragOver, true);
    document.addEventListener('drop', handleDocumentDrop, true);

    return () => {
      document.removeEventListener('dragover', handleDocumentDragOver, true);
      document.removeEventListener('drop', handleDocumentDrop, true);
    };
  }, [
    disabled,
    dropZoneRef,
    editableRef,
    handlePathInsertionWithDedupGuard,
    resetDragHint,
  ]);
  /**
   * Handle paste event - detect images and plain text
   */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (disabled) {
        return;
      }
      const items = e.clipboardData?.items;

      if (!items) {
        return;
      }

      // Check if there's a real image (type is image/*)
      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // Only process real image types (type starts with image/)
        if (item.type.startsWith('image/')) {
          hasImage = true;
          e.preventDefault();

          const blob = item.getAsFile();

          if (blob) {
            // Read image as Base64
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1];
              const mediaType = blob.type || item.type || 'image/png';
              const ext = (() => {
                if (mediaType && mediaType.includes('/')) {
                  return mediaType.split('/')[1];
                }
                const name = blob.name || '';
                const m = name.match(/\.([a-zA-Z0-9]+)$/);
                return m ? m[1] : 'png';
              })();
              const attachment: Attachment = {
                id: generateId(),
                fileName: `pasted-image-${Date.now()}.${ext}`,
                mediaType,
                data: base64,
              };

              setInternalAttachments((prev) => [...prev, attachment]);
            };
            reader.readAsDataURL(blob);
          }

          return;
        }
      }

      // If no image, try to get text or file path
      if (!hasImage) {
        e.preventDefault();

        // Try multiple ways to get text
        const text =
          e.clipboardData.getData('text/plain') ||
          e.clipboardData.getData('text/uri-list') ||
          e.clipboardData.getData('text/html');

        // If still no text, try to get filename/path from file type item
        if (!text) {
          // Check if there's a file type item
          let hasFileItem = false;
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
              hasFileItem = true;
              break;
            }
          }

          // If there's a file type item, try to get full path via Java side
          if (hasFileItem && window.getClipboardFilePath) {
            window
              .getClipboardFilePath()
              .then((fullPath: string) => {
                if (fullPath && fullPath.trim()) {
                  // Insert full path using modern Selection API
                  insertTextAtCursor(fullPath, editableRef.current);
                  // Bypass IME guard (isComposingRef may be stale after recent compositionEnd)
                  handleInput(false);
                  // Immediately sync parent state without waiting for debounce
                  flushInput();
                }
              })
              .catch(() => {
                // Ignore errors
              });
            return;
          }
        }

        if (text && text.trim()) {
          const timer = perfTimer('handlePaste-text');
          timer.mark(`text-length:${text.length}`);

          // Use modern Selection API to insert plain text (maintains cursor position)
          insertTextAtCursor(text, editableRef.current);
          timer.mark('insertText');

          // Trigger input event to update state
          // Pass false to bypass IME guard (isComposingRef may be stale after recent compositionEnd)
          handleInput(false);
          timer.mark('handleInput');

          // Immediately sync parent state without waiting for debounce
          flushInput();

          // Scroll to make cursor visible after paste
          // Use requestAnimationFrame to ensure DOM updates are complete
          requestAnimationFrame(() => {
            // Get the wrapper element that has overflow scroll
            const wrapper = editableRef.current?.parentElement;
            if (wrapper && editableRef.current) {
              // Scroll wrapper to bottom to show pasted content
              wrapper.scrollTop = wrapper.scrollHeight;
            }
          });

          timer.end();
        }
      }
    },
    [disabled, setInternalAttachments, handleInput, flushInput, editableRef]
  );

  /**
   * Handle drag over event
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (disabled) {
      return;
    }
    const dropPaths = extractPathCandidatesFromDataTransfer(e.dataTransfer);
    if (dropPaths.length > 0) {
      setIsDragOver(true);
      setDragPreviewNames(toPreviewNames(dropPaths));
    } else if (hasPathLikeDragType(e.dataTransfer)) {
      setIsDragOver(true);
      setDragPreviewNames([]);
    }
    if (typeof window !== "undefined" && window.__fileTreeDragActive === true) {
      window.__fileTreeDragPosition = { x: e.clientX, y: e.clientY };
      window.__fileTreeDragOverChat = true;
    }
    e.preventDefault();
    e.stopPropagation();
    // Set drop effect to copy
    e.dataTransfer.dropEffect = 'copy';
  }, [disabled]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    handleDragOver(e);
  }, [handleDragOver]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (disabled) {
      return;
    }
    const dropZone = dropZoneRef?.current ?? editableRef.current;
    const related = e.relatedTarget as Node | null;
    if (dropZone && related && dropZone.contains(related)) {
      return;
    }
    if (typeof window !== "undefined" && window.__fileTreeDragActive === true) {
      window.__fileTreeDragOverChat = false;
    }
    resetDragHint();
  }, [disabled, dropZoneRef, editableRef, resetDragHint]);

  /**
   * Handle drop event - detect images and file paths
   */
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      if (disabled) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer?.files;

      // Check if there are actual image file objects
      let hasImageFile = false;
      if (files && files.length > 0) {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];

          // Only process image files
          if (file.type.startsWith('image/')) {
            hasImageFile = true;
            const reader = new FileReader();
            reader.onload = () => {
              const base64 = (reader.result as string).split(',')[1];
              const ext = (() => {
                if (file.type && file.type.includes('/')) {
                  return file.type.split('/')[1];
                }
                const m = file.name.match(/\.([a-zA-Z0-9]+)$/);
                return m ? m[1] : 'png';
              })();
              const attachment: Attachment = {
                id: generateId(),
                fileName: file.name || `dropped-image-${Date.now()}.${ext}`,
                mediaType: file.type || 'image/png',
                data: base64,
              };

              setInternalAttachments((prev) => [...prev, attachment]);
            };
            reader.readAsDataURL(file);
          }
        }
      }

      // If there are image files, don't process text
      if (hasImageFile) {
        clearFileTreeDragBridge();
        resetDragHint();
        return;
      }

      const dropPaths = extractPathCandidatesFromDataTransfer(e.dataTransfer);
      if (dropPaths.length > 0) {
        handlePathInsertionWithDedupGuard(dropPaths);
        clearFileTreeDragBridge();
        resetDragHint();
        return;
      }
      const textPayload = e.dataTransfer?.getData('text/plain') ?? '';
      if (textPayload.length > MAX_DROP_TEXT_LENGTH) {
        clearFileTreeDragBridge();
        resetDragHint();
        return;
      }
      clearFileTreeDragBridge();
      resetDragHint();
    },
    [
      disabled,
      setInternalAttachments,
      handlePathInsertionWithDedupGuard,
      resetDragHint,
    ]
  );

  return {
    handlePaste,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    isDragOver,
    dragPreviewNames,
  };
}
