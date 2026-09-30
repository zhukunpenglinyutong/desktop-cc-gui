import type { AvatarConfig } from "./model";

/** Optical sizing is based on CSS pixels, never the canvas's Retina resolution.
 * Keep the saved recipe unchanged; the same agent adapts to its display size.
 */
export function faceAtSize(config: AvatarConfig, cssSize: number): AvatarConfig {
  const small = Math.max(0, Math.min(1, (64 - cssSize) / 40));
  if (small === 0) return config;
  return {
    ...config,
    eyeSize: Math.min(36, config.eyeSize * (1 + small * (config.family === "alien" ? .22 : .35))),
    eyeGap: config.eyeGap * (1 + small * .14),
  };
}

/** A small continuous face rig: expressions interpolate instead of swapping icons. */
export type FaceRig = {
  leftOpen: number; rightOpen: number; width: number; smile: number;
  leftAngle: number; rightAngle: number; brow: number; browAngle: number;
  browLift: number; browAsymmetry: number; lookX: number; lookY: number;
  headTilt: number; bounce: number; tremble: number; blink: number;
};

const NEUTRAL: FaceRig = {
  leftOpen: 1, rightOpen: 1, width: .45, smile: 0,
  leftAngle: -.08, rightAngle: -.08, brow: 0, browAngle: 0,
  browLift: 0, browAsymmetry: 0, lookX: 0, lookY: 0,
  headTilt: 0, bounce: 0, tremble: 0, blink: 1,
};

const EXPRESSIONS: Record<AvatarConfig["eyes"], Partial<FaceRig>> = {
  neutral: {},
  happy: { leftOpen: .75, rightOpen: .75, width: .53, smile: 1, bounce: 1 },
  angry: { leftOpen: .45, rightOpen: .45, width: .52, leftAngle: .35, rightAngle: -.35, brow: 1, browAngle: .45, browLift: -2, headTilt: -.07, lookY: 2 },
  thinking: { leftOpen: .7, rightOpen: .42, brow: .9, browAngle: -.1, browLift: 2, browAsymmetry: 6, lookX: 8, lookY: -9, headTilt: .15 },
  shook: { leftOpen: 1.55, rightOpen: 1.55, width: .57, brow: 1, browLift: 11, browAngle: -.15, lookY: -2, tremble: 1 },
  curious: { leftOpen: 1.15, rightOpen: .68, brow: .8, browLift: 4, browAsymmetry: 8, lookX: 4, lookY: -3, headTilt: -.13 },
  wink: { leftOpen: 1, rightOpen: .08, width: .45, rightAngle: -.13, headTilt: -.1, bounce: .3 },
  sleepy: { leftOpen: .18, rightOpen: .18, width: .55, leftAngle: .08, rightAngle: -.08, lookY: 5, headTilt: .12 },
  sad: { leftOpen: .48, rightOpen: .48, width: .48, leftAngle: -.28, rightAngle: .28, brow: .85, browAngle: -.65, browLift: -1, lookY: 7, headTilt: .07 },
  worried: { leftOpen: 1.1, rightOpen: 1.1, width: .34, brow: 1, browAngle: -.85, browLift: 5, lookY: -3, tremble: .18 },
  skeptical: { leftOpen: .16, rightOpen: .65, width: .6, brow: .8, browAngle: .06, browAsymmetry: -12, browLift: 1, headTilt: .1, lookX: -5 },
  focused: { leftOpen: .32, rightOpen: .32, width: .68, leftAngle: .12, rightAngle: -.12, brow: .4, browAngle: .15, browLift: -4, lookY: 1 },
  excited: { leftOpen: 1.3, rightOpen: 1.3, width: .68, smile: 1, brow: .65, browLift: 8, bounce: 1.3 },
  calm: { leftOpen: .25, rightOpen: .25, width: .62, smile: 1, leftAngle: -.1, rightAngle: .1, headTilt: -.04 },
  shy: { leftOpen: .6, rightOpen: .6, width: .3, leftAngle: -.3, rightAngle: .3, lookY: 10, lookX: -4, headTilt: -.18 },
  confused: { leftOpen: .45, rightOpen: 1.3, width: .5, leftAngle: -.2, rightAngle: .14, brow: .9, browAngle: -.25, browAsymmetry: -10, browLift: 3, headTilt: .2, lookX: -4 },
};

export function mixFace(from: FaceRig, to: FaceRig, progress: number): FaceRig {
  const result = { ...to };
  for (const key of Object.keys(result) as (keyof FaceRig)[]) result[key] = (from[key] ?? to[key]) + (to[key] - (from[key] ?? to[key])) * progress;
  return result;
}

