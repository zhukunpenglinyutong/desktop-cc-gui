import { useEffect, useMemo, useRef } from "react";
import { measureElement as defaultMeasureElement, useVirtualizer } from "@tanstack/react-virtual";
import type { DirEntry, RepositorySummary } from "@/lib/ipc";
import { fileName, joinPath, useFilesStore } from "./store";
import { createFileTreeFilter } from "./file-tree-filter";
import type { VisibleNode } from "./FileTreeRow";

export function compactFolder(
  dirPath: string,
  entry: DirEntry,
  children: Record<string, DirEntry[]>,
  repositories: Record<string, RepositorySummary>,
  loadingDirs: Record<string, true>,
  dirErrors: Record<string, string>,
  isVisible: (dirPath: string, entry: DirEntry) => boolean = () => true,
) {
  let path = joinPath(dirPath, entry.name);
  let name = entry.name;
  const paths = [path];
  if (entry.isDir) {
    while (!repositories[path] && !loadingDirs[path] && !dirErrors[path]) {
      const soleChild = children[path]?.filter((child) => isVisible(path, child));
      if (soleChild?.length !== 1 || !soleChild[0].isDir) break;
      name += `/${soleChild[0].name}`;
      path = joinPath(path, soleChild[0].name);
      paths.push(path);
    }
  }
  return { path, name, paths };
}

/**
 * Flattens the expanded store tree into the visible row list and owns the
 * virtualizer that renders it, including the root-load effect and the
 * hidden-panel scroll/measure safeguards.
 */
export function useFileTreeVirtualList() {
  const root = useFilesStore((s) => s.root);
  const children = useFilesStore((s) => s.children);
  const expanded = useFilesStore((s) => s.expanded);
  const loadingDirs = useFilesStore((s) => s.loadingDirs);
  const dirErrors = useFilesStore((s) => s.dirErrors);
  const repositories = useFilesStore((s) => s.repositories);
  const fileColors = useFilesStore((s) => s.fileColors);
  const filterConfig = useFilesStore((s) => s.filterConfig);
  const ensureDir = useFilesStore((s) => s.ensureDir);
  const isVisible = useMemo(() => createFileTreeFilter(root, filterConfig), [root, filterConfig]);

  // The root is read even when the user left its row collapsed.
  useEffect(() => {
    if (root) void ensureDir(root);
  }, [root, ensureDir]);

  // Restore only previously expanded paths that are still reachable and
  // visible. Each successful level lets this effect discover the next one.
  useEffect(() => {
    if (!root || !expanded[root]) return;
    const visit = (dir: string) => {
      for (const entry of children[dir] ?? []) {
        if (!entry.isDir || !isVisible(dir, entry)) continue;
        const path = joinPath(dir, entry.name);
        if (!expanded[path]) continue;
        if (children[path]) visit(path);
        else if (!loadingDirs[path] && !dirErrors[path]) void ensureDir(path);
      }
    };
    visit(root);
  }, [root, expanded, children, loadingDirs, dirErrors, isVisible, ensureDir]);


  const visible = useMemo<VisibleNode[]>(() => {
    const out: VisibleNode[] = [];
    // Synthetic root row: the workspace root itself is the first tree row
    // with its repository badge (`open-reverselab main M1 ?12`); clicking
    // it expands the tree below it.
    if (root) {
      out.push({
        name: fileName(root),
        isDir: true,
        size: 0,
        mtimeMs: 0,
        path: root,
        depth: 0,
        expanded: !!expanded[root],
        loading: !!loadingDirs[root],
        repository: repositories[root],
        // Repo-root rows are blue (the workspace repo root row here; nested
        // repo dirs get theirs from the backend color pass).
        color: repositories[root] ? "repository" : undefined,
      });
    }
    const walk = (dirPath: string, depth: number) => {
      const entries = children[dirPath];
      if (!entries) return;
      for (const e of entries) {
        if (!isVisible(dirPath, e)) continue;
        // Only combine known single-child levels. A click loads the next
        // level; no speculative walk of the filesystem is needed.
        const { path, name, paths: compactPaths } = compactFolder(
          dirPath, e, children, repositories, loadingDirs, dirErrors, isVisible,
        );
        const isExpanded = compactPaths.every((part) => !!expanded[part]);
        out.push({
          ...e,
          name,
          path,
          compactPaths: compactPaths.length > 1 ? compactPaths : undefined,
          depth,
          expanded: e.isDir && isExpanded,
          loading: e.isDir && !!loadingDirs[path],
          repository: e.isDir ? repositories[path] : undefined,
          // Plain folders never carry color; files take their git state;
          // nested repo dirs take their own repo's status color from the
          // backend. Blue stays exclusive to the workspace root row.
          color: fileColors[dirPath]?.[e.name],
        });
        // Only already-expanded levels are walked — the tree never loads
        // recursively; each expansion triggers exactly one listDir call.
        if (e.isDir && isExpanded) walk(path, depth + 1);
      }
    };
    if (root && expanded[root]) walk(root, 1);
    return out;
  }, [children, expanded, loadingDirs, dirErrors, repositories, fileColors, root, isVisible]);

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 28,
    overscan: 10,
    // Rows are recreated on every store update; key measurements by path so
    // expand/collapse/refresh never reassigns a cached size to the wrong row.
    getItemKey: (index) => visible[index]?.path ?? index,
    // ChatPage keeps this panel mounted under `display: none` while the
    // changes tab is active, and ResizeObserver then reports every rendered
    // row as 0px tall. virtual-core has no zero-size guard: accepting those
    // entries poisons itemSizeCache and fires phantom scroll adjustments
    // (writes dropped on the box-less scroller while scrollOffset eagerly
    // drifts), which can leave the virtualizer scrolled past real rows — a
    // blank band at the top of the tree. Keep the last known height instead.
    measureElement: (el, entry, instance) => {
      const size = defaultMeasureElement(el, entry, instance);
      if (size > 0) return size;
      const index = instance.indexFromElement(el);
      return (
        instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? 28
      );
    },
  });

  // Safety net for the same hidden→shown transition: if the DOM scroll
  // position and the virtualizer's offset still diverge (WKWebView restores
  // scrollTop without a scroll event), re-sync through the virtualizer's own
  // scroll pipeline. The synthetic event is a no-op when already in sync
  // (virtual-core's spurious-event guard).
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    let lastHeight = el.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const height = el.getBoundingClientRect().height;
      if (lastHeight === 0 && height > 0) el.dispatchEvent(new Event("scroll"));
      lastHeight = height;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { parentRef, virtualizer, visible };
}
