import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Disposer } from "@ccgui/plugin-sdk";
import { sidebarNavRegistry } from "@ccgui/plugin-sdk";
import { SidebarPrimaryNav } from "./sidebar-chrome";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

let node: HTMLDivElement;
let root: Root;
let disposers: Disposer[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});

afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  for (const dispose of disposers) dispose();
  disposers = [];
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(<SidebarPrimaryNav />);
  });
}

function navRow(label: string): HTMLElement {
  const row = [...node.querySelectorAll<HTMLElement>("button")].find((el) => {
    const name = el.getAttribute("aria-label") ?? "";
    return name === label || name.startsWith(`${label} (`);
  });
  if (!row) throw new Error(`no nav row ${label}`);
  return row;
}

it("渲染插件注册的计数 pill", async () => {
  disposers.push(
    sidebarNavRegistry.register({
      id: "plugin:git-tasks",
      label: () => "Tasks",
      badge: () => 7,
      onOpen: () => {},
    }),
  );
  await render();
  const row = navRow("Tasks");
  expect(row.textContent).toContain("7");
  expect(row.getAttribute("aria-label")).toBe("Tasks (7)");
  const pill = row.querySelector("span.rounded-full");
  expect(pill?.textContent).toBe("7");
});

it("null / 空串 / 抛错都按无徽标处理，不额外产生 DOM", async () => {
  disposers.push(
    sidebarNavRegistry.register({
      id: "plugin:none",
      label: () => "None",
      badge: () => null,
      onOpen: () => {},
    }),
    sidebarNavRegistry.register({
      id: "plugin:blank",
      label: () => "Blank",
      badge: () => "   ",
      onOpen: () => {},
    }),
    sidebarNavRegistry.register({
      id: "plugin:boom",
      label: () => "Boom",
      badge: () => {
        throw new Error("badge exploded");
      },
      onOpen: () => {},
    }),
    sidebarNavRegistry.register({
      id: "plugin:no-getter",
      label: () => "Plain",
      onOpen: () => {},
    }),
  );
  await render();
  for (const label of ["None", "Blank", "Boom", "Plain"]) {
    const row = navRow(label);
    expect(row.querySelector("span.rounded-full")).toBeNull();
    // 图标移到独立手柄，页面按钮只保留标签，不能生成空徽标。
    expect(row.children).toHaveLength(1);
    expect(row.parentElement?.querySelectorAll("svg")).toHaveLength(1);
    expect(row.parentElement?.querySelectorAll("button")).toHaveLength(2);
    expect(row.getAttribute("aria-label")).toBe(label);
  }
});

it("同一 key 重新注册即刷新计数（Registry upsert）", async () => {
  let count = 1;
  disposers.push(
    sidebarNavRegistry.register({
      id: "plugin:git-tasks",
      label: () => "Tasks",
      badge: () => count,
      onOpen: () => {},
    }),
  );
  await render();
  expect(navRow("Tasks").querySelector("span.rounded-full")?.textContent).toBe("1");

  count = 4;
  await act(async () => {
    disposers.push(
      sidebarNavRegistry.register({
        id: "plugin:git-tasks",
        label: () => "Tasks",
        badge: () => count,
        onOpen: () => {},
      }),
    );
  });
  expect(navRow("Tasks").querySelector("span.rounded-full")?.textContent).toBe("4");
});
