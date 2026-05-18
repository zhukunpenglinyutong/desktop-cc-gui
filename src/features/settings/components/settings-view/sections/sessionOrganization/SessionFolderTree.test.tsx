// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  FolderProjection,
  FolderProjectionNode,
} from "./folderProjection";
import {
  SessionFolderTree,
  type SessionFolderSelection,
} from "./SessionFolderTree";

function makeNode(
  id: string,
  name: string,
  options: {
    directEntryCount?: number;
    children?: FolderProjectionNode[];
    parentId?: string | null;
  } = {},
): FolderProjectionNode {
  const children = options.children ?? [];
  const direct = options.directEntryCount ?? 0;
  const total =
    direct +
    children.reduce((acc, child) => acc + child.totalEntryCount, 0);
  return {
    folder: {
      id,
      workspaceId: "ws",
      parentId: options.parentId ?? null,
      name,
      createdAt: 1,
      updatedAt: 1,
    },
    children,
    directEntryCount: direct,
    directLatestUpdatedAt: null,
    totalEntryCount: total,
    totalLatestUpdatedAt: null,
  };
}

function makeProjection(roots: FolderProjectionNode[]): FolderProjection {
  const map = new Map<string, FolderProjectionNode>();
  const walk = (node: FolderProjectionNode) => {
    map.set(node.folder.id, node);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return {
    unfiledEntryCount: 0,
    unfiledLatestUpdatedAt: null,
    rootFolders: roots,
    folderById: map,
  };
}

function makeBaseProps() {
  return {
    selection: { kind: "unfiled" } as SessionFolderSelection,
    collapsedFolderIds: new Set<string>(),
    onSelectionChange: vi.fn(),
    onToggleCollapse: vi.fn(),
  };
}

describe("SessionFolderTree CRUD", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("hides the CRUD toolbar when no callbacks are wired", () => {
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        projection={makeProjection([])}
      />,
    );
    expect(
      screen.queryByTestId("session-organization-tree-add-root"),
    ).toBeNull();
  });

  it("opens the root editor and creates a folder with parentId=null", async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        projection={makeProjection([])}
        onCreateFolder={onCreateFolder}
      />,
    );
    fireEvent.click(screen.getByTestId("session-organization-tree-add-root"));
    const input = await screen.findByTestId(
      "session-organization-tree-editor-input",
    );
    fireEvent.change(input, { target: { value: "Research" } });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-editor-save"),
      );
    });
    expect(onCreateFolder).toHaveBeenCalledWith(null, "Research");
  });

  it("blocks save when the draft name is empty or whitespace-only", () => {
    const onCreateFolder = vi.fn();
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        projection={makeProjection([])}
        onCreateFolder={onCreateFolder}
      />,
    );
    fireEvent.click(screen.getByTestId("session-organization-tree-add-root"));
    fireEvent.change(
      screen.getByTestId("session-organization-tree-editor-input"),
      { target: { value: "   " } },
    );
    const save = screen.getByTestId(
      "session-organization-tree-editor-save",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(onCreateFolder).not.toHaveBeenCalled();
  });

  it("surfaces backend errors from onCreateFolder and keeps the editor open", async () => {
    const onCreateFolder = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        projection={makeProjection([])}
        onCreateFolder={onCreateFolder}
      />,
    );
    fireEvent.click(screen.getByTestId("session-organization-tree-add-root"));
    fireEvent.change(
      screen.getByTestId("session-organization-tree-editor-input"),
      { target: { value: "x" } },
    );
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-editor-save"),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-tree-action-error").textContent,
      ).toContain("boom"),
    );
    expect(
      screen.getByTestId("session-organization-tree-editor-input"),
    ).toBeTruthy();
  });

  it("creates a subfolder under the selected folder via the toolbar add button", async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    const nodes = [makeNode("alpha", "Alpha")];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        projection={makeProjection(nodes)}
        onCreateFolder={onCreateFolder}
      />,
    );
    fireEvent.click(screen.getByTestId("session-organization-tree-add-root"));
    fireEvent.change(
      screen.getByTestId("session-organization-tree-editor-input"),
      { target: { value: "Child" } },
    );
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-editor-save"),
      );
    });
    expect(onCreateFolder).toHaveBeenCalledWith("alpha", "Child");
  });

  it("renames the selected folder via the toolbar rename button", async () => {
    const onRenameFolder = vi.fn().mockResolvedValue(undefined);
    const nodes = [makeNode("alpha", "Alpha")];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        projection={makeProjection(nodes)}
        onRenameFolder={onRenameFolder}
      />,
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-rename-selected"),
    );
    const input = (await screen.findByTestId(
      "session-organization-tree-editor-input",
    )) as HTMLInputElement;
    expect(input.value).toBe("Alpha");
    fireEvent.change(input, { target: { value: "Renamed" } });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-editor-save"),
      );
    });
    expect(onRenameFolder).toHaveBeenCalledWith("alpha", "Renamed");
  });

  it("disables rename save with whitespace-only name", () => {
    const onRenameFolder = vi.fn();
    const nodes = [makeNode("alpha", "Alpha")];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        projection={makeProjection(nodes)}
        onRenameFolder={onRenameFolder}
      />,
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-rename-selected"),
    );
    fireEvent.change(
      screen.getByTestId("session-organization-tree-editor-input"),
      { target: { value: "   " } },
    );
    const save = screen.getByTestId(
      "session-organization-tree-editor-save",
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(onRenameFolder).not.toHaveBeenCalled();
  });

  it("opens delete dialog with cascade option for a non-empty folder", () => {
    const onDeleteFolder = vi.fn();
    const nodes = [makeNode("alpha", "Alpha", { directEntryCount: 2 })];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        projection={makeProjection(nodes)}
        onDeleteFolder={onDeleteFolder}
      />,
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-delete-selected"),
    );
    expect(
      screen.getByTestId("session-organization-tree-delete-dialog"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("session-organization-tree-delete-dialog-cascade"),
    ).toBeTruthy();
    expect(onDeleteFolder).not.toHaveBeenCalled();
  });

  it("opens delete dialog with cascade option when the folder has subfolders even when empty", () => {
    const onDeleteFolder = vi.fn();
    const child = makeNode("child", "Child");
    const nodes = [makeNode("alpha", "Alpha", { children: [child] })];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        projection={makeProjection(nodes)}
        onDeleteFolder={onDeleteFolder}
      />,
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-delete-selected"),
    );
    expect(
      screen.getByTestId("session-organization-tree-delete-dialog-cascade"),
    ).toBeTruthy();
    expect(onDeleteFolder).not.toHaveBeenCalled();
  });

  it("deletes an empty folder after confirming in the dialog", async () => {
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    const nodes = [makeNode("empty", "Empty")];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "empty" }}
        projection={makeProjection(nodes)}
        onDeleteFolder={onDeleteFolder}
      />,
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-delete-selected"),
    );
    expect(onDeleteFolder).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("session-organization-tree-delete-dialog-cascade"),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-delete-dialog-confirm"),
      );
    });
    expect(onDeleteFolder).toHaveBeenCalledWith("empty", false);
  });

  it("displays errors thrown by onDeleteFolder in the dialog", async () => {
    const onDeleteFolder = vi.fn().mockRejectedValue(new Error("nope"));
    const nodes = [makeNode("empty", "Empty")];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "empty" }}
        projection={makeProjection(nodes)}
        onDeleteFolder={onDeleteFolder}
      />,
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-delete-selected"),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-delete-dialog-confirm"),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-tree-delete-dialog-error")
          .textContent,
      ).toContain("nope"),
    );
  });

  it("passes cascade=true when the cascade checkbox is checked", async () => {
    const onDeleteFolder = vi.fn().mockResolvedValue(undefined);
    const nodes = [makeNode("alpha", "Alpha", { directEntryCount: 3 })];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        projection={makeProjection(nodes)}
        onDeleteFolder={onDeleteFolder}
      />,
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-delete-selected"),
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-delete-dialog-cascade"),
    );
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-delete-dialog-confirm"),
      );
    });
    expect(onDeleteFolder).toHaveBeenCalledWith("alpha", true);
  });

  it("auto-expands a collapsed selected folder when creating a subfolder under it", () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    const onToggleCollapse = vi.fn();
    const child = makeNode("child", "Child");
    const nodes = [makeNode("alpha", "Alpha", { children: [child] })];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        onToggleCollapse={onToggleCollapse}
        collapsedFolderIds={new Set(["alpha"])}
        projection={makeProjection(nodes)}
        onCreateFolder={onCreateFolder}
      />,
    );
    fireEvent.click(screen.getByTestId("session-organization-tree-add-root"));
    expect(onToggleCollapse).toHaveBeenCalledWith("alpha");
  });
});

