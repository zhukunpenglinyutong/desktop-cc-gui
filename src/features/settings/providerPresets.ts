/** Preset tables and config templates for ProviderDialog, ported from the
 *  reference desktop-cc-gui's features/vendors/types.ts. */

import bailianIcon from "@lobehub/icons-static-svg/icons/bailian-color.svg";
import deepseekIcon from "@lobehub/icons-static-svg/icons/deepseek-color.svg";
import kimiIcon from "@lobehub/icons-static-svg/icons/kimi.svg";
import longcatIcon from "@lobehub/icons-static-svg/icons/longcat-color.svg";
import minimaxIcon from "@lobehub/icons-static-svg/icons/minimax-color.svg";
import moonshotIcon from "@lobehub/icons-static-svg/icons/moonshot.svg";
import opencodeIcon from "@lobehub/icons-static-svg/icons/opencode.svg";
import openrouterIcon from "@lobehub/icons-static-svg/icons/openrouter-color.svg";
import xaiIcon from "@lobehub/icons-static-svg/icons/xai.svg";
import xiaomimimoIcon from "@lobehub/icons-static-svg/icons/xiaomimimo.svg";
import zhipuIcon from "@lobehub/icons-static-svg/icons/zhipu-color.svg";
import requestyIcon from "@/assets/model-icons/requesty.svg";
import type { EngineId } from "./providers";

export interface ProviderPreset {
  /** Brand-literal display name (same convention as CLI_DISPLAY_NAMES). */
  name: string;
  baseUrl: string;
  model: string;
  /** Explicit provider mark; model inference is unsafe for relay presets
   *  whose default model belongs to a different brand (e.g. OpenCode Go). */
  iconSrc: string;
  /** Monochrome SVGs use currentColor, which stays black inside an <img>;
   *  invert them in dark mode so they remain visible. */
  iconClassName?: string;
  /** claude: extra env merged into the JSON config on preset pick —
   *  ANTHROPIC_DEFAULT_<TIER>_MODEL slots plus per-provider tuning vars. */
  env?: Record<string, string>;
  /** codex: wire_api for the generated config.toml (default "chat" — the
   *  relays below are chat-completions compatible). */
  wireApi?: "responses" | "chat";
}

/** Monochrome SVGs use currentColor, which stays black inside an <img>. */
const DARK_MONO_ICON_CLASS = "dark:invert";

/** Claude-only: the official direct endpoint. Selecting the official card
 *  locks API URL to this value, mirroring the reference's 官方直连 preset. */
export const OFFICIAL_BASE_URL = "https://api.anthropic.com";
export const OFFICIAL_CODEX_BASE_URL = "https://api.openai.com/v1";

