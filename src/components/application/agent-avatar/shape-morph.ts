import type { AvatarConfig } from "./model";

type Point = [number, number];
type RecordedPath = Path2D & { contour: Point[] };
export type PaperGeometry = {
  paper: RecordedPath; back: RecordedPath; crease: RecordedPath;
  sx: number; gazeX: number; gazeY: number; faceInset: number; faceY: number;
};
type SampledGeometry = Omit<PaperGeometry, "paper" | "back" | "crease"> & { paper: Point[]; back: Point[]; crease: Point[] };
export type ShapeMorph = { shape?: AvatarConfig["foldShape"]; last?: PaperGeometry; resolved?: SampledGeometry; from?: SampledGeometry; started: number; active: boolean };
export const SHAPE_MORPH_MS = 480;

/** Keep lightweight contour samples alongside the native path; no canvas readback. */
export function recordingPath(record = true): RecordedPath {
  const path = new Path2D() as RecordedPath;
  if (!record) { path.contour = []; return path; }
  const commands: number[][] = [];
  let contour: Point[] | undefined;
  const move = path.moveTo.bind(path), line = path.lineTo.bind(path), curve = path.bezierCurveTo.bind(path);
  path.moveTo = (x, y) => { move(x, y); commands.push([0, x, y]); };
  path.lineTo = (x, y) => { line(x, y); commands.push([1, x, y]); };
  path.bezierCurveTo = (x1, y1, x2, y2, x3, y3) => {
    curve(x1, y1, x2, y2, x3, y3); commands.push([2, x1, y1, x2, y2, x3, y3]);
  };
  // Normal wandering draws only native curves. Sample their contours lazily,
  // during the half-second morph, instead of allocating points every frame.
  Object.defineProperty(path, "contour", { get() {
    if (contour) return contour;
    contour = [];
    for (const [kind, x1, y1, x2, y2, x3, y3] of commands) {
      if (kind !== 2) { contour.push([x1, y1]); continue; }
      const a = contour.at(-1) ?? [0, 0];
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, u = 1 - t;
        contour.push([u ** 3 * a[0] + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t ** 3 * x3,
          u ** 3 * a[1] + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y3]);
      }
    }
    return contour;
  } });
  return path;
}

/** Match outlines by bearing, so tips grow outwards without twisting the paper. */
export function radialContour(points: Point[], count = 160): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + index / count * Math.PI * 2, dx = Math.cos(angle), dy = Math.sin(angle);
    let radius = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], ex = b[0] - a[0], ey = b[1] - a[1];
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) < 1e-9) continue;
      const r = (a[0] * ey - a[1] * ex) / denominator;
      const t = (a[0] * dy - a[1] * dx) / denominator;
      if (r >= 0 && t >= -1e-7 && t <= 1 + 1e-7) radius = Math.max(radius, r);
    }
    return [dx * radius, dy * radius];
  });
}
function openContour(points: Point[], count = 48): Point[] {
  return Array.from({ length: count }, (_, i) => {
    const at = i / (count - 1) * (points.length - 1), index = Math.floor(at), t = at - index;
    const a = points[index], b = points[Math.min(index + 1, points.length - 1)];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  });
}
function sample(g: PaperGeometry): SampledGeometry {
  return { ...g, paper: radialContour(g.paper.contour), back: radialContour(g.back.contour), crease: openContour(g.crease.contour) };
}
function trace(points: Point[], closed: boolean): RecordedPath {
  const path = new Path2D() as RecordedPath;
  path.contour = points;
  path.moveTo(...points[0]);
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const point = (n: number) => points[closed ? (n + points.length) % points.length : Math.min(points.length - 1, Math.max(0, n))];
    const a = point(i - 1), b = point(i), c = point(i + 1), d = point(i + 2);
    path.bezierCurveTo(b[0] + (c[0] - a[0]) / 6, b[1] + (c[1] - a[1]) / 6,
      c[0] - (d[0] - b[0]) / 6, c[1] - (d[1] - b[1]) / 6, ...c);
  }
  if (closed) path.closePath();
  return path;
}
export function morphEase(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Retarget from the last rendered contour, including during a rapid second selection. */
export function morphPaper(target: PaperGeometry, state: ShapeMorph, shape: AvatarConfig["foldShape"], now: number): PaperGeometry {
  if (state.shape !== shape) {
    state.from = state.resolved ?? (state.last ? sample(state.last) : undefined);
    state.started = now; state.shape = shape;
  }
  state.last = target;
  const progress = (now - state.started) / SHAPE_MORPH_MS;
  state.active = !!state.from && progress < 1;
  if (!state.active || !state.from) { state.from = undefined; state.resolved = undefined; return target; }
  const destination = sample(target), from = state.from, t = morphEase(progress);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  const points = (a: Point[], b: Point[]): Point[] => a.map((p, i) => [lerp(p[0], b[i][0]), lerp(p[1], b[i][1])]);
  const result: SampledGeometry = { paper: points(from.paper, destination.paper), back: points(from.back, destination.back), crease: points(from.crease, destination.crease), sx: lerp(from.sx, destination.sx), gazeX: lerp(from.gazeX, destination.gazeX), gazeY: lerp(from.gazeY, destination.gazeY), faceInset: lerp(from.faceInset, destination.faceInset), faceY: lerp(from.faceY, destination.faceY) };
  state.resolved = result;
  return { ...result, paper: trace(result.paper, true), back: trace(result.back, true), crease: trace(result.crease, false) };
}
