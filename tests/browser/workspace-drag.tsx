// Open /tests/browser/workspace-drag.html with the Vite dev server running.
// Exercises the real sidebar drag with synthetic pointer gestures: dropping
// a workspace row onto another group's container calls
// onDropWorkspaceToSection (group id / 已归档 sentinel / null = ungrouped),
// single-member sections stay draggable, empty groups appear mid-drag as
// targets, and a plain in-section drag still commits a reorder. No app, no
// backend, no saved state.
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { AiChatSidebar } from "../../src/components/application/ai-chat/ai-chat-sidebar";
import type { AiChatRepo, AiChatRepoSection } from "../../src/components/application/ai-chat/ai-chat-sidebar";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const repos: AiChatRepo[] = [
  { id: "ws-1", label: "ungrouped-one", threads: [] },
  { id: "ws-2", label: "alpha-app", threads: [] },
  { id: "ws-3", label: "beta-one", threads: [] },
  { id: "ws-4", label: "beta-two", threads: [] },
];
const sections: AiChatRepoSection[] = [
  { id: null, name: "", repos: [repos[0]] },
  { id: "g1", name: "Alpha", repos: [repos[1]] },
  { id: "g2", name: "Beta", repos: [repos[2], repos[3]] },
  { id: "g3", name: "Empty", repos: [] },
];
const archivedRepos: AiChatRepo[] = [{ id: "ws-9", label: "old-project", threads: [] }];

type DropCall = { id: string; target: string | null };

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function pointer(
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    isPrimary: true,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: x,
    clientY: y,
  });
}

/** Press the row's grip, drag in steps to the target, release there. The
 *  target is a thunk: starting the drag mounts the empty-group headers and
 *  shifts the sections below, so aim only after the layout has settled. */
async function dragRowTo(
  workspaceId: string,
  target: [number, number] | (() => [number, number]),
): Promise<void> {
  const row = document.querySelector(`[data-workspace-id="${workspaceId}"]`);
  const grip = row?.querySelector("button");
  if (!row || !grip) throw new Error(`row or grip missing for ${workspaceId}`);
  const from = center(grip);
  grip.dispatchEvent(pointer("pointerdown", from.x, from.y));
  await sleep(50);
  window.dispatchEvent(pointer("pointermove", from.x, from.y + 8));
  await sleep(150);
  const [x, y] = typeof target === "function" ? target() : target;
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    window.dispatchEvent(
      pointer(
        "pointermove",
        from.x + ((x - from.x) * i) / steps,
        from.y + 8 + ((y - from.y - 8) * i) / steps,
      ),
    );
    await sleep(16);
  }
  window.dispatchEvent(pointer("pointerup", x, y));
  // motion's onDragEnd lands post-render; the no-drag fallback takes 120ms.
  await sleep(300);
}

/** Center of a section's drop container (group / ungrouped / 已归档). */
function sectionCenter(attrValue: string): [number, number] {
  const el = document.querySelector(`[data-workspace-drop-target="${attrValue}"]`);
  if (!el) throw new Error(`drop target missing: "${attrValue}"`);
  const { x, y } = center(el);
  return [x, y];
}

function Test() {
  const drops = useRef<DropCall[]>([]);
  const reorders = useRef<string[][]>([]);
  const [result, setResult] = useState("Running…");

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const failures: string[] = [];
      await sleep(400);
      try {
        // 1. Ungrouped row → group g2's container: a move, not a reorder.
        await dragRowTo("ws-1", () => sectionCenter("g2"));
        // The moved row left the tree (fixture keeps props static, so the
        // sidebar re-renders from the same sections — only callbacks count).
        if (!drops.current.some((d) => d.id === "ws-1" && d.target === "g2")) {
          failures.push(`drop onto group g2 not reported: ${JSON.stringify(drops.current)}`);
        }
        if (reorders.current.length !== 0) {
          failures.push(`group drop also committed a reorder: ${JSON.stringify(reorders.current)}`);
        }

        // 2. Single-member group g1 → 已归档: archived sentinel, and the
        //    one-row list still had a working grip. The target shifts when
        //    the empty group mounts mid-drag — aim after it does.
        await dragRowTo("ws-2", () => sectionCenter("__archived__"));
        if (!drops.current.some((d) => d.id === "ws-2" && d.target === "__archived__")) {
          failures.push(`drop onto 已归档 not reported: ${JSON.stringify(drops.current)}`);
        }

        // 3. Group g2 row → ungrouped container: target null.
        await dragRowTo("ws-3", () => sectionCenter(""));
        if (!drops.current.some((d) => d.id === "ws-3" && d.target === null)) {
          failures.push(`drop onto ungrouped not reported: ${JSON.stringify(drops.current)}`);
        }

        // 4. Empty group g3 mounts only mid-drag and accepts a drop: press
        //    ws-4's grip, confirm g3 appears, then drag onto it and release.
        if (document.querySelector('[data-workspace-drop-target="g3"]')) {
          failures.push("empty group g3 rendered at rest");
        }
        const row4 = document.querySelector('[data-workspace-id="ws-4"]');
        const grip4 = row4?.querySelector("button");
        if (!row4 || !grip4) throw new Error("ws-4 row or grip missing");
        const from4 = center(grip4);
        grip4.dispatchEvent(pointer("pointerdown", from4.x, from4.y));
        await sleep(50);
        window.dispatchEvent(pointer("pointermove", from4.x, from4.y + 8));
        await sleep(150); // mid-drag: g3 must have mounted
        const g3 = document.querySelector('[data-workspace-drop-target="g3"]');
        if (!g3) {
          failures.push("empty group g3 did not mount mid-drag");
          window.dispatchEvent(pointer("pointerup", from4.x, from4.y + 8));
          await sleep(300);
        } else {
          const to4 = center(g3);
          for (let i = 1; i <= 12; i++) {
            window.dispatchEvent(
              pointer(
                "pointermove",
                from4.x + ((to4.x - from4.x) * i) / 12,
                from4.y + 8 + ((to4.y - from4.y - 8) * i) / 12,
              ),
            );
            await sleep(16);
          }
          window.dispatchEvent(pointer("pointerup", to4.x, to4.y));
          await sleep(300);
          if (!drops.current.some((d) => d.id === "ws-4" && d.target === "g3")) {
            failures.push(`drop onto empty group g3 not reported: ${JSON.stringify(drops.current)}`);
          }
        }

        // 5. Plain in-section reorder still commits: ws-4 above ws-3 in g2.
        const before = reorders.current.length;
        const row3 = document.querySelector('[data-workspace-id="ws-3"]');
        if (!row3) throw new Error("ws-3 row missing for reorder case");
        const target = center(row3);
        await dragRowTo("ws-4", [target.x, target.y - 6]);
        if (reorders.current.length === before) {
          failures.push("in-section reorder did not commit");
        }
      } catch (error) {
        failures.push(String(error));
      }
      if (cancelled) return;
      setResult(
        JSON.stringify(
          {
            status: failures.length === 0 ? "PASS" : "FAIL",
            failures,
            drops: drops.current,
            reorders: reorders.current,
          },
          null,
          2,
        ),
      );
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <pre id="result">{result}</pre>
      <div style={{ position: "fixed", top: 0, right: 0, width: 260, height: "100vh" }}>
        <AiChatSidebar
          flat
          repos={repos}
          sections={sections}
          archivedRepos={archivedRepos}
          onReorderWorkspaces={(ids) => {
            reorders.current.push(ids);
          }}
          onDropWorkspaceToSection={(id, target) => {
            drops.current.push({ id, target });
          }}
        />
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Test />);
