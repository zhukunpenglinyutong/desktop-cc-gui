/** Compare recorded cwd and picker paths without changing the cwd used to
 * resume a session. Windows spellings can differ across CLI and native APIs;
 * POSIX/remote paths retain their case-sensitive identity. */
export function sameWorkspacePath(left: string, right: string): boolean {
  if (left === right) return true;
  const windows = /^(?:[a-z]:[\\/]|\\\\)/i;
  if (!windows.test(left) || !windows.test(right)) return false;
  const key = (path: string) => path.replace(/\\/g, "/")
    .replace(/^\/\/\?\/UNC\//i, "//")
    .replace(/^\/\/\?\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
  return key(left) === key(right);
}