describe("SessionFolderTree contextual top button / breadcrumb / batch collapse", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("reflects the current selection on the top create button via data-context", () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    const nodes = [makeNode("alpha", "Alpha")];

    const { rerender } = render(
      <SessionFolderTree
        {...makeBaseProps()}
        projection={makeProjection(nodes)}
        onCreateFolder={onCreateFolder}
      />,
    );
    expect(
      screen
        .getByTestId("session-organization-tree-add-root")
        .getAttribute("data-context"),
    ).toBe("unfiled");

    rerender(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        projection={makeProjection(nodes)}
        onCreateFolder={onCreateFolder}
      />,
    );
    expect(
      screen
        .getByTestId("session-organization-tree-add-root")
        .getAttribute("data-context"),
    ).toBe("folder");
  });

  it("creates a child under the selected folder via the contextual top button", async () => {
    const onCreateFolder = vi.fn().mockResolvedValue(undefined);
    const nodes = [makeNode("alpha", "Alpha")];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "alpha" }}
        projection={makeProjection(nodes)}
        onCreateFolder={onCreateFolder}
      />,
    );
    fireEvent.click(screen.getByTestId("session-organization-tree-add-root"));
    fireEvent.change(
      screen.getByTestId("session-organization-tree-editor-input"),
      { target: { value: "Child" } },
    );
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-editor-save"),
      );
    });
    expect(onCreateFolder).toHaveBeenCalledWith("alpha", "Child");
  });

  it("toggle-all expands every folder when at least one folder is collapsed", () => {
    const onSetCollapsedFolderIds = vi.fn();
    const beta = makeNode("beta", "Beta", { parentId: "alpha" });
    const alpha = makeNode("alpha", "Alpha", { children: [beta] });
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        collapsedFolderIds={new Set(["alpha"])}
        projection={makeProjection([alpha])}
        onCreateFolder={vi.fn()}
        onSetCollapsedFolderIds={onSetCollapsedFolderIds}
      />,
    );
    const toggle = screen.getByTestId("session-organization-tree-toggle-all");
    expect(toggle.getAttribute("data-state")).toBe("expand");
    fireEvent.click(toggle);
    expect(onSetCollapsedFolderIds).toHaveBeenCalledTimes(1);
    const replacement = onSetCollapsedFolderIds.mock
      .calls[0][0] as ReadonlySet<string>;
    expect(replacement.size).toBe(0);
  });

  it("toggle-all collapses every folder when nothing is collapsed", () => {
    const onSetCollapsedFolderIds = vi.fn();
    const gamma = makeNode("gamma", "Gamma", { parentId: "beta" });
    const beta = makeNode("beta", "Beta", {
      parentId: "alpha",
      children: [gamma],
    });
    const alpha = makeNode("alpha", "Alpha", { children: [beta] });
    const delta = makeNode("delta", "Delta");
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        projection={makeProjection([alpha, delta])}
        onCreateFolder={vi.fn()}
        onSetCollapsedFolderIds={onSetCollapsedFolderIds}
      />,
    );
    const toggle = screen.getByTestId("session-organization-tree-toggle-all");
    expect(toggle.getAttribute("data-state")).toBe("collapse");
    fireEvent.click(toggle);
    expect(onSetCollapsedFolderIds).toHaveBeenCalledTimes(1);
    const replacement = onSetCollapsedFolderIds.mock
      .calls[0][0] as ReadonlySet<string>;
    expect(Array.from(replacement).sort()).toEqual(["alpha", "beta"]);
  });

  it("hides toggle-all when onSetCollapsedFolderIds is not wired", () => {
    const nodes = [makeNode("alpha", "Alpha")];
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        projection={makeProjection(nodes)}
        onCreateFolder={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId("session-organization-tree-toggle-all"),
    ).toBeNull();
  });

  it("renders a breadcrumb covering the full path of the current selection", () => {
    const gamma = makeNode("gamma", "Gamma", { parentId: "beta" });
    const beta = makeNode("beta", "Beta", {
      parentId: "alpha",
      children: [gamma],
    });
    const alpha = makeNode("alpha", "Alpha", { children: [beta] });
    render(
      <SessionFolderTree
        {...makeBaseProps()}
        selection={{ kind: "folder", folderId: "gamma" }}
        projection={makeProjection([alpha])}
      />,
    );
    const breadcrumb = screen.getByTestId(
      "session-organization-tree-breadcrumb",
    );
    expect(breadcrumb.textContent).toContain("Alpha");
    expect(breadcrumb.textContent).toContain("Beta");
    expect(breadcrumb.textContent).toContain("Gamma");
  });
});
