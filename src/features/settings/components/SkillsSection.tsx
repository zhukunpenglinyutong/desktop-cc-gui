import { convertFileSrc } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import BadgeInfo from "lucide-react/dist/esm/icons/badge-info";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import FileCode2 from "lucide-react/dist/esm/icons/file-code-2";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Folder from "lucide-react/dist/esm/icons/folder";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import HardDrive from "lucide-react/dist/esm/icons/hard-drive";
import Image from "lucide-react/dist/esm/icons/image";
import PencilLine from "lucide-react/dist/esm/icons/pencil-line";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Save from "lucide-react/dist/esm/icons/save";
import Search from "lucide-react/dist/esm/icons/search";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  listExternalAbsoluteDirectoryChildren,
  readExternalAbsoluteFile,
  writeExternalAbsoluteFile,
} from "../../../services/tauri";
import type { AppSettings, SkillOption, WorkspaceInfo } from "../../../types";
import { highlightLine, languageFromPath } from "../../../utils/syntax";
import { FileMarkdownPreview } from "../../files/components/FileMarkdownPreview";
import {
  FileStructuredPreview,
  resolveStructuredPreviewKind,
} from "../../files/components/FileStructuredPreview";
import { useSkills } from "../../skills/hooks/useSkills";
import {
  isGlobalManagedInstructionSource,
  normalizeManagedInstructionSource,
} from "../../skills/utils/managedInstructionSource";

type SkillsSectionProps = {
  activeWorkspace: WorkspaceInfo | null;
  embedded?: boolean;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

type GlobalEngine = "claude" | "code" | "gemini" | "agents" | "custom";
type SelectedNodeKind = "dir" | "file" | null;

type EngineConfig = {
  sourcePrefixes: string[];
  pathMarkers: string[];
  globalDir: string;
};

type SkillFileTreeEntry = {
  name: string;
  path: string;
  kind: "dir" | "file";
  isSkillRoot: boolean;
};

const SKILLS_TREE_MIN_WIDTH = 240;
const SKILLS_TREE_DEFAULT_WIDTH = 340;
const SKILLS_TREE_MAX_WIDTH = 560;
const SKILLS_TREE_COLLAPSE_THRESHOLD = 120;
const SKILLS_TREE_SPLITTER_WIDTH = 6;

const markdownExtensions = new Set(["md", "mdx"]);
const imageExtensions = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "bmp", "heic", "heif", "tif", "tiff", "ico",
]);

const ENGINE_ORDER: GlobalEngine[] = ["claude", "code", "gemini", "agents", "custom"];
const ENGINE_CONFIGS: Record<GlobalEngine, EngineConfig> = {
  claude: {
    sourcePrefixes: ["global_claude", "global_claude_plugin"],
    pathMarkers: ["/.claude/skills", "/.claude/plugins/cache"],
    globalDir: ".claude/skills",
  },
  code: {
    sourcePrefixes: ["global_codex", "global_code"],
    pathMarkers: ["/.codex/skills"],
    globalDir: ".codex/skills",
  },
  gemini: {
    sourcePrefixes: ["global_gemini"],
    pathMarkers: ["/.gemini/skills"],
    globalDir: ".gemini/skills",
  },
  agents: {
    sourcePrefixes: ["global_agents"],
    pathMarkers: ["/.agents/skills"],
    globalDir: ".agents/skills",
  },
  custom: {
    sourcePrefixes: ["custom"],
    pathMarkers: [],
    globalDir: "custom",
  },
};

function normalizeText(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePathKey(path: unknown) {
  return normalizeText(path).replace(/\\/g, "/");
}

function normalizeFsPath(path: unknown) {
  return String(path ?? "").trim().replace(/\\/g, "/");
}

function normalizeCustomSkillDirectories(value: readonly string[] | undefined) {
  const seen = new Set<string>();
  const directories: string[] = [];
  for (const item of value ?? []) {
    const normalized = String(item ?? "").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    directories.push(normalized);
  }
  return directories;
}

function normalizeWorkspacePath(workspacePath?: string | null) {
  const normalized = normalizePathKey(workspacePath ?? "");
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function isGlobalSkill(skill: SkillOption, workspacePath?: string | null) {
  const source = normalizeManagedInstructionSource(skill.source);
  if (source === "custom") {
    return true;
  }
  if (isGlobalManagedInstructionSource(source)) {
    return true;
  }
  if (source.startsWith("project_") || source === "workspace_managed") {
    return false;
  }
  const path = normalizePathKey(skill.path);
  const normalizedWorkspacePath = normalizeWorkspacePath(workspacePath);
  if (normalizedWorkspacePath && path.startsWith(normalizedWorkspacePath)) {
    return false;
  }
  return (
    path.includes("/.claude/skills") ||
    path.includes("/.codex/skills") ||
    path.includes("/.gemini/skills") ||
    path.includes("/.agents/skills")
  );
}

function matchesEngine(
  skill: SkillOption,
  engine: GlobalEngine,
  customSkillDirectories: readonly string[] = [],
) {
  const config = ENGINE_CONFIGS[engine];
  const source = normalizeManagedInstructionSource(skill.source);
  if (engine === "custom") {
    if (source === "custom") {
      return true;
    }
    const path = normalizePathKey(skill.path);
    return customSkillDirectories.some((directory) => {
      const root = normalizePathKey(directory).replace(/\/+$/, "");
      return root ? path === root || path.startsWith(`${root}/`) : false;
    });
  }
  if (source === "custom") {
    return false;
  }
  if (config.sourcePrefixes.some((prefix) => source.startsWith(prefix))) {
    return true;
  }
  const path = normalizePathKey(skill.path);
  return config.pathMarkers.some((marker) => path.includes(marker));
}

function pathBaseName(path: string) {
  const normalized = normalizeFsPath(path).replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? normalized;
}

function pathParent(path: string) {
  const normalized = normalizeFsPath(path).replace(/\/+$/, "");
  if (!normalized) {
    return "";
  }
  const index = normalized.lastIndexOf("/");
  if (index < 0) {
    return "";
  }
  if (index === 0) {
    return "/";
  }
  return normalized.slice(0, index);
}

function extractEngineRootFromSkillPath(skillPath: string, engine: GlobalEngine) {
  const normalized = normalizeFsPath(skillPath);
  const lowered = normalized.toLowerCase();
  for (const marker of ENGINE_CONFIGS[engine].pathMarkers) {
    const markerLowered = marker.toLowerCase();
    const index = lowered.lastIndexOf(markerLowered);
    if (index >= 0) {
      return normalized.slice(0, index + markerLowered.length);
    }
  }
  return null;
}

function isMarkdownPath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return markdownExtensions.has(ext);
}

function isImagePath(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return imageExtensions.has(ext);
}

function sortTreeEntries(entries: SkillFileTreeEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "dir" ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function isHiddenSkillTreeEntry(name: string) {
  return name.startsWith(".");
}

function isRenderedDescription(value?: string | null) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return false;
  }
  return !["|", ">", "|-", ">-", "|+", ">+"].includes(normalized);
}

