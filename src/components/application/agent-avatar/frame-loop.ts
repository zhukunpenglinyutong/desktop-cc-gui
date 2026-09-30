/**
 * One requestAnimationFrame for every animated avatar on screen.
 *
 * Blink, wander, attention and the shape morph all advance per frame, so a
 * per-instance loop turned every avatar into a timer of its own: a settings
 * list or a `#` menu with a dozen 16px avatars paid one browser callback per
 * avatar per frame. Subscribers share the browser's single loop instead, each
 * keeping its own elapsed/draw logic. The loop starts with the first
 * subscriber and stops with the last, so an unmounted list leaves no callback
 * behind.
 */
type Frame = (now: number) => void;

const frames = new Set<Frame>();
let handle = 0;

function pump(now: number) {
  handle = 0;
  // Copy: a frame that unsubscribes mid-pump must not disturb this pass.
  for (const frame of [...frames]) frame(now);
  // A subscriber that arrived during the pump already scheduled the next
  // frame itself — never arm a second loop on top of it.
  if (frames.size > 0 && !handle) handle = requestAnimationFrame(pump);
}

/** Runs `frame(timestamp)` every browser frame until the returned function is
 *  called. Callbacks receive the one timestamp the shared loop was woken with.
 */
export function subscribeFrame(frame: Frame): () => void {
  frames.add(frame);
  if (!handle) handle = requestAnimationFrame(pump);
  return () => {
    frames.delete(frame);
    if (frames.size === 0 && handle) {
      cancelAnimationFrame(handle);
      handle = 0;
    }
  };
}
