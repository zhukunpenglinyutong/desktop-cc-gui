import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { DirEntry } from "../../src/lib/ipc";
import { ipc } from "../../src/lib/ipc";
import { FilesPanel } from "../../src/features/files/FilesPanel";
import { fileTreeWorkspaceKey, useFilesStore } from "../../src/features/files/store";
import "../../src/index.css";
import "../../src/lib/i18n";

const A = "/fixture/tree-a";
const B = "/fixture/tree-b";
const dir = (name: string): DirEntry => ({ name, isDir: true, size: 0, mtimeMs: 0 });
const file = (name: string): DirEntry => ({ name, isDir: false, size: 1, mtimeMs: 0 });
const tree: Record<string, DirEntry[]> = {
  [A]: [dir("a"), dir("src"), dir(".github"), dir(".claude"), dir(".git"), dir("node_modules"), dir("dist"), dir("build"), dir("target"), file(".env"), file("README.md")],
  [`${A}/a`]: [dir("b"), file(".hidden")],
  [`${A}/a/b`]: [dir("c")],
  [`${A}/a/b/c`]: [file("leaf.ts")],
  [`${A}/src`]: [dir("generated"), dir("components"), file("trace.log")],
  [`${A}/src/generated`]: [file("out.ts")],
  [`${A}/src/components`]: [file("Widget.tsx")],
  [`${A}/.github`]: [file("workflow.yml")],
  [B]: [dir("src"), dir(".github"), file(".env"), file("trace.log")],
  [`${B}/src`]: [file("app.ts")],
  [`${B}/.github`]: [file("workflow.yml")],
};

if (new URLSearchParams(location.search).has("reset")) {
  localStorage.removeItem(fileTreeWorkspaceKey(A));
  localStorage.removeItem(fileTreeWorkspaceKey(B));
}

const reads: string[] = [];
ipc.listDir = async (path) => {
  reads.push(path);
  window.dispatchEvent(new Event("fixture-tree-read"));
  return tree[path] ?? [];
};
ipc.gitTreeStatus = async () => ({ repositories: [], fileColors: {} });

declare global {
  interface Window {
    __fileTreeFixture: {
      reads: string[];
      state: () => Pick<ReturnType<typeof useFilesStore.getState>, "root" | "expanded" | "filterConfig">;
    };
  }
}

window.__fileTreeFixture = {
  reads,
  state: () => {
    const { root, expanded, filterConfig } = useFilesStore.getState();
    return { root, expanded, filterConfig };
  },
};

function Fixture() {
  const [workspacePath, setWorkspacePath] = useState(A);
  const [readCount, setReadCount] = useState(0);
  const expanded = useFilesStore((s) => s.expanded);
  const filterConfig = useFilesStore((s) => s.filterConfig);
  useEffect(() => {
    const onRead = () => setReadCount(reads.length);
    window.addEventListener("fixture-tree-read", onRead);
    return () => window.removeEventListener("fixture-tree-read", onRead);
  }, []);
  return (
    <div className="flex h-screen flex-col bg-background-primary-default text-text-primary">
      <div className="flex shrink-0 gap-2 border-b border-border-button-default p-2">
        <button type="button" onClick={() => setWorkspacePath(A)}>工作区 A</button>
        <button type="button" onClick={() => setWorkspacePath(B)}>工作区 B</button>
      </div>
      <pre id="readout" className="fixed bottom-2 right-2 z-10 max-h-36 max-w-[60vw] overflow-auto rounded bg-background-primary-default p-2 text-xs shadow-dropdown">{JSON.stringify({ workspacePath, readCount, reads, expanded, filterConfig })}</pre>
      <div className="min-h-0 w-[360px] flex-1 border-r border-border-button-default">
        <FilesPanel workspacePath={workspacePath} />
      </div>
    </div>
  );
}

const fixtureRoot = createRoot(document.getElementById("fixture")!);
fixtureRoot.render(<Fixture />);
import.meta.hot?.dispose(() => fixtureRoot.unmount());
