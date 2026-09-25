import type { EngineIconId } from "./engine-icon";

/** Brand names stay literal in every locale (Claude Code, Codex CLI, …). */
export const CLI_DISPLAY_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  grok: "Grok CLI",
  kimi: "Kimi CLI",
  pi: "PI CLI",
  omp: "OMP CLI",
  dsh: "DeepSeek Harness",
  agy: "Antigravity CLI",
  opencode: "OpenCode",
  qoder: "Qoder CLI",
  "qoder-cn": "Qoder CLI CN",
  minimax: "MiniMax Code",
};

/**
 * Infer a provider brand from a model name so cross-provider engines
 * (e.g. OMP CLI serving Kimi K3) show the model's own mark in the model
 * list instead of the engine's. Returns null when no brand matches —
 * callers fall back to the engine icon.
 */
export function inferModelEngine(name: string): EngineIconId | null {
  const lower = name.toLowerCase();
  // Vendors whose marks ship in the repo (lobe-icons, MIT).
  if (/\b(glm|chatglm|zhipu)\b/.test(lower)) return "chatglm";
  if (/\b(qwen|tongyi|qwq)\b/.test(lower)) return "qwen";
  if (/\b(doubao|volc)\b/.test(lower)) return "doubao";
  if (/\b(minimax|abab)\b/.test(lower)) return "minimax";
  if (/\b(baichuan)\b/.test(lower)) return "baichuan";
  if (/\b(hunyuan)\b/.test(lower)) return "hunyuan";
  if (/\b(step-?\d|stepfun)\b/.test(lower)) return "stepfun";
  if (/\b(gemini|gemma|antigravity|agy)\b/.test(lower)) return "gemini";
  if (/\b(mistral|mixtral|codestral)\b/.test(lower)) return "mistral";
  if (/\b(cohere|command-r)\b/.test(lower)) return "cohere";
  if (/\b(perplexity|sonar)\b/.test(lower)) return "perplexity";
  if (/\b(yi-|yi\b)/.test(lower)) return "yi";
  if (/\b(claude|sonnet|opus|haiku)\b/.test(lower)) return "claude";
  if (/\b(gpt|codex|openai)\b/.test(lower) || /\bo[134]\b/.test(lower)) return "codex";
  if (/\bgrok\b/.test(lower)) return "grok";
  if (/\b(kimi|moonshot)\b/.test(lower) || /\bk\d/.test(lower)) return "kimi";
  if (/\bdeepseek\b/.test(lower)) return "dsh";
  return null;
}
