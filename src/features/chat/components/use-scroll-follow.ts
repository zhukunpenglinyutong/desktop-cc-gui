import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
  type RefObject,
} from "react";
import type { Message } from "@/lib/ipc";

/** Distance from the scroll tail within which the user counts as "at bottom". */
const BOTTOM_THRESHOLD_PX = 100;

/** Momentum keeps firing scroll events after the finger lifts; hold the touch
 *  intent window open this long past the last one so the resting position is
 *  what decides follow vs. pause. */
const TOUCH_IDLE_MS = 150;

/** Tail-follow state and controls shared by the timeline's scroll consumers:
 *  the pin effects, the anchor rail and the floating edge-jump control. */
export type ScrollEdge = "top" | "bottom";

export interface SessionScrollSnapshot {
  scrollTop: number;
  atBottom: boolean;
  userPaused: boolean;
}

const MAX_SCROLL_SNAPSHOTS = 64;
const sessionScrollSnapshots = new Map<string, SessionScrollSnapshot>();

/** Read a saved scroll position for a session that was hidden or evicted. */
export function readSessionScrollSnapshot(
  key?: string,
): SessionScrollSnapshot | undefined {
  if (!key) return undefined;
  return sessionScrollSnapshots.get(key);
}

/** Persist a session's scroll position in a bounded LRU map (in-memory only). */
export function writeSessionScrollSnapshot(
  key: string,
  snapshot: SessionScrollSnapshot,
): void {
  if (sessionScrollSnapshots.has(key)) sessionScrollSnapshots.delete(key);
  sessionScrollSnapshots.set(key, snapshot);
  while (sessionScrollSnapshots.size > MAX_SCROLL_SNAPSHOTS) {
    const oldest = sessionScrollSnapshots.keys().next().value;
    if (oldest === undefined) break;
    sessionScrollSnapshots.delete(oldest);
  }
}

/** Drop a closed tab's saved scroll position so reopening starts at the tail. */
export function clearSessionScrollSnapshot(key: string): void {
  sessionScrollSnapshots.delete(key);
}

/** Test helper: clear all saved session scroll snapshots. */
export function resetSessionScrollSnapshots(): void {
  sessionScrollSnapshots.clear();
}

export interface ScrollFollow {
  /** Whether the viewport currently sits at the tail. */
  atBottomRef: MutableRefObject<boolean>;
  /** Set when the user deliberately scrolled away from the tail. */
  userPausedRef: MutableRefObject<boolean>;
  isFollowing: () => boolean;
  scrollToBottom: () => void;
  /** Restore an exact scrollTop programmatically without tripping user intent. */
  restoreScrollTop: (top: number) => void;
  /** Instant resume + pin (programmatic channel: send, fixtures) — no glide. */
  resumeFollow: () => void;
  /** User-initiated edge jump from the floating control; both legs glide. */
  scrollToEdge: (edge: ScrollEdge) => void;
}

/** Smooth edge jumps become instant jumps for motion-sensitive users. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Stick-to-bottom intent model (ported from the reference chat UI): wheel-up
 * pauses following, scrolling back down to the bottom resumes it; programmatic
 * scrolls are tagged and ignored. */
