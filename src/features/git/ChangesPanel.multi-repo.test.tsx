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
  ChangesPanelHeader: ({ workspacePath, error }: { workspacePath: string; error?: string }) => (
    <header data-testid={`header-${workspacePath}`}>{workspacePath}{error}</header>
  ),
}));
vi.mock("./CommitFooter", () => ({
  CommitFooter: ({ workspacePath, stagedCount, commitMsg, busy, onCommitMsgChange, onCommitSelected }: {
    workspacePath: string;
    stagedCount: number;
    commitMsg: string;
    busy: boolean;
    onCommitMsgChange: (value: string) => void;
    onCommitSelected: () => Promise<void>;
  }) => (
    <footer data-testid={`footer-${workspacePath}`}>
      <span>{`staged:${stagedCount}`}</span>
      <textarea value={commitMsg} readOnly />
      <button onClick={() => onCommitMsgChange("draft")}>write draft</button>
      <button data-commit disabled={busy} onClick={() => void onCommitSelected()}>commit</button>
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
  const refresh = vi.fn().mockResolvedValue(undefined);
  const loadBranches = vi.fn().mockResolvedValue(undefined);

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
      reposRevisionByWorkspace: {},
      statusRevisionByWorkspace: {},
      statusByWorkspace: {
        "/ws": undefined,
        "/ws/api": { branch: "main", ahead: 0, behind: 0, staged: [{ path: "a.ts", status: "M" }], unstaged: [], untracked: [] },
        "/ws/web": { branch: "feat/ui", ahead: 2, behind: 0, staged: [], unstaged: [{ path: "b.ts", status: "M" }], untracked: [{ path: "c.ts", status: "??" }] },
        "/ws/docs": { branch: "main", ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] },
      },
      refresh,
      loadBranches,
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
    // Dirty projects mount their panels; the clean one stays folded with
    // only its section header, so first open does not refresh it.
    const headers = [...container.querySelectorAll("[data-testid^='header-']")]
      .map((n) => n.getAttribute("data-testid"));
    expect(headers).toEqual(["header-/ws/api", "header-/ws/web"]);
    // One scrollbar walks all projects, as in IDEA's unified change list.
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
    expect(container.textContent).toContain("api");
    expect(container.textContent).toContain("feat/ui");
    // Folded does not mean gone: the clean project keeps its section row.
    expect(container.textContent).toContain("docs");
  });

  it("loads a clean project only once its section is expanded", async () => {
    // /ws/docs has no changes, so opening the tab must not fire a status
    // walk for it — a wide workspace would otherwise stall on N IPC calls.
    expect(refresh).toHaveBeenCalledWith("/ws/api");
    expect(refresh).toHaveBeenCalledWith("/ws/web");
    expect(refresh).not.toHaveBeenCalledWith("/ws/docs");
    expect(loadBranches).not.toHaveBeenCalledWith("/ws/docs");
    expect(container.querySelector("[data-testid='footer-/ws/docs']")).toBeNull();

    const docsToggle = [...container.querySelectorAll<HTMLButtonElement>("section > button")]
      .find((button) => button.textContent?.includes("docs"))!;
    await act(async () => docsToggle.click());

    expect(container.querySelector("[data-testid='header-/ws/docs']")).not.toBeNull();
    expect(container.querySelector("[data-testid='footer-/ws/docs']")).not.toBeNull();
    expect(refresh).toHaveBeenCalledWith("/ws/docs");
    expect(loadBranches).toHaveBeenCalledWith("/ws/docs");
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
    const section = container.querySelector("[data-testid='header-/ws/web']")!.closest("section")!;
    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='header-/ws/web']")!
        .closest("section")!.querySelector<HTMLButtonElement>("button")!.click();
    });
    expect(section.querySelector('[aria-hidden="true"][inert]')).not.toBeNull();
    expect(section.querySelector("button")!.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[data-testid='footer-/ws/api']")).not.toBeNull();
  });

  it("preserves a project's draft and selection across collapse and reopen", async () => {
    const footer = container.querySelector("[data-testid='footer-/ws/api']")!;
    const toggle = footer.closest("section")!.querySelector<HTMLButtonElement>("button")!;
    act(() => footer.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(container.querySelector<HTMLTextAreaElement>("[data-testid='footer-/ws/api'] textarea")!.value).toBe("draft");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-testid='footer-/ws/api'] [data-commit]")!.click());
    expect(commit).toHaveBeenCalledWith("/ws/api", "draft");
  });

  it("keeps a pending commit locked across collapse and reports its eventual failure", async () => {
    let reject!: (error: Error) => void;
    commit.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const footer = container.querySelector("[data-testid='footer-/ws/api']")!;
    const toggle = footer.closest("section")!.querySelector<HTMLButtonElement>("button")!;
    act(() => footer.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => footer.querySelector<HTMLButtonElement>("[data-commit]")!.click());
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(container.querySelector<HTMLButtonElement>("[data-testid='footer-/ws/api'] [data-commit]")!.disabled).toBe(true);
    await act(async () => reject(new Error("commit failed")));
    expect(container.querySelector<HTMLButtonElement>("[data-testid='footer-/ws/api'] [data-commit]")!.disabled).toBe(false);
    expect(container.querySelector("[data-testid='header-/ws/api']")!.textContent).toContain("commit failed");
    expect(container.querySelector<HTMLTextAreaElement>("[data-testid='footer-/ws/api'] textarea")!.value).toBe("draft");
  });

  it("preserves checked unstaged files when reopening a repository", async () => {
    const footer = container.querySelector("[data-testid='footer-/ws/web']")!;
    const section = footer.closest("section")!;
    const toggle = section.querySelector<HTMLButtonElement>("button")!;
    act(() => section.querySelector<HTMLInputElement>('input[aria-label="b.ts"]')!.click());
    act(() => footer.querySelector<HTMLButtonElement>("button")!.click());
    await act(async () => toggle.click());
    await act(async () => toggle.click());
    expect(section.querySelector<HTMLInputElement>('input[aria-label="b.ts"]')!.checked).toBe(true);
    await act(async () => section.querySelector<HTMLButtonElement>("[data-commit]")!.click());
    expect(stage).toHaveBeenCalledWith("/ws/web", ["b.ts"]);
    expect(commit).toHaveBeenCalledWith("/ws/web", "draft");
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
