import type { DirEntry } from "@/lib/ipc";

export interface FileTreeFilterConfig {
  ignorePatterns: string[];
  dotWhitelist: string[];
}

export const DEFAULT_FILE_TREE_FILTER: FileTreeFilterConfig = {
  ignorePatterns: [],
  dotWhitelist: [".github", ".claude"],
};

const BUILTIN_IGNORED = new Set(["node_modules", ".git", "dist", "build", "target"]);

export function parseFilterLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function compilePattern(raw: string) {
  const directoryOnly = raw.endsWith("/");
  const pattern = raw.replace(/\\/g, "/").replace(/^\//, "").replace(/\/$/, "");
  if (!pattern) return null;
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i++;
      }
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += "\\^$.*+?()[]{}|".includes(char) ? `\\${char}` : char;
  }
  return { regex: new RegExp(`^${source}$`), pathBased: pattern.includes("/"), directoryOnly };
}

export function createFileTreeFilter(root: string, config: FileTreeFilterConfig) {
  const ignored = config.ignorePatterns.map(compilePattern).filter((rule) => rule !== null);
  const allowed = config.dotWhitelist.map(compilePattern).filter((rule) => rule !== null);
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");

  return (dirPath: string, entry: DirEntry): boolean => {
    if (BUILTIN_IGNORED.has(entry.name)) return false;
    const normalizedDir = dirPath.replace(/\\/g, "/").replace(/\/$/, "");
    const relativeDir = normalizedDir === normalizedRoot
      ? ""
      : normalizedDir.slice(normalizedRoot.length + 1);
    const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const matches = (rule: NonNullable<ReturnType<typeof compilePattern>>) =>
      (!rule.directoryOnly || entry.isDir) && rule.regex.test(rule.pathBased ? relative : entry.name);
    if (ignored.some(matches)) return false;
    if (entry.name.startsWith(".") && !allowed.some(matches)) return false;
    return true;
  };
}
