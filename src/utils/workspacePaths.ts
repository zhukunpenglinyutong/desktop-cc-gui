function stripRelativePrefix(path: string) {
  return path.replace(/^\.\/+/, "");
}

export function normalizeFsPath(path: string) {
  try {
    return decodeURIComponent(path)
      .replace(/\\/g, "/")
      .replace(/^\/([a-zA-Z]:\/)/, "$1")
      .replace(/\/+$/, "");
  } catch {
    return path
      .replace(/\\/g, "/")
      .replace(/^\/([a-zA-Z]:\/)/, "$1")
      .replace(/\/+$/, "");
  }
}

export function isLikelyWindowsFsPath(path: string) {
  return /^[a-zA-Z]:\//.test(path) || path.startsWith("//");
}

export function normalizeComparablePath(path: string, caseInsensitive: boolean) {
  const normalized = normalizeFsPath(path);
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

export function resolveWorkspaceRelativePath(
  workspacePath: string | null | undefined,
  path: string,
) {
  const normalizedPath = normalizeFsPath(path).trim();
  if (!workspacePath) {
    return stripRelativePrefix(normalizedPath);
  }
  const normalizedWorkspace = normalizeFsPath(workspacePath).replace(/\/+$/, "");
  if (!normalizedWorkspace) {
    return stripRelativePrefix(normalizedPath);
  }

  const caseInsensitive = isLikelyWindowsFsPath(normalizedWorkspace);
  const comparablePath = normalizeComparablePath(normalizedPath, caseInsensitive);
  const comparableWorkspace = normalizeComparablePath(
    normalizedWorkspace,
    caseInsensitive,
  );
  if (comparablePath === comparableWorkspace) {
    return "";
  }
  if (comparablePath.startsWith(`${comparableWorkspace}/`)) {
    return normalizedPath.slice(normalizedWorkspace.length + 1);
  }
  return stripRelativePrefix(normalizedPath);
}

export function resolveDiffPathFromWorkspacePath(
  rawPath: string,
  availablePaths: string[],
  workspacePath: string | null | undefined,
) {
  const normalizedInput = normalizeFsPath(rawPath).trim();
  const normalizedWorkspace = workspacePath
    ? normalizeFsPath(workspacePath).replace(/\/+$/, "")
    : "";
  const caseInsensitive = isLikelyWindowsFsPath(normalizedWorkspace);
  const comparableAvailable = new Map(
    availablePaths.map((path) => [
      normalizeComparablePath(path, caseInsensitive),
      path,
    ]),
  );

  const candidates = new Set<string>([
    stripRelativePrefix(normalizedInput),
    resolveWorkspaceRelativePath(workspacePath, normalizedInput),
  ]);
  if (normalizedInput.startsWith("/")) {
    candidates.add(normalizedInput.slice(1));
  }

  for (const candidate of candidates) {
    const matched = comparableAvailable.get(
      normalizeComparablePath(candidate, caseInsensitive),
    );
    if (matched) {
      return matched;
    }
  }

  for (const candidate of candidates) {
    const comparableCandidate = normalizeComparablePath(candidate, caseInsensitive);
    const suffixMatch = availablePaths.find((path) =>
      normalizeComparablePath(path, caseInsensitive).endsWith(`/${comparableCandidate}`),
    );
    if (suffixMatch) {
      return suffixMatch;
    }
  }

  const inputBaseName = normalizedInput.split("/").pop() ?? normalizedInput;
  const sameNamePaths = availablePaths.filter((path) => {
    const baseName = path.split("/").pop() ?? path;
    return normalizeComparablePath(baseName, caseInsensitive) ===
      normalizeComparablePath(inputBaseName, caseInsensitive);
  });
  if (sameNamePaths.length === 1) {
    return sameNamePaths[0];
  }

  return resolveWorkspaceRelativePath(workspacePath, normalizedInput);
}

function normalizeExtendedFsPath(path: string) {
  const normalized = normalizeFsPath(path).trim();
  if (normalized.startsWith("//?/UNC/")) {
    return `//${normalized.slice("//?/UNC/".length)}`;
  }
  if (normalized.startsWith("//?/")) {
    return normalized.slice("//?/".length);
  }
  return normalized;
}

function normalizeRootPath(path: string | null | undefined) {
  if (!path) {
    return "";
  }
  return normalizeExtendedFsPath(path).replace(/\/+$/, "");
}

function isLikelyAbsoluteFsPath(path: string) {
  if (!path) {
    return false;
  }
  if (path.startsWith("/")) {
    return true;
  }
  if (/^[a-zA-Z]:\//.test(path)) {
    return true;
  }
  if (path.startsWith("//")) {
    return true;
  }
  return false;
}

function isPathInsideRoot(path: string, root: string, caseInsensitive: boolean) {
  const comparablePath = normalizeComparablePath(path, caseInsensitive);
  const comparableRoot = normalizeComparablePath(root, caseInsensitive);
  if (comparablePath === comparableRoot) {
    return true;
  }
  return comparablePath.startsWith(`${comparableRoot}/`);
}

type WorkspaceFileReadTarget = {
  domain: "workspace";
  normalizedInputPath: string;
  workspaceRelativePath: string;
};

type ExternalSpecFileReadTarget = {
  domain: "external-spec";
  normalizedInputPath: string;
  workspaceRelativePath: string;
  externalSpecLogicalPath: string;
};

type UnsupportedExternalFileReadTarget = {
  domain: "unsupported-external";
  normalizedInputPath: string;
  workspaceRelativePath: string;
};

export type FileReadTarget =
  | WorkspaceFileReadTarget
  | ExternalSpecFileReadTarget
  | UnsupportedExternalFileReadTarget;

export function resolveFileReadTarget(
  workspacePath: string | null | undefined,
  inputPath: string,
  customSpecRoot?: string | null,
): FileReadTarget {
  const normalizedInputPath = normalizeExtendedFsPath(inputPath);
  const workspaceRelativePath = resolveWorkspaceRelativePath(
    workspacePath,
    normalizedInputPath,
  );
  const normalizedWorkspaceRoot = normalizeRootPath(workspacePath);
  if (normalizedWorkspaceRoot) {
    const workspaceCaseInsensitive = isLikelyWindowsFsPath(normalizedWorkspaceRoot);
    if (
      isPathInsideRoot(
        normalizedInputPath,
        normalizedWorkspaceRoot,
        workspaceCaseInsensitive,
      )
    ) {
      return {
        domain: "workspace",
        normalizedInputPath,
        workspaceRelativePath,
      };
    }
  }

  const normalizedSpecRoot = normalizeRootPath(customSpecRoot);
  if (normalizedSpecRoot) {
    const specCaseInsensitive = isLikelyWindowsFsPath(normalizedSpecRoot);
    if (isPathInsideRoot(normalizedInputPath, normalizedSpecRoot, specCaseInsensitive)) {
      const suffix = normalizedInputPath.slice(normalizedSpecRoot.length).replace(/^\/+/, "");
      let externalSpecLogicalPath = "openspec";
      if (suffix) {
        const normalizedSuffix = suffix.toLowerCase();
        if (normalizedSuffix === "openspec") {
          externalSpecLogicalPath = "openspec";
        } else if (normalizedSuffix.startsWith("openspec/")) {
          externalSpecLogicalPath = `openspec/${suffix.slice("openspec/".length)}`;
        } else {
          externalSpecLogicalPath = `openspec/${suffix}`;
        }
      }
      return {
        domain: "external-spec",
        normalizedInputPath,
        workspaceRelativePath,
        externalSpecLogicalPath,
      };
    }
  }

  if (isLikelyAbsoluteFsPath(normalizedInputPath)) {
    return {
      domain: "unsupported-external",
      normalizedInputPath,
      workspaceRelativePath,
    };
  }

  return {
    domain: "workspace",
    normalizedInputPath,
    workspaceRelativePath,
  };
}
