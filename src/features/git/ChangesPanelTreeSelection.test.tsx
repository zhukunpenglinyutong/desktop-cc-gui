import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangesPanel } from "./ChangesPanel";
import { useGitStore } from "./store";

vi.mock("@/features/files/FilesPanel", () => ({ FilesPanel: () => <div>files</div> }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string, opts?: any) => key.replace("{{count}}", opts?.count ?? "") }),
}));

vi.mock("react-aria-components", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-aria-components")>();
  return {
    ...actual,
    Checkbox: ({ children, isSelected, isIndeterminate, onChange, ...props }: any) => (
      <label>
        <input
          type="checkbox"
          data-indeterminate={isIndeterminate ? "true" : "false"}
          checked={!!isSelected}
          onChange={(e) => onChange?.(e.target.checked)}
          aria-label={props["aria-label"]}
        />
        {typeof children === "function" ? children({ isSelected: !!isSelected, isIndeterminate: !!isIndeterminate }) : children}
      </label>
    ),
  };
});

vi.mock("@/components/base/tooltip/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));

vi.mock("@/components/dialogs", () => ({
  ConfirmDialog: ({ onConfirm }: { onConfirm: () => void }) => <button onClick={onConfirm}>confirm</button>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChangesPanel tree view and checkbox selection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    localStorage.clear();
    useGitStore.setState({
      statusByWorkspace: {
        "/repo": {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [{ path: "staged-root.ts", status: "M" }],
          unstaged: [
            { path: "src/features/git/ChangesPanel.tsx", status: "M", additions: 10, deletions: 2 },
            { path: "src/features/git/store.ts", status: "M", additions: 5, deletions: 0 },
            { path: "docs/readme.md", status: "M", additions: 1, deletions: 1 },
          ],
          untracked: [{ path: "new-file.ts", status: "??" }],
        },
      },
      refresh: vi.fn().mockResolvedValue(undefined),
      loadBranches: vi.fn().mockResolvedValue(undefined),
      stage: vi.fn().mockResolvedValue(undefined),
      unstage: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn().mockResolvedValue(undefined),
      commit: vi.fn().mockResolvedValue("commit-hash-123"),
      openDiff: vi.fn(),
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders tree view with directory nodes by default", () => {
    act(() => root.render(<ChangesPanel workspacePath="/repo" repoPath="/repo" />));

    // The unstaged section should contain compacted directory "src/features/git" and "docs"
    expect(container.textContent).toContain("src/features/git");
    expect(container.textContent).toContain("docs");
    expect(container.textContent).toContain("ChangesPanel.tsx");
    expect(container.textContent).toContain("store.ts");
    expect(container.textContent).toContain("readme.md");
  });

  it("toggles directory collapse and expand in tree view", () => {
    act(() => root.render(<ChangesPanel workspacePath="/repo" repoPath="/repo" />));

    expect(container.textContent).toContain("ChangesPanel.tsx");

    // Click collapse on "src/features/git" directory
    const dirBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("src/features/git"),
    );
    expect(dirBtn).toBeDefined();

    act(() => {
      dirBtn!.click();
    });

    // Its child files should now be collapsed (unmounted)
    expect(container.textContent).not.toContain("ChangesPanel.tsx");
    expect(container.textContent).not.toContain("store.ts");

    // Click again to expand
    act(() => {
      dirBtn!.click();
    });

    expect(container.textContent).toContain("ChangesPanel.tsx");
    expect(container.textContent).toContain("store.ts");
  });

  it("toggles between flat view and tree view via header button", () => {
    act(() => root.render(<ChangesPanel workspacePath="/repo" repoPath="/repo" />));

    // Initially in tree view
    expect(container.textContent).toContain("src/features/git");

    // Click toggle view button (header button with title/aria-label git.viewAsList)
    const toggleBtn = container.querySelector<HTMLButtonElement>('button[aria-label="git.viewAsList"]')!;
    expect(toggleBtn).not.toBeNull();

    act(() => {
      toggleBtn.click();
    });

    // In flat view, it should show full file paths rather than directory nodes
    expect(container.textContent).toContain("src/features/git/ChangesPanel.tsx");
    expect(container.querySelector('button[aria-label="git.viewAsTree"]')).not.toBeNull();

    // Toggle back to tree view
    const treeToggleBtn = container.querySelector<HTMLButtonElement>('button[aria-label="git.viewAsTree"]')!;
    act(() => {
      treeToggleBtn.click();
    });

    expect(container.textContent).toContain("src/features/git");
    expect(container.querySelector('button[aria-label="git.viewAsList"]')).not.toBeNull();
  });

  it("toggles file checkbox and directory checkbox", () => {
    act(() => root.render(<ChangesPanel workspacePath="/repo" repoPath="/repo" />));

    // Staged file is selected by default
    const stagedCheckbox = container.querySelector<HTMLInputElement>('input[aria-label="staged-root.ts"]')!;
    expect(stagedCheckbox).not.toBeNull();
    expect(stagedCheckbox.checked).toBe(true);

    // Unstaged file is initially unchecked
    const fileCheckbox = container.querySelector<HTMLInputElement>(
      'input[aria-label="src/features/git/ChangesPanel.tsx"]',
    )!;
    expect(fileCheckbox).not.toBeNull();
    expect(fileCheckbox.checked).toBe(false);

    // Toggle file checkbox
    act(() => {
      fileCheckbox.click();
    });
    expect(fileCheckbox.checked).toBe(true);

    // Directory checkbox: "src/features/git" has 2 files, 1 checked -> should be indeterminate
    const dirCheckbox = container.querySelector<HTMLInputElement>(
      'input[aria-label="src/features/git"]',
    )!;
    expect(dirCheckbox).not.toBeNull();
    expect(dirCheckbox.getAttribute("data-indeterminate")).toBe("true");

    // Click dir checkbox to select all files in directory
    act(() => {
      dirCheckbox.click();
    });

    const storeCheckbox = container.querySelector<HTMLInputElement>(
      'input[aria-label="src/features/git/store.ts"]',
    )!;
    expect(storeCheckbox.checked).toBe(true);
    expect(dirCheckbox.getAttribute("data-indeterminate")).toBe("false");
    expect(dirCheckbox.checked).toBe(true);
  });

  it("submits selected files: auto-stages selected unstaged files before commit", async () => {
    act(() => root.render(<ChangesPanel workspacePath="/repo" repoPath="/repo" />));

    // Select an unstaged file
    const fileCheckbox = container.querySelector<HTMLInputElement>(
      'input[aria-label="src/features/git/ChangesPanel.tsx"]',
    )!;
    act(() => {
      fileCheckbox.click();
    });

    // Enter commit message
    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")!;
    act(() => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      nativeSetter?.call(textarea, "feat: new tree view");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Commit button should show count of selected items (1 staged + 1 selected unstaged = 2)
    const commitBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("git.commit"),
    )!;
    expect(commitBtn).toBeDefined();
    expect(commitBtn.disabled).toBe(false);

    await act(async () => {
      commitBtn.click();
    });

    // It should have auto-staged the selected unstaged file
    expect(useGitStore.getState().stage).toHaveBeenCalledWith("/repo", ["src/features/git/ChangesPanel.tsx"]);
    // And called commit with message
    expect(useGitStore.getState().commit).toHaveBeenCalledWith("/repo", "feat: new tree view");
  });
});
