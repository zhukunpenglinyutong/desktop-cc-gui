"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMotionValue, useMotionValueEvent, useReducedMotion, useSpring } from "motion/react";
import { AgentAvatar } from "@/components/application/agent-avatar/agent-avatar";
import { FOLD_SHAPES, type AvatarConfig } from "@/components/application/agent-avatar/model";
import { cx } from "@/utils/cx";

export const wrapShape = (index: number) => ((index % FOLD_SHAPES.length) + FOLD_SHAPES.length) % FOLD_SHAPES.length;
export function shapeArcPoint(distance: number) {
  const angle = distance * .34;
  return { x: Math.sin(angle) * 210, y: Math.cos(angle) * 210 - 176 };
}

function Shape({ config, shape }: { config: AvatarConfig; shape: AvatarConfig["foldShape"] }) {
  const appearance = useMemo(() => ({ ...config, foldShape: shape, face: false, idle: false, motion: 0, lookAt: "center" as const }), [config, shape]);
  return <AgentAvatar config={appearance} size={56} paused label={`${shape} silhouette`} />;
}

/** A manually moved, evenly spaced circular track with an unbounded index. */
export function ShapeArc({ config, onChange, labels }: { config: AvatarConfig; onChange: (shape: AvatarConfig["foldShape"]) => void; labels?: Partial<Record<AvatarConfig["foldShape"], string>> }) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const target = useMotionValue(Math.max(0, FOLD_SHAPES.indexOf(config.foldShape)));
  const spring = useSpring(target, { stiffness: 180, damping: 28 });
  const [position, setPosition] = useState(target.get());
  const reduceMotion = useReducedMotion();
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  useMotionValueEvent(spring, "change", setPosition);
  const move = (next: number) => { target.set(next); if (reduceMotion) spring.jump(next); };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const next = target.get() + delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1) / 110;
      target.set(next); if (reduceMotion) spring.jump(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [target, spring, reduceMotion]);
  const center = Math.round(position);
  const slots = Array.from({ length: 9 }, (_, i) => center + i - 4);
  const selectedSlot = slots.find(slot => FOLD_SHAPES[wrapShape(slot)] === config.foldShape);
  // The stationary arc region owns wheel gestures even between moving shapes.
  return <div ref={ref} role="listbox" aria-label="Avatar shape" aria-activedescendant={selectedSlot === undefined ? undefined : `${id}-${selectedSlot}`} tabIndex={0}
    className="pointer-events-auto relative h-[126px] w-full touch-pan-y select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring"
    style={{ maskImage: "linear-gradient(to right, transparent, black 8%, black 92%, transparent)", clipPath: "polygon(0 0, 15% 0, 30% 36%, 50% 50%, 70% 36%, 85% 0, 100% 0, 100% 100%, 0 100%)" }}
    onKeyDown={event => {
      const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
      if (!step && event.key !== "Home" && event.key !== "End") return;
      event.preventDefault();
      const next = step ? Math.round(target.get()) + step : event.key === "Home" ? 0 : FOLD_SHAPES.length - 1;
      move(next); onChange(FOLD_SHAPES[wrapShape(next)]);
    }}
    onClickCapture={event => { if (event.detail > 0 && suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}
    onPointerDown={event => { suppressClick.current = false; drag.current = { x: event.clientX, start: target.get(), moved: false }; }}
    onPointerMove={event => {
      const state = drag.current; if (!state) return;
      if (Math.abs(event.clientX - state.x) > 5) { state.moved = true; suppressClick.current = true; event.currentTarget.setPointerCapture(event.pointerId); move(state.start - (event.clientX - state.x) / 70); }
    }}
    onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}>
    {slots.map(slot => {
      const shape = FOLD_SHAPES[wrapShape(slot)], point = shapeArcPoint(slot - position);
      return <div key={slot} className="pointer-events-auto absolute left-1/2 top-[35px] -ml-7 size-14" style={{ transform: `translate(${point.x}px, ${point.y}px)` }}>
        <button type="button" id={`${id}-${slot}`} role="option" aria-selected={config.foldShape === shape} aria-label={labels?.[shape] ?? `${shape[0].toUpperCase()}${shape.slice(1)} shape`} tabIndex={-1}
          onClick={() => { if (drag.current?.moved) return; move(slot); onChange(shape); }}
          className={cx("flex size-14 cursor-grab items-center justify-center rounded-2xl outline-none transition-colors hover:bg-background-secondary-default active:cursor-grabbing", config.foldShape === shape && "bg-background-secondary-default ring-1 ring-border-button-default")}>
          <Shape config={config} shape={shape} />
        </button>
      </div>;
    })}
  </div>;
}
