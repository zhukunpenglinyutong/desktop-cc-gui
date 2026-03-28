/**
 * Provider configuration types (from idea-claude-code-gui)
 */

export const STORAGE_KEYS = {
  CODEX_CUSTOM_MODELS: 'codex-custom-models',
  CLAUDE_MODEL_MAPPING: 'claude-model-mapping',
  CLAUDE_CUSTOM_MODELS: 'claude-custom-models',
  GEMINI_CUSTOM_MODELS: 'gemini-custom-models',
} as const;

export const MODEL_ID_PATTERN = /^[a-zA-Z0-9._/:[\]-]+$/;

export function isValidModelId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 256) return false;
  return MODEL_ID_PATTERN.test(trimmed);
}

export function isValidCodexCustomModel(model: unknown): model is CodexCustomModel {
  if (!model || typeof model !== 'object') return false;
  const obj = model as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !isValidModelId(obj.id)) return false;
  if (typeof obj.label !== 'string' || obj.label.trim().length === 0) return false;
  if (obj.description !== undefined && typeof obj.description !== 'string') return false;
  return true;
}

export function validateCodexCustomModels(models: unknown): CodexCustomModel[] {
  if (!Array.isArray(models)) return [];
  return models.filter(isValidCodexCustomModel);
}

export interface ProviderConfig {
  id: string;
  name: string;
  remark?: string;
  websiteUrl?: string;
  category?: ProviderCategory;
  createdAt?: number;
  isActive?: boolean;
  source?: 'cc-switch' | string;
  isLocalProvider?: boolean;
  customModels?: CodexCustomModel[];
  settingsConfig?: {
    env?: Record<string, any>;
    alwaysThinkingEnabled?: boolean;
    permissions?: {
      allow?: string[];
      deny?: string[];
    };
  };
}

export type ProviderCategory =
  | 'official'
  | 'cn_official'
  | 'aggregator'
  | 'third_party'
  | 'custom';

export interface CodexCustomModel {
  id: string;
  label: string;
  description?: string;
}

export interface CodexProviderConfig {
  id: string;
  name: string;
  remark?: string;
  createdAt?: number;
  isActive?: boolean;
  configToml?: string;
  authJson?: string;
  customModels?: CodexCustomModel[];
}

export interface ProviderPreset {
  id: string;
  nameKey: string;
  env: Record<string, string>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'custom',
    nameKey: 'settings.provider.presets.custom',
    env: {},
  },
];
