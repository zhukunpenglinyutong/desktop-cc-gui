export const WORKING_SECONDS = 1.15;

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
};

/** One little hop and a full turn, then back to the existing gaze and pose. */
export function workingPose(seconds: number, cycles = 1) {
  const duration = WORKING_SECONDS * cycles;
  const elapsed = seconds >= duration ? WORKING_SECONDS : Math.max(0, seconds) % WORKING_SECONDS;
  const t = Math.max(0, Math.min(1, elapsed / WORKING_SECONDS));
  const turn = smooth((t - .08) / .84) * Math.PI * 2;
  const lift = Math.sin(Math.PI * smooth((t - .12) / .72)) ** 2;
  const anticipation = t < .18 ? Math.sin(Math.PI * t / .18) ** 2 * 2 : 0;
  return { turn, y: anticipation - lift * 9, tilt: Math.sin(turn) * -.055 };
}
