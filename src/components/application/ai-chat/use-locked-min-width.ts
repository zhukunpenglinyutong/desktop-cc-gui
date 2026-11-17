import { useLayoutEffect, useState } from "react";
import type { Ref } from "react";

/** Min-width lock: snapshot the node's width when `locked` turns on, clear it
 *  when `locked` turns off, so content changing meanwhile can't shrink the node
 *  and slide whatever sits next to it. Adjusted during render (prev-prop
 *  pattern) so every path flipping `locked` is covered and the snapshot still
 *  reads the DOM from before the new content commits. */
export function useLockedMinWidth(locked: boolean, ref: Ref<HTMLElement>) {
  const [lockedMinWidth, setLockedMinWidth] = useState<number | undefined>();
  const [prevLocked, setPrevLocked] = useState(locked);
  const readWidth = () => (ref && typeof ref !== "function" ? ref.current?.offsetWidth : undefined);
  if (prevLocked !== locked) {
    setPrevLocked(locked);
    setLockedMinWidth(locked ? readWidth() : undefined);
  }
  // Mounted already locked (the model search survives the engine switch that
  // remounts the flyout): there is no off-to-on flip to snapshot at.
  useLayoutEffect(() => {
    if (locked) setLockedMinWidth(readWidth());
  }, []);
  return lockedMinWidth;
}
