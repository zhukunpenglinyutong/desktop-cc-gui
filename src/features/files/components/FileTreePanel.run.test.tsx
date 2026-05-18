// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OpenAppTarget } from "../../../types";

const revealItemInDirMock = vi.fn(async () => undefined);
const emitToMock = vi.fn(async () => undefined);

const invokeMock = vi.fn(async (...args: any[]) => {
  const command = args[0];
  if (command === "list_workspace_directory_children") {
    return {
      files: [] as string[],
      directories: [] as string[],
      gitignored_files: [] as string[],
      gitignored_directories: [] as string[],
    };
  }
  if (command === "read_workspace_file") {
    return { content: "", truncated: false };
  }
  if (command === "search_workspace_text") {
    return {
      files: [],
      file_count: 0,
      match_count: 0,
      limit_hit: false,
    };
  }
  return null;
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: (...args: any[]) => (invokeMock as (...args: any[]) => Promise<any>)(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: (...args: any[]) => (emitToMock as (...args: any[]) => Promise<void>)(...args),
}));

vi.mock("../../../services/tauri", () => ({
  getWorkspaceDirectoryChildren: (workspaceId: string, path: string) =>
    invokeMock("list_workspace_directory_children", { workspaceId, path }),
  readWorkspaceFile: (workspaceId: string, path: string) =>
    invokeMock("read_workspace_file", { workspaceId, path }),
  createWorkspaceDirectory: (workspaceId: string, path: string) =>
    invokeMock("create_workspace_directory", { workspaceId, path }),
  copyWorkspaceItem: (workspaceId: string, path: string) =>
    invokeMock("copy_workspace_item", { workspaceId, path }),
  trashWorkspaceItem: (workspaceId: string, path: string) =>
    invokeMock("trash_workspace_item", { workspaceId, path }),
  writeWorkspaceFile: (workspaceId: string, path: string, content: string) =>
    invokeMock("write_workspace_file", { workspaceId, path, content }),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: revealItemInDirMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(async () => true),
}));

vi.mock("../../../components/FileIcon", () => ({
  default: () => <span data-testid="file-icon" />,
}));

vi.mock("./FilePreviewPopover", () => ({
  FilePreviewPopover: () => <div data-testid="file-preview-popover" />,
}));

let FileTreePanel: typeof import("./FileTreePanel").FileTreePanel;

beforeAll(async () => {
  ({ FileTreePanel } = await import("./FileTreePanel"));
});

afterEach(() => {
  cleanup();
  invokeMock.mockClear();
  emitToMock.mockClear();
  revealItemInDirMock.mockClear();
  delete window.handleFilePathFromJava;
  delete window.__fileTreeDragPaths;
  delete window.__fileTreeDragStamp;
  delete window.__fileTreeDragActive;
  delete window.__fileTreeDragPosition;
  delete window.__fileTreeDragOverChat;
  delete window.__fileTreeDragDropped;
  delete window.__fileTreeDragCleanup;
});

function getTreeItem(name: string | RegExp) {
  return screen.getByRole("treeitem", { name });
}