/** Critically damped motion retains velocity when an expression is interrupted. */
export function easeFace(current: FaceRig, target: FaceRig, velocity: Partial<FaceRig>, seconds: number): FaceRig {
  const result = { ...target };
  const dt = Math.max(0, Math.min(seconds, .064));
  const speed = 16;
  const decay = Math.exp(-speed * dt);
  for (const key of Object.keys(target) as (keyof FaceRig)[]) {
    const delta = (current[key] ?? target[key]) - target[key];
    const v = velocity[key] ?? 0;
    const change = v + speed * delta;
    let next = target[key] + (delta + change * dt) * decay;
    let nextVelocity = (v - speed * change * dt) * decay;
    if (["leftOpen", "rightOpen", "width", "bounce", "tremble", "smile", "brow"].includes(key) && next < 0) { next = 0; nextVelocity = 0; }
    if ((key === "smile" || key === "brow") && next > 1) { next = 1; nextVelocity = 0; }
    if (Math.abs(next - target[key]) < .0005 && Math.abs(nextVelocity) < .005) { next = target[key]; nextVelocity = 0; }
    result[key] = next;
    velocity[key] = nextVelocity;
  }
  return result;
}

export function expressionRig(config: AvatarConfig): FaceRig {
  if (config.idle) return { ...NEUTRAL, ...EXPRESSIONS.sleepy, leftOpen: .1, rightOpen: .13, headTilt: .09 };
  return mixFace(NEUTRAL, { ...NEUTRAL, ...EXPRESSIONS[config.eyes] }, config.expression / 100);
}

/** Project artwork attached to a sphere, pitching first and then turning sideways.
 * Each point gets its own depth: the far eye compresses, tilts, and recedes.
 */
export function projectEyePoint(x: number, y: number, yaw: number, pitch: number): [number, number] {
  const radius = 86;
  const z = Math.sqrt(Math.max(1, radius * radius - x * x - y * y));
  const y1 = y * Math.cos(pitch) + z * Math.sin(pitch);
  const z1 = z * Math.cos(pitch) - y * Math.sin(pitch);
  const x2 = x * Math.cos(yaw) + z1 * Math.sin(yaw);
  const z2 = z1 * Math.cos(yaw) - x * Math.sin(yaw);
  const perspective = (360 - radius) / (360 - z2);
  return [x2 * perspective, y1 * perspective];
}

const DIRECTIONS: Record<Exclude<AvatarConfig["lookAt"], "wander">, [number, number]> = {
  "top-left": [-1, -1], top: [0, -1], "top-right": [1, -1],
  left: [-1, 0], center: [0, 0], right: [1, 0],
  "bottom-left": [-1, 1], bottom: [0, 1], "bottom-right": [1, 1],
};

export function gazeAngles(c: AvatarConfig, _phase: number, rig: FaceRig, wander: [number, number] = [0, 0]): [number, number] {
  if (c.idle) return [0, .055];
  const [x, y] = c.lookAt === "wander" ? wander : DIRECTIONS[c.lookAt] ?? [0, 0];
  // Narrow silhouettes leave less room for the same face to turn.
  const room = c.family === "fold" ? .68 : c.family === "alien" ? .58 : c.shape === "triangle" ? .52 : c.shape === "diamond" ? .7 : 1;
  const eyeExtent = c.eyeSize * Math.max(rig.leftOpen, rig.rightOpen) + rig.browLift;
  const sizeRoom = Math.max(.45, 1 - Math.max(0, eyeExtent - 27) * .018);
  const travel = c.gaze / 100 * room * sizeRoom;
  return [x * .68 * travel + rig.lookX / 180, y * .62 * travel + rig.lookY / 180];
}