function removeRecordKey<T>(record: Record<string, T>, keyToDelete: string) {
  if (!(keyToDelete in record)) {
    return record;
  }
  const { [keyToDelete]: _deleted, ...rest } = record;
  return rest;
}

export function SkillsSection({
  activeWorkspace,
  embedded = false,
  appSettings,
  onUpdateAppSettings,
}: SkillsSectionProps) {
  const { t } = useTranslation();
  const customSkillDirectories = useMemo(
    () => normalizeCustomSkillDirectories(appSettings.customSkillDirectories),
    [appSettings.customSkillDirectories],
  );
  const { skills, refreshSkills } = useSkills({
    activeWorkspace,
    customSkillDirectories,
  });
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<GlobalEngine>("claude");
  const [customDirsDraft, setCustomDirsDraft] = useState(
    customSkillDirectories.join("\n"),
  );
  const [customDirsSaving, setCustomDirsSaving] = useState(false);
  const [customDirsMessage, setCustomDirsMessage] = useState<string | null>(null);
  const [customDirsError, setCustomDirsError] = useState<string | null>(null);
  const [selectedNodePath, setSelectedNodePath] = useState<string | null>(null);
  const [selectedNodeKind, setSelectedNodeKind] = useState<SelectedNodeKind>(null);
  const [expandedDirectoryKeys, setExpandedDirectoryKeys] = useState<Set<string>>(new Set());
  const [loadingDirectoryKeys, setLoadingDirectoryKeys] = useState<Set<string>>(new Set());
  const [directoryEntries, setDirectoryEntries] = useState<Record<string, SkillFileTreeEntry[]>>(
    {},
  );
  const [directoryErrors, setDirectoryErrors] = useState<Record<string, string>>({});
  const [selectedFileContent, setSelectedFileContent] = useState("");
  const [selectedFileContentLoading, setSelectedFileContentLoading] = useState(false);
  const [selectedFileContentError, setSelectedFileContentError] = useState<string | null>(null);
  const [selectedFileContentTruncated, setSelectedFileContentTruncated] = useState(false);
  const [isEditingSelectedFile, setIsEditingSelectedFile] = useState(false);
  const [selectedFileDraftContent, setSelectedFileDraftContent] = useState("");
  const [selectedFileSaveLoading, setSelectedFileSaveLoading] = useState(false);
  const [selectedFileSaveError, setSelectedFileSaveError] = useState<string | null>(null);
  const [treePaneWidth, setTreePaneWidth] = useState(SKILLS_TREE_DEFAULT_WIDTH);
  const [isResizingTreePane, setIsResizingTreePane] = useState(false);

  const browserContainerRef = useRef<HTMLDivElement | null>(null);
  const treeResizeCleanupRef = useRef<(() => void) | null>(null);
  const directoryEntriesRef = useRef<Record<string, SkillFileTreeEntry[]>>({});
  const loadingDirectoryKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    directoryEntriesRef.current = directoryEntries;
  }, [directoryEntries]);

  useEffect(() => {
    loadingDirectoryKeysRef.current = loadingDirectoryKeys;
  }, [loadingDirectoryKeys]);

  useEffect(() => {
    setCustomDirsDraft(customSkillDirectories.join("\n"));
  }, [customSkillDirectories]);

  const loadSkills = useCallback(async () => {
    if (!activeWorkspace?.id) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await refreshSkills();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace?.id, refreshSkills]);

  const saveCustomSkillDirectories = useCallback(async () => {
    const directories = normalizeCustomSkillDirectories(
      customDirsDraft.split(/\r?\n/),
    );
    setCustomDirsSaving(true);
    setCustomDirsError(null);
    setCustomDirsMessage(null);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        customSkillDirectories: directories,
      });
      setCustomDirsMessage(t("settings.skillsPanel.customDirsSaved"));
      await refreshSkills();
    } catch (saveError) {
      setCustomDirsError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    } finally {
      setCustomDirsSaving(false);
    }
  }, [
    appSettings,
    customDirsDraft,
    onUpdateAppSettings,
    refreshSkills,
    t,
  ]);

  useEffect(() => {
    void loadSkills();
  }, [loadSkills]);

  const globalSkills = useMemo(
    () => skills.filter((skill) => isGlobalSkill(skill, activeWorkspace?.path ?? null)),
    [activeWorkspace?.path, skills],
  );
  const engineSkills = useMemo(
    () =>
      globalSkills.filter((skill) =>
        matchesEngine(skill, engine, customSkillDirectories),
      ),
    [customSkillDirectories, engine, globalSkills],
  );
  const normalizedQuery = normalizeText(query);
  const filteredSkills = useMemo(() => {
    if (!normalizedQuery) {
      return engineSkills;
    }
    return engineSkills.filter((skill) => {
      const haystack = `${skill.name} ${skill.description ?? ""} ${skill.path}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [engineSkills, normalizedQuery]);

  const engineRootPaths = useMemo(() => {
    if (engine === "custom") {
      return customSkillDirectories;
    }
    for (const skill of engineSkills) {
      const root = extractEngineRootFromSkillPath(skill.path, engine);
      if (root) {
        return [root];
      }
    }
    return [] as string[];
  }, [customSkillDirectories, engine, engineSkills]);
  const primaryEngineRootPath = engineRootPaths[0] ?? null;
  const engineRootSummary = useMemo(
    () => engineRootPaths.join(", "),
    [engineRootPaths],
  );
  const usesVirtualRootEntries =
    engine === "custom" && engineRootPaths.length > 1;

  const skillRootMap = useMemo(() => {
    const map = new Map<string, SkillOption>();
    for (const skill of engineSkills) {
      const rootPath = pathParent(skill.path);
      if (!rootPath) {
        continue;
      }
      map.set(normalizePathKey(rootPath), skill);
    }
    return map;
  }, [engineSkills]);

  const loadDirectoryEntries = useCallback(
    async (directoryPath: string) => {
      const workspaceId = activeWorkspace?.id;
      const normalizedPath = normalizeFsPath(directoryPath);
      if (!workspaceId || !normalizedPath) {
        return;
      }
      const directoryKey = normalizePathKey(normalizedPath);
      if (directoryEntriesRef.current[directoryKey] || loadingDirectoryKeysRef.current.has(directoryKey)) {
        return;
      }

      setLoadingDirectoryKeys((previous) => {
        const next = new Set(previous);
        next.add(directoryKey);
        loadingDirectoryKeysRef.current = next;
        return next;
      });

      try {
        const response = await listExternalAbsoluteDirectoryChildren(workspaceId, normalizedPath);
        const entries = sortTreeEntries(
          [
            ...response.directories.map((path) => {
              const resolvedPath = normalizeFsPath(path);
              return {
                name: pathBaseName(resolvedPath),
                path: resolvedPath,
                kind: "dir" as const,
                isSkillRoot: skillRootMap.has(normalizePathKey(resolvedPath)),
              };
            }),
            ...response.files.map((path) => {
              const resolvedPath = normalizeFsPath(path);
              return {
                name: pathBaseName(resolvedPath),
                path: resolvedPath,
                kind: "file" as const,
                isSkillRoot: false,
              };
            }),
          ].filter((entry) => !isHiddenSkillTreeEntry(entry.name)),
        );

        setDirectoryEntries((previous) => {
          const next = { ...previous, [directoryKey]: entries };
          directoryEntriesRef.current = next;
          return next;
        });
        setDirectoryErrors((previous) => removeRecordKey(previous, directoryKey));
      } catch (loadError) {
        setDirectoryErrors((previous) => ({
          ...previous,
          [directoryKey]: loadError instanceof Error ? loadError.message : String(loadError),
        }));
      } finally {
        setLoadingDirectoryKeys((previous) => {
          const next = new Set(previous);
          next.delete(directoryKey);
          loadingDirectoryKeysRef.current = next;
          return next;
        });
      }
    },
    [activeWorkspace?.id, skillRootMap],
  );

  useEffect(() => {
    setDirectoryEntries({});
    directoryEntriesRef.current = {};
    setDirectoryErrors({});
    setLoadingDirectoryKeys(new Set());
    loadingDirectoryKeysRef.current = new Set();
    setExpandedDirectoryKeys(new Set());

    if (engineRootPaths.length === 0) {
      setSelectedNodePath(null);
      setSelectedNodeKind(null);
      return;
    }

    setExpandedDirectoryKeys(
      new Set(engineRootPaths.map((rootPath) => normalizePathKey(rootPath))),
    );
    for (const rootPath of engineRootPaths) {
      void loadDirectoryEntries(rootPath);
    }

    const defaultSkillPath = normalizeFsPath(engineSkills[0]?.path ?? "");
    if (defaultSkillPath) {
      setSelectedNodePath(defaultSkillPath);
      setSelectedNodeKind("file");
      return;
    }
    setSelectedNodePath(primaryEngineRootPath);
    setSelectedNodeKind("dir");
  }, [engineRootPaths, engineSkills, loadDirectoryEntries, primaryEngineRootPath]);

  const toggleDirectory = useCallback(
    (directoryPath: string) => {
      const directoryKey = normalizePathKey(directoryPath);
      const shouldExpand = !expandedDirectoryKeys.has(directoryKey);
      setExpandedDirectoryKeys((previous) => {
        const next = new Set(previous);
        if (next.has(directoryKey)) {
          next.delete(directoryKey);
        } else {
          next.add(directoryKey);
        }
        return next;
      });
      if (shouldExpand) {
        void loadDirectoryEntries(directoryPath);
      }
    },
    [expandedDirectoryKeys, loadDirectoryEntries],
  );

  const selectedSkill = useMemo(() => {
    const currentPath = selectedNodePath ? normalizeFsPath(selectedNodePath) : "";
    if (!currentPath) {
      return null;
    }
    let cursor = selectedNodeKind === "dir" ? currentPath : pathParent(currentPath);
    while (cursor) {
      const entry = skillRootMap.get(normalizePathKey(cursor));
      if (entry) {
        return entry;
      }
      const parent = pathParent(cursor);
      if (!parent || parent === cursor) {
        break;
      }
      cursor = parent;
    }
    return null;
  }, [selectedNodeKind, selectedNodePath, skillRootMap]);

  const selectedFilePath = selectedNodeKind === "file" && selectedNodePath
    ? normalizeFsPath(selectedNodePath)
    : null;
  const selectedFileIsImage = Boolean(selectedFilePath && isImagePath(selectedFilePath));
  const selectedFileIsMarkdown = Boolean(selectedFilePath && isMarkdownPath(selectedFilePath));
  const selectedStructuredPreviewKind = useMemo(
    () => (selectedFilePath ? resolveStructuredPreviewKind(selectedFilePath) : null),
    [selectedFilePath],
  );
  const canEditSelectedFile = Boolean(
    selectedFilePath &&
    !selectedFileIsImage &&
    !selectedFileContentLoading &&
    !selectedFileContentError &&
    !selectedFileContentTruncated,
  );

  useEffect(() => {
    setIsEditingSelectedFile(false);
    setSelectedFileDraftContent("");
    setSelectedFileSaveError(null);
  }, [selectedFilePath]);

  useEffect(() => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId || !selectedFilePath || selectedFileIsImage) {
      setSelectedFileContent("");
      setSelectedFileContentError(null);
      setSelectedFileContentTruncated(false);
      setSelectedFileContentLoading(false);
      return;
    }

    let cancelled = false;
    setSelectedFileContentLoading(true);
    setSelectedFileContentError(null);

    void readExternalAbsoluteFile(workspaceId, selectedFilePath)
      .then((response) => {
        if (cancelled) {
          return;
        }
        setSelectedFileContent(response.content ?? "");
        setSelectedFileContentTruncated(Boolean(response.truncated));
      })
      .catch((readError) => {
        if (cancelled) {
          return;
        }
        setSelectedFileContent("");
        setSelectedFileContentTruncated(false);
        setSelectedFileContentError(readError instanceof Error ? readError.message : String(readError));
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedFileContentLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspace?.id, selectedFileIsImage, selectedFilePath]);

  const selectedImageSrc = useMemo(() => {
    if (!selectedFilePath || !selectedFileIsImage) {
      return null;
    }
    try {
      return convertFileSrc(selectedFilePath);
    } catch {
      return null;
    }
  }, [selectedFileIsImage, selectedFilePath]);

  const selectedFileLanguage = useMemo(
    () => languageFromPath(selectedFilePath),
    [selectedFilePath],
  );
  const highlightedContentLines = useMemo(() => {
    if (!selectedFileContent) {
      return [] as string[];
    }
    return selectedFileContent.split("\n").map((line) => highlightLine(line, selectedFileLanguage) || "&nbsp;");
  }, [selectedFileContent, selectedFileLanguage]);

  const startEditingSelectedFile = useCallback(() => {
    if (!canEditSelectedFile) {
      return;
    }
    setSelectedFileDraftContent(selectedFileContent);
    setSelectedFileSaveError(null);
    setIsEditingSelectedFile(true);
  }, [canEditSelectedFile, selectedFileContent]);

  const cancelEditingSelectedFile = useCallback(() => {
    setIsEditingSelectedFile(false);
    setSelectedFileDraftContent(selectedFileContent);
    setSelectedFileSaveError(null);
  }, [selectedFileContent]);

  const saveSelectedFile = useCallback(async () => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId || !selectedFilePath || !isEditingSelectedFile) {
      return;
    }
    setSelectedFileSaveLoading(true);
    setSelectedFileSaveError(null);
    try {
      await writeExternalAbsoluteFile(workspaceId, selectedFilePath, selectedFileDraftContent);
      setSelectedFileContent(selectedFileDraftContent);
      setSelectedFileContentTruncated(false);
      setIsEditingSelectedFile(false);
    } catch (saveError) {
      setSelectedFileSaveError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSelectedFileSaveLoading(false);
    }
  }, [activeWorkspace?.id, isEditingSelectedFile, selectedFileDraftContent, selectedFilePath]);

  const rootTreeEntries = useMemo(() => {
    if (usesVirtualRootEntries) {
      return sortTreeEntries(
        engineRootPaths.map((rootPath) => ({
          name: pathBaseName(rootPath) || rootPath,
          path: rootPath,
          kind: "dir" as const,
          isSkillRoot: true,
        })),
      );
    }
    const rootDirectoryKey = primaryEngineRootPath
      ? normalizePathKey(primaryEngineRootPath)
      : "";
    return rootDirectoryKey ? (directoryEntries[rootDirectoryKey] ?? []) : [];
  }, [
    directoryEntries,
    engineRootPaths,
    primaryEngineRootPath,
    usesVirtualRootEntries,
  ]);
  const rootTreeLoading = Boolean(
    !usesVirtualRootEntries
    && primaryEngineRootPath
    && loadingDirectoryKeys.has(normalizePathKey(primaryEngineRootPath)),
  );
  const rootTreeError = useMemo(() => {
    if (usesVirtualRootEntries || !primaryEngineRootPath) {
      return null;
    }
    return directoryErrors[normalizePathKey(primaryEngineRootPath)] ?? null;
  }, [directoryErrors, primaryEngineRootPath, usesVirtualRootEntries]);

  const engineLabel = useCallback(
    (value: GlobalEngine) => {
      switch (value) {
        case "claude":
          return t("settings.skillsPanel.engineClaude");
        case "code":
          return t("settings.skillsPanel.engineCode");
        case "gemini":
          return t("settings.skillsPanel.engineGemini");
        case "agents":
          return t("settings.skillsPanel.engineAgents");
        case "custom":
          return t("settings.skillsPanel.engineCustom");
      }
    },
    [t],
  );

  const currentSelectionKey = selectedNodePath ? normalizePathKey(selectedNodePath) : "";

  const renderTreeNodes = useCallback(
    (entries: SkillFileTreeEntry[], depth = 0): ReactNode[] =>
      entries.flatMap((entry) => {
        const entryKey = normalizePathKey(entry.path);
        const matchesQuery = !normalizedQuery || `${entry.name} ${entry.path}`.toLowerCase().includes(normalizedQuery);
        const isActive = entryKey === currentSelectionKey;

        if (entry.kind === "dir") {
          const isExpanded = expandedDirectoryKeys.has(entryKey);
          const children = directoryEntries[entryKey] ?? [];
          const childNodes = isExpanded ? renderTreeNodes(children, depth + 1) : [];
          if (normalizedQuery && !matchesQuery && childNodes.length === 0) {
            return [];
          }

          const isLoadingChildren = loadingDirectoryKeys.has(entryKey);
          const loadError = directoryErrors[entryKey];
          return [
            <div key={entry.path}>
              <button
                type="button"
                className={cn(
                  "settings-skills-tree-node settings-skills-tree-node--dir w-full border-0 bg-transparent text-[var(--text-strong)] min-h-7 flex items-center gap-1.5 text-left cursor-pointer text-[12px] font-semibold hover:bg-[var(--surface-hover)]",
                  isActive && "is-active bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]",
                )}
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
                onClick={() => {
                  setSelectedNodePath(entry.path);
                  setSelectedNodeKind("dir");
                  toggleDirectory(entry.path);
                }}
              >
                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <Folder size={14} />
                <span className="settings-skills-tree-label min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
                {entry.isSkillRoot ? (
                  <span className="settings-skills-tree-tag inline-flex items-center gap-1 rounded-full border border-[var(--border-muted)] px-1.5 py-px text-[var(--text-muted)] text-[10px] font-medium">
                    <BadgeInfo size={12} />
                    {t("settings.skillsPanel.treeSkillRootTag")}
                  </span>
                ) : null}
              </button>
              {isExpanded ? (
                <div>
                  {isLoadingChildren ? (
                    <div className="settings-skills-tree-state min-h-[26px] flex items-center text-[11px] text-[var(--text-muted)]" style={{ paddingLeft: `${depth * 14 + 30}px` }}>
                      {t("settings.skillsPanel.treeLoading")}
                    </div>
                  ) : null}
                  {loadError ? (
                    <div className="settings-skills-tree-state settings-inline-error min-h-[26px] flex items-center text-[11px]" style={{ paddingLeft: `${depth * 14 + 30}px` }}>
                      {t("settings.skillsPanel.treeLoadFailed", { message: loadError })}
                    </div>
                  ) : null}
                  {!isLoadingChildren && !loadError && children.length === 0 ? (
                    <div className="settings-skills-tree-state min-h-[26px] flex items-center text-[11px] text-[var(--text-muted)]" style={{ paddingLeft: `${depth * 14 + 30}px` }}>
                      {t("settings.skillsPanel.treeFolderEmpty")}
                    </div>
                  ) : null}
                  {childNodes}
                </div>
              ) : null}
            </div>,
          ];
        }

        if (normalizedQuery && !matchesQuery) {
          return [];
        }
        const FileIcon = isImagePath(entry.path) ? Image : isMarkdownPath(entry.path) ? FileText : FileCode2;

        return [
          <button
            key={entry.path}
            type="button"
            className={cn(
              "settings-skills-tree-node settings-skills-tree-node--file w-full border-0 bg-transparent text-[var(--text-strong)] min-h-7 flex items-center gap-1.5 text-left cursor-pointer text-[12px] hover:bg-[var(--surface-hover)]",
              isActive && "is-active bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]",
            )}
            style={{ paddingLeft: `${depth * 14 + 24}px` }}
            onClick={() => {
              setSelectedNodePath(entry.path);
              setSelectedNodeKind("file");
            }}
          >
            <FileIcon size={14} />
            <span className="settings-skills-tree-label min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{entry.name}</span>
          </button>,
        ];
      }),
    [
      currentSelectionKey,
      directoryEntries,
      directoryErrors,
      expandedDirectoryKeys,
      loadingDirectoryKeys,
      normalizedQuery,
      t,
      toggleDirectory,
    ],
  );

  const selectedDirectoryChildCount = useMemo(() => {
    if (selectedNodeKind !== "dir" || !selectedNodePath) {
      return 0;
    }
    const key = normalizePathKey(selectedNodePath);
    return directoryEntries[key]?.length ?? 0;
  }, [directoryEntries, selectedNodeKind, selectedNodePath]);

  const selectedSkillRootPath = selectedSkill ? pathParent(selectedSkill.path) : null;
  const selectedSkillDescription = isRenderedDescription(selectedSkill?.description)
    ? String(selectedSkill?.description).trim()
    : "";
  const treePaneCollapsed = treePaneWidth === 0;
  const browserGridTemplateColumns = `${treePaneWidth}px ${SKILLS_TREE_SPLITTER_WIDTH}px minmax(0, 1fr)`;

  const cleanupTreeResizeTracking = useCallback(() => {
    treeResizeCleanupRef.current?.();
    treeResizeCleanupRef.current = null;
  }, []);

  useEffect(
    () => () => {
      cleanupTreeResizeTracking();
    },
    [cleanupTreeResizeTracking],
  );

  const handleTreePaneResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }
      cleanupTreeResizeTracking();
      event.preventDefault();
      const containerWidth = browserContainerRef.current?.getBoundingClientRect().width ?? 0;
      const maxWidth = Math.min(
        SKILLS_TREE_MAX_WIDTH,
        Math.max(0, Math.floor(containerWidth - 360)),
      );
      const startX = event.clientX;
      const startWidth = treePaneWidth;
      setIsResizingTreePane(true);
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (moveEvent: PointerEvent) => {
        let nextWidth = startWidth + (moveEvent.clientX - startX);
        nextWidth = Math.max(0, Math.min(nextWidth, maxWidth));
        if (nextWidth < SKILLS_TREE_COLLAPSE_THRESHOLD) {
          nextWidth = 0;
        } else if (nextWidth < SKILLS_TREE_MIN_WIDTH) {
          nextWidth = SKILLS_TREE_MIN_WIDTH;
        }
        setTreePaneWidth(nextWidth);
      };

      let completed = false;
      const handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          finishResize();
        }
      };
      const finishResize = () => {
        if (completed) {
          return;
        }
        completed = true;
        setIsResizingTreePane(false);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishResize);
        window.removeEventListener("pointercancel", finishResize);
        window.removeEventListener("blur", finishResize);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        treeResizeCleanupRef.current = null;
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", finishResize);
      window.addEventListener("pointercancel", finishResize);
      window.addEventListener("blur", finishResize);
      document.addEventListener("visibilitychange", handleVisibilityChange);
      treeResizeCleanupRef.current = finishResize;
    },
    [cleanupTreeResizeTracking, treePaneWidth],
  );

  return (
    <section className="settings-section">
      {!embedded && (
        <div className="settings-section-title">{t("settings.skillsPanel.title")}</div>
      )}

      {!activeWorkspace?.id ? (
        <>
          {!embedded && (
            <div className="settings-section-subtitle">{t("settings.skillsPanel.description")}</div>
          )}
          <div className="settings-inline-muted">{t("settings.skillsPanel.workspaceRequired")}</div>
        </>
      ) : (
        <>
          <div className="settings-skills-head-inline flex items-center justify-between gap-3 flex-nowrap max-[1100px]:items-stretch max-[1100px]:flex-wrap">
            <div className="settings-section-subtitle settings-skills-head-desc mb-0 flex-[0_0_auto]">
              {t("settings.skillsPanel.description")}
            </div>
            <div className="settings-skills-toolbar settings-skills-toolbar--inline flex items-center gap-2 flex-nowrap max-[1100px]:w-full max-[1100px]:justify-start max-[1100px]:flex-wrap">
              <label className="settings-search-field inline-flex items-center gap-1.5 min-w-[340px] [&>svg]:text-[var(--text-faint)] max-[1100px]:min-w-[220px]">
                <Search size={14} />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("settings.skillsPanel.searchPlaceholder")}
                />
              </label>

              <label className="settings-workspace-picker-label">
                {t("settings.skillsPanel.enginePicker")}
              </label>
              <select
                className="settings-select settings-select--compact"
                value={engine}
                onChange={(event) => setEngine(event.target.value as GlobalEngine)}
              >
                {ENGINE_ORDER.map((value) => (
                  <option key={value} value={value}>
                    {engineLabel(value)}
                  </option>
                ))}
              </select>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadSkills()}
                disabled={loading}
              >
                <RefreshCw size={14} className={cn(loading && "is-spin")} />
                {t("settings.skillsPanel.refresh")}
              </Button>
            </div>
          </div>

          <div className="settings-skills-custom-dirs grid grid-cols-[minmax(180px,260px)_minmax(280px,1fr)_auto] items-start gap-2.5 my-2.5 p-2.5 border border-[var(--border-muted)] rounded-lg bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)]">
            <div className="settings-skills-custom-dirs-copy flex flex-col gap-1">
              <div className="settings-skills-custom-dirs-title text-[12px] font-bold text-[var(--text-strong)]">
                {t("settings.skillsPanel.customDirsTitle")}
              </div>
              <div className="settings-inline-muted">
                {t("settings.skillsPanel.customDirsDescription")}
              </div>
            </div>
            <Textarea
              value={customDirsDraft}
              onChange={(event) => {
                setCustomDirsDraft(event.target.value);
                setCustomDirsMessage(null);
                setCustomDirsError(null);
              }}
              placeholder={t("settings.skillsPanel.customDirsPlaceholder")}
              className="settings-skills-custom-dirs-input min-h-[72px] font-mono text-[12px] resize-y"
              spellCheck={false}
            />
            <div className="settings-skills-custom-dirs-actions inline-flex flex-col items-start gap-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void saveCustomSkillDirectories()}
                disabled={customDirsSaving}
              >
                <Save size={14} />
                {customDirsSaving
                  ? t("settings.saving")
                  : t("settings.skillsPanel.customDirsSave")}
              </Button>
              {customDirsMessage ? (
                <span className="settings-inline-success">{customDirsMessage}</span>
              ) : null}
              {customDirsError ? (
                <span className="settings-inline-error">{customDirsError}</span>
              ) : null}
            </div>
          </div>

          <div className="settings-skills-summary-strip flex items-center gap-2 flex-wrap mb-2">
            <div className="settings-skills-summary-chip inline-flex items-center gap-1.5 border border-[var(--border-muted)] rounded-full px-2.5 py-[5px] bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)] text-[var(--text-muted)] text-[11px]">
              <HardDrive size={14} />
              <span>{t("settings.skillsPanel.globalDirs")}</span>
            </div>
            <div className="settings-skills-summary-chip inline-flex items-center gap-1.5 border border-[var(--border-muted)] rounded-full px-2.5 py-[5px] bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)] text-[var(--text-muted)] text-[11px]">
              <FolderTree size={14} />
              <span>
                {t("settings.skillsPanel.activeGlobalDir", {
                  path: engineRootSummary || ENGINE_CONFIGS[engine].globalDir,
                })}
              </span>
            </div>
            <div className="settings-skills-summary-chip inline-flex items-center gap-1.5 border border-[var(--border-muted)] rounded-full px-2.5 py-[5px] bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)] text-[var(--text-muted)] text-[11px]">
              <FileText size={14} />
              <span>
                {t("settings.skillsPanel.count", {
                  count: filteredSkills.length,
                  total: engineSkills.length,
                })}
              </span>
            </div>
          </div>

          {error && <div className="settings-inline-error">{error}</div>}

          {loading && <div className="settings-inline-muted">{t("settings.loading")}</div>}

          {!loading && engineRootPaths.length === 0 && (
            <div className="settings-inline-muted">{t("settings.skillsPanel.engineRootUnavailable")}</div>
          )}

          {!loading && engineSkills.length === 0 && (
            <div className="settings-inline-muted">{t("settings.skillsPanel.empty")}</div>
          )}

          {!loading && primaryEngineRootPath && (
            <div
              ref={browserContainerRef}
              className={cn(
                "settings-skills-browser group/skills-browser mt-2.5 grid grid-cols-[minmax(260px,340px)_6px_1fr] gap-1 max-[1100px]:!grid-cols-[minmax(0,1fr)]",
                treePaneCollapsed && "is-tree-collapsed gap-0",
                isResizingTreePane && "is-resizing is-resizing-active cursor-col-resize",
              )}
              style={{ gridTemplateColumns: browserGridTemplateColumns }}
            >
              <aside
                className={cn(
                  "settings-skills-tree-pane border border-[var(--border-muted)] rounded-[10px] bg-[var(--surface-card)] min-h-[420px] flex flex-col",
                  treePaneCollapsed && "min-w-0 border-0 rounded-none overflow-hidden [&>*]:hidden",
                )}
                aria-hidden={treePaneCollapsed}
              >
                <div className="settings-skills-pane-title px-3 pt-2.5 pb-2 text-[12px] font-bold text-[var(--text-strong)] border-b border-[var(--border-muted)]">{t("settings.skillsPanel.treeTitle")}</div>
                <div className="settings-skills-tree-root px-3 py-2 text-[11px] text-[var(--text-muted)] border-b border-[var(--border-muted)] font-mono">
                  {engineRootSummary || primaryEngineRootPath}
                </div>
                <div className="settings-skills-tree-scroll overflow-auto py-2">
                  {rootTreeLoading ? (
                    <div className="settings-skills-tree-state min-h-[26px] flex items-center text-[11px] text-[var(--text-muted)]">{t("settings.skillsPanel.treeLoading")}</div>
                  ) : rootTreeError ? (
                    <div className="settings-inline-error">
                      {t("settings.skillsPanel.treeLoadFailed", { message: rootTreeError })}
                    </div>
                  ) : rootTreeEntries.length === 0 ? (
                    <div className="settings-skills-tree-state min-h-[26px] flex items-center text-[11px] text-[var(--text-muted)]">{t("settings.skillsPanel.treeFolderEmpty")}</div>
                  ) : (
                    renderTreeNodes(rootTreeEntries)
                  )}
                </div>
              </aside>
              <button
                type="button"
                className={cn(
                  "settings-skills-splitter relative w-[6px] border-0 bg-transparent p-0 cursor-col-resize before:content-[''] before:absolute before:top-1 before:bottom-1 before:left-1/2 before:w-0.5 before:-translate-x-1/2 before:rounded-full before:bg-[color-mix(in_srgb,var(--border-muted)_74%,transparent)] before:transition-colors hover:before:bg-[color-mix(in_srgb,var(--primary)_48%,var(--border-muted)_52%)] max-[1100px]:hidden",
                  isResizingTreePane && "before:!bg-[color-mix(in_srgb,var(--primary)_62%,var(--border-muted)_38%)]",
                )}
                onPointerDown={handleTreePaneResizeStart}
                aria-label={t("settings.skillsPanel.treeTitle")}
              />

              <section className="settings-skills-detail-pane border border-[var(--border-muted)] rounded-[10px] bg-[var(--surface-card)] min-h-[420px] flex flex-col overflow-hidden">
                <div className="settings-skills-pane-title settings-skills-pane-title--row px-3 pt-2.5 pb-2 text-[12px] font-bold text-[var(--text-strong)] border-b border-[var(--border-muted)] flex items-center justify-between gap-2">
                  <span>{t("settings.skillsPanel.detailTitle")}</span>
                  {selectedNodePath ? (
                    <div className="settings-skills-detail-actions inline-flex items-center gap-1.5 flex-wrap">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedNodePath) {
                            void revealItemInDir(selectedNodePath);
                          }
                        }}
                      >
                        <FolderOpen size={14} />
                        {t("settings.skillsPanel.reveal")}
                      </Button>
                      {selectedNodeKind === "file" ? (
                        isEditingSelectedFile ? (
                          <>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={cancelEditingSelectedFile}
                              disabled={selectedFileSaveLoading}
                            >
                              <X size={14} />
                              {t("settings.skillsPanel.cancel")}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void saveSelectedFile()}
                              disabled={selectedFileSaveLoading}
                            >
                              <Save size={14} />
                              {t("settings.skillsPanel.save")}
                            </Button>
                          </>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={startEditingSelectedFile}
                            disabled={!canEditSelectedFile}
                          >
                            <PencilLine size={14} />
                            {t("settings.skillsPanel.edit")}
                          </Button>
                        )
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {!selectedNodePath ? (
                  <div className="settings-inline-muted">{t("settings.skillsPanel.detailEmpty")}</div>
                ) : (
                  <div className="settings-skills-detail-body px-3 py-2.5 flex flex-col gap-2 min-h-0 flex-1">
                    <div className="settings-skills-detail-headline flex items-center gap-2 flex-wrap">
                      <span className="settings-skills-detail-name text-[15px] font-bold text-[var(--text-strong)]">{pathBaseName(selectedNodePath)}</span>
                      <span className="settings-skills-detail-chip inline-flex items-center border border-[var(--border-muted)] rounded-full px-2.5 py-0.5 text-[11px] text-[var(--text-muted)] bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)]">
                        {t("settings.skillsPanel.detailType")}:
                        {" "}
                        {selectedNodeKind === "dir"
                          ? t("settings.skillsPanel.detailTypeDirectory")
                          : t("settings.skillsPanel.detailTypeFile")}
                      </span>
                      <span className="settings-skills-detail-chip inline-flex items-center border border-[var(--border-muted)] rounded-full px-2.5 py-0.5 text-[11px] text-[var(--text-muted)] bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)]">
                        {t("settings.skillsPanel.detailSource")}:
                        {" "}
                        {selectedSkill?.source
                          ? normalizeManagedInstructionSource(selectedSkill.source)
                          : "-"}
                      </span>
                    </div>
                    <div className="settings-skills-detail-meta text-[11px] text-[var(--text-muted)] break-all">
                      {t("settings.skillsPanel.detailPath")}: {selectedNodePath}
                    </div>
                    <div className="settings-skills-detail-meta text-[11px] text-[var(--text-muted)] break-all">
                      {t("settings.skillsPanel.detailSkillRoot")}:
                      {" "}
                      {selectedSkillRootPath || t("settings.skillsPanel.detailSkillRootMissing")}
                    </div>
                    {selectedSkillDescription ? (
                      <div className="settings-skills-detail-description text-[12px] text-[var(--text-subtle)] leading-[1.5]">{selectedSkillDescription}</div>
                    ) : null}
                    {selectedFileSaveError ? (
                      <div className="settings-inline-error">
                        {t("settings.skillsPanel.saveFailed", { message: selectedFileSaveError })}
                      </div>
                    ) : null}

                    {selectedNodeKind === "dir" ? (
                      <div className="settings-inline-muted">
                        {t("settings.skillsPanel.detailDirectoryHint", { count: selectedDirectoryChildCount })}
                      </div>
                    ) : (
                      <div className="settings-skills-content-wrap mt-1 min-h-0 flex-1 flex flex-col overflow-auto">
                        {selectedFileIsImage ? (
                          selectedImageSrc ? (
                            <div className="fvp-image-preview flex-1 flex items-center justify-center overflow-auto p-6 bg-(--surface-command) bg-[linear-gradient(45deg,var(--surface-control)_25%,transparent_25%),linear-gradient(-45deg,var(--surface-control)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--surface-control)_75%),linear-gradient(-45deg,var(--surface-control)_75%)] [background-size:16px_16px] [background-position:0_0,0_8px,8px_-8px,-8px_0]">
                              <div className="fvp-image-preview-inner flex flex-col items-center gap-3 max-w-full max-h-full min-w-0 min-h-0">
                                <img
                                  src={selectedImageSrc}
                                  alt={pathBaseName(selectedFilePath ?? "")}
                                  className="fvp-image-preview-img max-w-full max-h-full object-contain rounded-[4px] shadow-[0_4px_16px_rgba(0,0,0,0.2)] min-h-0"
                                  draggable={false}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="settings-inline-muted">{t("settings.skillsPanel.contentEmpty")}</div>
                          )
                        ) : selectedFileContentLoading ? (
                          <div className="settings-inline-muted">{t("settings.skillsPanel.contentLoading")}</div>
                        ) : selectedFileContentError ? (
                          <div className="settings-inline-error">{selectedFileContentError}</div>
                        ) : isEditingSelectedFile ? (
                          <div className="settings-skills-editor-wrap mt-0.5 min-h-0 flex-1 flex">
                            <Textarea
                              value={selectedFileDraftContent}
                              onChange={(event) => setSelectedFileDraftContent(event.target.value)}
                              className="settings-skills-editor flex-1 min-h-[320px] resize-y text-[12px] leading-[1.5] font-mono"
                              spellCheck={false}
                            />
                          </div>
                        ) : selectedFileIsMarkdown ? (
                          selectedFileContent ? (
                            <div className="fvp-preview-scroll flex-1 overflow-auto py-5 px-6 w-full min-w-0">
                              <FileMarkdownPreview
                                value={selectedFileContent}
                                className="fvp-file-markdown fvp-markdown-github"
                              />
                            </div>
                          ) : (
                            <div className="settings-inline-muted">{t("settings.skillsPanel.contentEmpty")}</div>
                          )
                        ) : selectedStructuredPreviewKind && selectedFilePath ? (
                          <div className="fvp-preview-scroll flex-1 overflow-auto py-5 px-6 w-full min-w-0">
                            <FileStructuredPreview
                              filePath={selectedFilePath}
                              value={selectedFileContent}
                              className="fvp-structured-preview flex flex-col gap-3.5 text-[13px] text-(--fvp-reader-text)"
                            />
                          </div>
                        ) : highlightedContentLines.length > 0 ? (
                          <div className="fvp-code-preview flex flex-col overflow-auto flex-1 py-3 px-0 font-[var(--code-font-family)] text-[var(--code-font-size,12px)] font-[var(--code-font-weight,400)] leading-[var(--code-line-height,1.6)] text-(--fvp-reader-text) whitespace-pre bg-(--fvp-reader-surface) w-full min-w-0" role="list">
                            {highlightedContentLines.map((lineHtml, index) => (
                              <div key={`${selectedFilePath}-${index}`} className="fvp-code-line relative grid grid-cols-[52px_1fr] gap-3 items-start py-px pr-4 pl-0 min-w-full w-max hover:bg-[color-mix(in_srgb,var(--surface-active)_35%,transparent)]">
                                <span className="fvp-line-number inline-flex items-center justify-end gap-1.5 text-(--fvp-reader-fainter) text-right tabular-nums select-none pr-1">{index + 1}</span>
                                <span
                                  className="fvp-line-text min-w-0"
                                  dangerouslySetInnerHTML={{ __html: lineHtml }}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="settings-inline-muted">{t("settings.skillsPanel.contentEmpty")}</div>
                        )}
                        {selectedFileContentTruncated ? (
                          <div className="settings-help">{t("settings.skillsPanel.contentTruncated")}</div>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </section>
  );
}