describe("FileTreePanel run action isolation", () => {
  it("uses an internal workspace root while rendering top-level entries first", () => {
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts", "README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.queryByRole("treeitem", { name: /workspace/ })).toBeNull();
    expect(container.querySelectorAll('[data-slot="tree-item"][data-file-tree-kind="root"]')).toHaveLength(0);
    expect(getTreeItem(/src/)).toBeTruthy();
    expect(getTreeItem(/README.md/)).toBeTruthy();
  });

  it("renders the file browser through the coss tree surface", () => {
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts", "README.md"]}
        directories={["src"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(container.querySelector('[data-slot="tree"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="tree-item"]')).toBeTruthy();
    expect(container.querySelector(".file-tree-row")).toBeNull();
  });

  it("keeps child expansion on the coss folder row without visible root chrome", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/src/));
    expect(screen.getByText("index.ts")).toBeTruthy();

    const srcToggle = getTreeItem(/src/).querySelector("[data-tree-toggle]");
    expect(srcToggle).toBeTruthy();
    fireEvent.click(srcToggle as Element);
    expect(screen.queryByText("index.ts")).toBeNull();
    fireEvent.click(srcToggle as Element);
    expect(screen.getByText("index.ts")).toBeTruthy();
  });

  it("keeps root actions outside tree rows", () => {
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onToggleRuntimeConsole={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.queryByRole("treeitem", { name: /workspace/ })).toBeNull();
    expect(container.querySelector(".coss-file-tree-root-actions-slot")).toBeTruthy();
    expect(container.querySelector(".coss-file-tree-row-wrap .coss-file-tree-root-actions")).toBeNull();
  });

  it("keeps opened-file contract when running non-open action from root context menu", async () => {
    const onOpenFile = vi.fn();
    const writeTextMock = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={onOpenFile}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const surface = container.querySelector(".coss-file-tree-surface");
    expect(surface).toBeTruthy();
    fireEvent.contextMenu(surface as Element);
    fireEvent.click(await screen.findByRole("menuitem", { name: "files.copyPath" }));

    expect(writeTextMock).toHaveBeenCalledWith("/tmp/workspace/");
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("opens file preview read flow when onOpenFile handler is not provided", async () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem("README.md"));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("read_workspace_file", {
        workspaceId: "workspace-1",
        path: "README.md",
      });
    });
  });

  it("applies git color class when git status path is absolute", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        directories={["src"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "/tmp/workspace/src/index.ts",
            status: "M",
            additions: 1,
            deletions: 0,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/src/));
    const fileLabel = screen.getByText("index.ts");
    expect(fileLabel.className).toContain("git-m");
  });

  it("applies git color class for repo-relative status when git root is a workspace subdirectory", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/JinSen"
        gitRoot="kmllm-search-showcar-py"
        files={["kmllm-search-showcar-py/README.md", "km-chat-new-web/README.md"]}
        directories={["kmllm-search-showcar-py", "km-chat-new-web"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "README.md",
            status: "M",
            additions: 1,
            deletions: 0,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/kmllm-search-showcar-py/));
    const fileLabel = screen.getByText("README.md");
    expect(fileLabel.className).toContain("git-m");
  });

  it("does not apply subrepo repo-relative status to workspace root file with same name", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/JinSen"
        gitRoot="kmllm-search-showcar-py"
        files={["README.md", "kmllm-search-showcar-py/README.md"]}
        directories={["kmllm-search-showcar-py"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "README.md",
            status: "M",
            additions: 1,
            deletions: 0,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/kmllm-search-showcar-py/));
    const readmeLabels = screen.getAllByText("README.md");
    expect(readmeLabels).toHaveLength(2);
    const highlightedLabels = readmeLabels.filter((label) =>
      label.className.includes("git-m"),
    );
    expect(highlightedLabels).toHaveLength(1);
  });

  it("applies folder git status from deep git path even when file node is not listed", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["src-tauri", "src-tauri/src", "src-tauri/src/bin"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "/tmp/workspace/src-tauri/src/bin/moss_x_daemon.rs",
            status: "M",
            additions: 10,
            deletions: 2,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const folderLabel = screen.getByText("src-tauri.src");
    expect(folderLabel.className).toContain("git-m");
  });

  it("does not render folder label as deleted when only nested files are deleted", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/JinSen"
        gitRoot="kmllm-search-showcar-py"
        files={[]}
        directories={["kmllm-search-showcar-py"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[
          {
            path: "obsolete.txt",
            status: "D",
            additions: 0,
            deletions: 10,
          },
        ]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const folderLabel = screen.getByText("kmllm-search-showcar-py");
    expect(folderLabel.className).toContain("git-m");
    expect(folderLabel.className).not.toContain("git-d");
  });

  it("renders a dedicated coss tree scroll surface", () => {
    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const surface = container.querySelector(".coss-file-tree-surface");
    const scrollZone = container.querySelector(".coss-file-tree-scroll");
    const tree = container.querySelector('[data-slot="tree"]');
    expect(surface).toBeTruthy();
    expect(scrollZone).toBeTruthy();
    expect(tree).toBeTruthy();
    expect(surface?.contains(scrollZone as Node)).toBe(true);
    expect(scrollZone?.contains(tree as Node)).toBe(true);
    expect(container.querySelector(".file-tree-top-zone")).toBeNull();
  });

  it("renders empty directories from workspace directory snapshot", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        directories={["empty-dir"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.getByText("empty-dir")).toBeTruthy();
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("renders single-child empty directory chains in a.b.c style", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["a/b/c"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.getByText("a.b.c")).toBeTruthy();
  });

  it("does not render empty state for a directories-only snapshot", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["src"]}
        isLoading={true}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
        gitignoredDirectories={new Set<string>()}
      />,
    );

    expect(screen.getByText("src")).toBeTruthy();
    expect(screen.queryByText("files.noFilesAvailable")).toBeNull();
  });

  it("renders the root loading indicator while the first workspace snapshot is pending", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={[]}
        isLoading={true}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
        gitignoredDirectories={new Set<string>()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("files.loadingFiles");
    expect(screen.queryByText("files.noFilesAvailable")).toBeNull();
  });

  it("does not render run icon button when handler is absent", () => {
    const openTargets: OpenAppTarget[] = [];

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={openTargets}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.queryByRole("button", { name: "files.openRunConsole" })).toBeNull();
  });

  it("uses single click for selection and double click for file open", () => {
    const onOpenFile = vi.fn();
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts", "README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={onOpenFile}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(getTreeItem("README.md"));
    expect(onOpenFile).not.toHaveBeenCalled();
    fireEvent.doubleClick(getTreeItem("README.md"));
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
  });

  it("toggles folder children on a single click", () => {
    const onOpenFile = vi.fn();
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={onOpenFile}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.queryByText("index.ts")).toBeNull();
    fireEvent.click(getTreeItem(/src/));
    expect(screen.getByText("index.ts")).toBeTruthy();
    fireEvent.click(getTreeItem(/src/));
    expect(screen.queryByText("index.ts")).toBeNull();
    const srcRow = getTreeItem(/src/);
    const srcChevron = srcRow.querySelector("[data-tree-toggle]");
    expect(srcChevron).toBeTruthy();
    fireEvent.click(srcChevron as Element);
    expect(screen.getByText("index.ts")).toBeTruthy();
    fireEvent.click(srcChevron as Element);
    expect(screen.queryByText("index.ts")).toBeNull();
    fireEvent.doubleClick(getTreeItem(/src/));
    expect(screen.getByText("index.ts")).toBeTruthy();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "list_workspace_directory_children",
      expect.any(Object),
    );
  });

  it("loads special directory children lazily when expanded", async () => {
    invokeMock.mockImplementation(async (...args: any[]): Promise<any> => {
      const command = args[0];
      if (command === "list_workspace_directory_children") {
        return {
          files: ["node_modules/package.json"],
          directories: [] as string[],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
        };
      }
      return null;
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["node_modules"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/node_modules/));
    expect(await screen.findByText("package.json")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules",
    });
  });

  it("loads ordinary unknown directory children lazily when expanded", async () => {
    invokeMock.mockImplementation(async (...args: any[]): Promise<any> => {
      const command = args[0];
      if (command === "list_workspace_directory_children") {
        return {
          files: ["packages/large/index.ts"],
          directories: [] as string[],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
          scan_state: "complete",
          limit_hit: false,
          directory_entries: [
            {
              path: "packages/large",
              child_state: "loaded",
            },
          ],
        };
      }
      return null;
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["packages/large"]}
        directoryMetadata={[
          {
            path: "packages/large",
            child_state: "unknown",
          },
        ]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/packages/));
    fireEvent.doubleClick(getTreeItem(/large/));

    expect(await screen.findByText("index.ts")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "packages/large",
    });
  });

  it("caches confirmed empty ordinary directories without repeated fetches", async () => {
    invokeMock.mockImplementation(async (...args: any[]): Promise<any> => {
      const command = args[0];
      if (command === "list_workspace_directory_children") {
        return {
          files: [] as string[],
          directories: [] as string[],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
          scan_state: "complete",
          limit_hit: false,
          directory_entries: [
            {
              path: "docs/empty",
              child_state: "empty",
            },
          ],
        };
      }
      return null;
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["docs/empty"]}
        directoryMetadata={[
          {
            path: "docs/empty",
            child_state: "unknown",
          },
        ]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/docs/));
    fireEvent.doubleClick(getTreeItem(/empty/));
    await waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    fireEvent.doubleClick(getTreeItem(/empty/));
    fireEvent.doubleClick(getTreeItem(/empty/));

    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("loads nested directories lazily under special directory", async () => {
    invokeMock.mockImplementation(async (...args: any[]) => {
      const command = args[0];
      const payload = args[1];
      if (command !== "list_workspace_directory_children") {
        return null;
      }
      if (payload.path === "node_modules") {
        return {
          files: [] as string[],
          directories: ["node_modules/@babel"],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
        };
      }
      if (payload.path === "node_modules/@babel") {
        return {
          files: [] as string[],
          directories: ["node_modules/@babel/core"],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
        };
      }
      if (payload.path === "node_modules/@babel/core") {
        return {
          files: ["node_modules/@babel/core/index.js"],
          directories: [] as string[],
          gitignored_files: [] as string[],
          gitignored_directories: [] as string[],
        };
      }
      return {
        files: [] as string[],
        directories: [] as string[],
        gitignored_files: [] as string[],
        gitignored_directories: [] as string[],
      };
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["node_modules"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/node_modules/));
    expect(await screen.findByRole("treeitem", { name: /@babel/ })).toBeTruthy();

    fireEvent.doubleClick(getTreeItem(/@babel/));
    expect(await screen.findByRole("treeitem", { name: /core/ })).toBeTruthy();

    fireEvent.doubleClick(getTreeItem(/core/));
    expect(await screen.findByText("index.js")).toBeTruthy();

    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules",
    });
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules/@babel",
    });
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules/@babel/core",
    });
  });

  it("shows root action buttons and trashes selected node from root row", async () => {
    const onRefreshFiles = vi.fn();

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onRefreshFiles={onRefreshFiles}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const deleteButton = screen.getByRole("button", { name: "files.deleteItem" }) as HTMLButtonElement;
    const refreshButton = screen.getByRole("button", { name: "files.refreshFiles" }) as HTMLButtonElement;
    expect(screen.getByRole("button", { name: "files.newFile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "files.newFolder" })).toBeTruthy();
    expect(refreshButton).toBeTruthy();
    expect(deleteButton).toBeTruthy();
    expect(deleteButton.disabled).toBe(true);
    fireEvent.click(refreshButton);
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);

    fireEvent.click(getTreeItem("README.md"));
    expect(deleteButton.disabled).toBe(false);
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("trash_workspace_item", {
        workspaceId: "workspace-1",
        path: "README.md",
      });
    });
    expect(onRefreshFiles).toHaveBeenCalledTimes(2);
  });

  it("creates new folder from root action", async () => {
    const onRefreshFiles = vi.fn();

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onRefreshFiles={onRefreshFiles}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "files.newFolder" }));
    const folderInput = screen.getByPlaceholderText("files.newFolderNamePlaceholder");
    fireEvent.change(folderInput, { target: { value: "docs" } });
    fireEvent.keyDown(folderInput, { key: "Enter" });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_workspace_directory", {
        workspaceId: "workspace-1",
        path: "docs",
      });
    });
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
  });

  it("creates new folder under selected folder from root action", async () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.click(getTreeItem(/src/));
    fireEvent.click(screen.getByRole("button", { name: "files.newFolder" }));
    const folderInput = screen.getByPlaceholderText("files.newFolderNamePlaceholder");
    fireEvent.change(folderInput, { target: { value: "docs" } });
    fireEvent.keyDown(folderInput, { key: "Enter" });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("create_workspace_directory", {
        workspaceId: "workspace-1",
        path: "src/docs",
      });
    });
  });

  it("creates new file under selected file parent from root action", async () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/src/));
    fireEvent.click(getTreeItem("index.ts"));
    fireEvent.click(screen.getByRole("button", { name: "files.newFile" }));
    const fileInput = screen.getByPlaceholderText("files.newFileNamePlaceholder");
    fireEvent.change(fileInput, { target: { value: "utils.ts" } });
    fireEvent.keyDown(fileInput, { key: "Enter" });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("write_workspace_file", {
        workspaceId: "workspace-1",
        path: "src/utils.ts",
        content: "",
      });
    });
  });

  it("shows retry action when special directory lazy load fails", async () => {
    invokeMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        files: ["node_modules/package-lock.json"],
        directories: [] as string[],
        gitignored_files: [] as string[],
        gitignored_directories: [] as string[],
      });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={["node_modules"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    fireEvent.doubleClick(getTreeItem(/node_modules/));
    expect(await screen.findByRole("button", { name: "files.retryLoadFiles" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "files.retryLoadFiles" }));
    await waitFor(() => {
      expect(screen.getByText("package-lock.json")).toBeTruthy();
    });
  });

  it("shows load error state instead of empty state when root file list fails", () => {
    const onRefreshFiles = vi.fn();

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={[]}
        directories={[]}
        isLoading={false}
        loadError="network down"
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        onRefreshFiles={onRefreshFiles}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    expect(screen.getByText("files.loadFilesFailed")).toBeTruthy();
    expect(screen.queryByText("files.noFilesAvailable")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "files.retryLoadFiles" }));
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
  });

  it("mentions file using Windows-style absolute path when workspace path uses backslashes", () => {
    const onInsertText = vi.fn();

    const { container } = render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath={"C:\\workspace\\demo"}
        files={["index.ts"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={onInsertText}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const mentionButton = container.querySelector(".coss-file-tree-action") as HTMLButtonElement | null;
    expect(mentionButton).not.toBeNull();
    fireEvent.click(mentionButton as HTMLButtonElement);

    expect(onInsertText).toHaveBeenCalledWith(
      "@C:\\workspace\\demo\\index.ts ",
    );
  });

  it("builds multi-path drag payload from selected nodes", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md", "package.json"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = getTreeItem("README.md");
    const pkg = getTreeItem("package.json");
    fireEvent.click(readme);
    fireEvent.click(pkg, { ctrlKey: true });

    const setData = vi.fn();
    const dataTransfer = {
      setData,
      effectAllowed: "",
    };

    fireEvent.dragStart(pkg, { dataTransfer });

    const payloadJson = setData.mock.calls.find(
      (call) => call[0] === "application/x-ccgui-file-paths",
    )?.[1];
    const payloadText = setData.mock.calls.find(
      (call) => call[0] === "text/plain",
    )?.[1];

    expect(payloadJson).toBeTruthy();
    expect(payloadText).toBeTruthy();
    const parsedPayload = JSON.parse(payloadJson as string) as string[];
    expect(new Set(parsedPayload)).toEqual(
      new Set(["/tmp/workspace/README.md", "/tmp/workspace/package.json"]),
    );
    expect(new Set((payloadText as string).split("\n"))).toEqual(
      new Set(["/tmp/workspace/README.md", "/tmp/workspace/package.json"]),
    );
    expect(new Set(window.__fileTreeDragPaths ?? [])).toEqual(
      new Set(["/tmp/workspace/README.md", "/tmp/workspace/package.json"]),
    );
    expect(typeof window.__fileTreeDragStamp).toBe("number");
    expect(window.__fileTreeDragActive).toBe(true);
    expect(window.__fileTreeDragOverChat).toBe(false);
    expect(typeof window.__fileTreeDragCleanup).toBe("function");

    fireEvent.dragEnd(pkg);
    expect(window.__fileTreeDragPaths).toBeUndefined();
    expect(window.__fileTreeDragStamp).toBeUndefined();
    expect(window.__fileTreeDragActive).toBeUndefined();
    expect(window.__fileTreeDragPosition).toBeUndefined();
    expect(window.__fileTreeDragOverChat).toBeUndefined();
    expect(window.__fileTreeDragDropped).toBeUndefined();
    expect(window.__fileTreeDragCleanup).toBeUndefined();
  });

  it("uses a windows-only drag image for internal tree drags", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: "Win32",
    });

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const setDragImage = vi.fn();
    fireEvent.dragStart(getTreeItem("README.md"), {
      dataTransfer: {
        setData: vi.fn(),
        setDragImage,
        effectAllowed: "",
      },
    });

    expect(setDragImage).toHaveBeenCalledTimes(1);
    const dragImageNode = setDragImage.mock.calls[0]?.[0] as HTMLElement | undefined;
    expect(dragImageNode).toBeInstanceOf(HTMLElement);
    expect(dragImageNode?.textContent).toContain("README.md");
    expect(document.body.contains(dragImageNode ?? null)).toBe(true);

    fireEvent.dragEnd(getTreeItem("README.md"));
    expect(document.body.contains(dragImageNode ?? null)).toBe(false);

    Object.defineProperty(window.navigator, "platform", {
      configurable: true,
      value: originalPlatform,
    });
  });

  it("uses the same insertion bridge as the + action when tree drag ends over chat input", () => {
    const handleFilePathFromJava = vi.fn();
    window.handleFilePathFromJava = handleFilePathFromJava;

    const chatInput = document.createElement("div");
    chatInput.className = "chat-input-box";
    chatInput.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 400, bottom: 200 } as DOMRect);
    document.body.appendChild(chatInput);

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md", "package.json"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = getTreeItem("README.md");
    fireEvent.dragStart(readme, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    window.__fileTreeDragPosition = { x: 120, y: 80 };
    fireEvent.dragEnd(readme);

    expect(handleFilePathFromJava).toHaveBeenCalledWith("/tmp/workspace/README.md");
    chatInput.remove();
  });

  it("targets the active chat input even when it's not the first chat-input-box node", () => {
    const handleFilePathFromJava = vi.fn();
    window.handleFilePathFromJava = handleFilePathFromJava;

    const inactiveChatInput = document.createElement("div");
    inactiveChatInput.className = "chat-input-box";
    inactiveChatInput.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 180, bottom: 120 } as DOMRect);
    document.body.appendChild(inactiveChatInput);

    const activeChatInput = document.createElement("div");
    activeChatInput.className = "chat-input-box";
    activeChatInput.getBoundingClientRect = () =>
      ({ left: 520, top: 40, right: 980, bottom: 260 } as DOMRect);
    document.body.appendChild(activeChatInput);

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = getTreeItem("README.md");
    fireEvent.dragStart(readme, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    window.__fileTreeDragPosition = { x: 700, y: 120 };
    fireEvent.dragEnd(readme);

    expect(handleFilePathFromJava).toHaveBeenCalledWith("/tmp/workspace/README.md");
    inactiveChatInput.remove();
    activeChatInput.remove();
  });

  it("falls back to + bridge on drag end when hit-test channel is unavailable", () => {
    const handleFilePathFromJava = vi.fn();
    window.handleFilePathFromJava = handleFilePathFromJava;

    const chatInput = document.createElement("div");
    chatInput.className = "chat-input-box";
    document.body.appendChild(chatInput);

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        onInsertText={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const readme = getTreeItem("README.md");
    fireEvent.dragStart(readme, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    // Simulate runtime that doesn't provide usable drag-end location.
    fireEvent.dragEnd(readme, { clientX: 0, clientY: 0 });

    expect(handleFilePathFromJava).toHaveBeenCalledWith("/tmp/workspace/README.md");
    chatInput.remove();
  });
});