/** Model-slot env keys, in the grid's display order. */
export const CLAUDE_MODEL_SLOTS = [
  { slot: "fable", envKey: "ANTHROPIC_DEFAULT_FABLE_MODEL" },
  { slot: "sonnet", envKey: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { slot: "opus", envKey: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { slot: "haiku", envKey: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
] as const;
export type ClaudeModelSlot = (typeof CLAUDE_MODEL_SLOTS)[number]["slot"];

/** The reference's default settings.json template for a new Claude channel. */
export function buildDefaultClaudeSettings(): Record<string, unknown> & {
  env: Record<string, string>;
} {
  return {
    alwaysThinkingEnabled: true,
    autoDreamEnabled: true,
    cleanupPeriodDays: 720,
    effortLevel: "xhigh",
    env: {
      ANTHROPIC_AUTH_TOKEN: "",
      ANTHROPIC_BASE_URL: "",
      ANTHROPIC_BETAS: "context-1m-2025-08-07",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "claude-haiku-4-5-20251001",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "claude-opus-5",
      ANTHROPIC_DEFAULT_SONNET_MODEL: "claude-sonnet-4-6",
      ANTHROPIC_SMALL_FAST_MODEL: "claude-haiku-4-5-20251001",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: "1",
      CLAUDE_CODE_NEW_INIT: "1",
      DISABLE_ERROR_REPORTING: "1",
      DISABLE_TELEMETRY: "1",
      ENABLE_TOOL_SEARCH: "1",
      MAX_THINKING_TOKENS: "31999",
      MCP_TIMEOUT: "60000",
    },
    hasCompletedOnboarding: true,
    language: "简体中文",
    model: "opus",
    skipAutoPermissionPrompt: true,
    teammateMode: "in-process",
    tui: "fullscreen",
  };
}

/** Fresh settings.json text for a claude channel: the default template with
 *  the endpoint, the user's token and any preset env merged in. */
export function claudeTemplateJson(
  baseUrl: string,
  apiKey: string,
  extraEnv: Record<string, string> = {},
): string {
  const config = buildDefaultClaudeSettings();
  config.env.ANTHROPIC_BASE_URL = baseUrl;
  config.env.ANTHROPIC_AUTH_TOKEN = apiKey;
  for (const [key, val] of Object.entries(extraEnv)) {
    config.env[key] = val;
  }
  return JSON.stringify(config, null, 2);
}

// ── codex config.toml ───────────────────────────────────────────────────────

const tomlString = (value: string): string => JSON.stringify(value);

/** The reference's buildCodexProviderConfigToml: a managed config.toml with
 *  one model_providers table. */
export function buildCodexConfigToml(
  providerName: string,
  baseUrl: string,
  model: string,
  wireApi: "responses" | "chat" = "responses",
  providerId = "custom",
): string {
  return `disable_response_storage = true
model = ${tomlString(model)}
model_reasoning_effort = "high"
model_provider = ${tomlString(providerId)}

[model_providers.${providerId}]
base_url = ${tomlString(baseUrl)}
name = ${tomlString(providerName)}
requires_openai_auth = true
wire_api = ${tomlString(wireApi)}`;
}

export const DEFAULT_CODEX_AUTH_JSON = `{
  "OPENAI_API_KEY": ""
}`;

export const OFFICIAL_CODEX_CONFIG_TOML = buildCodexConfigToml(
  "openai",
  OFFICIAL_CODEX_BASE_URL,
  "gpt-5.1-codex",
  "responses",
  "openai",
);

/** First `base_url = "…"` in a config.toml — display/preset-match mirror; the
 *  backend applies the TOML itself, this is only for the UI. */
export function tomlBaseUrl(toml: string): string {
  return toml.match(/^\s*base_url\s*=\s*"([^"]*)"/m)?.[1] ?? "";
}

/** Top-level `model = "…"`. */
export function tomlModel(toml: string): string {
  return toml.match(/^\s*model\s*=\s*"([^"]+)"/m)?.[1] ?? "";
}

/** OPENAI_API_KEY out of an auth.json text; "" when unparseable/absent. */
export function authJsonApiKey(authJson: string): string {
  try {
    const parsed: unknown = JSON.parse(authJson);
    if (parsed && typeof parsed === "object") {
      const key = (parsed as Record<string, unknown>).OPENAI_API_KEY;
      return typeof key === "string" ? key : "";
    }
  } catch {
    // invalid JSON — the dialog surfaces this separately
  }
  return "";
}

// ── preset tables ───────────────────────────────────────────────────────────

/** Third-party relay presets per engine. Claude's table is ported from the
 *  reference's CLAUDE_PROVIDER_PRESETS (per-tier model env included); codex's
 *  from CODEX_PROVIDER_PRESETS (wire_api drives the generated config.toml). */
export const PRESETS: Partial<Record<EngineId, ProviderPreset[]>> = {
  claude: [
    {
      name: "智谱GLM",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
      model: "glm-5.2",
      iconSrc: zhipuIcon,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "glm-5.2",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.2",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.2",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.2",
      },
    },
    {
      name: "Kimi",
      baseUrl: "https://api.moonshot.cn/anthropic",
      model: "kimi-k3",
      iconSrc: kimiIcon,
      iconClassName: DARK_MONO_ICON_CLASS,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k3",
      },
    },
    {
      name: "Kimi Coding",
      baseUrl: "https://api.kimi.com/coding/",
      model: "kimi-k3",
      iconSrc: kimiIcon,
      iconClassName: DARK_MONO_ICON_CLASS,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k3",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k3",
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "262144",
        CLAUDE_CODE_AUTO_COMPACT_WINDOW: "262144",
      },
    },
    {
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/anthropic",
      model: "deepseek-v4-pro[1m]",
      iconSrc: deepseekIcon,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "deepseek-v4-pro[1m]",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-pro[1m]",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-pro[1m]",
        CLAUDE_CODE_EFFORT_LEVEL: "max",
      },
    },
    {
      name: "MiniMax",
      baseUrl: "https://api.minimaxi.com/anthropic",
      model: "MiniMax-M2.1",
      iconSrc: minimaxIcon,
      env: {
        // MiniMax 模型响应较慢, 需要 50 分钟 (3,000,000ms) 超时避免长推理请求被截断
        API_TIMEOUT_MS: "3000000",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ANTHROPIC_DEFAULT_FABLE_MODEL: "MiniMax-M2.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "MiniMax-M2.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "MiniMax-M2.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "MiniMax-M2.1",
      },
    },
    {
      name: "Xiaomi MiMo",
      baseUrl: "https://api.xiaomimimo.com/anthropic",
      model: "mimo-v2.5-pro",
      iconSrc: xiaomimimoIcon,
      iconClassName: DARK_MONO_ICON_CLASS,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
      },
    },
    {
      name: "Xiaomi MiMo Plan",
      baseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
      model: "mimo-v2.5-pro",
      iconSrc: xiaomimimoIcon,
      iconClassName: DARK_MONO_ICON_CLASS,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "mimo-v2.5-pro",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "mimo-v2.5-pro",
      },
    },
    { name: "Bailian", baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic", model: "", iconSrc: bailianIcon },
    { name: "Bailian Coding", baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic", model: "", iconSrc: bailianIcon },
    {
      name: "LongCat",
      baseUrl: "https://api.longcat.chat/anthropic",
      model: "LongCat-2.0",
      iconSrc: longcatIcon,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "LongCat-2.0",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "LongCat-2.0",
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: "131072",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      },
    },
    {
      name: "OpenCode Go",
      baseUrl: "https://opencode.ai/zen/go",
      model: "deepseek-v4-flash",
      iconSrc: opencodeIcon,
      iconClassName: DARK_MONO_ICON_CLASS,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-v4-flash",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-v4-flash",
      },
    },
    {
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api",
      model: "anthropic/claude-sonnet-4.5",
      iconSrc: openrouterIcon,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "anthropic/claude-fable-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4.5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4.5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4.5",
      },
    },
    {
      name: "Requesty",
      baseUrl: "https://router.requesty.ai",
      model: "anthropic/claude-sonnet-4-5",
      iconSrc: requestyIcon,
      env: {
        ANTHROPIC_DEFAULT_FABLE_MODEL: "anthropic/claude-fable-5",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "anthropic/claude-haiku-4-5",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "anthropic/claude-sonnet-4-5",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "anthropic/claude-opus-4-5",
      },
    },
  ],
  kimi: [
    { name: "Kimi Coding", baseUrl: "https://api.kimi.com/coding/v1", model: "kimi-for-coding", iconSrc: kimiIcon, iconClassName: DARK_MONO_ICON_CLASS },
    { name: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "", iconSrc: moonshotIcon, iconClassName: DARK_MONO_ICON_CLASS },
  ],
  grok: [{ name: "xAI Official", baseUrl: "https://api.x.ai/v1", model: "grok-build", iconSrc: xaiIcon, iconClassName: DARK_MONO_ICON_CLASS }],
  codex: [
    { name: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4", model: "glm-5.2", iconSrc: zhipuIcon, wireApi: "chat" },
    { name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3", iconSrc: kimiIcon, iconClassName: DARK_MONO_ICON_CLASS, wireApi: "chat" },
    { name: "Kimi Coding", baseUrl: "https://api.kimi.com/coding/v1", model: "kimi-k3", iconSrc: kimiIcon, iconClassName: DARK_MONO_ICON_CLASS, wireApi: "chat" },
    { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", iconSrc: deepseekIcon, wireApi: "chat" },
    { name: "MiniMax", baseUrl: "https://api.minimaxi.com/v1", model: "MiniMax-M3", iconSrc: minimaxIcon, wireApi: "chat" },
    { name: "Xiaomi MiMo", baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2.5-pro", iconSrc: xiaomimimoIcon, iconClassName: DARK_MONO_ICON_CLASS, wireApi: "chat" },
    { name: "Bailian Coding", baseUrl: "https://coding.dashscope.aliyuncs.com/v1", model: "qwen3-coder-plus", iconSrc: bailianIcon, wireApi: "chat" },
    { name: "LongCat", baseUrl: "https://api.longcat.chat/openai/v1", model: "LongCat-2.0", iconSrc: longcatIcon, wireApi: "chat" },
    { name: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1", model: "glm-5.2", iconSrc: opencodeIcon, iconClassName: DARK_MONO_ICON_CLASS, wireApi: "chat" },
    { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "", iconSrc: openrouterIcon, wireApi: "chat" },
    { name: "Requesty", baseUrl: "https://router.requesty.ai/v1", model: "", iconSrc: requestyIcon, wireApi: "chat" },
  ],
};

/** The preset matching the current URL; the empty 自定义 URL matches nothing. */
export function findMatchedPreset(
  presets: ProviderPreset[],
  baseUrl: string,
): ProviderPreset | undefined {
  return presets.find((p) => p.baseUrl === baseUrl && p.baseUrl !== "");
}

/** The reference's isOfficialAnthropicEndpoint: empty and api.anthropic.com
 *  (any scheme/path) count as official. */
export function isOfficialAnthropicEndpoint(baseUrl: string): boolean {
  const normalized = baseUrl.trim().toLowerCase();
  if (normalized === "") return true;
  try {
    return new URL(normalized).hostname === "api.anthropic.com";
  } catch {
    return false;
  }
}
