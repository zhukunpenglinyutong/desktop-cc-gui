/** A private clock for each mounted avatar, independent of its motion loop. */
export type BlinkState = { seed: number; wait: number; elapsed: number; duration: number; blinking: boolean; second: boolean };
function random(state: BlinkState) { state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0; return state.seed / 4294967296; }
export function createBlink(seed: number): BlinkState {
  const state: BlinkState = { seed, wait: 0, elapsed: 0, duration: .18, blinking: false, second: false };
  state.wait = .4 + random(state) * 4.4;
  return state;
}
export function advanceBlink(state: BlinkState, seconds: number): number {
  if (!state.blinking) {
    state.wait -= seconds;
    if (state.wait > 0) return 1;
    state.blinking = true; state.elapsed = 0; state.duration = .14 + random(state) * .09;
  }
  state.elapsed += seconds;
  const progress = state.elapsed / state.duration;
  if (progress >= 1) {
    state.blinking = false;
    const double = !state.second && random(state) < .12;
    state.second = double;
    state.wait = double ? .14 + random(state) * .12 : 2.1 + random(state) * 5.2;
    return 1;
  }
  // A quicker close and a soft reopen, with no hard frame at the seam.
  return Math.max(.07, 1 - Math.sin(Math.PI * progress) ** 2);
}
