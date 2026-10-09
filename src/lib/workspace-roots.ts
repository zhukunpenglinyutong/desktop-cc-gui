/**
 * 工作区多目录（多根）的根列表工具。
 *
 * 主目录恒为工作区的 `path`（首个根，固定），附加根（`Workspace.roots`）
 * 依次排在其后。单目录工作区只会得到 `[主目录]`，因此调用方按列表渲染时
 * 与旧的单根行为完全一致。
 */

/** 主目录在前、附加根在后：去空白、去重（保序）。 */
export function workspaceRootList(
  primary: string,
  extras?: readonly string[] | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [primary, ...(extras ?? [])]) {
    const path = raw?.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
