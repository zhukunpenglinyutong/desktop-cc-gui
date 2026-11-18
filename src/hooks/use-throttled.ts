import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { ThrottledText, nextParseInterval, streamParseInterval } from "./throttled-text";
import { performanceRecorder } from "@/lib/performance-diagnostics";

export { nextParseInterval, streamParseInterval };

/** Parse interval for one live row: cadence from the reply length, backed off
 * by the measured cost of the previous commit. Settled rows pass 0 (no
 * throttle). The measurement spans render + commit, so it includes the
 * markdown parse, highlighting and React's reconciliation. */
export function useLiveParseInterval(live: boolean, length: number): number {
  const commitMs = useRef(0);
  // Timestamp taken in render and captured by this render's layout effect:
  // same render + commit measurement, without mutating a ref during render
  // (React may replay or discard render work).
  const renderStartedAt = performance.now();
  useLayoutEffect(() => {
    commitMs.current = performance.now() - renderStartedAt;
    if (live) performanceRecorder.duration("liveRenderCommit", commitMs.current);
  });
  return live ? nextParseInterval(streamParseInterval(length), commitMs.current) : 0;
}

/** Coalesce streaming appends before expensive Markdown parsing. Completion,
 * replacements and truncation pass through in the current render. Publish
 * idle arrivals before paint, without queuing captured text in React state. */
export function useThrottled(value: string, ms: number): string {
  const [controller] = useState(() => new ThrottledText(value));
  const visible = useSyncExternalStore(controller.subscribe, controller.read, () => value);
  useLayoutEffect(() => { controller.update(value, ms); }, [controller, value, ms]);
  useLayoutEffect(() => () => controller.cancel(), [controller]);
  return controller.bypass(value, ms) ? value : visible;
}

/** Republish `value` at most once per `ms` while it keeps changing: the first
 *  change lands before paint, later ones coalesce into a trailing publish of
 *  the newest value. `isSame` reports inputs that no consumer can tell apart;
 *  those never republish and never schedule work. For consumers whose render
 *  cost scales with the input — a session-wide fold re-read on every stream
 *  flush — a status summary does not need a per-frame cadence. Not for text
 *  that must stay frame-accurate. */
export function useCoalescedValue<T>(
  value: T,
  ms: number,
  isSame: (previous: T, next: T) => boolean = Object.is,
): T {
  const [visible, setVisible] = useState(value);
  const latest = useRef(value);
  const timer = useRef<number | null>(null);
  const publishedAt = useRef(Number.NEGATIVE_INFINITY);
  useLayoutEffect(() => {
    latest.current = value;
    if (isSame(visible, value)) return;
    const wait = publishedAt.current + ms - Date.now();
    if (wait <= 0) {
      publishedAt.current = Date.now();
      setVisible(value);
      return;
    }
    // A trailing publish is already scheduled; it reads the newest value.
    if (timer.current !== null) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      publishedAt.current = Date.now();
      setVisible(latest.current);
    }, wait);
  }, [value, visible, ms, isSame]);
  useLayoutEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );
  return visible;
}