export function useScrollFollow({
  scrollRef,
  initialSnapshot,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  initialSnapshot?: SessionScrollSnapshot;
}): ScrollFollow {
  // Sampling geometry at content-change time misfires in a virtualized
  // list: a freshly mounted tool row still has the 72px estimated height,
  // so scrollHeight is stale and a "near bottom" check reads wrong. Track
  // user intent instead: wheel-up pauses following, scrolling back down to
  // the bottom resumes it; programmatic scrolls are tagged and ignored.
  const atBottomRef = useRef(initialSnapshot ? initialSnapshot.atBottom : true);
  const userPausedRef = useRef(initialSnapshot ? initialSnapshot.userPaused : false);
  const autoScrollingRef = useRef(false);
  // The floating control's smooth slide to the tail: programmatic pins stand
  // down until it settles, or one stream flush mid-animation would hard-jump
  // the viewport and cut the transition short.
  const smoothPinRef = useRef(false);
  const smoothPinTokenRef = useRef(0);
  const smoothPinTimerRef = useRef<number | null>(null);

  const isFollowing = useCallback(
    () => atBottomRef.current && !userPausedRef.current,
    [],
  );

  const cancelSmoothPin = useCallback(() => {
    smoothPinTokenRef.current += 1;
    smoothPinRef.current = false;
    if (smoothPinTimerRef.current !== null) {
      clearTimeout(smoothPinTimerRef.current);
      smoothPinTimerRef.current = null;
    }
  }, []);

  // Pin by scrollTop, not scrollToIndex: index alignment recomputes offsets
  // from the virtualizer's measured sizes, so rows whose height is still
  // settling (live growth, tool rows measuring in) made the viewport jump.
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // A user-initiated smooth slide owns the viewport until it settles.
    if (smoothPinRef.current) return;
    autoScrollingRef.current = true;
    el.scrollTop = el.scrollHeight - el.clientHeight;
    requestAnimationFrame(() => {
      autoScrollingRef.current = false;
    });
  }, [scrollRef]);
  const restoreScrollTop = useCallback(
    (top: number) => {
      const el = scrollRef.current;
      if (!el) return;
      cancelSmoothPin();
      autoScrollingRef.current = true;
      el.scrollTop = Math.max(0, top);
      requestAnimationFrame(() => {
        autoScrollingRef.current = false;
      });
    },
    [cancelSmoothPin, scrollRef],
  );
  // Explicit instant jump-to-bottom: clears the wheel-up pause so the pin
  // effects keep following afterwards. The user-facing glide lives in
  // scrollToEdge; programmatic callers (send, browser fixtures) want the
  // viewport on the tail immediately.
  const resumeFollow = useCallback(() => {
    cancelSmoothPin();
    userPausedRef.current = false;
    atBottomRef.current = true;
    scrollToBottom();
  }, [cancelSmoothPin, scrollToBottom]);
  // Floating-control jump: wheel up asks for "top", wheel down for "bottom".
  // Both glide; the bottom leg clears the wheel-up pause so the pin effects
  // keep following afterwards, then hard-pins once the glide settles so
  // content that grew mid-animation still lands on the true tail.
  const scrollToEdge = useCallback(
    (edge: ScrollEdge) => {
      const el = scrollRef.current;
      if (!el) return;
      cancelSmoothPin();
      if (edge === "top") {
        userPausedRef.current = true;
        atBottomRef.current = false;
        if (prefersReducedMotion()) el.scrollTop = 0;
        else el.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      userPausedRef.current = false;
      atBottomRef.current = true;
      const top = Math.max(0, el.scrollHeight - el.clientHeight);
      // Already at the tail (or nothing to scroll): a hard pin is the same frame.
      if (prefersReducedMotion() || top - el.scrollTop <= 4) {
        scrollToBottom();
        return;
      }
      smoothPinRef.current = true;
      const token = smoothPinTokenRef.current;
      el.scrollTo({ top, behavior: "smooth" });
      const finish = () => {
        el.removeEventListener("scrollend", finish);
        if (token !== smoothPinTokenRef.current) return;
        cancelSmoothPin();
        // A wheel-up mid-slide is the user taking over; don't yank them back.
        if (userPausedRef.current) return;
        scrollToBottom();
      };
      el.addEventListener("scrollend", finish, { once: true });
      // scrollend is missing on older WebKit (and in jsdom): time-box the
      // settle by distance, like the reference client does.
      smoothPinTimerRef.current = window.setTimeout(
        finish,
        Math.min(1000, Math.max(350, Math.round((top - el.scrollTop) * 0.55))),
      );
    },
    [scrollRef, cancelSmoothPin, scrollToBottom],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight;

    // Only a scrollbar drag counts as scroll-event intent: the virtualizer's
    // measurement compensation also moves scrollTop (untagged), and reading
    // those programmatic shifts as intent silently unfollowed the tail right
    // after opening a session. Wheel pause/resume stays in the wheel handler.
    let scrollbarDrag = false;
    // Touch (the web-remote UI on a phone) produces neither wheel deltas nor
    // a scrollbar press, so without this branch the follow state stayed at
    // its initial "at bottom" forever and every append, stream flush and row
    // re-measurement yanked the viewport back to the tail while the user was
    // reading history. A touch drag IS user intent, and its direction carries
    // the same meaning as a wheel delta.
    let touchIntent = false;
    let touchIdle = 0;
    let lastScrollTop = el.scrollTop;
    const isTouch = (e: PointerEvent) =>
      e.pointerType === "touch" || e.pointerType === "pen";
    const clearTouchIdle = () => {
      clearTimeout(touchIdle);
      touchIdle = 0;
    };
    const armTouchIdle = () => {
      clearTouchIdle();
      touchIdle = window.setTimeout(() => {
        touchIdle = 0;
        touchIntent = false;
      }, TOUCH_IDLE_MS);
    };
    const handlePointerDown = (e: PointerEvent) => {
      if (isTouch(e)) {
        clearTouchIdle();
        touchIntent = true;
        lastScrollTop = el.scrollTop;
        return;
      }
      // Scrollbar chrome sits outside the padding box: a press with offsets
      // beyond clientWidth/clientHeight landed on the track or thumb.
      scrollbarDrag = e.offsetX > el.clientWidth || e.offsetY > el.clientHeight;
    };
    const endPointerDrag = (e: PointerEvent) => {
      // Lifting the finger does not end the gesture: momentum scrolling is
      // still the user's, so the window closes on scroll idle instead.
      if (isTouch(e)) {
        if (touchIntent) armTouchIdle();
        return;
      }
      scrollbarDrag = false;
    };

    let scrollRaf = 0;
    const handleScroll = () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        // Programmatic pins must not read as user intent.
        if (autoScrollingRef.current) return;
        // Touch drag and its momentum tail: up pauses following, back down to
        // the bottom resumes it. Checked before the pause early-return so a
        // finger can undo its own pause, and gated on direction so the
        // virtualizer's measurement compensation cannot silently re-follow.
        if (touchIntent) {
          armTouchIdle();
          const top = el.scrollTop;
          const delta = top - lastScrollTop;
          lastScrollTop = top;
          if (delta < 0) {
            userPausedRef.current = true;
            atBottomRef.current = false;
          } else if (delta > 0 && distanceFromBottom() < BOTTOM_THRESHOLD_PX) {
            userPausedRef.current = false;
            atBottomRef.current = true;
          }
          return;
        }
        // An explicit wheel-up pause is cleared only by the wheel handler,
        // otherwise a scroll event from that same gesture (still within the
        // threshold) would immediately un-pause.
        if (userPausedRef.current) return;
        if (!scrollbarDrag) return;
        atBottomRef.current = distanceFromBottom() < BOTTOM_THRESHOLD_PX;
      });
    };

    // Wheel deltas are always user-initiated: up pauses following, down to
    // the bottom resumes it.
    let wheelRaf = 0;
    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) {
        userPausedRef.current = true;
        atBottomRef.current = false;
      } else if (e.deltaY > 0) {
        if (wheelRaf) cancelAnimationFrame(wheelRaf);
        wheelRaf = requestAnimationFrame(() => {
          wheelRaf = 0;
          if (distanceFromBottom() < BOTTOM_THRESHOLD_PX) {
            userPausedRef.current = false;
            atBottomRef.current = true;
          }
        });
      }
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    el.addEventListener("wheel", handleWheel, { passive: true });
    el.addEventListener("pointerdown", handlePointerDown, { passive: true });
    window.addEventListener("pointerup", endPointerDrag);
    window.addEventListener("pointercancel", endPointerDrag);
    return () => {
      el.removeEventListener("scroll", handleScroll);
      el.removeEventListener("wheel", handleWheel);
      el.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", endPointerDrag);
      window.removeEventListener("pointercancel", endPointerDrag);
      if (scrollRaf) cancelAnimationFrame(scrollRaf);
      if (wheelRaf) cancelAnimationFrame(wheelRaf);
      clearTouchIdle();
      // Invalidate a glide still in flight so its settle cannot pin after unmount.
      cancelSmoothPin();
    };
  }, [scrollRef, cancelSmoothPin]);

  return {
    atBottomRef,
    userPausedRef,
    isFollowing,
    scrollToBottom,
    restoreScrollTop,
    resumeFollow,
    scrollToEdge,
  };
}

