/** Shared provider model for the CLI config section. */

import type { ProviderSection } from "@/lib/ipc";

export const ENGINE_IDS = [
  "claude",
  "kimi",
  "grok",
  "codex",
  "pi",
  "omp",
  "dsh",
  "agy",
  "opencode",
  "qoder",
  "qoder-cn",
] as const;
export type EngineId = (typeof ENGINE_IDS)[number];
/** Official docs per engine — the CLI 管理 header "官方文档" link. */
export const ENGINE_DOCS_URLS: Record<EngineId, string> = {
  claude: "https://code.claude.com/docs/en/cli-reference",
  kimi: "https://www.kimi.com/code/docs/en/",
  grok: "https://x.ai/cli",
  codex: "https://learn.chatgpt.com/docs/codex/cli",
  pi: "https://pi.dev/docs/latest/usage",
  omp: "https://omp.sh",
  dsh: "https://github.com/deepseek-ai/dsh",
  agy: "https://www.antigravity.google/docs/cli/headless/",
  opencode: "https://opencode.ai/docs/",
  qoder: "https://docs.qoder.com/en/cli/using-cli",
  "qoder-cn": "https://docs.qoder.com/zh/cli/using-cli",
};

export const PSEUDO_LOCAL = "__local_settings_json__";
export const PSEUDO_DISABLED = "__disabled__";
/** Pseudo providers pinned at the top of every engine's list. */
export const PSEUDO_PROVIDER_IDS = [PSEUDO_LOCAL, PSEUDO_DISABLED] as const;
export type PseudoProviderId = (typeof PSEUDO_PROVIDER_IDS)[number];

export const isPseudoProvider = (id: string): id is PseudoProviderId =>
  (PSEUDO_PROVIDER_IDS as readonly string[]).includes(id);

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** Per-engine model env var, mirroring the backend provider_files::env_mapping() table. */
const ENV_MODEL_KEY: Partial<Record<EngineId, string>> = {
  claude: "ANTHROPIC_MODEL",
  kimi: "KIMI_MODEL_NAME",
  grok: "GROK_MODEL",
};

/**
 * Model id for the picker: the flat `model` field first, then the legacy
 * imported shape (`settingsConfig.env.<ENGINE_MODEL_VAR>` / `env.<…>`).
 */
export function providerModel(engine: EngineId, raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const flat = asString(o.model).trim();
  if (flat) return flat;
  const key = ENV_MODEL_KEY[engine];
  if (!key) return "";
  const settingsEnv = (o.settingsConfig as Record<string, unknown> | undefined)?.env;
  for (const source of [settingsEnv, o.env]) {
    if (source && typeof source === "object") {
      const value = asString((source as Record<string, unknown>)[key]).trim();
      if (value) return value;
    }
  }
  return "";
}

/**
 * Per-engine env keys backing the flat baseUrl/apiKey/model fields, mirroring
 * the backend provider_files::env_mapping() table. Legacy imported channels (ccswitch shape)
 * carry these inside settingsConfig.env/env, and the backend lets raw env win
 * over flat fields — so an edit must strip them or the new values are dead.
 */
const ENV_CONVENTION_KEYS: Partial<Record<EngineId, string[]>> = {
  claude: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"],
  kimi: ["KIMI_BASE_URL", "KIMI_API_KEY", "KIMI_MODEL_NAME"],
  grok: ["GROK_BASE_URL", "GROK_API_KEY", "GROK_MODEL"],
  codex: ["OPENAI_BASE_URL", "OPENAI_API_KEY"],
};

/** Copy `raw` with the convention env keys removed (empty maps/objects
 *  dropped), so edited flat fields take effect. Unknown keys are preserved. */
export function stripConventionEnv(engine: EngineId, raw: unknown): Record<string, unknown> {
  const keys = ENV_CONVENTION_KEYS[engine];
  const o = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
  if (!keys) return o;
  const keySet = new Set(keys);
  const strip = (env: unknown): Record<string, unknown> | undefined => {
    if (!env || typeof env !== "object") return undefined;
    const rest = Object.fromEntries(
      Object.entries(env as Record<string, unknown>).filter(([k]) => !keySet.has(k)),
    );
    return Object.keys(rest).length > 0 ? rest : undefined;
  };
  const env = strip(o.env);
  if (env) o.env = env;
  else delete o.env;
  if (o.settingsConfig && typeof o.settingsConfig === "object") {
    const sc = { ...(o.settingsConfig as Record<string, unknown>) };
    const scEnv = strip(sc.env);
    if (scEnv) sc.env = scEnv;
    else delete sc.env;
    if (Object.keys(sc).length > 0) o.settingsConfig = sc;
    else delete o.settingsConfig;
  }
  return o;
}

/** claude edit-dialog seed: the channel's settings.json text — its
 *  settingsConfig, or the flat env escape hatch wrapped in an object.
 *  "" when neither exists (the dialog falls back to the default template). */
export function claudeSettingsJson(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = o.settingsConfig;
  if (sc && typeof sc === "object" && Object.keys(sc).length > 0) {
    return JSON.stringify(sc, null, 2);
  }
  const env = o.env;
  if (env && typeof env === "object" && Object.keys(env).length > 0) {
    return JSON.stringify({ env }, null, 2);
  }
  return "";
}

/** codex edit-dialog seed: the channel's verbatim config.toml
 *  (settingsConfig.config), "" for flat channels. */
export function codexConfigToml(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = o.settingsConfig as Record<string, unknown> | undefined;
  return asString(sc?.config);
}

/** codex edit-dialog seed: the channel's auth.json text
 *  (settingsConfig.auth pretty-printed), "" when absent. */
export function codexAuthJson(raw: unknown): string {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sc = o.settingsConfig as Record<string, unknown> | undefined;
  const auth = sc?.auth;
  if (auth && typeof auth === "object" && Object.keys(auth).length > 0) {
    return JSON.stringify(auth, null, 2);
  }
  return "";
}

/** One channel row of an engine's provider map, flattened for the UI. */
export interface ProviderEntry {
  /** Map key — the id `set_current_provider` expects. */
  id: string;
  name: string;
  remark: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Untouched stored record, merged back on save so unknown fields survive. */
  raw: unknown;
}

/** Display-ready channel list: pseudo ids are never stored in the map, so no
 *  filtering is needed; display name falls back to the id. */
export function providerEntries(
  engine: EngineId,
  section: ProviderSection | undefined,
): ProviderEntry[] {
  if (!section) return [];
  return Object.entries(section.providers).map(([id, raw]) => {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return {
      id,
      name: asString(o.name).trim() || id,
      remark: asString(o.remark),
      baseUrl: asString(o.baseUrl),
      apiKey: asString(o.apiKey),
      model: providerModel(engine, raw),
      raw,
    };
  });
}

/**
 * Window event fired after any CLI config mutation so the chat tree
 * (ChatConversation's model picker) refetches — it caches getCliConfig on
 * mount and never re-reads otherwise.
 */
export const CLI_CONFIG_CHANGED_EVENT = "ccgui:cli-config-changed";

export function notifyCliConfigChanged() {
  window.dispatchEvent(new Event(CLI_CONFIG_CHANGED_EVENT));
}

/** Per-engine default channel (`section.current`). Unset / empty → 官方配置. */
export function engineCurrents(
  config: Pick<Record<EngineId, ProviderSection | undefined>, EngineId>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ENGINE_IDS) {
    const current = config[id]?.current?.trim();
    out[id] = current && current !== PSEUDO_DISABLED ? current : PSEUDO_LOCAL;
  }
  return out;
}
