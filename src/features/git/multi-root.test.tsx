import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChangesPanel } from "./ChangesPanel";
import { resolveWorkspaceRepositoryGroups, useGitStore } from "./store";
import { useFilesStore } from "@/features/files/store";

vi.mock("@/features/files/FilesPanel", () => ({ FilesPanel: () => <div>files</div> }));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-aria-components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-aria-components")>()),
  Checkbox: ({ isSelected, onChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={!!isSelected}
      onChange={(e) => onChange?.(e.target.checked)}
      aria-label={props["aria-label"]}
    />
  ),
}));

vi.mock("@/components/base/tooltip/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipContent: () => null,
}));

vi.mock("@/components/dialogs", () => ({
  ConfirmDialog: ({ onConfirm }: { onConfirm: () => void }) => (
    <button onClick={onConfirm}>confirm</button>
  ),
}));

vi.mock("./ChangesPanelHeader", () => ({
  ChangesPanelHeader: ({ workspacePath }: { workspacePath: string }) => (
    <header data-header={workspacePath} />
  ),
}));

vi.mock("./CommitFooter", () => ({ CommitFooter: () => <footer /> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("resolveWorkspaceRepositoryGroups", () => {
  it("单根：主目录恒为唯一一组且是仓库（与旧行为一致）", () => {
    expect(
      resolveWorkspaceRepositoryGroups({
        primaryRoot: "/repo",
        roots: ["/repo"],
        repositoryRoots: [],
      }),
    ).toEqual([{ path: "/repo", extra: false, repoPath: "/repo" }]);
  });

  it("多根：主目录恒为第一组，附加根只在确为仓库时成组", () => {
    expect(
      resolveWorkspaceRepositoryGroups({
        primaryRoot: "/primary",
        roots: ["/primary", "/extra-repo", "/plain"],
        repositoryRoots: ["/extra-repo"],
      }),
    ).toEqual([
      { path: "/primary", extra: false, repoPath: "/primary" },
      { path: "/extra-repo", extra: true, repoPath: "/extra-repo" },
      // 非仓库的附加根不出变更列表，repoPath 为 null 供 UI 标注「非仓库」。
      { path: "/plain", extra: true, repoPath: null },
    ]);
  });

  it("附加根的仓库判定与分隔符/盘符大小写无关", () => {
    expect(
      resolveWorkspaceRepositoryGroups({
        primaryRoot: "S:\\WS",
        roots: ["S:\\WS", "s:\\Voltron"],
        repositoryRoots: ["s:/voltron"],
      })[1],
    ).toEqual({ path: "s:\\Voltron", extra: true, repoPath: "s:\\Voltron" });
  });
});

describe("ChangesPanel 多根分组", () => {
  let container: HTMLDivElement;
  let root: Root;

  const statusOf = (branch: string) => ({
    branch,
    ahead: 0,
    behind: 0,
    staged: [] as { path: string; status: string }[],
    unstaged: [{ path: `${branch}.ts`, status: "M" }],
    untracked: [],
  });

  beforeEach(() => {
    localStorage.clear();
    useFilesStore.setState({
      selectedPath: null,
      repositories: { "/extra": { path: "/extra", branch: "dev", changed: 1, untracked: 0 } },
    } as never);
    useGitStore.setState({
      statusByWorkspace: { "/repo": statusOf("main"), "/extra": statusOf("dev") },
      notRepoByWorkspace: {},
      branchesByWorkspace: {},
      errorByWorkspace: {},
      fetchedAtByWorkspace: {},
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
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function groups() {
    return Array.from(container.querySelectorAll("[data-git-group]"));
  }

  it("单根渲染一个组，主目录默认聚焦", () => {
    act(() =>
      root.render(<ChangesPanel workspacePath="/repo" roots={[]} className="w-full" />),
    );
    expect(groups()).toHaveLength(1);
    expect(groups()[0].getAttribute("data-git-group-active")).toBe("true");
    // 单根保持旧行为：无「附加根」徽标。
    expect(container.textContent).not.toContain("git.extraRoot");
  });

  it("每个是仓库的根各成一组，主目录在首组且默认聚焦", () => {
    act(() =>
      root.render(<ChangesPanel workspacePath="/repo" roots={["/extra"]} className="w-full" />),
    );
    const list = groups();
    expect(list).toHaveLength(2);
    expect(list[0].getAttribute("data-git-group-path")).toBe("/repo");
    expect(list[0].getAttribute("data-git-group-active")).toBe("true");
    expect(list[1].getAttribute("data-git-group-path")).toBe("/extra");
    expect(list[1].getAttribute("data-git-group-repo")).toBe("true");
    // 附加根带徽标，且只渲染聚焦组的 header。
    expect(container.textContent).toContain("git.extraRoot");
    expect(container.querySelectorAll("header")).toHaveLength(1);
    expect(container.querySelector("header")?.getAttribute("data-header")).toBe("/repo");
    // 两个根的变更列表都在（各自独立操作）。
    expect(container.textContent).toContain("main.ts");
    expect(container.textContent).toContain("dev.ts");
  });

  it("非仓库的附加根成组但标注「非仓库」且不出变更列表", () => {
    act(() =>
      root.render(
        <ChangesPanel workspacePath="/repo" roots={["/plain"]} className="w-full" />,
      ),
    );
    const list = groups();
    expect(list).toHaveLength(2);
    expect(list[1].getAttribute("data-git-group-path")).toBe("/plain");
    expect(list[1].getAttribute("data-git-group-repo")).toBe("false");
    expect(list[1].textContent).toContain("git.notARepo");
  });

  it("点击附加根组标题可切换聚焦（header 跟随到该根）", () => {
    act(() =>
      root.render(<ChangesPanel workspacePath="/repo" roots={["/extra"]} className="w-full" />),
    );
    const extraButton = Array.from(groups()[1].querySelectorAll("button")).find((b) =>
      b.textContent?.includes("extra"),
    )!;
    act(() => extraButton.click());
    expect(groups()[1].getAttribute("data-git-group-active")).toBe("true");
    expect(groups()[0].getAttribute("data-git-group-active")).toBe("false");
    expect(container.querySelector("header")?.getAttribute("data-header")).toBe("/extra");
  });

  it("文件树选中附加根内的文件时该根自动聚焦", () => {
    act(() => {
      useFilesStore.setState({ selectedPath: "/extra/src/app.ts" } as never);
    });
    act(() =>
      root.render(<ChangesPanel workspacePath="/repo" roots={["/extra"]} className="w-full" />),
    );
    expect(groups()[1].getAttribute("data-git-group-active")).toBe("true");
  });
});
