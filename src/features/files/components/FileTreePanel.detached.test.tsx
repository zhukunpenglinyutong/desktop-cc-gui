// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT,
  DETACHED_FILE_TREE_DRAG_SNAPSHOT_STORAGE_KEY,
} from "../detachedFileTreeDragBridge";

const invokeMock = vi.fn(async (..._args: any[]) => null);
const emitToMock = vi.fn(async () => undefined);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (value: string) => value,
  invoke: (...args: any[]) => (invokeMock as any)(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: (...args: any[]) => (emitToMock as any)(...args),
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
  revealItemInDir: vi.fn(async () => undefined),
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
  window.localStorage.removeItem(DETACHED_FILE_TREE_DRAG_SNAPSHOT_STORAGE_KEY);
});

function getTreeItem(name: string | RegExp) {
  return screen.getByRole("treeitem", { name });
}

describe("FileTreePanel detached explorer action", () => {
  it("keeps the embedded panel available while exposing the detached explorer control", () => {
    const onOpenDetachedExplorer = vi.fn();

    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspaceName="workspace"
        workspacePath="/tmp/workspace"
        files={["src/index.ts"]}
        directories={["src"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
        gitignoredDirectories={new Set<string>()}
        onOpenSpecHub={() => undefined}
        onOpenDetachedExplorer={onOpenDetachedExplorer}
      />,
    );

    expect(screen.getByTitle("sidebar.specHub")).not.toBeNull();
    fireEvent.click(screen.getByTitle("files.openDetachedExplorer"));
    expect(onOpenDetachedExplorer).toHaveBeenCalledWith(null);
  });

  it("broadcasts detached tree drag paths to the main window", () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspaceName="workspace"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
        gitignoredDirectories={new Set<string>()}
        crossWindowDragTargetLabel="main"
      />,
    );

    fireEvent.dragStart(getTreeItem("README.md"), {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: "",
      },
    });

    expect(emitToMock).toHaveBeenCalledWith(
      "main",
      DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT,
      {
        type: "start",
        paths: ["/tmp/workspace/README.md"],
      },
    );
    const snapshot = window.localStorage.getItem(DETACHED_FILE_TREE_DRAG_SNAPSHOT_STORAGE_KEY);
    expect(snapshot).toContain("/tmp/workspace/README.md");
  });

  it("rebroadcasts detached drag payload during drag movement", async () => {
    render(
      <FileTreePanel
        workspaceId="workspace-1"
        workspaceName="workspace"
        workspacePath="/tmp/workspace"
        files={["README.md"]}
        isLoading={false}
        filePanelMode="files"
        onFilePanelModeChange={() => undefined}
        onOpenFile={() => undefined}
        openTargets={[]}
        openAppIconById={{}}
        selectedOpenAppId=""
        onSelectOpenAppId={() => undefined}
        gitStatusFiles={[]}
        gitignoredFiles={new Set<string>()}
        gitignoredDirectories={new Set<string>()}
        crossWindowDragTargetLabel="main"
      />,
    );

    const row = getTreeItem("README.md");
    fireEvent.dragStart(row, {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: "",
      },
    });
    emitToMock.mockClear();

    await new Promise((resolve) => setTimeout(resolve, 140));
    fireEvent.drag(row, {
      dataTransfer: {
        setData: vi.fn(),
        effectAllowed: "",
      },
    });

    expect(emitToMock).toHaveBeenCalledWith(
      "main",
      DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT,
      {
        type: "start",
        paths: ["/tmp/workspace/README.md"],
      },
    );
  });
});