/** Keep the tail pinned while content grows: on append (when following), on
 * every stream flush, and on late row re-measurements that grow the virtual
 * total height after the append effects already ran. */
export function useTailPin({
  scrollRef,
  count,
  items,
  streaming,
  isFollowing,
  scrollToBottom,
  restoreScrollTop,
  initialScrollTop,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  count: number;
  items: Message[];
  streaming: boolean;
  isFollowing: () => boolean;
  scrollToBottom: () => void;
  restoreScrollTop?: (top: number) => void;
  initialScrollTop?: number | null;
}) {
  // Scroll to bottom when switching sessions (new page loaded) or when a new
  // message is appended while following the tail. If the session is returning
  // after LRU eviction with a saved non-tail position, restore that offset
  // instead of yanking back to the bottom.
  const lastCountRef = useRef(0);
  const initialScrollTopRef = useRef(initialScrollTop ?? null);
  useLayoutEffect(() => {
    if (!scrollRef.current || count === 0) return;
    const grew = count > lastCountRef.current;
    const switched = lastCountRef.current === 0;
    if (switched) {
      const savedTop = initialScrollTopRef.current;
      initialScrollTopRef.current = null;
      if (savedTop !== null && !isFollowing() && restoreScrollTop) {
        restoreScrollTop(savedTop);
      } else {
        scrollToBottom();
      }
    } else if (grew && isFollowing()) {
      scrollToBottom();
    }
    lastCountRef.current = count;
  }, [count, isFollowing, restoreScrollTop, scrollToBottom, scrollRef]);

  // Keep the tail pinned while stream rows grow, if the user is at bottom.
  // `items` changes identity on every flush, so this tracks both thinking
  // and text growth.
  useLayoutEffect(() => {
    if (!scrollRef.current || !streaming || !isFollowing()) return;
    scrollToBottom();
  }, [items, streaming, count, isFollowing, scrollToBottom, scrollRef]);

  // Rows re-measure after mount (tool calls render taller than the 72px
  // estimate); each measurement grows the virtual total height after the
  // count/items effects above already ran. Follow those late size changes
  // so the tail stays pinned while tools appear.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const inner = el?.querySelector<HTMLElement>("[data-virtual-inner]");
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (isFollowing()) scrollToBottom();
    });
    observer.observe(inner);
    return () => {
      observer.disconnect();
    };
  }, [isFollowing, scrollToBottom, scrollRef]);
}
