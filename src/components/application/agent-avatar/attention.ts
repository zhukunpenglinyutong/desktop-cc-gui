import type { FaceRig } from "./face";
import type { AvatarConfig } from "./model";

type Nuance = { openness: number; asymmetry: number; tilt: number; softness: number };
export type AttentionState = { seed: number; elapsed: number; duration: number; time: number; offset: number; from: Nuance; to: Nuance };
const REST: Nuance = { openness: 0, asymmetry: 0, tilt: 0, softness: 0 };
function random(state: AttentionState) {
  state.seed = (Math.imul(state.seed, 1664525) + 1013904223) >>> 0;
  return state.seed / 4294967296;
}
function nextNuance(state: AttentionState): Nuance {
  return { openness: (random(state) - .5) * .18, asymmetry: (random(state) - .5) * .22, tilt: (random(state) - .5) * .07, softness: random(state) * .14 };
}
export function createAttention(seed: number): AttentionState {
  const state = { seed, elapsed: 0, duration: 2.2, time: 0, offset: (seed >>> 0) / 4294967296 * Math.PI * 2, from: REST, to: REST };
  state.to = nextNuance(state);
  state.duration = 1.8 + random(state) * 1.8;
  return state;
}

/** Add small changes within the chosen emotion, without cycling through moods.
 * This clock advances only while the avatar is visibly animating.
 */
export function advanceAttention(state: AttentionState, seconds: number, base: FaceRig, config: AvatarConfig): FaceRig {
  if (config.idle || config.eyes === "sleepy" || config.motion === 0) return base;
  state.time = (state.time ?? 0) + Math.max(0, seconds);
  state.elapsed += Math.max(0, seconds);
  while (state.elapsed >= state.duration) {
    state.elapsed -= state.duration;
    state.from = state.to; state.to = nextNuance(state);
    state.duration = 1.8 + random(state) * 1.8;
  }
  const t = state.elapsed / state.duration;
  const smooth = t * t * (3 - 2 * t);
  const amount = Math.min(1, config.motion / 40);
  const value = (key: keyof Nuance) => (state.from[key] + (state.to[key] - state.from[key]) * smooth) * amount;
  const openness = value("openness"), asymmetry = value("asymmetry");
  // Overlapping rhythms keep happy lids gently changing even between glances.
  // Each eye has its own timing; the expression blend eases this in and out.
  const happy = Math.max(0, (base.smile - .2) / .8) * amount * Math.min(1, state.time / .8);
  const clock = state.time, offset = state.offset ?? 0;
  const left = Math.sin(clock * 1.65 + offset) * .7 + Math.sin(clock * 1.13 + offset * .7) * .3;
  const right = Math.sin(clock * 1.48 + offset + .9) * .7 + Math.sin(clock * 2.05 + offset * .4) * .3;
  const soften = (1 + Math.sin(clock * 1.31 + offset + .4)) * .5;
  return {
    ...base,
    leftOpen: base.leftOpen * (1 + openness + asymmetry + left * happy * .13),
    rightOpen: base.rightOpen * (1 + openness - asymmetry + right * happy * .13),
    width: base.width * (1 + (left + right) * happy * .035),
    leftAngle: base.leftAngle + value("tilt") * .6 + left * happy * .045,
    rightAngle: base.rightAngle + value("tilt") * .6 - right * happy * .045,
    headTilt: base.headTilt + value("tilt"),
    smile: Math.max(0, Math.min(1, base.smile - soften * happy * .09 + (config.eyes === "neutral" || config.eyes === "curious" ? value("softness") : 0))),
  };
}
