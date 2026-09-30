/**
 * Skills hub transport: two commands (`skills_hub_query` / `skills_hub_mutate`)
 * plus error normalization. Backend errors arrive as `{ code, message }`;
 * callers branch on `code` for retry paths (rate limit → retry later,
 * conflict → reload, readonly → hide the action).
 */
import { invoke } from "@/lib/transport";
import { invalidateSlashCommandCatalog } from "@/components/application/ai-chat/slash-commands";
import type {
  DiscoveredSkill,
  SkillActivityEntry,
  SkillContentResult,
  SkillDiscoverResult,
  SkillErrorCode,
  SkillMutationResult,
  SkillRepo,
  SkillSearchResult,
  SkillTargetId,
  SkillsInstalledResult,
  SkillsMutation,
  SkillRemoteContent,
  SkillUpdateResult,
  SkillUsageResult,
} from "./types";

export class SkillsHubError extends Error {
  readonly code: SkillErrorCode;
  constructor(code: SkillErrorCode, message: string) {
    super(message);
    this.name = "SkillsHubError";
    this.code = code;
  }
}

function normalizeError(error: unknown): SkillsHubError {
  if (error instanceof SkillsHubError) return error;
  if (typeof error === "object" && error !== null) {
    const record = error as { code?: unknown; message?: unknown };
    const code =
      typeof record.code === "string" ? (record.code as SkillErrorCode) : "internal";
    const message =
      typeof record.message === "string"
        ? record.message
        : Object.prototype.toString.call(error);
    return new SkillsHubError(code, message);
  }
  return new SkillsHubError("internal", String(error));
}

/** Query one mode of the hub; `params` stay loose because the backend is the
 *  source of truth for each mode's shape. */
async function query<T>(mode: string, params: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>("skills_hub_query", { mode, params });
  } catch (error) {
    throw normalizeError(error);
  }
}

async function mutate<T = SkillMutationResult>(mutation: SkillsMutation): Promise<T> {
  // `skills_hub_mutate` takes two params — the action plus that action's own
  // payload. The call sites above pass one bag keyed by `action`, so split it
  // here: shipping the bag flat made every mutation fail with
  // 「invalid args `payload` … missing required key payload」.
  const { action, ...payload } = mutation;
  try {
    const result = await invoke<T>("skills_hub_mutate", { action, payload });
    // The composer's `/` catalog is cached per workspace root; a successful
    // mutation changed what the CLI would discover there. Invalidate instead
    // of claiming the running session reloaded its skills.
    invalidateSlashCommandCatalog();
    // Same for the bot prompt assembler's skills index: it must not keep
    // listing a skill the user just uninstalled.
    invalidateInstalledSkillsCache();
    return result;
  } catch (error) {
    throw normalizeError(error);
  }
}

/** `force` must be the string "1" — the backend mirrors the upstream HTTP
 *  semantics (`params.force === "1"`). */
function forceParam(force?: boolean): Record<string, unknown> {
  return force ? { force: "1" } : {};
}

/**
 * Process-wide cache of the installed-skill list, for callers that are not
 * components: the bot prompt assembler builds a skills index on every send
 * and must not re-scan the skills directories each time.
 *
 * Only the first call's promise is shared (a failure clears it, so the next
 * call retries); `invalidateInstalledSkillsCache` runs after any mutation.
 */
let installedCache: Promise<SkillsInstalledResult> | null = null;
const INSTALLED_TTL_MS = 30_000;
let installedAt = 0;

export function invalidateInstalledSkillsCache(): void {
  installedCache = null;
  installedAt = 0;
}

export function cachedInstalledSkills(): Promise<SkillsInstalledResult> {
  const fresh = installedCache && Date.now() - installedAt < INSTALLED_TTL_MS;
  if (fresh && installedCache) return installedCache;
  const promise = skillsHubApi.installed().catch((error: unknown) => {
    // A failed scan must not be cached: the next send retries.
    if (installedCache === promise) invalidateInstalledSkillsCache();
    throw error;
  });
  installedCache = promise;
  installedAt = Date.now();
  return promise;
}

export const skillsHubApi = {
  installed: () => query<SkillsInstalledResult>("installed"),
  discover: (force?: boolean) =>
    query<SkillDiscoverResult>("discover", forceParam(force)),
  search: (q: string, offset = 0, limit = 20) =>
    query<SkillSearchResult>("search", { q, offset, limit }),
  popular: (force?: boolean) =>
    query<SkillDiscoverResult>("popular", forceParam(force)),
  repos: () => query<{ repos: SkillRepo[] }>("repos"),
  updates: (force?: boolean) =>
    query<SkillUpdateResult>("updates", forceParam(force)),
  activity: (limit = 50) =>
    query<{ activity: SkillActivityEntry[] }>("activity", { limit }),
  usage: (force?: boolean) =>
    query<SkillUsageResult>("skill_usage", forceParam(force)),
  content: (directory: string) =>
    query<SkillContentResult>("skill_content", { directory }),
  /** 发现页的详情：skills.sh 不给描述与正文，回仓库读 SKILL.md。 */
  remoteContent: (skill: DiscoveredSkill) =>
    query<SkillRemoteContent>("remote_skill_content", {
      owner: skill.repoOwner,
      name: skill.repoName,
      branch: skill.repoBranch || "main",
      directory: skill.directory,
    }),

  install: (skill: DiscoveredSkill, targets: SkillTargetId[], force = false) =>
    mutate({
      action: "install",
      force,
      skill: {
        name: skill.name,
        description: skill.description,
        directory: skill.directory,
        repoOwner: skill.repoOwner,
        repoName: skill.repoName,
        repoBranch: skill.repoBranch,
      },
      targets,
    }),
  uninstall: (id: string) => mutate({ action: "uninstall", id }),
  restore: (id: string) => mutate({ action: "restore", id }),
  setTargets: (id: string, targets: SkillTargetId[]) =>
    mutate({ action: "set_targets", id, targets }),
  importLocal: (directory: string, targets: SkillTargetId[]) =>
    mutate({ action: "import_local", directory, targets }),
  deleteLocal: (directory: string, targets?: SkillTargetId[]) =>
    mutate({ action: "delete_local", directory, targets: targets ?? [] }),
  addRepo: (repo: { owner: string; name: string; branch: string }) =>
    mutate({ action: "add_repo", repo }),
  removeRepo: (owner: string, name: string) =>
    mutate({ action: "remove_repo", owner, name }),
};

