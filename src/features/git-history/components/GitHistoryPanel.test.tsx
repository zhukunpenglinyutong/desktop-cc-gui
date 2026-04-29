/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitHistoryPanel, buildFileTreeItems, getDefaultColumnWidths } from "./GitHistoryPanel";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    const visibleCount = Math.min(count, 120);
    const virtualItems = Array.from({ length: visibleCount }, (_, index) => ({
      index,
      key: index,
      size: 56,
      start: index * 56,
      end: index * 56 + 56,
      lane: 0,
    }));
    return {
      getVirtualItems: () => virtualItems,
      getTotalSize: () => count * 56,
      scrollToIndex: vi.fn(),
      measure: vi.fn(),
      measureElement: vi.fn(),
    };
  },
}));

const mockTranslate = (key: string, options?: Record<string, unknown>) => {
  if (!options) {
    return key;
  }
  if (
    typeof options.sourceBranch === "string" &&
    typeof options.remote === "string" &&
    typeof options.targetBranch === "string"
  ) {
    return `${options.sourceBranch} -> ${options.remote}:${options.targetBranch}`;
  }
  if (typeof options.count === "number") {
    return `${key}:${options.count}`;
  }
  if (typeof options.operation === "string") {
    return `${key}:${options.operation}`;
  }
  return key;
};

const mockI18n = {
  language: "en",
  changeLanguage: vi.fn(),
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: mockTranslate,
    i18n: mockI18n,
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(async () => true),
}));

vi.mock("./GitHistoryWorktreePanel", () => ({
  GitHistoryWorktreePanel: () => <div data-testid="worktree-panel">worktree</div>,
}));

vi.mock("../../git/components/GitDiffViewer", () => ({
  GitDiffViewer: () => <div data-testid="git-diff-viewer">diff-viewer</div>,
}));

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/tauri", () => ({
  checkoutGitBranch: vi.fn(async () => undefined),
  cherryPickCommit: vi.fn(async () => undefined),
  createGitPrWorkflow: vi.fn(async () => ({
    ok: true,
    status: "success",
    message: "created",
    errorCategory: null,
    nextActionHint: null,
    prUrl: "https://github.com/example/repo/pull/12",
    prNumber: 12,
    existingPr: null,
    retryCommand: null,
    stages: [
      { key: "precheck", status: "success", detail: "precheck ok" },
      { key: "push", status: "success", detail: "push ok" },
      { key: "create", status: "success", detail: "create ok" },
      { key: "comment", status: "skipped", detail: "skipped" },
    ],
  })),
  createGitBranchFromBranch: vi.fn(async () => undefined),
  createGitBranchFromCommit: vi.fn(async () => undefined),
  deleteGitBranch: vi.fn(async () => undefined),
  fetchGit: vi.fn(async () => undefined),
  getGitPrWorkflowDefaults: vi.fn(async () => ({
    upstreamRepo: "chenxiangning/mossx",
    baseBranch: "main",
    headOwner: "chenxiangning",
    headBranch: "codex/feat-gitv9-v0.1.8",
    title: "fix(git): stabilize",
    body: "body",
    commentBody: "@maintainer please review",
    canCreate: true,
    disabledReason: null,
  })),
  getGitBranchCompareCommits: vi.fn(async () => ({
    targetOnlyCommits: [],
    currentOnlyCommits: [],
  })),
  getGitStatus: vi.fn(async () => ({
    files: [],
    totalAdditions: 0,
    totalDeletions: 0,
  })),
  getGitDiffs: vi.fn(async () => ({
    files: [],
    totalAdditions: 0,
    totalDeletions: 0,
  })),
  getGitCommitDetails: vi.fn(async () => ({
    sha: "a".repeat(40),
    summary: "feat: one",
    message: "message one",
    author: "tester",
    authorEmail: "tester@example.com",
    committer: "tester",
    committerEmail: "tester@example.com",
    authorTime: 1739300000,
    commitTime: 1739300000,
    parents: [],
    files: [
      {
        path: "src/main/java/com/demo/App.java",
        status: "M",
        additions: 4,
        deletions: 1,
        diff: "diff --git a/src/main/java/com/demo/App.java b/src/main/java/com/demo/App.java\n@@ -1 +1 @@\n-old\n+new\n",
        lineCount: 4,
        truncated: false,
      },
    ],
    totalAdditions: 4,
    totalDeletions: 1,
  })),
  getGitCommitHistory: vi.fn(async () => ({
    snapshotId: "snap-1",
    total: 1,
    offset: 0,
    limit: 100,
    hasMore: false,
    commits: [
      {
        sha: "a".repeat(40),
        shortSha: "aaaaaaa",
        summary: "feat: one",
        message: "message one",
        author: "tester",
        authorEmail: "tester@example.com",
        timestamp: 1739300000,
        parents: [],
        refs: [],
      },
    ],
  })),
  getGitPushPreview: vi.fn(async () => ({
    sourceBranch: "main",
    targetRemote: "origin",
    targetBranch: "main",
    targetRef: "refs/remotes/origin/main",
    targetFound: true,
    hasMore: false,
    commits: [
      {
        sha: "a".repeat(40),
        shortSha: "aaaaaaa",
        summary: "feat: one",
        message: "message one",
        author: "tester",
        authorEmail: "tester@example.com",
        timestamp: 1739300000,
        parents: [],
        refs: [],
      },
    ],
  })),
  listGitRoots: vi.fn(async () => []),
  listGitBranches: vi.fn(async () => ({
    branches: [],
    localBranches: [
      {
        name: "main",
        isCurrent: true,
        isRemote: false,
        remote: null,
        upstream: "origin/main",
        lastCommit: 1739300000,
        ahead: 0,
        behind: 0,
      },
    ],
    remoteBranches: [],
    currentBranch: "main",
  })),
  getGitWorktreeDiffAgainstBranch: vi.fn(async () => []),
  getGitWorktreeDiffFileAgainstBranch: vi.fn(async () => ({
    path: "src/main/java/com/demo/App.java",
    status: "M",
    diff: "diff --git a/src/main/java/com/demo/App.java b/src/main/java/com/demo/App.java\n@@ -1 +1 @@\n-old\n+new\n",
  })),
  mergeGitBranch: vi.fn(async () => undefined),
  pullGit: vi.fn(async () => undefined),
  pushGit: vi.fn(async () => undefined),
  rebaseGitBranch: vi.fn(async () => undefined),
  resetGitCommit: vi.fn(async () => undefined),
  renameGitBranch: vi.fn(async () => undefined),
  resolveGitCommitRef: vi.fn(async () => "a".repeat(40)),
  revertCommit: vi.fn(async () => undefined),
  syncGit: vi.fn(async () => undefined),
  updateGitBranch: vi.fn(async () => ({
    branch: "main",
    status: "success",
    reason: null,
    message: "updated",
    worktreePath: null,
  })),
}));