export function drawFace(ctx: CanvasRenderingContext2D, c: AvatarConfig, _phase: number, rig: FaceRig, angles?: [number, number], cssSize = 200, bodyYaw = 0) {
  const [yaw, pitch] = angles ?? gazeAngles(c, _phase, rig);
  const tilt = c.eyeTilt * Math.PI / 180 + rig.headTilt + yaw * pitch * .8;
  const project = (x: number, y: number) => projectEyePoint(x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt), yaw + bodyYaw, pitch);
  const blink = c.motion > 0 ? rig.blink : 1;
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = c.lightEyes ? "hsl(40, 30%, 98%)" : "hsl(240, 15%, 8%)";
  ctx.lineCap = "round";
  const faceAlpha = ctx.globalAlpha;

  for (const side of [-1, 1]) {
    const alien = c.family === "alien";
    const center = side * c.eyeGap / 2;
    // Each eye crosses the horizon separately as its surface normal turns away.
    const normal = Math.sqrt(Math.max(0, 86 * 86 - center * center)) * Math.cos(yaw + bodyYaw) * Math.cos(pitch) - center * Math.sin(yaw + bodyYaw);
    ctx.globalAlpha = faceAlpha * Math.max(0, Math.min(1, normal / 12));
    if (ctx.globalAlpha === 0) continue;
    const open = side === -1 ? rig.leftOpen : rig.rightOpen;
    const minimumLid = cssSize <= 48 ? 90 / cssSize : 1.2;
    const h = Math.max(minimumLid, c.eyeSize * (alien ? .6 : .96) * open * blink);
    const w = alien ? Math.min(c.eyeSize * 1.06 * (rig.width / .45) ** .25, c.eyeGap * .43) : c.eyeSize * rig.width;
    const angle = (side === -1 ? rig.leftAngle : rig.rightAngle) + (alien ? .08 - side * .4 : 0);
    const eyePoint = (x: number, y: number) => project(center + x * Math.cos(angle) - y * Math.sin(angle), (alien ? -9 : 0) + x * Math.sin(angle) + y * Math.cos(angle));
    const radius = Math.min(w, h);
    ctx.beginPath();
    if (alien) {
      // Two tapered lids form a slanted almond lens, wrapped onto the same surface.
      for (let edge = 0; edge < 2; edge++) {
        for (let i = 0; i <= 24; i++) {
          const t = edge === 0 ? i / 24 : 1 - i / 24;
          const x = -w + t * w * 2;
          const arch = 4 * t * (1 - t);
          const upper = -h * arch;
          const lower = h * arch * (1 - 2 * rig.smile) + rig.smile * 4 * arch;
          const point = eyePoint(x, edge === 0 ? upper : lower);
          if (!edge && !i) ctx.moveTo(...point); else ctx.lineTo(...point);
        }
      }
    } else {
      // Morph a vertical capsule into a bent horizontal capsule. Sample both
      // the round caps and connecting edges so the lid keeps a curved middle.
      const lidRadius = Math.min(w, Math.max(minimumLid, c.eyeSize * .16));
      const vertex = (corner: number, a: number) => {
        const direction = corner === 0 || corner === 3 ? 1 : -1;
        return [
          direction * (w - radius) + Math.cos(a) * radius,
          (corner < 2 ? 1 : -1) * (h - radius) + Math.sin(a) * radius,
          direction * (w - lidRadius) + Math.cos(a) * lidRadius,
          Math.sin(a) * lidRadius,
        ];
      };
      let first = true;
      const plot = ([x, y, lidX, lidY]: number[]) => {
        const smileY = lidY - h * .6 * (1 - (lidX / w) ** 2);
        const point = eyePoint(x * (1 - rig.smile) + lidX * rig.smile, y * (1 - rig.smile) + smileY * rig.smile);
        if (first) { ctx.moveTo(...point); first = false; } else ctx.lineTo(...point);
      };
      for (let corner = 0; corner < 4; corner++) {
        for (let step = 0; step <= 10; step++) plot(vertex(corner, (corner + step / 10) * Math.PI / 2));
        const end = vertex(corner, (corner + 1) * Math.PI / 2);
        const next = vertex((corner + 1) % 4, (corner + 1) * Math.PI / 2);
        for (let step = 1; step <= 8; step++) plot(end.map((value, i) => value + (next[i] - value) * step / 8));
      }
    }
    ctx.closePath(); ctx.fill();

    if (alien && !c.idle && open > .4 && rig.smile < .4 && cssSize >= 48) {
      ctx.save(); ctx.clip();
      ctx.strokeStyle = c.lightEyes ? "hsla(240, 15%, 8%, .13)" : "hsla(180, 20%, 98%, .28)";
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(...eyePoint(-w * .53, -h * .32));
      ctx.quadraticCurveTo(...eyePoint(-w * .28, -h * .74), ...eyePoint(w * .05, -h * .58));
      ctx.stroke(); ctx.restore();
    }

    if (rig.brow > .01 && !alien) {
      ctx.save(); ctx.globalAlpha *= rig.brow;
      const y = -c.eyeSize * .95 - 6 - rig.browLift + side * rig.browAsymmetry * .5;
      ctx.lineWidth = Math.max(2.5, c.eyeSize * .2);
      ctx.beginPath();
      for (let i = 0; i <= 16; i++) {
        const x = (i / 16 * 2 - 1) * (w + 1);
        const point = project(center + x, y - side * x * rig.browAngle - Math.sin(i / 16 * Math.PI) * 1.5);
        if (i === 0) ctx.moveTo(...point); else ctx.lineTo(...point);
      }
      ctx.stroke(); ctx.restore();
    }
  }

  ctx.restore();
}

/** Four staggered sleep marks float from the eye corner and dissolve. */
export function drawSleepMarks(ctx: CanvasRenderingContext2D, c: AvatarConfig, phase: number, gaze: [number, number]) {
  const anchor = projectEyePoint(c.eyeGap / 2 + c.eyeSize * .5, -c.eyeSize * .55, ...gaze);
  ctx.save();
  ctx.fillStyle = c.lightEyes ? "hsl(40, 30%, 98%)" : "hsl(240, 15%, 8%)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 4; i++) {
    const progress = ((phase / (Math.PI * 2) + i * .25) % 1 + 1) % 1;
    // Vanish before wrapping, so there is no visible jump to the eye corner.
    const alpha = Math.sin(progress * Math.PI) ** 1.5;
    const letterSize = (i % 2 ? 13 : 10) + progress * 3;
    ctx.save();
    ctx.globalAlpha = alpha * .8;
    ctx.translate(anchor[0] + 5 + progress * 15 + Math.sin(progress * Math.PI) * 4, anchor[1] - 3 - progress * 44);
    ctx.rotate(-.12 + progress * .2);
    ctx.font = `800 ${letterSize}px ui-rounded, system-ui, sans-serif`;
    ctx.fillText(i % 2 ? "Z" : "z", 0, 0);
    ctx.restore();
  }
  ctx.restore();
}
