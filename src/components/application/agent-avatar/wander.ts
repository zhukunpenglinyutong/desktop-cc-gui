export type GazePoint = [number, number];

export type WanderState = {
  seed: number;
  from: GazePoint;
  target: GazePoint;
  point: GazePoint;
  elapsed: number;
  travel: number;
  hold: number;
};

function random(state: WanderState) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}

export function createWander(seed: number, attentive = false): WanderState {
  const state: WanderState = { seed, from: [0, 0], target: [0, 0], point: [0, 0], elapsed: 0, travel: .2, hold: 0 };
  state.hold = attentive ? .35 + random(state) * .55 : .4 + random(state) * 1.3;
  return state;
}

/** Runs on active animation time, so pausing or hiding the avatar freezes its gaze. */
export function advanceWander(state: WanderState, seconds: number, attentive = false): GazePoint {
  state.elapsed += Math.max(0, seconds);
  while (state.elapsed >= state.travel + state.hold) {
    state.elapsed -= state.travel + state.hold;
    state.from = state.target;
    if (attentive) {
      // Most changes are nearby checking glances; broad looks are occasional.
      const nearby = random(state) < .68;
      const clamp = (v: number) => Math.max(-.9, Math.min(.9, v));
      state.target = nearby
        ? [clamp(state.from[0] * .72 + (random(state) - .5) * .85), clamp(state.from[1] * .72 + (random(state) - .5) * .7)]
        : [(random(state) * 2 - 1) * .9, (random(state) * 2 - 1) * .8];
      state.travel = .38 + random(state) * .24 + Math.hypot(state.target[0] - state.from[0], state.target[1] - state.from[1]) * .22;
      state.hold = .45 + random(state) * 1.05;
      continue;
    }
    const range = random(state) < .24 ? .2 : 1;
    let next: GazePoint = [0, 0];
    for (let attempt = 0; attempt < 4; attempt++) {
      next = [(random(state) * 2 - 1) * range, (random(state) * 2 - 1) * range];
      if (Math.hypot(next[0] - state.from[0], next[1] - state.from[1]) > .3) break;
    }
    state.target = next;
    state.travel = .16 + random(state) * .3;
    // A quick checking glance sometimes interrupts the longer, relaxed holds.
    state.hold = random(state) < .2 ? .25 + random(state) * .45 : 1 + random(state) * 2.6;
  }
  const t = Math.min(state.elapsed / state.travel, 1);
  const ease = t * t * (3 - 2 * t);
  state.point = [state.from[0] + (state.target[0] - state.from[0]) * ease, state.from[1] + (state.target[1] - state.from[1]) * ease];
  if (attentive && state.elapsed > state.travel) {
    // Tiny adjustments during a hold, easing to zero at either end.
    const holdProgress = (state.elapsed - state.travel) / state.hold;
    const envelope = Math.sin(holdProgress * Math.PI) ** 2 * .035;
    const offset = state.seed % 97;
    state.point = [state.point[0] + Math.sin(holdProgress * 3 + offset) * envelope, state.point[1] + Math.cos(holdProgress * 2 + offset) * envelope];
  }
  return state.point;
}
