import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangesPanel } from "./ChangesPanel";
import { useGitStore } from "./store";
import { ChatSidePanel } from "@/features/chat/ChatSidePanel";

vi.mock("@/features/files/FilesPanel", () => ({ FilesPanel: () => <div>files</div> }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-i18next")>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./ChangesPanelHeader", () => ({ ChangesPanelHeader: ({ error, pending }: { error?: string; pending: Record<string, true> }) => <header>{error}{pending.stage ? "stage pending" : ""}</header> }));
vi.mock("./CommitFooter", () => ({
  CommitFooter: ({ commitMsg, onCommitMsgChange }: { commitMsg: string; onCommitMsgChange: (value: string) => void }) => (
    <footer><textarea value={commitMsg} onChange={(event) => onCommitMsgChange(event.target.value)} /><button onClick={() => onCommitMsgChange("saved draft")}>write draft</button></footer>
  ),
}));
vi.mock("react-aria-components", () => ({
  Focusable: ({ children }: { children: ReactNode }) => children,
  Checkbox: ({ children, isSelected, onChange, ...props }: any) => (
    <label>
      <input
        type="checkbox"
        checked={!!isSelected}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-label={props["aria-label"]}
      />
      {typeof children === "function" ? children({ isSelected: !!isSelected, isIndeterminate: false }) : children}
    </label>
  ),
}));
vi.mock("@/components/base/tooltip/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@/components/dialogs", () => ({
  ConfirmDialog: ({ onConfirm }: { onConfirm: () => void }) => <button onClick={onConfirm}>confirm</button>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChangesPanel virtual rows", () => {
  let container: HTMLDivElement;
  let root: Root;
  const resizeCallbacks = new Map<Element, Set<() => void>>();

  beforeEach(() => {
    resizeCallbacks.clear();
    vi.stubGlobal("ResizeObserver", class {
      private observed = new Set<Element>();
      private notify: () => void;
      constructor(callback: ResizeObserverCallback) {
        this.notify = () => callback([], this as unknown as ResizeObserver);
      }
      observe(element: Element) {
        this.observed.add(element);
        const callbacks = resizeCallbacks.get(element) ?? new Set();
        callbacks.add(this.notify);
        resizeCallbacks.set(element, callbacks);
      }
      unobserve(element: Element) { resizeCallbacks.get(element)?.delete(this.notify); }
      disconnect() { for (const element of this.observed) this.unobserve(element); }
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      let top = 0;
      if (this.tagName === "UL" && this.parentElement?.tagName === "SECTION") {
        const section = this.parentElement;
        const scroller = section.parentElement!;
        top = 72 - scroller.scrollTop;
        for (const sibling of scroller.querySelectorAll("section")) {
          if (sibling === section) break;
          top += 32 + Number.parseFloat(sibling.querySelector("ul")?.style.height ?? "0");
        }
      }
      return { width: 300, height: 320, top, left: 0, right: 300, bottom: top + 320, x: 0, y: top, toJSON: () => ({}) };
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(300);
    useGitStore.setState({
      statusByWorkspace: {
        "/repo": {
          branch: "main", ahead: 0, behind: 0,
          staged: [{ path: "staged.ts", status: "M" }],
          unstaged: Array.from({ length: 2000 }, (_, index) => ({ path: `file-${index}.ts`, status: "M" })),
          untracked: [{ path: "new.ts", status: "??" }],
        },
      },
      refresh: vi.fn().mockResolvedValue(undefined),
      loadBranches: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      unstage: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn().mockResolvedValue(undefined),
      openDiff: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ChangesPanel workspacePath="/repo" repoPath="/repo" />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("bounds mounted rows and reaches the end through a single parent scroller", () => {
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("li").length).toBeLessThan(60);
    const section = container.querySelectorAll("section")[1];
    const scroller = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    expect(scroller).not.toBeNull();
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
    act(() => {
      scroller.scrollTop = 63680;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(section.textContent).toContain("file-1999.ts");
    expect(section.querySelectorAll("li").length).toBeLessThan(40);
  });

  it("preserves row diff, stage, unstage, discard confirmation and whole-group actions", async () => {
    const section = container.querySelectorAll("section")[1];
    const row = section.querySelector("li")!;
    await act(async () => {
      row.querySelector<HTMLButtonElement>("button")!.click();
      row.querySelector<HTMLButtonElement>('[aria-label="git.stage"]')!.click();
    });
    expect(useGitStore.getState().openDiff).toHaveBeenCalledWith("/repo", { file: "file-0.ts", staged: false });
    expect(useGitStore.getState().stage).toHaveBeenCalledWith("/repo", ["file-0.ts"]);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="git.unstage"]')!.click());
    expect(useGitStore.getState().unstage).toHaveBeenCalledWith("/repo", ["staged.ts"]);
    act(() => row.querySelector<HTMLButtonElement>('[aria-label="git.discard"]')!.click());
    expect(useGitStore.getState().discard).not.toHaveBeenCalled();
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "confirm")!.click());
    expect(useGitStore.getState().discard).toHaveBeenCalledWith("/repo", ["file-0.ts"]);
    await act(async () => Array.from(section.querySelectorAll("button")).find((button) => button.textContent === "git.stageAll")!.click());
    expect(vi.mocked(useGitStore.getState().stage).mock.lastCall?.[1]).toHaveLength(2000);
  });

  it("unmounts a collapsed group's rows and restores them on expand", () => {
    const section = container.querySelectorAll("section")[1];
    const toggle = section.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
    act(() => toggle.click());
    expect(section.querySelectorAll("li")).toHaveLength(0);
    act(() => toggle.click());
    expect(section.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(section.querySelectorAll("li").length).toBeLessThan(40);
  });

  it("does not request Git or mount rows while hidden, including workspace switches", () => {
    const refresh = vi.mocked(useGitStore.getState().refresh);
    const loadBranches = vi.mocked(useGitStore.getState().loadBranches);
    refresh.mockClear();
    loadBranches.mockClear();
    const renderSidebar = (panelTab: string, panelCollapsed: boolean, workspacePath = "/repo") => {
      act(() => root.render(
        <ChatSidePanel
          active={{ engine: "dsh", sessionId: null, workspacePath }}
          panelRef={{ current: null }}
          panelWidth={300}
          panelCollapsed={panelCollapsed}
          dragging={null}
          panelTab={panelTab}
          onResizeStart={() => {}}
        />,
      ));
    };
    renderSidebar("files", false);
    renderSidebar("changes", true);
    renderSidebar("changes", true, "/other");
    expect(refresh).not.toHaveBeenCalled();
    expect(loadBranches).not.toHaveBeenCalled();
    expect(container.querySelectorAll("li")).toHaveLength(0);
    renderSidebar("changes", false);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(loadBranches).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    renderSidebar("files", false);
    act(() => useGitStore.setState({ branchesByWorkspace: { "/repo": [] } }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    renderSidebar("changes", false, "/other");
    expect(refresh).toHaveBeenLastCalledWith("/other");
    expect(loadBranches).toHaveBeenLastCalledWith("/other");
  });

  it("uses the scrolled row's path for actions and keeps whole-group discard complete", async () => {
    const section = container.querySelectorAll("section")[1];
    const scroller = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    act(() => {
      scroller.scrollTop = 63680;
      scroller.dispatchEvent(new Event("scroll"));
    });
    const row = Array.from(section.querySelectorAll("li")).find((element) => element.textContent?.includes("file-1999.ts"))!;
    await act(async () => row.querySelector<HTMLButtonElement>('[aria-label="git.stage"]')!.click());
    expect(useGitStore.getState().stage).toHaveBeenCalledWith("/repo", ["file-1999.ts"]);
    act(() => Array.from(section.querySelectorAll("button")).find((button) => button.textContent === "git.discardAll")!.click());
    expect(useGitStore.getState().discard).not.toHaveBeenCalled();
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "confirm")!.click());
    expect(vi.mocked(useGitStore.getState().discard).mock.lastCall?.[1]).toHaveLength(2000);
  });

  it("preserves the commit draft and group expansion across tab switches and sidebar collapse", () => {
    const render = (panelTab: string, panelCollapsed = false) => act(() => root.render(
      <ChatSidePanel active={{ engine: "dsh", sessionId: null, workspacePath: "/repo" }} panelRef={{ current: null }} panelWidth={300} panelCollapsed={panelCollapsed} dragging={null} panelTab={panelTab} onResizeStart={() => {}} />,
    ));
    render("changes");
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "write draft")!.click());
    act(() => container.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")[1].click());
    render("files");
    expect(container.querySelectorAll("li")).toHaveLength(0);
    render("changes");
    expect(container.querySelector("textarea")!.value).toBe("saved draft");
    expect(container.querySelectorAll("button[aria-expanded]")[1].getAttribute("aria-expanded")).toBe("false");
    render("changes", true);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    render("changes");
    expect(container.querySelector("textarea")!.value).toBe("saved draft");
    expect(container.querySelectorAll("button[aria-expanded]")[1].getAttribute("aria-expanded")).toBe("false");
  });

  it("refreshes the lower group's offset when the preceding group collapses", () => {
    act(() => useGitStore.setState((state) => ({
      statusByWorkspace: { "/repo": { ...state.statusByWorkspace["/repo"]!, staged: Array.from({ length: 100 }, (_, index) => ({ path: `staged-${index}.ts`, status: "M" })) } },
    })));
    const scroller = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    const preceding = container.querySelectorAll("section")[0];
    const following = container.querySelectorAll("section")[1];
    act(() => {
      for (const notify of resizeCallbacks.get(preceding) ?? []) notify();
      scroller.scrollTop = 3304;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(following.textContent).toContain("file-0.ts");
    act(() => preceding.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click());
    act(() => { for (const notify of resizeCallbacks.get(preceding) ?? []) notify(); });
    expect(following.textContent).toContain("file-100.ts");
    expect(following.textContent).not.toContain("file-0.ts");
  });

  it("restores the shared scroll position after hiding and keeps all Git subscriptions detached while hidden", () => {
    const originalSubscribe = useGitStore.subscribe;
    let subscriptions = 0;
    vi.spyOn(useGitStore, "subscribe").mockImplementation((listener) => {
      subscriptions++;
      const unsubscribe = originalSubscribe(listener);
      return () => { subscriptions--; unsubscribe(); };
    });
    const render = (visible: boolean) => act(() => root.render(<ChangesPanel key="subscriptions" workspacePath="/repo" repoPath="/repo" visible={visible} />));
    render(false);
    expect(subscriptions).toBe(0);
    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector("footer")).toBeNull();
    render(true);
    expect(subscriptions).toBe(4);
    const scroller = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    act(() => { scroller.scrollTop = 20000; scroller.dispatchEvent(new Event("scroll")); });
    render(false);
    expect(subscriptions).toBe(0);
    expect(container.querySelectorAll("li")).toHaveLength(0);
    act(() => { scroller.scrollTop = 0; scroller.dispatchEvent(new Event("scroll")); });
    render(true);
    expect(scroller.scrollTop).toBe(20000);
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("li").length).toBeLessThan(60);
  });

  it("retains pending actions and their errors across hiding", async () => {
    let reject!: (error: Error) => void;
    useGitStore.setState({ stage: () => new Promise((_, rejectAction) => { reject = rejectAction; }) });
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="git.stage"]')!.click());
    expect(container.querySelector("header")!.textContent).toContain("stage pending");
    act(() => root.render(<ChangesPanel workspacePath="/repo" repoPath="/repo" visible={false} />));
    await act(async () => reject(new Error("stage failed")));
    act(() => root.render(<ChangesPanel workspacePath="/repo" repoPath="/repo" visible />));
    expect(container.querySelector("header")!.textContent).toContain("stage failed");
    expect(container.querySelector("header")!.textContent).not.toContain("stage pending");
  });

  it("tracks preceding groups that become empty and later reappear", () => {
    const preceding = container.querySelector("section")!;
    act(() => useGitStore.setState((state) => ({ statusByWorkspace: { "/repo": { ...state.statusByWorkspace["/repo"]!, staged: [] } } })));
    expect(preceding.isConnected).toBe(true);
    act(() => useGitStore.setState((state) => ({ statusByWorkspace: { "/repo": { ...state.statusByWorkspace["/repo"]!, staged: Array.from({ length: 100 }, (_, index) => ({ path: `added-${index}.ts`, status: "A" })) } } })));
    const scroller = container.querySelector<HTMLElement>(".overflow-y-auto")!;
    act(() => {
      for (const notify of resizeCallbacks.get(preceding) ?? []) notify();
      scroller.scrollTop = 3304;
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(container.querySelectorAll("section")[1].textContent).toContain("file-0.ts");
  });
});
