import type { GitFileEntry } from "@/lib/ipc";

export interface GitTreeDirNode {
  type: "dir";
  id: string;
  name: string;
  path: string;
  depth: number;
  children: GitTreeNode[];
  allPaths: string[];
}

export interface GitTreeFileNode {
  type: "file";
  id: string;
  name: string;
  path: string;
  depth: number;
  entry: GitFileEntry;
}

export type GitTreeNode = GitTreeDirNode | GitTreeFileNode;

interface RawDir {
  name: string;
  dirs: Map<string, RawDir>;
  files: GitFileEntry[];
}

function createRawDir(name = ""): RawDir {
  return { name, dirs: new Map(), files: [] };
}

/**
 * Builds a compact hierarchical tree from flat GitFileEntry items.
 * Single-child directory chains without intermediate files are collapsed (e.g. "src/features/git").
 */
export function buildGitTree(entries: GitFileEntry[], baseDepth = 0): GitTreeNode[] {
  if (entries.length === 0) return [];

  const root = createRawDir();

  for (const entry of entries) {
    const parts = entry.path.replace(/\\/g, "/").split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      let next = current.dirs.get(part);
      if (!next) {
        next = createRawDir(part);
        current.dirs.set(part, next);
      }
      current = next;
    }

    current.files.push(entry);
  }

  function convertDir(raw: RawDir, parentPath: string, depth: number): GitTreeNode[] {
    const result: GitTreeNode[] = [];

    // Sort directory names alphabetically
    const dirEntries = Array.from(raw.dirs.entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    for (const [name, subDir] of dirEntries) {
      let combinedName = name;
      let combinedDir = subDir;
      let currentPath = parentPath ? `${parentPath}/${name}` : name;

      // Collapse single-child directory chains
      while (combinedDir.dirs.size === 1 && combinedDir.files.length === 0) {
        const [nextName, nextDir] = combinedDir.dirs.entries().next().value as [string, RawDir];
        combinedName = `${combinedName}/${nextName}`;
        currentPath = `${currentPath}/${nextName}`;
        combinedDir = nextDir;
      }

      const children = convertDir(combinedDir, currentPath, depth + 1);
      const allPaths: string[] = [];
      for (const child of children) {
        if (child.type === "file") {
          allPaths.push(child.path);
        } else {
          allPaths.push(...child.allPaths);
        }
      }

      result.push({
        type: "dir",
        id: `dir:${currentPath}`,
        name: combinedName,
        path: currentPath,
        depth,
        children,
        allPaths,
      });
    }

    for (const file of raw.files) {
      const fileName = file.path.split(/[\\/]/).pop() ?? file.path;
      result.push({
        type: "file",
        id: `file:${file.path}`,
        name: fileName,
        path: file.path,
        depth,
        entry: file,
      });
    }

    return result;
  }

  return convertDir(root, "", baseDepth);
}

/**
 * Flattens tree nodes into a linear list respecting collapsed directory state.
 */
export function flattenGitTree(
  nodes: GitTreeNode[],
  collapsedDirIds: ReadonlySet<string>,
): GitTreeNode[] {
  const result: GitTreeNode[] = [];

  function walk(items: GitTreeNode[]) {
    for (const item of items) {
      result.push(item);
      if (item.type === "dir" && !collapsedDirIds.has(item.id)) {
        walk(item.children);
      }
    }
  }

  walk(nodes);
  return result;
}
