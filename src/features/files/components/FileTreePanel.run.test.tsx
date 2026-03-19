// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OpenAppTarget } from "../../../types";

const menuPopupMock = vi.fn(async () => undefined);
const menuNewMock = vi.fn(async ({ items }: { items: any[] }) => ({
  append: vi.fn(async () => undefined),
  popup: menuPopupMock,
  close: vi.fn(async () => undefined),
  items,
}));
const menuItemNewMock = vi.fn(async (options: any) => options);
const revealItemInDirMock = vi.fn(async () => undefined);

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
  invoke: (...args: any[]) => invokeMock(...args),
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: menuNewMock,
  },
  MenuItem: {
    new: menuItemNewMock,
  },
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class {},
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    scaleFactor: vi.fn(async () => 1),
  })),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: revealItemInDirMock,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(async () => true),
}));

let FileTreePanel: typeof import("./FileTreePanel").FileTreePanel;

beforeAll(async () => {
  ({ FileTreePanel } = await import("./FileTreePanel"));
});

afterEach(() => {
  cleanup();
  invokeMock.mockClear();
  menuNewMock.mockClear();
  menuItemNewMock.mockClear();
  menuPopupMock.mockClear();
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

describe("FileTreePanel run action isolation", () => {
  it("renders a single workspace root node and keeps it expanded by default", () => {
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

    expect(screen.getByRole("button", { name: /workspace/ })).toBeTruthy();
    expect(container.querySelectorAll(".file-tree-row.is-root")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /src/ })).toBeTruthy();
  });

  it("restores child expansion state after collapsing and re-expanding workspace root", () => {
    const { container } = render(
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

    fireEvent.doubleClick(screen.getByRole("button", { name: /src/ }));
    expect(screen.getByText("index.ts")).toBeTruthy();

    const rootChevron = container.querySelector(".file-tree-root-chevron");
    expect(rootChevron).toBeTruthy();
    fireEvent.click(rootChevron as Element);
    expect(screen.queryByText("index.ts")).toBeNull();

    fireEvent.click(rootChevron as Element);
    expect(screen.getByText("index.ts")).toBeTruthy();
  });

  it("places workspace root on its own row", () => {
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
        onToggleRuntimeConsole={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
      />,
    );

    const rootButton = screen.getByRole("button", { name: /workspace/ });
    const rootRow = rootButton.closest(".file-tree-root-row");
    expect(rootRow).toBeTruthy();
    expect(rootRow?.querySelectorAll(".file-tree-row.is-root")).toHaveLength(1);
  });

  it("keeps opened-file contract when running non-open action from root context menu", async () => {
    const onOpenFile = vi.fn();
    const writeTextMock = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    render(
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

    fireEvent.contextMenu(screen.getByRole("button", { name: /workspace/ }));
    await waitFor(() => {
      expect(menuItemNewMock).toHaveBeenCalled();
      expect(menuNewMock).toHaveBeenCalled();
      expect(menuPopupMock).toHaveBeenCalled();
    });

    const copyPathItem = menuItemNewMock.mock.calls
      .map((call) => call[0])
      .find((item) => item.text === "files.copyPath");
    expect(copyPathItem).toBeTruthy();
    await copyPathItem.action();
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

    fireEvent.doubleClick(screen.getByRole("button", { name: "README.md" }));
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("read_workspace_file", {
        workspaceId: "workspace-1",
        path: "README.md",
      });
    });
  });

  it("keeps sticky-top and scroll-list containers separated in DOM structure", () => {
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

    const topZone = container.querySelector(".file-tree-top-zone");
    const listZone = container.querySelector(".file-tree-list");
    expect(topZone).toBeTruthy();
    expect(listZone).toBeTruthy();
    expect(topZone?.contains(listZone as Node)).toBe(false);
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

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(onOpenFile).not.toHaveBeenCalled();
    fireEvent.doubleClick(screen.getByRole("button", { name: "README.md" }));
    expect(onOpenFile).toHaveBeenCalledWith("README.md");
  });

  it("keeps single click on folder as selection and uses double click to toggle children", () => {
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
    fireEvent.click(screen.getByRole("button", { name: /src/ }));
    expect(screen.queryByText("index.ts")).toBeNull();
    const srcRow = screen.getByRole("button", { name: /src/ });
    const srcChevron = srcRow.querySelector(".file-tree-chevron");
    expect(srcChevron).toBeTruthy();
    fireEvent.click(srcChevron as Element);
    expect(screen.getByText("index.ts")).toBeTruthy();
    fireEvent.click(srcChevron as Element);
    expect(screen.queryByText("index.ts")).toBeNull();
    fireEvent.doubleClick(screen.getByRole("button", { name: /src/ }));
    expect(screen.getByText("index.ts")).toBeTruthy();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "list_workspace_directory_children",
      expect.any(Object),
    );
  });

  it("loads special directory children lazily when expanded", async () => {
    invokeMock.mockImplementation(async (...args: any[]) => {
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

    fireEvent.doubleClick(screen.getByRole("button", { name: /node_modules/ }));
    expect(await screen.findByText("package.json")).toBeTruthy();
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_directory_children", {
      workspaceId: "workspace-1",
      path: "node_modules",
    });
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

    fireEvent.doubleClick(screen.getByRole("button", { name: /node_modules/ }));
    expect(await screen.findByRole("button", { name: /@babel/ })).toBeTruthy();

    fireEvent.doubleClick(screen.getByRole("button", { name: /@babel/ }));
    expect(await screen.findByRole("button", { name: /core/ })).toBeTruthy();

    fireEvent.doubleClick(screen.getByRole("button", { name: /core/ }));
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
    expect(screen.getByRole("button", { name: "files.newFile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "files.newFolder" })).toBeTruthy();
    expect(deleteButton).toBeTruthy();
    expect(deleteButton.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "README.md" }));
    expect(deleteButton.disabled).toBe(false);
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("trash_workspace_item", {
        workspaceId: "workspace-1",
        path: "README.md",
      });
    });
    expect(onRefreshFiles).toHaveBeenCalledTimes(1);
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

    fireEvent.click(screen.getByRole("button", { name: /src/ }));
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

    fireEvent.doubleClick(screen.getByRole("button", { name: /src/ }));
    fireEvent.click(screen.getByRole("button", { name: "index.ts" }));
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

    fireEvent.doubleClick(screen.getByRole("button", { name: /node_modules/ }));
    expect(await screen.findByRole("button", { name: "加载失败，点击重试" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "加载失败，点击重试" }));
    await waitFor(() => {
      expect(screen.getByText("package-lock.json")).toBeTruthy();
    });
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

    const mentionButton = container.querySelector(".file-tree-action") as HTMLButtonElement | null;
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

    const readme = screen.getByRole("button", { name: "README.md" });
    const pkg = screen.getByRole("button", { name: "package.json" });
    fireEvent.click(readme);
    fireEvent.click(pkg, { ctrlKey: true });

    const setData = vi.fn();
    const dataTransfer = {
      setData,
      effectAllowed: "",
    };

    fireEvent.dragStart(pkg, { dataTransfer });

    const payloadJson = setData.mock.calls.find(
      (call) => call[0] === "application/x-codemoss-file-paths",
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

    const readme = screen.getByRole("button", { name: "README.md" });
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

    const readme = screen.getByRole("button", { name: "README.md" });
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

    const readme = screen.getByRole("button", { name: "README.md" });
    fireEvent.dragStart(readme, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "" },
    });
    // Simulate runtime that doesn't provide usable drag-end location.
    fireEvent.dragEnd(readme, { clientX: 0, clientY: 0 });

    expect(handleFilePathFromJava).toHaveBeenCalledWith("/tmp/workspace/README.md");
    chatInput.remove();
  });
});
