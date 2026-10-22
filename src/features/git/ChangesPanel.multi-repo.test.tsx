import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangesPanel } from "./ChangesPanel";
import { useGitStore } from "./store";

vi.mock("@/features/files/FilesPanel", () => ({ FilesPanel: () => <div>files</div> }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-i18next")>(),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "zh-CN" } }),
}));
vi.mock("./ChangesPanelHeader", () => ({
  ChangesPanelHeader: ({ workspacePath }: { workspacePath: string }) => (
    <header data-testid={`header-${workspacePath}`}>{workspacePath}</header>
  ),
}));
vi.mock("./CommitFooter", () => ({
  CommitFooter: ({ workspacePath, stagedCount, onCommitMsgChange }: {
    workspacePath: string;
    stagedCount: number;
    onCommitMsgChange: (value: string) => void;
  }) => (
    <footer data-testid={`footer-${workspacePath}`}>
      <span>{`staged:${stagedCount}`}</span>
      <button onClick={() => onCommitMsgChange("draft")}>write draft</button>
    </footer>
  ),
}));
vi.mock("react-aria-components", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-aria-components")>(),
  Focusable: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/base/tooltip/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => children,
  TooltipContent: () => null,
}));
vi.mock("@/components/dialogs", () => ({
  ConfirmDialog: ({ onConfirm }: { onConfirm: () => void }) => <button onClick={onConfirm}>confirm</button>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A workspace folder that holds three independent projects, none of them
 *  the folder itself. */
const SUMMARIES = [
  { path: "/ws/api", branch: "main", changed: 1, untracked: 0 },
  { path: "/ws/web", branch: "feat/ui", changed: 2, untracked: 1 },
  { path: "/ws/docs", branch: "main", changed: 0, untracked: 0 },
];

describe("ChangesPanel multi-project view", () => {
  let container: HTMLDivElement;
  let root: Root;
  const commit = vi.fn().mockResolvedValue("sha");
  const stage = vi.fn().mockResolvedValue(undefined);
  const discoverRepos = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    stage.mockResolvedValue(undefined);
    commit.mockResolvedValue("sha");
    discoverRepos.mockResolvedValue(undefined);
    vi.stubGlobal("ResizeObserver", class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ width: 300, height: 320, top: 0, left: 0, right: 300, bottom: 320, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    );
    useGitStore.setState({
      reposByWorkspace: { "/ws": SUMMARIES },
      statusByWorkspace: {
        "/ws": undefined,
        "/ws/api": { branch: "main", ahead: 0, behind: 0, staged: [{ path: "a.ts", status: "M" }], unstaged: [], untracked: [] },
        "/ws/web": { branch: "feat/ui", ahead: 2, behind: 0, staged: [], unstaged: [{ path: "b.ts", status: "M" }], untracked: [{ path: "c.ts", status: "??" }] },
        "/ws/docs": { branch: "main", ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] },
      },
      refresh: vi.fn().mockResolvedValue(undefined),
      loadBranches: vi.fn().mockResolvedValue(undefined),
      discoverRepos,
      stage,
      unstage: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn().mockResolvedValue(undefined),
      commit,
      openDiff: vi.fn(),
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ChangesPanel workspacePath="/ws" />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lists every project under the workspace, each with its own section", () => {
    const headers = [...container.querySelectorAll("[data-testid^='header-']")]
      .map((n) => n.getAttribute("data-testid"));
    expect(headers).toEqual(["header-/ws/api", "header-/ws/web", "header-/ws/docs"]);
    // One scrollbar walks all projects, as in IDEA's unified change list.
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
    expect(container.textContent).toContain("api");
    expect(container.textContent).toContain("feat/ui");
  });

  it("scopes each project's row actions and commit box to that repository", async () => {
    // /ws/web is the only project with unstaged or untracked rows, and each
    // of those rows offers a stage action.
    const stageButtons = container.querySelectorAll('li [aria-label="git.stage"]');
    expect(stageButtons.length).toBe(2);
    await act(async () => stageButtons[0].closest("li")!.querySelector<HTMLButtonElement>('[aria-label="git.stage"]')!.click());
    expect(stage).toHaveBeenCalledWith("/ws/web", ["b.ts"]);
    expect(stage).not.toHaveBeenCalledWith("/ws/api", expect.anything());
    // Staged counts are per repository: only api has staged changes.
    expect(container.querySelector("[data-testid='footer-/ws/api']")!.textContent).toContain("staged:1");
    expect(container.querySelector("[data-testid='footer-/ws/web']")!.textContent).toContain("staged:0");
    // The workspace folder is not a repository, so it gets no section and
    // no commit box of its own.
    expect(container.querySelector("[data-testid='footer-/ws']")).toBeNull();
  });

  it("folds one project without disturbing the others", async () => {
    const before = container.querySelectorAll("li").length;
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='header-/ws/web']")!
        .closest("section")!.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(container.querySelectorAll("li").length).toBeLessThan(before);
    expect(container.querySelector("[data-testid='footer-/ws/web']")).toBeNull();
    expect(container.querySelector("[data-testid='footer-/ws/api']")).not.toBeNull();
  });

  it("keeps the single-repository panel when a repository is pinned", () => {
    act(() => root.render(<ChangesPanel workspacePath="/ws" repoPath="/ws/api" />));
    expect(container.querySelectorAll("[data-testid^='header-']").length).toBe(1);
    expect(container.querySelector("[data-testid='header-/ws/api']")).not.toBeNull();
    expect(container.querySelector("[data-testid='header-/ws/web']")).toBeNull();
  });

  it("pins a single discovered repository that is not the workspace root", () => {
    act(() => {
      useGitStore.setState({ reposByWorkspace: { "/ws": [SUMMARIES[0]] } });
      root.render(<ChangesPanel workspacePath="/ws" />);
    });
    expect(container.querySelector("[data-testid='header-/ws/api']")).not.toBeNull();
    expect(container.querySelector("[data-testid='header-/ws']")).toBeNull();
  });

  it("asks the backend to discover repositories for the workspace", () => {
    expect(discoverRepos).toHaveBeenCalledWith("/ws");
  });
});
