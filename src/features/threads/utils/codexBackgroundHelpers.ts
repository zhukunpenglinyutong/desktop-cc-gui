const CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES = [
  "Generate a concise title for a coding chat thread from the first user message.",
  "You create concise run metadata for a coding task.",
  "You are generating OpenSpec project context.",
  "## Memory Writing Agent: Phase 2",
  "Memory Writing Agent: Phase 2",
] as const;

function hasMemoryWritingAgentSignature(text: string): boolean {
  const lower = text.toLowerCase();
  const startsWithMemoryAgentHeader =
    lower.startsWith("## memory writing agent:") ||
    lower.startsWith("memory writing agent:");
  if (!startsWithMemoryAgentHeader) {
    return false;
  }
  return lower.includes("consolidation") || lower.includes("phase 2");
}

export function isCodexBackgroundHelperPreview(value: string): boolean {
  const preview = value.trim();
  if (!preview) {
    return false;
  }
  if (
    CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES.some((prefix) =>
      preview.startsWith(prefix),
    )
  ) {
    return true;
  }
  return hasMemoryWritingAgentSignature(preview);
}

export function hasCodexBackgroundHelperPreview(values: string[]): boolean {
  return values.some(isCodexBackgroundHelperPreview);
}
