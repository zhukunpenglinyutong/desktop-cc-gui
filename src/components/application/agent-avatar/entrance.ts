export const ENTRANCE_SECONDS = 1;

const smooth = (t: number) => {
  const p = Math.max(0, Math.min(1, t));
  return p * p * p * (p * (p * 6 - 15) + 10);
};

/** A curled arrival: the body rises first, then its tucked edge catches up. */
export function entrancePose(seconds: number) {
  const t = Math.max(0, Math.min(1, seconds / ENTRANCE_SECONDS));
  const grow = 1 - (1 - t) ** 3;
  const scale = .1 + .9 * grow;
  const turn = 1 - smooth(t / .85);
  const fold = 1 - smooth((t - .12) / .88);
  return {
    x: -22 * Math.sin(Math.PI * t) * (1 - t),
    y: 46 * (1 - grow),
    scaleX: scale,
    scaleY: scale,
    rotation: -.32 * turn,
    opacity: smooth(t / .2),
    fold,
    faceOpacity: smooth((t - .15) / .4),
  };
}