import * as tauriService from "../../../services/tauri";
import * as clientStorage from "../../../services/clientStorage";

const workspace = {
  id: "w1",
  name: "demo",
  path: "/tmp/demo",
  connected: true,
  settings: {},
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  vi.mocked(clientStorage.getClientStoreSync).mockReturnValue(undefined);
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(async () => undefined),
    },
  });
});

describe("GitHistoryPanel helpers", () => {
  it("keeps changed file tree directories expanded from root", () => {
    const items = buildFileTreeItems(
      [
        {
          path: "a/b/c/d.txt",
          status: "M",
          additions: 1,
          deletions: 0,
          diff: "",
          lineCount: 0,
          truncated: false,
        },
      ],
      new Set(["a", "a/b", "a/b/c"]),
    );
    expect(items.map((item) => item.label)).toEqual(["a", "b", "c", "d.txt"]);
  });

  it("returns sane default widths for 3:2:3:2 layout", () => {
    const widths = getDefaultColumnWidths(1600);
    expect(widths.overviewWidth).toBeGreaterThan(0);
    expect(widths.branchesWidth).toBeGreaterThan(0);
    expect(widths.commitsWidth).toBeGreaterThan(0);
  });
});

describe("GitHistoryPanel interactions", () => {
  it("renders create-pr action before pull and runs workflow after confirm", async () => {
    vi.mocked(tauriService.getGitBranchCompareCommits).mockResolvedValue({
      targetOnlyCommits: [
        {
          sha: "b".repeat(40),
          shortSha: "bbbbbbb",
          summary: "feat: preview commit",
          message: "feat: preview commit",
          author: "tester",
          authorEmail: "tester@example.com",
          timestamp: 1739300000,
          parents: ["a".repeat(40)],
          refs: [],
        },
      ],
      currentOnlyCommits: [],
    });

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.historyCreatePr")).toBeTruthy();
      expect(screen.getByText("git.pull")).toBeTruthy();
    });

    const actionLabels = Array.from(
      document.querySelectorAll(".git-history-toolbar-action-group .git-history-chip span"),
    ).map((node) => node.textContent?.trim() ?? "");
    expect(actionLabels[0]).toBe("git.historyCreatePr");
    expect(actionLabels[1]).toBe("git.pull");

    fireEvent.click(screen.getByText("git.historyCreatePr"));
    expect(screen.getByRole("dialog", { name: "git.historyCreatePrDialogTitle" })).toBeTruthy();

    await waitFor(() => {
      expect(tauriService.getGitPrWorkflowDefaults).toHaveBeenCalledWith("w1");
      const baseRepoInput = screen.getByLabelText(
        "git.historyCreatePrCompareBaseRepo",
      ) as HTMLButtonElement;
      const headRepoInput = screen.getByLabelText(
        "git.historyCreatePrCompareHeadRepo",
      ) as HTMLButtonElement;
      expect(baseRepoInput.textContent ?? "").toContain("chenxiangning/mossx");
      expect(headRepoInput.textContent ?? "").toContain("chenxiangning/mossx");
    });
    await waitFor(() => {
      expect(tauriService.getGitBranchCompareCommits).toHaveBeenCalledWith(
        "w1",
        "codex/feat-gitv9-v0.1.8",
        "upstream/main",
        200,
      );
      expect(screen.getByText("feat: preview commit")).toBeTruthy();
    });
    await waitFor(() => {
      expect(tauriService.getGitCommitDetails).toHaveBeenCalledWith("w1", "b".repeat(40));
      expect(screen.getAllByText("src/main/java/com/demo/App.java").length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByDisplayValue("fix(git): stabilize"), {
      target: { value: "fix(git): create pr button" },
    });

    const confirmButton = screen.getByText("git.historyCreatePrAction").closest("button");
    expect(confirmButton).toBeTruthy();
    await waitFor(() => {
      expect(confirmButton?.disabled).toBe(false);
    });
    fireEvent.click(confirmButton as HTMLElement);

      await waitFor(() => {
        expect(tauriService.createGitPrWorkflow).toHaveBeenCalledWith(
          "w1",
          expect.objectContaining({
            upstreamRepo: "chenxiangning/mossx",
          baseBranch: "main",
          headOwner: "chenxiangning",
          headBranch: "codex/feat-gitv9-v0.1.8",
          title: "fix(git): create pr button",
          commentAfterCreate: true,
          }),
        );
        expect(screen.getByText("git.historyCreatePrResultSuccess")).toBeTruthy();
        expect(screen.getByText("git.historyCreatePrCopyLink")).toBeTruthy();
      });
  });

  it("toggles create-pr dialog maximize state", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.historyCreatePr")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("git.historyCreatePr"));
    const dialog = screen.getByRole("dialog", { name: "git.historyCreatePrDialogTitle" });
    expect(dialog.className).not.toContain("is-maximized");

    await waitFor(() => {
      expect(tauriService.getGitPrWorkflowDefaults).toHaveBeenCalledWith("w1");
      expect(screen.getByLabelText("git.historyCreatePrCompareBaseRepo")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "menu.maximize" }));
    expect(dialog.className).toContain("is-maximized");
    expect(screen.getByRole("button", { name: "common.restore" })).toBeTruthy();
  });

  it("renames selected local branch from toolbar rename button", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    const renameButton = await screen.findByLabelText("git.historyRename");
    await waitFor(() => {
      expect(renameButton.getAttribute("aria-disabled")).not.toBe("true");
    });

    fireEvent.click(renameButton);
    const dialog = await screen.findByRole("dialog", { name: "git.historyRenameBranchDialogTitle" });
    const renameInput = within(dialog).getByPlaceholderText("git.historyPromptRenameBranch");
    fireEvent.change(renameInput, { target: { value: "main-renamed" } });
    fireEvent.click(within(dialog).getByText("common.confirm"));

    await waitFor(() => {
      expect(tauriService.renameGitBranch).toHaveBeenCalledWith("w1", "main", "main-renamed");
    });
  });

  it("opens pull dialog and runs pull only after confirm", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.pull")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("git.pull")[0]!);
    expect(screen.getByRole("dialog", { name: "git.historyPullDialogTitle" })).toBeTruthy();
    expect(tauriService.pullGit).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("git.pull")[1]!);

    await waitFor(() => {
      expect(tauriService.pullGit).toHaveBeenCalledWith(
        "w1",
        expect.objectContaining({
          remote: "origin",
          branch: "main",
        }),
      );
    });
  });

  it("opens sync dialog and runs sync only after confirm", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.sync")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("git.sync")[0]!);
    expect(screen.getByRole("dialog", { name: "git.historySyncDialogTitle" })).toBeTruthy();
    expect(tauriService.syncGit).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("git.sync")[1]!);

    await waitFor(() => {
      expect(tauriService.syncGit).toHaveBeenCalledWith("w1");
    });
  });

  it("opens fetch dialog and runs fetch only after confirm", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.fetch")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("git.fetch")[0]!);
    expect(screen.getByRole("dialog", { name: "git.historyFetchDialogTitle" })).toBeTruthy();
    expect(tauriService.fetchGit).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("git.fetch")[1]!);

    await waitFor(() => {
      expect(tauriService.fetchGit).toHaveBeenCalledWith("w1");
    });
  });

  it("opens refresh dialog and refreshes only after confirm", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.refresh")).toBeTruthy();
    });

    const beforeCount = vi.mocked(tauriService.getGitCommitHistory).mock.calls.length;
    fireEvent.click(screen.getByText("git.refresh"));
    expect(screen.getByRole("dialog", { name: "git.historyRefreshDialogTitle" })).toBeTruthy();

    fireEvent.click(screen.getAllByText("git.refresh")[1]!);

    await waitFor(() => {
      expect(vi.mocked(tauriService.getGitCommitHistory).mock.calls.length).toBeGreaterThan(beforeCount);
    });
  });

  it("renders unified intent sections and fetch scope example", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.fetch")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("git.fetch")[0]!);
    expect(screen.getByText("git.historyIntentTitle")).toBeTruthy();
    expect(screen.getByText("git.historyWillHappenTitle")).toBeTruthy();
    expect(screen.getByText("git.historyWillNotHappenTitle")).toBeTruthy();
    expect(screen.getByText("git.historyExampleTitle")).toBeTruthy();
    expect(screen.getByText("git.historyFetchDialogWillHappen")).toBeTruthy();
    expect(screen.getByText("git fetch --all")).toBeTruthy();
  });

  it("shows sync preflight summary before execution", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.sync")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("git.sync")[0]!);
    await waitFor(() => {
      expect(screen.getByText("git.historySyncDialogAheadBehind")).toBeTruthy();
      expect(screen.getByText("feat: one")).toBeTruthy();
    });
    expect(tauriService.syncGit).not.toHaveBeenCalled();
  });

  it("uses distinct toolbar visuals for fetch and refresh actions", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("git.fetch")).toBeTruthy();
      expect(screen.getByText("git.refresh")).toBeTruthy();
    });

    const fetchButton = screen.getByText("git.fetch").closest(".git-history-chip");
    const refreshButton = screen.getByText("git.refresh").closest(".git-history-chip");
    expect(fetchButton).toBeTruthy();
    expect(refreshButton).toBeTruthy();
    expect(fetchButton?.innerHTML).not.toEqual(refreshButton?.innerHTML);
  });

  it("opens branch context menu with tracking summary", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("main"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    await waitFor(() => {
      expect(screen.getByRole("menu")).toBeTruthy();
    });

    expect(screen.getByText("main -> origin/main")).toBeTruthy();
    const menuItems = screen.getAllByRole("menuitem");
    expect(menuItems[0]?.textContent).toContain("git.historyBranchMenuCheckout");
  });

  it("keeps current local branch update on pull path", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("main"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const updateAction = await screen.findByText("git.historyBranchMenuUpdate");
    const updateButton = updateAction.closest('[role="menuitem"]');
    expect(updateButton?.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(updateButton as Element);

    await waitFor(() => {
      expect(tauriService.pullGit).toHaveBeenCalledWith("w1");
    });
    expect(tauriService.updateGitBranch).not.toHaveBeenCalled();
  });

  it("updates a non-current tracked local branch from branch context menu", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValue({
      branches: [],
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          remote: null,
          upstream: "origin/main",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "update-target",
          isCurrent: false,
          isRemote: false,
          remote: null,
          upstream: "origin/update-target",
          lastCommit: 1739299999,
          ahead: 0,
          behind: 2,
        },
      ],
      remoteBranches: [],
      currentBranch: "main",
    } as never);
    vi.mocked(tauriService.updateGitBranch).mockResolvedValueOnce({
      branch: "update-target",
      status: "success",
      reason: null,
      message: "updated",
      worktreePath: null,
    });

    render(<GitHistoryPanel workspace={workspace as never} />);
    const branchLoadCountBeforeUpdate = vi.mocked(tauriService.listGitBranches).mock.calls.length;

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("update-target"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const updateAction = await screen.findByText("git.historyBranchMenuUpdate");
    const updateButton = updateAction.closest('[role="menuitem"]');
    expect(updateButton?.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(updateButton as Element);

    await waitFor(() => {
      expect(tauriService.updateGitBranch).toHaveBeenCalledWith("w1", "update-target");
    });
    await waitFor(() => {
      expect(vi.mocked(tauriService.listGitBranches).mock.calls.length).toBeGreaterThan(branchLoadCountBeforeUpdate);
    });
    expect(screen.getByText("git.historyBranchUpdateSuccess")).toBeTruthy();
  });

  it("disables local branch update without upstream tracking", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValue({
      branches: [],
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          remote: null,
          upstream: "origin/main",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "no-upstream",
          isCurrent: false,
          isRemote: false,
          remote: null,
          upstream: null,
          lastCommit: 1739299999,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [],
      currentBranch: "main",
    } as never);

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("no-upstream"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const updateAction = await screen.findByText("git.historyBranchMenuUpdate");
    const updateButton = updateAction.closest('[role="menuitem"]');
    expect(
      (updateButton as HTMLButtonElement | null)?.disabled
      || updateButton?.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });

  it("keeps remote branch update on fetch-only path", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValue({
      branches: [],
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          remote: null,
          upstream: "origin/main",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [
        {
          name: "origin/remote-target",
          isCurrent: false,
          isRemote: true,
          remote: "origin",
          upstream: null,
          lastCommit: 1739299999,
          ahead: 0,
          behind: 0,
        },
      ],
      currentBranch: "main",
    } as never);

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    let remoteGroupToggle = screen.queryByLabelText("git.historyToggleRemoteGroup");
    if (!remoteGroupToggle) {
      fireEvent.click(screen.getByLabelText("git.historyToggleRemoteBranches"));
      remoteGroupToggle = await screen.findByLabelText("git.historyToggleRemoteGroup");
    }
    fireEvent.click(remoteGroupToggle);

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("remote-target"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const updateAction = await screen.findByText("git.historyBranchMenuUpdate");
    const updateButton = updateAction.closest('[role="menuitem"]');
    expect(updateButton?.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(updateButton as Element);

    await waitFor(() => {
      expect(tauriService.fetchGit).toHaveBeenCalledWith("w1", "origin");
    });
    expect(tauriService.updateGitBranch).not.toHaveBeenCalled();
  });

  it("runs checkout then rebase from branch context menu", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValue({
      branches: [],
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          remote: null,
          upstream: "origin/main",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "rebase-target",
          isCurrent: false,
          isRemote: false,
          remote: null,
          upstream: "origin/rebase-target",
          lastCommit: 1739299999,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [],
      currentBranch: "main",
    } as never);

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("rebase-target"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const checkoutRebaseAction = await screen.findByText(
      "git.historyBranchMenuCheckoutAndRebaseCurrent",
    );
    const checkoutRebaseButton = checkoutRebaseAction.closest('[role="menuitem"]');
    expect(checkoutRebaseButton).toBeTruthy();
    fireEvent.click(checkoutRebaseButton as Element);

    await waitFor(() => {
      expect(tauriService.checkoutGitBranch).toHaveBeenCalledWith("w1", "rebase-target");
      expect(tauriService.rebaseGitBranch).toHaveBeenCalledWith("w1", "main");
    });
  });

  it("shows success notice and refreshes history after branch checkout succeeds", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValue({
      branches: [],
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          remote: null,
          upstream: "origin/main",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "feature-clean-checkout",
          isCurrent: false,
          isRemote: false,
          remote: null,
          upstream: "origin/feature-clean-checkout",
          lastCommit: 1739299997,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [],
      currentBranch: "main",
    } as never);

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });
    const baselineHistoryCalls = vi.mocked(tauriService.getGitCommitHistory).mock.calls.length;

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("feature-clean-checkout"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const checkoutAction = await screen.findByText("git.historyBranchMenuCheckout");
    const checkoutButton = checkoutAction.closest('[role="menuitem"]');
    expect(checkoutButton).toBeTruthy();
    fireEvent.click(checkoutButton as Element);

    await waitFor(() => {
      expect(tauriService.checkoutGitBranch).toHaveBeenCalledWith("w1", "feature-clean-checkout");
      expect(
        screen.getByText("git.historyOperationSucceeded:git.historyOperationCheckout"),
      ).toBeTruthy();
      expect(vi.mocked(tauriService.getGitCommitHistory).mock.calls.length).toBeGreaterThan(
        baselineHistoryCalls,
      );
    });
  });

  it("shows dirty-tree guidance and does not report success when checkout is blocked", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValue({
      branches: [],
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          remote: null,
          upstream: "origin/main",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "feature-dirty-checkout",
          isCurrent: false,
          isRemote: false,
          remote: null,
          upstream: "origin/feature-dirty-checkout",
          lastCommit: 1739299996,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [],
      currentBranch: "main",
    } as never);
    vi.mocked(tauriService.checkoutGitBranch).mockRejectedValueOnce(
      new Error("Working tree has uncommitted changes. Commit/stash/discard changes first."),
    );

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("feature-dirty-checkout"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const checkoutAction = await screen.findByText("git.historyBranchMenuCheckout");
    const checkoutButton = checkoutAction.closest('[role="menuitem"]');
    expect(checkoutButton).toBeTruthy();
    fireEvent.click(checkoutButton as Element);

    await waitFor(() => {
      expect(tauriService.checkoutGitBranch).toHaveBeenCalledWith("w1", "feature-dirty-checkout");
      expect(screen.getByText(/git\.historyErrorWorkingTreeDirty/)).toBeTruthy();
      expect(
        screen.queryByText("git.historyOperationSucceeded:git.historyOperationCheckout"),
      ).toBeNull();
      expect(document.querySelector(".git-history-current-branch")?.textContent).toBe("main");
    });
  });

  it("opens branch vs worktree diff modal from branch context menu", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValue({
      branches: [],
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          remote: null,
          upstream: "origin/main",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "diff-target",
          isCurrent: false,
          isRemote: false,
          remote: null,
          upstream: "origin/diff-target",
          lastCommit: 1739299998,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [],
      currentBranch: "main",
    } as never);
    vi.mocked(tauriService.getGitWorktreeDiffAgainstBranch).mockResolvedValue([
      {
        path: "src/main/java/com/demo/App.java",
        status: "M",
        diff: "",
      } as never,
    ]);
    vi.mocked(tauriService.getGitWorktreeDiffFileAgainstBranch).mockResolvedValue({
      path: "src/main/java/com/demo/App.java",
      status: "M",
      diff: "diff --git a/src/main/java/com/demo/App.java b/src/main/java/com/demo/App.java\n@@ -1 +1 @@\n-old\n+new\n",
    } as never);

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("diff-target"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const showDiffAction = await screen.findByText("git.historyBranchMenuShowDiffWithWorktree");
    const showDiffButton = showDiffAction.closest('[role="menuitem"]');
    expect(showDiffButton).toBeTruthy();
    fireEvent.click(showDiffButton as Element);

    await waitFor(() => {
      expect(tauriService.getGitWorktreeDiffAgainstBranch).toHaveBeenCalledWith(
        "w1",
        "diff-target",
      );
      expect(screen.getByText("git.historyBranchWorktreeDiffTitle")).toBeTruthy();
      expect(screen.getByText("src/main/java/com/demo/App.java")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("src/main/java/com/demo/App.java"));

    await waitFor(() => {
      expect(tauriService.getGitWorktreeDiffFileAgainstBranch).toHaveBeenCalledWith(
        "w1",
        "diff-target",
        "src/main/java/com/demo/App.java",
      );
      expect(screen.getByTestId("git-diff-viewer")).toBeTruthy();
    });
  });

  it("opens branch vs current branch diff modal from branch context menu", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValue({
      branches: [],
      localBranches: [
        {
          name: "main",
          isCurrent: true,
          isRemote: false,
          remote: null,
          upstream: "origin/main",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "diff-target",
          isCurrent: false,
          isRemote: false,
          remote: null,
          upstream: "origin/diff-target",
          lastCommit: 1739299998,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [],
      currentBranch: "main",
    } as never);
    vi.mocked(tauriService.getGitBranchCompareCommits).mockResolvedValue({
      targetOnlyCommits: [
        {
          sha: "b".repeat(40),
          shortSha: "bbbbbbb",
          summary: "feat: target only",
          message: "target only message",
          author: "tester",
          authorEmail: "tester@example.com",
          timestamp: 1739300100,
          parents: ["a".repeat(40)],
          refs: [],
        },
      ],
      currentOnlyCommits: [
        {
          sha: "c".repeat(40),
          shortSha: "ccccccc",
          summary: "fix: current only",
          message: "current only message",
          author: "tester",
          authorEmail: "tester@example.com",
          timestamp: 1739300200,
          parents: ["a".repeat(40)],
          refs: [],
        },
      ],
    });
    vi.mocked(tauriService.getGitCommitDetails).mockResolvedValueOnce({
      sha: "b".repeat(40),
      summary: "feat: target only",
      message: "target only message",
      author: "tester",
      authorEmail: "tester@example.com",
      committer: "tester",
      committerEmail: "tester@example.com",
      authorTime: 1739300100,
      commitTime: 1739300100,
      parents: ["a".repeat(40)],
      files: [
        {
          path: "src/main/java/com/demo/App.java",
          status: "M",
          additions: 4,
          deletions: 1,
          diff: "diff --git a/src/main/java/com/demo/App.java b/src/main/java/com/demo/App.java\n@@ -1 +1 @@\n-old\n+new\n",
          lineCount: 4,
          truncated: false,
        },
      ],
      totalAdditions: 4,
      totalDeletions: 1,
    });

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(document.querySelector(".git-history-branch-row .git-history-branch-name")).toBeTruthy();
    });

    const branchRow = Array.from(document.querySelectorAll(".git-history-branch-row")).find((row) =>
      row.textContent?.includes("diff-target"),
    );
    expect(branchRow).toBeTruthy();
    fireEvent.contextMenu(branchRow as Element, { clientX: 160, clientY: 180 });

    const compareAction = await screen.findByText("git.historyBranchMenuCompareWithCurrent");
    const compareButton = compareAction.closest('[role="menuitem"]');
    expect(compareButton).toBeTruthy();
    fireEvent.click(compareButton as Element);

    await waitFor(() => {
      expect(tauriService.getGitBranchCompareCommits).toHaveBeenCalledWith(
        "w1",
        "diff-target",
        "main",
      );
      expect(screen.getByText("git.historyBranchCompareDiffTitle")).toBeTruthy();
      expect(screen.getByText("feat: target only")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("feat: target only"));

    await waitFor(() => {
      expect(tauriService.getGitCommitDetails).toHaveBeenCalledWith("w1", "b".repeat(40));
      expect(screen.getByText("src/main/java/com/demo/App.java")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("src/main/java/com/demo/App.java")[0] as Element);

    await waitFor(() => {
      expect(screen.getByTestId("git-diff-viewer")).toBeTruthy();
    });
  });

  it("supports select commit -> click file -> open diff modal", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("feat: one"));

    await waitFor(() => {
      expect(screen.getByText("App.java")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("App.java"));

    await waitFor(() => {
      expect(screen.getByTestId("git-diff-viewer")).toBeTruthy();
    });
  });

  it("shows no-body hint when commit message only contains summary", async () => {
    vi.mocked(tauriService.getGitCommitDetails).mockResolvedValueOnce({
      sha: "a".repeat(40),
      summary: "feat: one",
      message: "feat: one",
      author: "tester",
      authorEmail: "tester@example.com",
      committer: "tester",
      committerEmail: "tester@example.com",
      authorTime: 1739300000,
      commitTime: 1739300000,
      parents: [],
      files: [],
      totalAdditions: 0,
      totalDeletions: 0,
    });

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("feat: one"));

    await waitFor(() => {
      expect(screen.getByText("git.historyCommitMetaNoContent")).toBeTruthy();
    });
  });

  it("opens commit context menu and runs reset with default mixed mode", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    const summary = screen.getByText("feat: one");
    const commitRow = summary.closest(".git-history-commit-row");
    expect(commitRow).toBeTruthy();
    fireEvent.contextMenu(commitRow as HTMLElement);

    await waitFor(() => {
      expect(screen.getAllByText("git.historyResetCurrentBranchToHere").length).toBeGreaterThan(0);
    });

    const menuRoot = document.querySelector(".git-history-commit-context-menu");
    const resetMenuItem = Array.from(
      menuRoot?.querySelectorAll<HTMLButtonElement>(".git-history-commit-context-item") ?? [],
    ).find((node) => node.textContent?.trim() === "git.historyResetCurrentBranchToHere");
    expect(resetMenuItem).toBeTruthy();
    fireEvent.click(resetMenuItem as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText("git.historyResetDialogTitle")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("common.confirm"));

    await waitFor(() => {
      expect(tauriService.resetGitCommit).toHaveBeenCalledWith(
        "w1",
        "a".repeat(40),
        "mixed",
      );
    });
  });

  it("opens push dialog before executing push", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("git.push"));

    await waitFor(() => {
      expect(screen.getByText("git.historyPushDialogTitle")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText("git.historyPushDialogPreviewCommits")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("git.historyPushDialogTargetBranchLabel"), {
      target: { value: "cxn/feat-003" },
    });
    fireEvent.click(screen.getByText("git.historyPushDialogPushToGerrit"));
    await waitFor(() => {
      expect(screen.getByText("main -> origin:refs/for/cxn/feat-003")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("git.historyPushDialogTopicLabel"), {
      target: { value: "optimize" },
    });
    fireEvent.change(screen.getByLabelText("git.historyPushDialogReviewersLabel"), {
      target: { value: "alice,bob" },
    });
    fireEvent.change(screen.getByLabelText("git.historyPushDialogCcLabel"), {
      target: { value: "carol" },
    });
    fireEvent.click(screen.getByText("git.historyPushDialogRunHooks"));
    const pushDialog = document.querySelector(".git-history-push-dialog");
    const confirmPushButton = Array.from(
      pushDialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((node) => node.textContent?.trim() === "git.push");
    expect(confirmPushButton).toBeTruthy();
    await waitFor(() => {
      expect(confirmPushButton?.disabled).toBe(false);
    });
    fireEvent.click(confirmPushButton as HTMLElement);

    await waitFor(() => {
      expect(tauriService.pushGit).toHaveBeenCalledWith("w1", {
        remote: "origin",
        branch: "cxn/feat-003",
        forceWithLease: false,
        pushTags: false,
        runHooks: false,
        pushToGerrit: true,
        topic: "optimize",
        reviewers: "alice,bob",
        cc: "carol",
      });
    });
  });

  it("opens diff modal when clicking push preview changed file", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("git.push"));

    await waitFor(() => {
      expect(screen.getByText("git.historyPushDialogPreviewDetails")).toBeTruthy();
    });
    expect(screen.queryByTestId("git-diff-viewer")).toBeNull();

    const pushDialog = document.querySelector(".git-history-push-dialog");
    await waitFor(() => {
      expect(pushDialog?.textContent ?? "").toContain("App.java");
    });
    const firstPreviewFile = pushDialog?.querySelector<HTMLElement>(
      ".git-history-push-preview-file-tree .git-history-file-item",
    );
    expect(firstPreviewFile).toBeTruthy();
    fireEvent.click(firstPreviewFile as HTMLElement);

    await waitFor(() => {
      expect(screen.getByTestId("git-diff-viewer")).toBeTruthy();
    });
  });

  it("groups existing remote target branches in push dialog dropdown", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValueOnce({
      branches: [],
      localBranches: [
        {
          name: "codex/simple-memory-0.1.7",
          isCurrent: true,
          isRemote: false,
          remote: null,
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [
        {
          name: "origin/main",
          isCurrent: false,
          isRemote: true,
          remote: "origin",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "origin/codex/feat-memory",
          isCurrent: false,
          isRemote: true,
          remote: "origin",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "origin/chore/bump-version",
          isCurrent: false,
          isRemote: true,
          remote: "origin",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
      ],
      currentBranch: "codex/simple-memory-0.1.7",
    });

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("git.push"));
    fireEvent.click(screen.getByLabelText("git.historyPushDialogTargetBranchLabel toggle"));

    await waitFor(() => {
      const menu = document.querySelector(".git-history-push-target-menu");
      expect(menu?.textContent ?? "").toContain("git.historyPushDialogGroupRoot");
      expect(menu?.textContent ?? "").toContain("codex");
      expect(menu?.textContent ?? "").toContain("chore");
      expect(menu?.textContent ?? "").toContain("feat-memory");
    });
  });

  it("groups existing remote target branches in pull dialog dropdown", async () => {
    vi.mocked(tauriService.listGitBranches).mockResolvedValueOnce({
      branches: [],
      localBranches: [
        {
          name: "codex/simple-memory-0.1.7",
          isCurrent: true,
          isRemote: false,
          remote: null,
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
      ],
      remoteBranches: [
        {
          name: "origin/main",
          isCurrent: false,
          isRemote: true,
          remote: "origin",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "origin/codex/feat-memory",
          isCurrent: false,
          isRemote: true,
          remote: "origin",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
        {
          name: "origin/chore/bump-version",
          isCurrent: false,
          isRemote: true,
          remote: "origin",
          lastCommit: 1739300000,
          ahead: 0,
          behind: 0,
        },
      ],
      currentBranch: "codex/simple-memory-0.1.7",
    });

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getAllByText("git.pull")[0]!);
    fireEvent.click(screen.getByLabelText("git.historyPullDialogTargetBranchLabel toggle"));

    await waitFor(() => {
      const menu = document.querySelector(".git-history-push-target-menu");
      expect(menu?.textContent ?? "").toContain("git.historyPushDialogGroupRoot");
      expect(menu?.textContent ?? "").toContain("codex");
      expect(menu?.textContent ?? "").toContain("chore");
      expect(menu?.textContent ?? "").toContain("feat-memory");
    });
  });

  it("disables push confirm when preview has no outgoing commits", async () => {
    vi.mocked(tauriService.getGitPushPreview).mockImplementation(async () => ({
      sourceBranch: "main",
      targetRemote: "origin",
      targetBranch: "main",
      targetRef: "refs/remotes/origin/main",
      targetFound: true,
      hasMore: false,
      commits: [],
    }));

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("git.push"));

    await waitFor(() => {
      expect(screen.getByText("git.historyPushDialogPreviewNoOutgoing")).toBeTruthy();
    });

    const pushDialog = document.querySelector(".git-history-push-dialog");
    const confirmPushButton = Array.from(
      pushDialog?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((node) => node.textContent?.trim() === "git.push");
    expect(confirmPushButton).toBeTruthy();
    expect(confirmPushButton?.disabled).toBe(true);
  });

  it("refreshes push preview when target branch changes", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("git.push"));

    await waitFor(() => {
      expect(screen.getByText("git.historyPushDialogPreviewCommits")).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText("git.historyPushDialogTargetBranchLabel"), {
      target: { value: "release/1.0" },
    });

    await waitFor(() => {
      expect(tauriService.getGitPushPreview).toHaveBeenCalledWith("w1", {
        remote: "origin",
        branch: "release/1.0",
        limit: 120,
      });
    });
  });

  it("hides preview list and marks new when target remote branch does not exist", async () => {
    vi.mocked(tauriService.getGitPushPreview).mockImplementation(async () => ({
      sourceBranch: "main",
      targetRemote: "origin",
      targetBranch: "new-branch",
      targetRef: "refs/remotes/origin/new-branch",
      targetFound: false,
      hasMore: false,
      commits: [
        {
          sha: "a".repeat(40),
          shortSha: "aaaaaaa",
          summary: "feat: one",
          message: "message one",
          author: "tester",
          authorEmail: "tester@example.com",
          timestamp: 1739300000,
          parents: [],
          refs: [],
        },
      ],
    }));

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("git.push"));
    fireEvent.change(screen.getByLabelText("git.historyPushDialogTargetBranchLabel"), {
      target: { value: "new-branch" },
    });

    await waitFor(() => {
      expect(screen.getByText("(git.historyPushDialogTargetNewTag)")).toBeTruthy();
    });

    expect(screen.getByText("git.historyPushDialogPreviewCommits")).toBeTruthy();
    expect(document.querySelectorAll(".git-history-push-preview-commit").length).toBe(0);
    expect(screen.getByText("git.historyPushDialogNewBranchPreviewTitle")).toBeTruthy();
    expect(screen.getByText("git.historyPushDialogNewBranchPreviewHint")).toBeTruthy();
  });

  it("keeps context menu focused and exposes write actions under more menu", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    const summary = screen.getByText("feat: one");
    const commitRow = summary.closest(".git-history-commit-row");
    expect(commitRow).toBeTruthy();
    fireEvent.contextMenu(commitRow as HTMLElement);

    const menuRoot = document.querySelector(".git-history-commit-context-menu");
    expect(menuRoot).toBeTruthy();
    expect(menuRoot?.textContent ?? "").toContain("git.historyCopyRevisionNumber");
    expect(menuRoot?.textContent ?? "").not.toContain("git.historyCopyCommitMessage");

    const moreButton = Array.from(
      menuRoot?.querySelectorAll<HTMLButtonElement>(".git-history-commit-context-item") ?? [],
    ).find((node) => node.textContent?.trim().includes("git.historyMoreOperations"));
    expect(moreButton).toBeTruthy();
    fireEvent.click(moreButton as HTMLElement);

    await waitFor(() => {
      const submenuLabels = Array.from(
        menuRoot?.querySelectorAll<HTMLElement>(
          ".git-history-commit-context-submenu .git-history-commit-context-item-label",
        ) ?? [],
      ).map((node) => node.textContent?.trim() ?? "");
      expect(submenuLabels).toContain("git.historyCherryPick");
      expect(submenuLabels).toContain("git.historyRevert");
    });
  });

  it("copies revision number from commit context menu", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    const summary = screen.getByText("feat: one");
    const commitRow = summary.closest(".git-history-commit-row");
    expect(commitRow).toBeTruthy();
    fireEvent.contextMenu(commitRow as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText("git.historyCopyRevisionNumber")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("git.historyCopyRevisionNumber"));

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("a".repeat(40));
    });
  });

  it("restores persisted query and commit selection state", async () => {
    vi.mocked(clientStorage.getClientStoreSync).mockImplementation((store, key) => {
      if (store === "layout" && String(key).startsWith("gitHistoryPanel:")) {
        return {
          selectedBranch: "all",
          commitQuery: "aaaa",
          selectedCommitSha: "a".repeat(40),
          diffStyle: "split",
        } as never;
      }
      return undefined;
    });

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      const input = screen.getByPlaceholderText("git.historySearchCommits") as HTMLInputElement;
      expect(input.value).toBe("aaaa");
    });

    expect(clientStorage.writeClientStoreValue).toHaveBeenCalled();
  });

  it("does not refetch history in a loop after snapshot update", async () => {
    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("feat: one")).toBeTruthy();
    });

    await waitFor(
      () => {
        expect(tauriService.getGitCommitHistory).toHaveBeenCalledTimes(1);
      },
      { timeout: 400 },
    );
  });

  it("keeps rendered commit rows bounded with large history payload", async () => {
    const largeCommits = Array.from({ length: 10_000 }, (_, index) => ({
      sha: `sha-${index}`,
      shortSha: `s${index}`,
      summary: `commit-${index}`,
      message: `message-${index}`,
      author: "tester",
      authorEmail: "tester@example.com",
      timestamp: 1739300000 - index,
      parents: [],
      refs: [],
    }));
    vi.mocked(tauriService.getGitCommitHistory).mockImplementation(async () => ({
      snapshotId: "snap-large",
      total: 10_000,
      offset: 0,
      limit: 10_000,
      hasMore: false,
      commits: largeCommits,
    }));

    render(<GitHistoryPanel workspace={workspace as never} />);

    await waitFor(() => {
      expect(screen.getByText("commit-0")).toBeTruthy();
    });

    const renderedRows = document.querySelectorAll(".git-history-commit-row");
    expect(renderedRows.length).toBeLessThan(300);
  });
});
