import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceSortableList } from "./workspace-sortable-list";

// 手动推进真实列表的预览与 Motion 延后到达的结束回调。
const motion = vi.hoisted(() => ({
  reorder: null as null | ((ids: string[]) => void),
  ends: new Map<string, () => void>(),
}));
vi.mock("motion/react", () => ({
  useDragControls: () => ({ start() {} }),
  Reorder: {
    Group: ({ onReorder, children }: { onReorder: (ids: string[]) => void; children: ReactNode }) => {
      motion.reorder = onReorder;
      return <div>{children}</div>;
    },
    Item: ({ value, onDragEnd, onClickCapture, children }: {
      value: string; onDragEnd: () => void;
      onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => void; children: ReactNode;
    }) => {
      motion.ends.set(value, onDragEnd);
      return <div onClickCapture={onClickCapture}>{children}</div>;
    },
  },
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  motion.ends.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => { root.unmount(); vi.runOnlyPendingTimers(); });
  container.remove();
  vi.useRealTimers();
});

it("移动产生预览后取消，晚到的结束回调不得提交或触发行点击", () => {
  const commit = vi.fn();
  const open = vi.fn();
  act(() => root.render(
    <WorkspaceSortableList
      items={[{ id: "a" }, { id: "b" }]} onReorder={commit}
      renderItem={(item, drag) => <div>
        <button data-handle={item.id} {...drag?.dragHandleProps}>拖动</button>
        <button data-open={item.id} onClick={open}>{item.id}</button>
      </div>}
    />,
  ));
  const event = (type: string) => {
    const result = new MouseEvent(type, { bubbles: true, button: 0 });
    Object.defineProperty(result, "pointerId", { value: 1 });
    return result;
  };
  act(() => container.querySelector('[data-handle="a"]')!.dispatchEvent(event("pointerdown")));
  act(() => motion.reorder!(["b", "a"]));
  act(() => {
    window.dispatchEvent(event("pointercancel"));
    motion.ends.get("a")!();
    container.querySelector<HTMLButtonElement>('[data-open="a"]')!.click();
    vi.advanceTimersByTime(150);
  });
  expect(commit).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
  expect([...container.querySelectorAll('[data-handle]')].map((node) => node.getAttribute("data-handle"))).toEqual(["a", "b"]);
});


it("拖动预览后列表卸载，旧结束回调不得提交过期顺序", () => {
  const commit = vi.fn();
  act(() => root.render(
    <WorkspaceSortableList items={[{ id: "a" }, { id: "b" }]} onReorder={commit}
      renderItem={(item, drag) => <button {...drag?.dragHandleProps}>{item.id}</button>} />,
  ));
  act(() => container.querySelector("button")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
  act(() => motion.reorder!(["b", "a"]));
  const lateEnd = motion.ends.get("a")!;
  act(() => root.render(null));
  act(() => { lateEnd(); vi.runOnlyPendingTimers(); });
  expect(commit).not.toHaveBeenCalled();
});

it("正常松开并收到结束回调时仅提交一次新顺序", () => {
  const commit = vi.fn();
  act(() => root.render(
    <WorkspaceSortableList items={[{ id: "a" }, { id: "b" }]} onReorder={commit}
      renderItem={(item, drag) => <button {...drag?.dragHandleProps}>{item.id}</button>} />,
  ));
  act(() => container.querySelector("button")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
  act(() => motion.reorder!(["b", "a"]));
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    motion.ends.get("a")!();
    motion.ends.get("a")!();
    vi.advanceTimersByTime(150);
  });
  expect(commit).toHaveBeenCalledExactlyOnceWith(["b", "a"]);
});


it("拖动中的行被移除后释放拖拽态，并采用当前入口集合", () => {
  const commit = vi.fn();
  const active = vi.fn();
  const render = (ids: string[]) => act(() => root.render(
    <WorkspaceSortableList items={ids.map((id) => ({ id }))} onReorder={commit} onDragActiveChange={active}
      renderItem={(item, drag) => <button data-id={item.id} {...drag?.dragHandleProps}>{item.id}</button>} />,
  ));
  render(["a", "b"]);
  act(() => container.querySelector("button")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })));
  act(() => motion.reorder!(["b", "a"]));
  const lateEnd = motion.ends.get("a")!;
  render(["b", "new"]);
  act(() => { lateEnd(); vi.runOnlyPendingTimers(); });
  expect(commit).not.toHaveBeenCalled();
  expect(active.mock.calls).toEqual([[true], [false]]);
  expect([...container.querySelectorAll("button")].map((node) => node.textContent)).toEqual(["b", "new"]);
});


it("连续两次拖动时，上一次松开的延后检查不得取消新手势", () => {
  const commit = vi.fn();
  act(() => root.render(
    <WorkspaceSortableList items={[{ id: "a" }, { id: "b" }]} onReorder={commit}
      renderItem={(item, drag) => <button data-id={item.id} {...drag?.dragHandleProps}>{item.id}</button>} />,
  ));
  const down = () => container.querySelector('[data-id="a"]')!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  act(() => {
    down();
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    motion.ends.get("a")!();
    vi.advanceTimersByTime(1);
  });
  act(() => down());
  act(() => motion.reorder!(["b", "a"]));
  act(() => {
    vi.advanceTimersByTime(119);
    motion.ends.get("a")!();
  });
  expect(commit).toHaveBeenCalledExactlyOnceWith(["b", "a"]);
});


it.each(["移动到其他分组", "取消跨组移动", "在原分组内排序"])("既有工作区链路：%s", (scenario) => {
  const commit = vi.fn();
  const move = vi.fn();
  const target = document.createElement("div");
  target.setAttribute("data-workspace-drop-target", scenario === "在原分组内排序" ? "source" : "target");
  document.body.append(target);
  const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
  try {
    act(() => root.render(
      <WorkspaceSortableList items={[{ id: "a" }, { id: "b" }]} sectionId="source" onReorder={commit} onDropToSection={move}
        renderItem={(item, drag) => <button data-id={item.id} {...drag?.dragHandleProps}>{item.id}</button>} />,
    ));
    const event = (type: string) => {
      const result = new MouseEvent(type, { bubbles: true, button: 0, clientX: 10, clientY: 10 });
      Object.defineProperty(result, "pointerId", { value: 9 });
      return result;
    };
    act(() => container.querySelector("button")!.dispatchEvent(event("pointerdown")));
    act(() => motion.reorder!(["b", "a"]));
    act(() => window.dispatchEvent(event("pointermove")));
    if (scenario !== "在原分组内排序") expect(target.getAttribute("data-drop-hover")).toBe("true");
    act(() => {
      window.dispatchEvent(event(scenario === "取消跨组移动" ? "pointercancel" : "pointerup"));
      motion.ends.get("a")!();
      vi.advanceTimersByTime(150);
    });
    expect(target.hasAttribute("data-drop-hover")).toBe(false);
    if (scenario === "移动到其他分组") {
      expect(move).toHaveBeenCalledExactlyOnceWith("a", "target");
      expect(commit).not.toHaveBeenCalled();
    } else if (scenario === "取消跨组移动") {
      expect(move).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    } else {
      expect(move).not.toHaveBeenCalled();
      expect(commit).toHaveBeenCalledExactlyOnceWith(["b", "a"]);
    }
  } finally {
    if (original) Object.defineProperty(document, "elementFromPoint", original);
    else Reflect.deleteProperty(document, "elementFromPoint");
    target.remove();
  }
});
