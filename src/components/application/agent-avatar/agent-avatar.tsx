"use client";

import { useEffect, useRef } from "react";
import { advanceAttention, createAttention, type AttentionState } from "./attention";
import { advanceBlink, createBlink, type BlinkState } from "./blink";
import type { ShapeMorph } from "./shape-morph";
import { drawFold } from "./fold";
import { entrancePose, ENTRANCE_SECONDS } from "./entrance";
import { workingPose, WORKING_SECONDS } from "./working";
import type { AvatarConfig } from "./model";
import { drawFace, drawSleepMarks, easeFace, expressionRig, faceAtSize, gazeAngles, type FaceRig } from "./face";
import { subscribeFrame } from "./frame-loop";
import { advanceWander, createWander, type WanderState } from "./wander";

const TAU = Math.PI * 2;
let noise: HTMLCanvasElement | null = null;

function grainTile() {
  if (noise) return noise;
  noise = document.createElement("canvas");
  noise.width = noise.height = 192;
  const ctx = noise.getContext("2d")!;
  const pixels = ctx.createImageData(192, 192);
  let seed = 713;
  for (let i = 0; i < pixels.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = seed >>> 24;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  return noise;
}

function silhouette(c: AvatarConfig, phase: number) {
  const path = new Path2D();
  if (c.family === "alien") {
    const sx = c.alienShape === "round" ? 1.06 : c.alienShape === "long" ? .86 : 1;
    const sy = c.alienShape === "round" ? .92 : c.alienShape === "long" ? 1.03 : 1;
    path.moveTo(0, -86 * sy);
    path.bezierCurveTo(49 * sx, -88 * sy, 87 * sx, -61 * sy, 82 * sx, -20 * sy);
    path.bezierCurveTo(80 * sx, 18 * sy, 47 * sx, 52 * sy, 17 * sx, 80 * sy);
    path.quadraticCurveTo(0, 96 * sy, -17 * sx, 80 * sy);
    path.bezierCurveTo(-47 * sx, 52 * sy, -80 * sx, 18 * sy, -82 * sx, -20 * sy);
    path.bezierCurveTo(-87 * sx, -61 * sy, -49 * sx, -88 * sy, 0, -86 * sy);
    path.closePath();
  } else if (c.shape === "squircle") {
    path.moveTo(-50, -82); path.bezierCurveTo(-80, -82, -82, -65, -82, -40);
    path.lineTo(-82, 45); path.bezierCurveTo(-82, 76, -70, 82, -42, 82);
    path.lineTo(45, 82); path.bezierCurveTo(78, 82, 82, 67, 82, 40);
    path.lineTo(82, -43); path.bezierCurveTo(82, -75, 70, -82, 42, -82); path.closePath();
  } else if (c.shape === "triangle") {
    path.moveTo(-15, -78); path.quadraticCurveTo(0, -103, 16, -77);
    path.lineTo(84, 52); path.quadraticCurveTo(100, 80, 67, 82);
    path.lineTo(-68, 82); path.quadraticCurveTo(-100, 80, -84, 53); path.closePath();
  } else {
    for (let i = 0; i <= 180; i++) {
      const a = i / 180 * TAU;
      let radius = 83;
      if (c.shape === "pebble") radius += 7 * Math.sin(a * 3 + .7 + Math.sin(phase) * c.motion / 350) + 4 * Math.cos(a * 2 - 1);
      if (c.shape === "flower") radius += 10 * Math.cos(a * 5 + .5);
      if (c.shape === "diamond") radius = 83 / (Math.pow(Math.abs(Math.cos(a)), 1.35) + Math.pow(Math.abs(Math.sin(a)), 1.35)) ** (1 / 1.35);
      const x = Math.cos(a) * radius, y = Math.sin(a) * radius;
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    path.closePath();
  }
  return path;
}

/** Colors here are editable artwork, independent of the surrounding UI theme. */
function drawAvatar(ctx: CanvasRenderingContext2D, c: AvatarConfig, phase: number, rig: FaceRig, gaze: [number, number], cssSize: number, entranceSeconds = ENTRANCE_SECONDS, workingSeconds = WORKING_SECONDS, shapeMorph?: ShapeMorph, workingCycles = 1) {
  const size = ctx.canvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(size / 200, size / 200);
  const entrance = entrancePose(entranceSeconds);
  const entrySide = c.family === "fold" && c.foldDirection === "left" ? -1 : 1;
  ctx.translate(100 + entrance.x * entrySide, 100 + entrance.y);
  ctx.rotate(entrance.rotation * entrySide);
  ctx.scale(entrance.scaleX, entrance.scaleY);
  ctx.globalAlpha = entrance.opacity;
  ctx.translate(-100, -100);
  ctx.translate(100 + Math.sin(phase * 23) * rig.tremble * c.motion / 28, 100 + Math.sin(phase) * c.motion / 28 - Math.cos(phase * 2) * rig.bounce * c.motion / 12);
  ctx.rotate(Math.sin(phase) * c.motion / 2400);
  const breath = 1 + Math.sin(phase) * c.motion / 4000;
  ctx.scale(breath, breath);
  if (c.family === "fold") {
    const work = workingPose(workingSeconds, workingCycles);
    ctx.translate(0, work.y);
    ctx.rotate(work.tilt * entrySide);
    drawFold(ctx, c, phase, rig, gaze, cssSize, grainTile(), entrance.fold, entrance.faceOpacity, work.turn, shapeMorph);
    ctx.restore(); return;
  }
  ctx.save(); ctx.clip(silhouette(c, phase));
  const color = (offset: number, light: number, alpha = 1) => `hsla(${c.hue + offset},${c.saturation}%,${light}%,${alpha})`;
  ctx.fillStyle = color(0, c.material === "solid" ? 55 : 58);
  ctx.fillRect(-110, -110, 220, 220);
  const drift = c.motion / 100;
  if (c.material === "mist") {
    for (let i = 0; i < c.complexity + 3; i++) {
      const a = i * 2.399 + c.seed;
      const x = Math.cos(a + Math.sin(phase + i) * drift) * 68;
      const y = Math.sin(a * 1.7 + Math.cos(phase + i) * drift) * 74;
      const radius = i % 3 === 0 ? 102 : 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      const light = [82, 29, 62, 88, 39][i % 5];
      const hue = (i % 3 - 1) * c.spread;
      g.addColorStop(0, color(hue, light, .95));
      g.addColorStop(.35, color(hue, light, .7));
      g.addColorStop(1, color(hue, light, 0));
      ctx.fillStyle = g; ctx.fillRect(-110, -110, 220, 220);
    }
  } else if (c.material === "ribbons" || c.material === "prism") {
    ctx.save();
    ctx.rotate(c.seed * .12 + Math.sin(phase) * drift * .25);
    const width = 240 / c.complexity;
    for (let i = -8; i < c.complexity + 8; i++) {
      const p = new Path2D();
      for (let side = 0; side < 2; side++) {
        for (let j = 0; j <= 50; j++) {
          const y = (side === 0 ? j : 50 - j) / 50 * 320 - 160;
          const bend = c.material === "prism" ? Math.abs(y) * .75 : Math.sin(y / 54 + Math.sin(phase) * drift) * 34;
          const x = -120 + (i + side) * width + bend;
          if (side === 0 && j === 0) p.moveTo(x, y); else p.lineTo(x, y);
        }
      }
      p.closePath();
      const offset = ((i % 3 + 3) % 3 - 1) * c.spread;
      const g = ctx.createLinearGradient(-70, -100, 90, 100);
      g.addColorStop(0, color(offset, 77)); g.addColorStop(.5, color(offset + 12, 57)); g.addColorStop(1, color(offset, 39));
      ctx.fillStyle = g; ctx.fill(p);
    }
    ctx.restore();
  }
  if (c.grain > 0) {
    ctx.save();
    // Keep grain density consistent in CSS pixels at every rendered size.
    ctx.scale(200 / size, 200 / size);
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha *= c.grain / 100;
    ctx.fillStyle = ctx.createPattern(grainTile(), "repeat")!;
    ctx.fillRect(-size, -size, size * 2, size * 2);
    ctx.restore();
  }
  ctx.restore();
  if (c.face) {
    ctx.save(); ctx.clip(silhouette(c, phase));
    drawFace(ctx, c, phase, rig, gaze, cssSize);
    ctx.restore();
    if (c.idle) drawSleepMarks(ctx, c, phase, gaze);
  }
  ctx.restore();
}

export type AvatarProps = { config: AvatarConfig; size?: number; paused?: boolean; label?: string; interactive?: boolean; portrait?: boolean; entranceKey?: number; workingKey?: number; workingCycles?: number };
export function AgentAvatar({ config, size = 64, paused = false, label = "Agent avatar", entranceKey, workingKey, workingCycles = 1 }: AvatarProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const phase = useRef(0);
  const blink = useRef<BlinkState | null>(null);
  const shapeMorph = useRef<ShapeMorph>({ started: 0, active: false });
  const face = useRef<FaceRig | null>(null);
  const expression = useRef<FaceRig | null>(null);
  const expressionVelocity = useRef<Partial<FaceRig>>({});
  const gaze = useRef<[number, number] | null>(null);
  const wander = useRef<WanderState | null>(null);
  const attention = useRef<AttentionState | null>(null);
  const entrance = useRef<{ key?: number; elapsed: number }>({ elapsed: ENTRANCE_SECONDS });
  const working = useRef<{ key?: number; elapsed: number }>({ elapsed: WORKING_SECONDS });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = canvas.height = Math.round(size * Math.min(window.devicePixelRatio || 1, 2));
    // Without a 2D context there is nothing to paint (jsdom, a canvas that
    // refused one): skip the observer and the frame subscription instead of
    // running a loop whose every draw is a no-op.
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cycles = Math.max(1, Math.floor(workingCycles));
    const workingDuration = WORKING_SECONDS * cycles;
    const appearance = faceAtSize(config, size);
    if (entrance.current.key !== entranceKey) entrance.current = { key: entranceKey, elapsed: entranceKey === undefined || paused ? ENTRANCE_SECONDS : 0 };
    if (working.current.key !== workingKey) {
      working.current = { key: workingKey, elapsed: workingKey === undefined || paused ? workingDuration : 0 };
      if (workingKey !== undefined) entrance.current.elapsed = ENTRANCE_SECONDS;
    }
    // Each visible instance has its own attention; editing controls keeps its rhythm.
    wander.current ??= createWander(crypto.getRandomValues(new Uint32Array(1))[0] ^ config.seed, config.family === "fold");
    if (!blink.current) {
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      blink.current = createBlink(seed);
      phase.current = seed / 4294967296 * TAU;
    }
    attention.current ??= createAttention(crypto.getRandomValues(new Uint32Array(1))[0] ^ config.seed);
    let stop: (() => void) | null = null, last = 0, visible = true, transitioning = true;
    const target = expressionRig(appearance);
    expression.current ??= face.current ?? target;
    face.current ??= target;
    gaze.current ??= gazeAngles(appearance, phase.current, target, wander.current.point);
    if (config.idle || workingKey === undefined) working.current.elapsed = workingDuration;
    const draw = () => drawAvatar(ctx, appearance, phase.current, face.current ?? target, gaze.current ?? [0, 0], size, entrance.current.elapsed, working.current.elapsed, paused || reduced.matches || config.motion === 0 ? undefined : shapeMorph.current, cycles);
    const tick = (now: number) => {
      if (!last) last = now;
      if (now - last >= (transitioning ? 16 : 32)) {
        if (visible && !document.hidden) {
          const seconds = Math.min(now - last, 64) / 1000;
          entrance.current.elapsed = Math.min(ENTRANCE_SECONDS, entrance.current.elapsed + seconds);
          working.current.elapsed = Math.min(workingDuration, working.current.elapsed + seconds);
          const base = easeFace(expression.current ?? target, target, expressionVelocity.current, seconds);
          expression.current = base;
          transitioning = (Object.keys(target) as (keyof FaceRig)[]).some((key) => base[key] !== target[key]) || shapeMorph.current.active;
          face.current = (config.family === "fold" || base.smile > .2) && attention.current
            ? advanceAttention(attention.current, seconds * 8 / config.duration, base, appearance)
            : base;
          if (blink.current && face.current) {
            face.current.blink = config.idle ? 1 : advanceBlink(blink.current, seconds);
            transitioning ||= blink.current.blinking;
          }
          phase.current = (phase.current + Math.min(now - last, 64) / 1000 * TAU / config.duration) % TAU;
          if (!config.idle && config.lookAt === "wander" && wander.current) advanceWander(wander.current, seconds * 8 / config.duration, config.family === "fold");
          const aim = gazeAngles(appearance, phase.current, face.current, wander.current?.point);
          const ease = 1 - Math.exp(-Math.min(now - last, 64) / 85);
          gaze.current = aim.map((v, i) => (gaze.current?.[i] ?? v) + (v - (gaze.current?.[i] ?? v)) * ease) as [number, number];
          draw();
        }
        last = now;
      }
    };
    const start = () => {
      stop?.(); stop = null; last = 0;
      if (reduced.matches || config.motion === 0) {
        entrance.current.elapsed = ENTRANCE_SECONDS;
        working.current.elapsed = workingDuration;
      }
      if (paused || reduced.matches || config.motion === 0) {
        shapeMorph.current = { started: 0, active: false };
        face.current = target;
        expression.current = target;
        expressionVelocity.current = {};
        // Keep the exact gaze on pause; explicit direction changes still render immediately.
        if (!paused || config.lookAt !== "wander") gaze.current = gazeAngles(appearance, phase.current, target, wander.current?.point);
      }
      draw();
      if (!paused && !reduced.matches && config.motion > 0) stop = subscribeFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(canvas);
    reduced.addEventListener("change", start); start();
    return () => { stop?.(); observer.disconnect(); reduced.removeEventListener("change", start); };
  }, [config, size, paused, entranceKey, workingKey, workingCycles]);
  return <canvas ref={ref} role="img" aria-label={label} style={{ width: size, height: size, maxWidth: "100%", objectFit: "contain" }} />;
}
