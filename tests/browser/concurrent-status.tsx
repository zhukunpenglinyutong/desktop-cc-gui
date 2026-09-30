// Real sidebar + tabs, synthetic status only. The readout checks browser
// animation effects, not CPU or GPU utilization; no streaming/model workload.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { AiChatSidebar, type AiChatRepo } from "../../src/components/application/ai-chat/ai-chat-sidebar";
import { SessionTab } from "../../src/features/chat/components/SessionTab";

type Status = "processing" | "retry" | "complete";
type Motion = "normal" | "reduce";

// Exercise the shipped reduced-motion declaration by changing only its media
// condition. No fixture animation rule can hide a production regression.
function forceMotion(motion: Motion) {
  const changed: Array<[CSSMediaRule, string]> = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      if (
        rule instanceof CSSMediaRule &&
        rule.conditionText.includes("(prefers-reduced-motion: reduce)") &&
        rule.cssText.includes(".sidebar-thread-status-processing")
      ) {
        changed.push([rule, rule.media.mediaText]);
        rule.media.mediaText = motion === "reduce" ? "all" : "not all";
      } else if ("cssRules" in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try { visit(sheet.cssRules); } catch { /* Cross-origin CSS is not inspected. */ }
  }
  return {
    matchedRules: changed.length,
    restore: () => changed.forEach(([rule, condition]) => { rule.media.mediaText = condition; }),
  };
}

function inspect(root: HTMLElement, count: number, status: Status, motion: Motion, matchedRules: number) {
  const failures: string[] = [];
  const dots = [...root.querySelectorAll<HTMLElement>(".sidebar-thread-status")];
  const expected = count * 2; // One sidebar dot and one tab dot per session.
  if (dots.length !== expected) failures.push(`Expected ${expected} status dots, received ${dots.length}`);
  if (matchedRules === 0) failures.push("Production reduced-motion rule was not found");
  const shouldAnimate = status === "processing" && motion === "normal";
  const propertyNames = new Set<string>();
  let animatedDots = 0;
  let breathingDots = 0;
  for (const dot of dots) {
    const effects = dot.getAnimations({ subtree: true }).filter((animation) =>
      animation.playState === "running" || animation.pending,
    );
    if (effects.length) animatedDots++;
    let breathing = false;
    for (const animation of effects) {
      const frames = (animation.effect as KeyframeEffect).getKeyframes();
      const transforms = new Set(frames.map((frame) => frame.transform).filter(Boolean));
      breathing ||= transforms.size > 1;
      for (const frame of frames) {
        for (const property of Object.keys(frame)) {
          if (["offset", "computedOffset", "easing", "composite"].includes(property)) continue;
          propertyNames.add(property);
          // A narrow allowlist also catches future paint/layout properties,
          // including boxShadow, filter and backgroundPosition.
          if (property !== "transform" && property !== "opacity") {
            failures.push(`Animation contains paint/layout property: ${property}`);
          }
        }
      }
    }
    if (breathing) breathingDots++;
    const className = status === "complete" ? "sidebar-thread-status-unseen" : "sidebar-thread-status-processing";
    if (!dot.classList.contains(className)) failures.push(`Missing ${className}`);
    if ((status === "retry") !== dot.classList.contains("sidebar-thread-status-retrying")) {
      failures.push("Retry status class does not match the selected state");
    }
  }
  if (shouldAnimate && animatedDots !== expected) failures.push(`Only ${animatedDots}/${expected} dots animate`);
  if (shouldAnimate && breathingDots !== expected) failures.push(`Only ${breathingDots}/${expected} dots have changing transforms`);
  if (!shouldAnimate && animatedDots !== 0) failures.push(`${animatedDots} dots still animate in ${status}/${motion}`);
  return {
    result: failures.length ? "FAIL" : "PASS",
    count, status, motion, expectedDots: expected, mountedDots: dots.length,
    animatedDots, breathingDots, animatedProperties: [...propertyNames].sort(),
    reducedMotionRules: matchedRules,
    failures: [...new Set(failures)],
    scope: "CSS animation contract only; this does not measure native CPU/GPU usage",
  };
}

function Fixture() {
  const [count, setCount] = useState(6);
  const [status, setStatus] = useState<Status>("processing");
  const [motion, setMotion] = useState<Motion>("normal");
  const [dark, setDark] = useState(false);
  const [active, setActive] = useState("session-1");
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<ReturnType<typeof inspect> | null>(null);
  const surfaces = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const threads = useMemo(() => Array.from({ length: count }, (_, i) => ({
    id: `session-${i + 1}`,
    label: `合成会话 ${i + 1}`,
    time: "now",
    engine: "codex",
    streaming: status !== "complete",
    retrying: status === "retry",
    unseen: status === "complete",
  })), [count, status]);
  const repos: AiChatRepo[] = useMemo(() => [{
    id: "concurrent-status-fixture",
    label: "Concurrent status fixture", defaultOpen: true, threads,
  }], [threads]);

  useEffect(() => {
    const media = forceMotion(motion);
    const timer = window.setTimeout(() => {
      if (surfaces.current) setReport(inspect(surfaces.current, count, status, motion, media.matchedRules));
    }, 80);
    return () => { window.clearTimeout(timer); media.restore(); };
  }, [count, status, motion, dark, revision]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);

  return (
    <main className="min-h-dvh bg-background-primary-default p-5 text-text-primary">
      <h1 className="mb-3 text-lg font-semibold">并发会话状态动画验证</h1>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <label>会话数量 <select aria-label="会话数量" value={count} onChange={(e) => setCount(Number(e.target.value))}>
          {[1, 6, 12].map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>会话状态 <select aria-label="会话状态" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          <option value="processing">Processing</option><option value="retry">Retry</option><option value="complete">Complete</option>
        </select></label>
        <label>动态效果 <select aria-label="动态效果" value={motion} onChange={(e) => setMotion(e.target.value as Motion)}>
          <option value="normal">Normal</option><option value="reduce">Reduced motion</option>
        </select></label>
        <label><input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} /> 深色主题</label>
        <button type="button" className="rounded border px-2 py-1" onClick={() => setRevision((value) => value + 1)}>重新检查</button>
      </div>
      <div ref={surfaces} className="flex gap-5" data-testid="status-surfaces">
        <div style={{ height: 740 }} className="flex shrink-0">
          <AiChatSidebar repos={repos} activeThreadId={active} onThreadSelect={setActive} />
        </div>
        <section className="min-w-0 flex-1">
          <div role="tablist" aria-label="合成会话页签" className="mb-5 flex flex-wrap gap-2 rounded border p-2">
            {threads.map((thread) => <SessionTab
              key={thread.id} tab={{ ...thread, key: thread.id }}
              isActive={thread.id === active} dragged={false} dropBefore={null}
              closeLabel="Close synthetic tab" onSelect={setActive} onClose={() => {}}
              suppressClickRef={suppressClick}
            />)}
          </div>
          <h2 data-result={report?.result ?? "RUNNING"} className="mb-2 text-lg font-semibold">{report?.result ?? "RUNNING"}</h2>
          <pre data-testid="animation-report" className="overflow-auto rounded bg-background-secondary-default p-3 text-sm">{JSON.stringify(report, null, 2)}</pre>
          <p className="mt-3 text-sm text-text-secondary">Normal / Reduced motion 切换生产 CSS 中减少动态效果规则的媒体条件。这里只验证动画属性和运行状态，不代表原生 CPU 或 GPU 性能测量。</p>
        </section>
      </div>
    </main>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
