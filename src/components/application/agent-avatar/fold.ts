import { morphPaper, recordingPath, type ShapeMorph } from "./shape-morph";
import type { AvatarConfig } from "./model";
import { isPaperSymbol, paperSymbolPoint } from "./fold-outlines";
import { drawFace, drawSleepMarks, type FaceRig } from "./face";

/** Two flat pieces of color, one continuous curved fold. No GPU or raster assets. */
export function drawFold(ctx: CanvasRenderingContext2D, c: AvatarConfig, phase: number, rig: FaceRig, gaze: [number, number], cssSize: number, grain: HTMLCanvasElement, arrivalFold = 0, faceOpacity = 1, workTurn = 0, shapeMorph?: ShapeMorph) {
  const side = c.foldDirection === "left" ? -1 : 1;
  let sx = c.foldShape === "slender" ? .86 : 1;
  const sy = 1;
  const movement = c.motion / 100;
  const flutter = (Math.sin(phase - .5) * 3 + rig.bounce * 4 + rig.headTilt * 10) * movement;
  const depth = (c.foldDepth - 45) * .35;
  const curl = (c.idle ? -3 : gaze[0] * side * 6) + flutter - arrivalFold * 24;
  const seamX = 49 - depth + curl;
  // Both layers turn with the already-smoothed gaze. Their different depths
  // create parallax: the near face slides across the tucked sheet underneath.
  const yaw = gaze[0] * side * 1.4;
  const pitch = gaze[1] * 1.2;
  const cross = Math.sin(yaw) * Math.sin(pitch);
  const faceTurn = new DOMMatrix([
    Math.cos(yaw), -cross * .36, cross * .18, Math.cos(pitch),
    Math.sin(yaw) * 22, Math.sin(pitch) * 17,
  ]);
  const facing = Math.cos(workTurn);
  const orbit = Math.sin(workTurn);
  const turning = workTurn > .0001 && workTurn < Math.PI * 2 - .0001;
  // One rigid rotation for every layer. Only their depth differs: the tucked
  // sheet stays close to the pivot instead of swinging around independently.
  const rotateLayer = (rest: DOMMatrix, z: number) => new DOMMatrix([
    rest.a * facing, rest.b, rest.c * facing, rest.d,
    rest.e * facing + orbit * z, rest.f,
  ]);
  const symbol = isPaperSymbol(c.foldShape) ? c.foldShape : null;
  const shaped = c.foldShape === "star" || c.foldShape === "flower" || symbol !== null;
  const frontTurn = rotateLayer(faceTurn, shaped ? 24 : 60);
  const backTurn = rotateLayer(new DOMMatrix([
    Math.cos(yaw * .7), -cross * .14, cross * .08, Math.cos(pitch * .7),
    -Math.sin(yaw) * 15 + arrivalFold * 9, -Math.sin(pitch) * 10 + arrivalFold * 14,
  ]), -5);
  const bodyTurn = rotateLayer(faceTurn, 0);
  let paper = recordingPath(!!shapeMorph);
  let back = recordingPath(!!shapeMorph);
  let crease = recordingPath(!!shapeMorph);
  const foldedSides = new Path2D();
  if (shaped) {
    const petals = c.foldShape === "flower" ? 6 : 5;
    const flower = c.foldShape === "flower";
    const tuck = 8 + c.foldDepth * .16 - curl * .35;
    // Both paper layers follow the same rounded contour; only the near sheet
    // tucks inward along one edge, leaving room for the eyes.
    const point = (angle: number, front: boolean): [number, number] => {
      const wave = Math.cos(petals * (angle + Math.PI / 2));
      const r = flower ? 58 + 28 * Math.sqrt(.08 + .92 * (wave + 1) / 2) : 73 + 17 * wave;
      const [x, y] = symbol ? paperSymbolPoint(symbol, angle) : [r * Math.cos(angle), r * Math.sin(angle)];
      const bearing = symbol ? Math.atan2(y, x) : angle;
      const edge = Math.max(0, Math.cos(bearing - .3));
      const fold = front ? tuck * edge * edge : 0;
      return [x - fold * Math.cos(bearing), y - fold * .45 * Math.sin(bearing)];
    };
    // Cubic interpolation keeps the tips and valleys soft, including at 24px.
    const trace = (path: Path2D, front: boolean, start: number, end: number, closed: boolean) => {
      const steps = Math.ceil((end - start) * 12);
      const step = (end - start) / steps;
      const derivative = (angle: number): [number, number] => {
        const a = point(angle - .001, front), b = point(angle + .001, front);
        return [(b[0] - a[0]) / .002, (b[1] - a[1]) / .002];
      };
      path.moveTo(...point(start, front));
      for (let i = 0; i < steps; i++) {
        const angle = start + i * step;
        const a = point(angle, front), b = point(angle + step, front);
        const da = derivative(angle), db = derivative(angle + step);
        path.bezierCurveTo(a[0] + da[0] * step / 3, a[1] + da[1] * step / 3,
          b[0] - db[0] * step / 3, b[1] - db[1] * step / 3, b[0], b[1]);
      }
      if (closed) path.closePath();
    };
    trace(paper, true, -Math.PI / 2, Math.PI * 1.5, true);
    trace(back, false, -Math.PI / 2, Math.PI * 1.5, true);
    trace(crease, true, -.65, 1.3, false);
    if (turning) {
      // Join matching contour points on the two sheets. A generic oval would
      // fill the star's valleys and leave isolated tips poking out mid-turn.
      const project = (angle: number, amount: number): [number, number] => {
        const a = point(angle, false), b = point(angle, true);
        const bx = backTurn.a * a[0] + backTurn.c * a[1] + backTurn.e;
        const by = backTurn.b * a[0] + backTurn.d * a[1] + backTurn.f;
        const fx = frontTurn.a * b[0] + frontTurn.c * b[1] + frontTurn.e;
        const fy = frontTurn.b * b[0] + frontTurn.d * b[1] + frontTurn.f;
        // A small curved bevel rounds the side instead of making a rigid prism.
        const bevel = Math.sin(amount * Math.PI) * 5 * orbit * orbit;
        const dx = Math.cos(angle) * bevel, dy = Math.sin(angle) * bevel;
        return [bx + (fx - bx) * amount + bodyTurn.a * dx + bodyTurn.c * dy,
          by + (fy - by) * amount + bodyTurn.b * dx + bodyTurn.d * dy];
      };
      const segments = 120, layers = 8;
      for (let layer = 0; layer < layers; layer++) {
        for (let i = 0; i < segments; i++) {
          const a = -Math.PI / 2 + i / segments * Math.PI * 2;
          const b = a + Math.PI * 2 / segments;
          const corners = [project(a, layer / layers), project(b, layer / layers),
            project(b, (layer + 1) / layers), project(a, (layer + 1) / layers)];
          const area = corners.reduce((sum, p, index) => {
            const next = corners[(index + 1) % corners.length];
            return sum + p[0] * next[1] - next[0] * p[1];
          }, 0);
          // All wall patches must share the sheets' winding to form a solid union.
          if ((area < 0) !== (facing < 0)) corners.reverse();
          foldedSides.moveTo(...corners[0]);
          for (let j = 1; j < corners.length; j++) foldedSides.lineTo(...corners[j]);
          foldedSides.closePath();
        }
      }
    }
  } else if (c.foldShape === "pocket") {
    // A broad, soft paper pocket. Its lower corner rolls inward as it turns.
    const tuck = 48 - depth * .6 + curl * .65;
    paper.moveTo(-56, -68);
    paper.bezierCurveTo(-12, -73, 38, -73, 61, -64);
    paper.bezierCurveTo(79, -57, 83, -31, 78, 0);
    paper.bezierCurveTo(75, 24, tuck - 2, 31, tuck, 48);
    paper.bezierCurveTo(tuck + 2, 64, 12, 70, -40, 68);
    paper.bezierCurveTo(-69, 67, -81, 53, -81, 25);
    paper.bezierCurveTo(-83, -3, -84, -39, -75, -56);
    paper.bezierCurveTo(-71, -64, -64, -67, -56, -68);
    paper.closePath();
    back.moveTo(-56, -68);
    back.bezierCurveTo(-12, -73, 38, -73, 61, -64);
    back.bezierCurveTo(84, -56, 87, -32, 86, 1);
    back.bezierCurveTo(85, 36, 84 + curl * .3, 61, 63, 73);
    back.bezierCurveTo(41, 85, -12, 80, -43, 76);
    back.bezierCurveTo(-75, 72, -83, 52, -83, 23);
    back.bezierCurveTo(-85, -7, -84, -42, -75, -56);
    back.bezierCurveTo(-71, -64, -64, -67, -56, -68);
    back.closePath();
    crease.moveTo(78, 0);
    crease.bezierCurveTo(75, 24, tuck - 2, 31, tuck, 48);
    crease.bezierCurveTo(tuck + 2, 64, 12, 70, -40, 68);
  } else if (c.foldShape === "petal") {
    // A rounded, leaning tip opens into a fuller base; the fold follows its edge.
    const tuck = 45 - depth * .65 + curl * .7;
    paper.moveTo(10, -86);
    paper.bezierCurveTo(33, -91, 68, -51, 73, -20);
    paper.bezierCurveTo(80, 11, tuck - 5, 27, tuck, 47);
    paper.bezierCurveTo(tuck + 3, 66, 18, 78, -15, 78);
    paper.bezierCurveTo(-54, 78, -78, 52, -77, 17);
    paper.bezierCurveTo(-76, -19, -38, -74, 10, -86);
    paper.closePath();
    back.moveTo(10, -86);
    back.bezierCurveTo(35, -92, 71, -55, 82, -19);
    back.bezierCurveTo(94, 18, 81 + curl * .3, 61, 51, 79);
    back.bezierCurveTo(25, 95, -15, 90, -42, 72);
    back.bezierCurveTo(-69, 54, -81, 28, -77, 6);
    back.bezierCurveTo(-74, -27, -36, -75, 10, -86);
    back.closePath();
    crease.moveTo(73, -20);
    crease.bezierCurveTo(80, 11, tuck - 5, 27, tuck, 47);
    crease.bezierCurveTo(tuck + 3, 66, 18, 78, -15, 78);
  } else {
    paper.moveTo(-65, -61);
    paper.bezierCurveTo(-43, -84, 16, -85, 55, -73);
    paper.bezierCurveTo(80, -65, 86, -41, 77, -13);
    paper.bezierCurveTo(69, 12, seamX - 6, 18, seamX + 1, 43);
    paper.bezierCurveTo(seamX + 7, 66, 27, 79, -9, 77);
    paper.bezierCurveTo(-56, 76, -79, 53, -83, 15);
    paper.bezierCurveTo(-87, -19, -83, -42, -65, -61);
    paper.closePath();
    back.moveTo(-65, -61);
    back.bezierCurveTo(-43, -84, 16, -85, 55, -73);
    back.bezierCurveTo(89, -62, 96, -29, 80, 8);
    back.bezierCurveTo(67, 39, 98 + curl, 49, 73, 72);
    back.bezierCurveTo(48, 94, -11, 88, -43, 68);
    back.bezierCurveTo(-78, 51, -86, 12, -83, -15);
    back.bezierCurveTo(-85, -37, -77, -51, -65, -61);
    back.closePath();
    crease.moveTo(77, -13);
    crease.bezierCurveTo(69, 12, seamX - 6, 18, seamX + 1, 43);
    crease.bezierCurveTo(seamX + 7, 66, 27, 79, -9, 77);
  }
  const taper = c.foldShape === "petal" ? Math.min(1, Math.max(0, -gaze[1]) / .3) : 0;
  // Star valleys sit closer to the face than the other outlines.
  const star = c.foldShape === "star";
  let gazeX = symbol === "diamond" ? .65 : symbol ? 1.45 : star ? 1.5 : 1.85 - taper * .55;
  let gazeY = symbol === "diamond" ? .65 : symbol === "heart" ? .95 : symbol === "cloud" ? .8 : symbol ? 1.4 : star ? 1.05 : 1.9 - taper * .35;
  // The inward seam needs a little extra clearance at the strongest turns.
  let faceInset = (symbol === "diamond" ? 0 : c.foldShape === "petal" ? -4 : shaped ? -6 : -12) - Math.max(0, gaze[0] * side - .23) * 28;
  let faceY = symbol === "cloud" ? 8 : star ? 2 : -4;

  if (shapeMorph) {
    ({ paper, back, crease, sx, gazeX, gazeY, faceInset, faceY } = morphPaper(
      { paper, back, crease, sx, gazeX, gazeY, faceInset, faceY }, shapeMorph, c.foldShape, performance.now()));
  }
  const front = new Path2D(); front.addPath(paper, frontTurn);
  const reverse = new Path2D(); reverse.addPath(back, backTurn);
  const silhouette = new Path2D(); silhouette.addPath(paper, bodyTurn); silhouette.addPath(reverse);
  // Reveal the rounded side between the two rotating sheets at profile.
  // It vanishes front-on, preserving the original resting silhouette exactly.
  if (turning && shaped) {
    silhouette.addPath(front);
  } else if (turning) {
    const volume = new Path2D();
    // Match the mirrored sheets' winding so overlapping paths remain a union.
    const profile = Math.abs(orbit);
    const profileHeight = c.foldShape === "pocket" ? 69 : 77;
    volume.ellipse(-orbit * 5, profile * 2, 76 * profile, profileHeight + profile * 11, 0, 0, Math.PI * 2, facing < 0);
    silhouette.addPath(volume);
  }
  const turnedCrease = new Path2D(); turnedCrease.addPath(crease, frontTurn);
  const frontLightness = c.lightness ?? 76;
  const frontColor = `hsl(${c.hue}, ${c.saturation}%, ${frontLightness}%)`;
  const backColor = `hsl(${c.hue + Math.min(c.spread, 60) * .4}, ${c.saturation * .85}%, ${Math.max(0, frontLightness - 28)}%)`;
  const rear = facing < 0;
  ctx.save();
  ctx.scale(sx * side, sy);
  ctx.rotate(-.06 + flutter * .002);
  ctx.fillStyle = backColor;
  // The connecting surface is absent at rest. Ease it in with the physical
  // turn, rather than adding a full-width bevel on the first animated frame.
  const sideReveal = Math.min(1, Math.abs(orbit) / .35);
  const sideOpacity = sideReveal * sideReveal * (3 - 2 * sideReveal);
  if (shaped && turning) {
    ctx.save(); ctx.globalAlpha *= sideOpacity; ctx.fill(foldedSides); ctx.restore();
  }
  ctx.fill(silhouette);
  ctx.save(); ctx.clip(silhouette);
  if (!rear) { ctx.fillStyle = frontColor; ctx.fill(front); }

  // An optional single flowing ribbon leaves plenty of quiet space for the face.
  if (c.material === "ribbons" && !rear) {
    ctx.save(); ctx.clip(front);
    ctx.transform(frontTurn.a, frontTurn.b, frontTurn.c, frontTurn.d, frontTurn.e, frontTurn.f);
    ctx.strokeStyle = `hsla(${c.hue - Math.min(c.spread, 60)}, ${c.saturation}%, 60%, .55)`;
    ctx.lineWidth = 27;
    const drift = Math.sin(phase) * movement * 12;
    const bend = Math.sin(c.seed) * 18;
    ctx.beginPath(); ctx.moveTo(-105, 55 + bend);
    ctx.bezierCurveTo(20, 55 + drift, -63, -42, 99, -45 + bend);
    ctx.stroke(); ctx.restore();
  }
  ctx.restore();

  // A narrow contact line, rather than a shaded sphere, suggests the tucked edge.
  if (cssSize > 48 && !rear) {
    ctx.save(); ctx.clip(silhouette);
    ctx.strokeStyle = `hsla(${c.hue}, ${c.saturation * .65}%, 27%, .18)`;
    ctx.lineWidth = 1.2;
    ctx.stroke(turnedCrease); ctx.restore();
  }
  if (c.grain > 0) {
    ctx.save(); ctx.clip(silhouette);
    const scale = 200 / cssSize;
    ctx.scale(scale, scale);
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha *= c.grain / 100;
    ctx.fillStyle = ctx.createPattern(grain, "repeat")!;
    ctx.fillRect(-cssSize, -cssSize, cssSize * 2, cssSize * 2);
    ctx.restore();
  }
  if (c.face) {
    ctx.save(); ctx.clip(turning && !shaped ? silhouette : front);
    const faceProjection = shaped && turning ? frontTurn : faceTurn;
    ctx.globalAlpha *= faceOpacity * (shaped && turning ? Math.max(0, Math.min(1, facing * 6)) : 1);
    ctx.transform(faceProjection.a, faceProjection.b, faceProjection.c, faceProjection.d, faceProjection.e, faceProjection.f);
    // Wrap the eyes farther around the face than the paper's gentle turn.
    // Per-point sphere projection compresses and tilts the far eye at corners.
    // Ease into the edge so full travel still leaves room for the eye contour.
    const wrap = (angle: number, gain: number) => .62 * Math.tanh(angle * gain / .62);
    // The petal narrows above the face, so upper glances follow that contour.
    const eyeGaze: [number, number] = [wrap(gaze[0], gazeX), wrap(gaze[1], gazeY)];
    // Mirror the paper, not expressions or eye perspective.
    ctx.scale(side, 1); ctx.translate(faceInset * side * (shaped ? 1 : facing), faceY);
    drawFace(ctx, c, phase, rig, eyeGaze, cssSize, shaped ? 0 : workTurn * side);
    ctx.restore();
    if (c.idle) {
      ctx.save(); ctx.transform(frontTurn.a, frontTurn.b, frontTurn.c, frontTurn.d, frontTurn.e, frontTurn.f);
      ctx.globalAlpha *= faceOpacity;
      ctx.scale(side, 1); ctx.translate(faceInset * side, faceY);
      drawSleepMarks(ctx, c, phase, eyeGaze); ctx.restore();
    }
  }
  ctx.restore();
}
