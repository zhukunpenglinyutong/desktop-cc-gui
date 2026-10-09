import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTerminalStore, TERMINAL_DEFAULT_HEIGHT } from "./store";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    terminalClose: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

// TerminalView boots xterm; the store tests only exercise tab bookkeeping.
vi.mock("./TerminalView", () => ({
  TerminalView: ({ cwd }: { cwd: string }) => <div data-cwd={cwd} />,
}));

vi.mock("@/components/base/dropdown/dropdown", () => ({
  Dropdown: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownTrigger: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  DropdownPopover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownItem: ({ onSelect, children }: any) => <button onClick={onSelect}>{children}</button>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WS = "/ws";
const EXTRA = "/ws-extra";

function resetStore() {
  useTerminalStore.setState({
    open: false,
    height: TERMINAL_DEFAULT_HEIGHT,
    tabsByWorkspace: {},
    activeByWorkspace: {},
  });
}

describe("terminal store 多根", () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  it("newTab 缺省把根记为主目录（单根行为不变）", () => {
    useTerminalStore.getState().newTab(WS);
    const tabs = useTerminalStore.getState().tabsByWorkspace[WS];
    expect(tabs).toHaveLength(1);
    expect(tabs[0].root).toBe(WS);
    // 单根一键新建仍落主目录。
  });

  it("newTab 可指定附加根，同一工作区按根并存多个 shell", () => {
    const store = useTerminalStore.getState();
    store.newTab(WS);
    store.newTab(WS, EXTRA);
    const tabs = useTerminalStore.getState().tabsByWorkspace[WS];
    expect(tabs.map((t) => t.root)).toEqual([WS, EXTRA]);
    // 新标签成为活动标签。
    expect(useTerminalStore.getState().activeByWorkspace[WS]).toBe(tabs[1].id);
  });

  it("removeWorkspace 仍按工作区清空其全部根的标签", () => {
    const store = useTerminalStore.getState();
    store.newTab(WS);
    store.newTab(WS, EXTRA);
    store.removeWorkspace(WS);
    expect(useTerminalStore.getState().tabsByWorkspace[WS]).toBeUndefined();
    expect(useTerminalStore.getState().activeByWorkspace[WS]).toBeUndefined();
  });
});

describe("TerminalDock 选根", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    resetStore();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(roots?: string[]) {
    const { TerminalDock } = await import("./TerminalDock");
    await act(async () => {
      root.render(<TerminalDock workspacePath={WS} roots={roots} />);
    });
  }

  it("单根：一键新建，shell 的 cwd 是主目录", async () => {
    useTerminalStore.setState({ open: true });
    await render([]);
    // 打开且无标签时自动建一个主目录 shell。
    expect(useTerminalStore.getState().tabsByWorkspace[WS]).toHaveLength(1);
    expect(container.querySelector("[data-cwd]")?.getAttribute("data-cwd")).toBe(WS);
  });

  it("多根：新建按钮打开根选择，选定附加根后该标签的 cwd 指向附加根", async () => {
    useTerminalStore.setState({ open: true });
    await render([EXTRA]);
    // 自动建的主目录 shell。
    expect(useTerminalStore.getState().tabsByWorkspace[WS]).toHaveLength(1);

    // 新建按钮（aria-label = terminal.newTerminal）打开根选择下拉。
    const plus = container.querySelector<HTMLButtonElement>(
      'button[aria-label="terminal.newTerminal"]',
    )!;
    act(() => plus.click());

    const extraItem = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "ws-extra",
    )!;
    expect(extraItem).toBeTruthy();
    act(() => extraItem.click());

    const tabs = useTerminalStore.getState().tabsByWorkspace[WS];
    expect(tabs).toHaveLength(2);
    expect(tabs[1].root).toBe(EXTRA);
    // 活动标签的 shell 以附加根为 cwd。
    expect(container.querySelector("[data-cwd]")?.getAttribute("data-cwd")).toBe(EXTRA);
  });
});
