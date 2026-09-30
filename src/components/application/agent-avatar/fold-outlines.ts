type Point = [number, number];
type Curve = [number, number, number, number, number, number];
type Outline = { start: Point; curves: Curve[] };

// Clockwise, rounded contours with enough uninterrupted space for a small face.
const outlines: Record<"heart" | "cloud" | "diamond" | "shield", Outline> = {
  heart: {
    start: [0, -46],
    curves: [
      [12, -46, 16, -73, 43, -73], [86, -73, 96, -29, 76, 2],
      [59, 34, 28, 64, 10, 78], [4, 84, -4, 84, -10, 78],
      [-28, 64, -59, 34, -76, 2], [-96, -29, -86, -73, -43, -73],
      [-16, -73, -12, -46, 0, -46],
    ],
  },
  cloud: {
    start: [0, -75],
    curves: [
      [25, -75, 42, -54, 44, -32], [70, -45, 93, -23, 92, 0],
      [105, 30, 81, 62, 55, 62], [21, 64, -19, 64, -54, 62],
      [-84, 62, -100, 40, -96, 13], [-94, -10, -76, -24, -55, -23],
      [-59, -49, -35, -66, -15, -58], [-12, -68, -8, -75, 0, -75],
    ],
  },
  diamond: {
    start: [0, -88],
    curves: [
      [8, -88, 14, -77, 24, -66], [42, -46, 61, -25, 76, -10],
      [84, -2, 84, 2, 76, 10], [61, 25, 42, 46, 24, 66],
      [14, 77, 8, 88, 0, 88], [-8, 88, -14, 77, -24, 66],
      [-42, 46, -61, 25, -76, 10], [-84, 2, -84, -2, -76, -10],
      [-61, -25, -42, -46, -24, -66], [-14, -77, -8, -88, 0, -88],
    ],
  },
  shield: {
    start: [0, -86],
    curves: [
      [7, -86, 16, -74, 33, -67], [48, -60, 63, -56, 73, -54],
      [80, -53, 81, -49, 81, -41], [81, -26, 81, -7, 80, 10],
      [79, 42, 51, 60, 10, 84], [4, 88, -4, 88, -10, 84],
      [-51, 60, -79, 42, -80, 10], [-81, -7, -81, -26, -81, -41],
      [-81, -49, -80, -53, -73, -54], [-63, -56, -48, -60, -33, -67],
      [-16, -74, -7, -86, 0, -86],
    ],
  },
};

export type PaperSymbol = keyof typeof outlines;
export const isPaperSymbol = (shape: string): shape is PaperSymbol => Object.hasOwn(outlines, shape);

/** Same contour drives the front, tucked sheet, and connecting turn surfaces. */
export function paperSymbolPoint(shape: PaperSymbol, angle: number): Point {
  const outline = outlines[shape];
  const turn = (angle + Math.PI / 2) / (Math.PI * 2);
  const position = ((turn % 1 + 1) % 1) * outline.curves.length;
  const index = Math.floor(position), t = position - index, u = 1 - t;
  const previous = index ? outline.curves[index - 1] : null;
  const start = previous ? [previous[4], previous[5]] : outline.start;
  const c = outline.curves[index];
  return [
    u ** 3 * start[0] + 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t ** 3 * c[4],
    u ** 3 * start[1] + 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t ** 3 * c[5],
  ];
}
