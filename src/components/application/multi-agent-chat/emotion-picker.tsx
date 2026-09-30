"use client";
import { useEffect, useRef, useState } from "react";
import { drawFace, expressionRig } from "@/components/application/agent-avatar/face";
import { EYES, type AvatarConfig } from "@/components/application/agent-avatar/model";
import { motion, useAnimationFrame, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "motion/react";
import { cx } from "@/utils/cx";

const names: Record<AvatarConfig["eyes"], string> = { neutral: "Neutral", happy: "Happy", angry: "Angry", thinking: "Thinking", shook: "Shook", curious: "Curious", wink: "Wink", sleepy: "Sleepy", sad: "Sad", worried: "Worried", skeptical: "Skeptical", focused: "Focused", excited: "Excited", calm: "Calm", shy: "Shy", confused: "Confused" };
function Eyes({ config }: { config: AvatarConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = 34 * dpr;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.translate(17, 19); ctx.scale(.36, .36);
    const c = { ...config, eyeSize: 24, eyeGap: 36, lookAt: "center" as const, motion: 0, idle: false };
    drawFace(ctx, c, 0, expressionRig(c), [0, 0], 200);
  }, [config]);
  return <canvas ref={ref} aria-hidden="true" className="size-[34px]" />;
}

function Emotion({ config, eyes, index, rotation, onChange, label }: {
  config: AvatarConfig; eyes: AvatarConfig["eyes"]; index: number; rotation: MotionValue<number>; onChange: (eyes: AvatarConfig["eyes"]) => void; label: string;
}) {
  const angle = index * 360 / EYES.length;
  const counterRotation = useTransform(rotation, value => -value - angle);
  return <div className="absolute left-1/2 top-1/2 -ml-[17px] -mt-[17px] size-[34px]" style={{ transform: `rotate(${angle}deg) translateY(-116px)` }}>
    <motion.div style={{ rotate: counterRotation }}>
      <button type="button" aria-label={label} title={label} aria-pressed={config.eyes === eyes}
        onClick={() => onChange(eyes)} className={cx("pointer-events-auto flex size-[34px] cursor-pointer items-center justify-center overflow-hidden rounded-full border-2 outline-none transition-[border-color,box-shadow] hover:ring-2 hover:ring-border-button-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring", config.eyes === eyes ? "border-foreground-icon-secondary" : "border-transparent")}
        style={{ backgroundColor: `hsl(${config.hue} ${config.saturation}% ${config.lightness ?? 80}%)` }}>
        <Eyes config={{ ...config, eyes }} />
      </button>
    </motion.div>
  </div>;
}

/** Slow automatic orbit with direct manipulation and always-upright eye chips.
 *  `labels` localises the accessible name of each chip (the host app is
 *  bilingual); the English table stays the fallback. */
export function EmotionPicker({ config, onChange, labels }: { config: AvatarConfig; onChange: (eyes: AvatarConfig["eyes"]) => void; labels?: Partial<Record<AvatarConfig["eyes"], string>> }) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useMotionValue(0);
  const rotation = useSpring(target, { stiffness: 180, damping: 28 });
  const reduced = useReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const drag = useRef<{ angle: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useAnimationFrame((_, delta) => { if (!reduced && !hovered && !focused && !drag.current && !document.hidden) target.set(target.get() + Math.min(delta, 64) * .003); });
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const next = target.get() + delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1) * .2;
      target.set(next); if (reduced) rotation.jump(next);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [target, rotation, reduced]);
  const angleAt = (x: number, y: number, el: HTMLDivElement) => {
    const r = el.getBoundingClientRect();
    return Math.atan2(y - r.top - r.height / 2, x - r.left - r.width / 2) * 180 / Math.PI;
  };
  // A stationary, filled hit area keeps wheel events captured between moving chips.
  // Rounded hit testing leaves the neighboring shape arc outside this control.
  return <div ref={ref} role="group" aria-label="Agent emotion" className="pointer-events-auto relative size-[268px] touch-none rounded-full"
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onClickCapture={event => { if (event.detail > 0 && suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}
    onPointerDown={event => { if (event.button !== 0) return; target.set(rotation.get()); suppressClick.current = false; drag.current = { angle: angleAt(event.clientX, event.clientY, event.currentTarget), moved: false }; }}
    onPointerMove={event => {
      const state = drag.current; if (!state) return;
      const angle = angleAt(event.clientX, event.clientY, event.currentTarget);
      const delta = ((angle - state.angle + 540) % 360) - 180;
      if (Math.abs(delta) > 2 || state.moved) {
        state.moved = true; suppressClick.current = true; state.angle = angle;
        event.currentTarget.setPointerCapture(event.pointerId);
        const next = target.get() + delta;
        target.set(next); if (reduced) rotation.jump(next);
      }
    }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}>
    <motion.div className="pointer-events-none absolute inset-0" style={{ rotate: rotation }}>
      {EYES.map((eyes, index) => <Emotion key={eyes} config={config} eyes={eyes} index={index} rotation={rotation} label={labels?.[eyes] ?? names[eyes]} onChange={value => { if (!drag.current?.moved) onChange(value); }} />)}
    </motion.div>
  </div>;
}
