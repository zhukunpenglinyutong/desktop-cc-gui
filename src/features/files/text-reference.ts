import type { EditorState } from "@codemirror/state";

export interface FileLineRange {
  from: number;
  to: number;
}

export function isTextReferencePath(path: string): boolean {
  // Windows normalizes trailing spaces and dots in path segments.
  return !/[\\\u0000-\u001f]/.test(path) &&
    path.split("/").every((part) => part !== "" && !/^[. ]+$/.test(part));
}

export function formatTextReference(path: string, state: EditorState): string | null {
  const { from, to, empty } = state.selection.main;
  if (empty || !isTextReferencePath(path)) return null;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to - 1).number;
  const text = state.sliceDoc(from, to);
  const lines = first === last ? `#L${first}` : `#L${first}-L${last}`;
  return `./${path}${lines}\n${text.split("\n").map((line) => `> ${line}`).join("\n")}`;
}

export function parseTextReferenceLocation(line: string) {
  const match = /^\.\/(.+)#L([1-9]\d*)(?:-L([1-9]\d*))?$/.exec(line);
  if (!match) return null;
  const [, path, first, last = first] = match;
  if (!isTextReferencePath(path)) return null;
  const from = Number(first);
  const to = Number(last);
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to < from) return null;
  return { path, from, to };
}
