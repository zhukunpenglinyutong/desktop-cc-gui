/**
 * Resolve WHICH Git repository the status-bar branch chip should track for a
 * file-tree selection.
 *
 * A workspace root may itself be a plain folder whose children are individual
 * repositories (a scratch/monorepo parent), and a selection can be any folder
 * or file inside one of them. Git IPC commands accept any path inside a
 * worktree, so once we know the repository root the whole git store just
 * re-keys on that path. We walk upward from the selected node and return the
 * deepest known repository root containing it, stopping at the workspace
 * boundary — ties at the boundary stay with the workspace status path.
 *
 * The walk starts at the selected path ITSELF: the tree's `selectPath` does
 * not record whether the node is a file or a directory (its `isDir` argument
 * is never passed by the tree), and a file path never equals a directory root
 * key, so testing the path itself is both correct and isDir-agnostic.
 */

/** Separator- and (Windows-only) case-insensitive key. Drive-letter paths
 * arrive from the picker with mixed `\`/`/` separators and inconsistent
 * drive-letter case; POSIX paths stay case-sensitive. */
function normalize(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(unified) ? unified.toLowerCase() : unified;
}

/** True when `pathOrDir` is `dir` itself or lives inside it. */
export function isWithinDirectory(dir: string, pathOrDir: string): boolean {
  const d = normalize(dir);
  const p = normalize(pathOrDir);
  return p === d || p.startsWith(d + "/");
}

/** Directory containing `path` (identity when already at a drive root). */
function parentDirectory(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

export interface RepositorySelectionInput {
  /** Selected tree node path (file or directory), or null. */
  selectedPath: string | null;
  /** Repository root paths (file store `repositories` keys). */
  repositoryRoots: readonly string[];
  /** Active workspace path — the primary root and the fallback Git path. */
  workspacePath: string;
  /** 工作区全部根（主目录在前、附加根在后）。缺省 = 仅主目录 `workspacePath`，
   *  与旧的单根行为完全一致。 */
  roots?: readonly string[];
}

/** The roots that bound the upward walk; defaults to the single primary. */
function boundaryRoots(input: RepositorySelectionInput): readonly string[] {
  return input.roots && input.roots.length > 0 ? input.roots : [input.workspacePath];
}

/**
 * The root (from `roots`, deepest first) that contains the selection, or null.
 * Used to decide which root's Git group a file-tree selection belongs to when
 * a workspace has multiple roots.
 */
export function resolveSelectedRoot(input: RepositorySelectionInput): string | null {
  const { selectedPath } = input;
  if (!selectedPath) return null;
  let best: string | null = null;
  for (const root of boundaryRoots(input)) {
    if (!isWithinDirectory(root, selectedPath)) continue;
    if (!best || normalize(root).length > normalize(best).length) best = root;
  }
  return best;
}

/**
 * Deepest repository root containing the selection, verbatim from
 * `repositoryRoots` (so it can be used as an IPC key). Null when nothing is
 * selected, the selection lies outside every root (stale tree state from
 * another workspace), or the deepest hit is a root itself — a root's own
 * repository status is what that root's default Git group already shows.
 */
export function resolveSelectedRepository(
  input: RepositorySelectionInput,
): string | null {
  const { selectedPath, repositoryRoots } = input;
  if (!selectedPath) return null;
  // Guard against stale tree state: the files store keeps the previous
  // workspace's selection until its panel re-mounts.
  const boundary = resolveSelectedRoot(input);
  if (boundary === null) return null;
  const roots: Record<string, string> = {};
  for (const p of repositoryRoots) roots[normalize(p)] = p;
  let candidate = selectedPath;
  let previous = "";
  while (isWithinDirectory(boundary, candidate)) {
    if (candidate !== previous) {
      const hit = roots[normalize(candidate)];
      if (hit && normalize(hit) !== normalize(boundary)) return hit;
      previous = candidate;
    }
    const next = parentDirectory(candidate);
    if (next === candidate) break;
    candidate = next;
  }
  return null;
}

/** Resolve the Git path used by a workspace-scoped surface. */
export function resolveWorkspaceRepository(input: RepositorySelectionInput): string {
  return resolveSelectedRepository(input) ?? input.workspacePath;
}
