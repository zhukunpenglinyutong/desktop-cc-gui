/**
 * Ghost text overlay for inline history completion.
 *
 * Since <textarea> does not support ::after pseudo-elements,
 * this component renders an absolutely-positioned overlay that
 * mirrors the textarea's text layout. The overlay shows an
 * invisible prefix (matching the user's input) followed by a
 * visible gray suffix (the completion suggestion).
 */

import { useEffect, useRef, type RefObject } from "react";

interface ComposerGhostTextProps {
  /** Current textarea value */
  text: string;
  /** Completion suffix to display */
  suffix: string;
  /** Reference to the actual textarea element */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function ComposerGhostText({
  text,
  suffix,
  textareaRef,
}: ComposerGhostTextProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // Sync scroll position with the textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    const overlay = overlayRef.current;
    if (!textarea || !overlay) return;

    const syncScroll = () => {
      overlay.scrollTop = textarea.scrollTop;
      overlay.scrollLeft = textarea.scrollLeft;
    };

    syncScroll();
    textarea.addEventListener("scroll", syncScroll, { passive: true });
    return () => textarea.removeEventListener("scroll", syncScroll);
  }, [textareaRef]);

  if (!suffix) return null;

  return (
    <div
      ref={overlayRef}
      className="composer-ghost-text-overlay pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre-wrap break-words border-none p-0 font-[inherit] text-[14px] leading-[1.5]"
      aria-hidden
    >
      <span className="composer-ghost-text-prefix invisible whitespace-pre-wrap break-words">
        {text}
      </span>
      <span className="composer-ghost-text-suffix whitespace-pre-wrap break-words text-muted-foreground opacity-50">
        {suffix}
      </span>
    </div>
  );
}
