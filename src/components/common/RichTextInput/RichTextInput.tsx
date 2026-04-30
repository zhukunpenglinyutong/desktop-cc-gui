import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ChangeEvent,
  ClipboardEvent,
  KeyboardEvent,
  RefObject,
  SyntheticEvent,
} from "react";
import { useImageDrop } from "./useImageDrop";
import { RichTextInputAttachments } from "./RichTextInputAttachments";

export type RichTextInputProps = {
  // 基础输入
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;

  // 附件管理
  attachments?: string[];
  attachmentWorkspaceId?: string | null;
  onAddAttachment?: () => void;
  onAttachImages?: (paths: string[]) => void;
  onRemoveAttachment?: (path: string) => void;

  // 高度控制
  enableResize?: boolean;
  initialHeight?: number;
  minHeight?: number;
  maxHeight?: number;

  // 样式定制
  className?: string;
  inputClassName?: string;
  footerClassName?: string;
  attachmentsClassName?: string;

  // 底部插槽（用于放置额外控件）
  footerLeft?: React.ReactNode;
  footerRight?: React.ReactNode;

  // 高级控制
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelectionChange?: (selectionStart: number | null) => void;

  // 历史补全 ghost text
  ghostTextSuffix?: string;
};

export function RichTextInput({
  value,
  onChange,
  placeholder = "",
  disabled = false,
  attachments = [],
  attachmentWorkspaceId = null,
  onAddAttachment: _onAddAttachment,
  onAttachImages,
  onRemoveAttachment,
  enableResize = false,
  initialHeight = 80,
  minHeight = 60,
  maxHeight = 400,
  className = "",
  inputClassName = "",
  footerClassName = "",
  attachmentsClassName = "",
  footerLeft,
  footerRight,
  textareaRef: externalRef,
  onKeyDown,
  onSelectionChange,
  ghostTextSuffix,
}: RichTextInputProps) {
  const { t } = useTranslation();
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = externalRef || internalRef;
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [textareaHeight, setTextareaHeight] = useState(initialHeight);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const currentHeight = Math.max(minHeight, Math.min(textareaHeight, maxHeight));

  const {
    dropTargetRef,
    isDragOver,
    handleDragOver,
    handleDragEnter,
    handleDragLeave,
    handleDrop,
    handlePaste,
  } = useImageDrop({
    disabled,
    onAttachImages,
  });

  // Textarea height management
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.style.height = `${currentHeight}px`;
    textarea.style.minHeight = `${minHeight}px`;
    textarea.style.maxHeight = `${maxHeight}px`;
    textarea.style.overflowY = "auto";
  }, [currentHeight, textareaRef, minHeight, maxHeight]);

  // Drag resize handlers
  const handleResizeStart = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      if (disabled || !enableResize) return;
      event.preventDefault();
      setIsDragging(true);
      const clientY =
        "touches" in event ? (event.touches[0]?.clientY ?? 0) : event.clientY;
      dragStartY.current = clientY;
      dragStartHeight.current = currentHeight;
    },
    [disabled, enableResize, currentHeight],
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (event: MouseEvent | TouchEvent) => {
      const clientY =
        "touches" in event ? (event.touches[0]?.clientY ?? dragStartY.current) : event.clientY;
      // Dragging up (negative delta) should increase height
      const delta = dragStartY.current - clientY;
      const newHeight = Math.max(minHeight, Math.min(dragStartHeight.current + delta, maxHeight));
      setTextareaHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("touchmove", handleMouseMove);
    document.addEventListener("touchend", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("touchmove", handleMouseMove);
      document.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDragging, minHeight, maxHeight]);

  const handleTextareaChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(event.target.value);
    },
    [onChange],
  );

  const handleTextareaSelect = useCallback(
    (event: SyntheticEvent<HTMLTextAreaElement>) => {
      onSelectionChange?.((event.target as HTMLTextAreaElement).selectionStart);
    },
    [onSelectionChange],
  );

  const handleTextareaPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      void handlePaste(event);
    },
    [handlePaste],
  );

  return (
    <div className={`rich-text-input${isDragging ? " is-resizing" : ""} ${className}`.trim()}>
      {/* Resize handle at the top */}
      {enableResize && (
        <div
          ref={resizeHandleRef}
          className="rich-text-resize-handle"
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeStart}
          aria-label={t("composer.dragToResize")}
          role="separator"
          aria-orientation="horizontal"
        >
          <div className="rich-text-resize-handle-bar" />
        </div>
      )}

      <div
        className={`rich-text-input-area${isDragOver ? " is-drag-over" : ""}`}
        ref={dropTargetRef}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <RichTextInputAttachments
          attachments={attachments}
          workspaceId={attachmentWorkspaceId}
          disabled={disabled}
          onRemoveAttachment={onRemoveAttachment}
          className={attachmentsClassName}
        />

        <div className="rich-text-textarea-shell">
          <textarea
            ref={textareaRef}
            className={`rich-text-textarea ${inputClassName}`.trim()}
            placeholder={placeholder}
            value={value}
            onChange={handleTextareaChange}
            onSelect={handleTextareaSelect}
            disabled={disabled}
            onKeyDown={onKeyDown}
            onDragOver={handleDragOver}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onPaste={handleTextareaPaste}
          />
          {ghostTextSuffix && (
            <div className="composer-ghost-text-overlay" aria-hidden>
              <span className="composer-ghost-text-prefix">{value}</span>
              <span className="composer-ghost-text-suffix">{ghostTextSuffix}</span>
            </div>
          )}
        </div>

        {(footerLeft || footerRight) && (
          <div className={`rich-text-input-footer ${footerClassName}`.trim()}>
            {footerLeft && (
              <div className="rich-text-input-footer-left">{footerLeft}</div>
            )}
            {footerRight && (
              <div className="rich-text-input-footer-right">{footerRight}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
