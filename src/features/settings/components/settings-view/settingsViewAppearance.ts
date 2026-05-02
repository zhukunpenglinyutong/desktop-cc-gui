import { DEFAULT_UI_FONT_FAMILY } from "../../../../utils/fonts";
import { applyUserMessageBubbleCssVars } from "../../../../utils/userMessageBubbleCssVars";

export type SettingsSection =
  | "basic"
  | "providers"
  | "project-management"
  | "mcp"
  | "permissions"
  | "commit"
  | "agent-prompt-management"
  | "composer"
  | "dictation"
  | "git"
  | "runtime-environment"
  | "other"
  | "community"
  | "vendors";

export type SettingsViewSection = SettingsSection | "experimental" | "about";

export const USER_MSG_DARK_PRESETS = [
  { color: "#005fb8", label: "Default" },
  { color: "#1a7f37", label: "Green" },
  { color: "#6e40c9", label: "Purple" },
  { color: "#9a6700", label: "Amber" },
  { color: "#cf222e", label: "Red" },
  { color: "#0e6b8a", label: "Teal" },
  { color: "#6b4c9a", label: "Violet" },
  { color: "#4a5568", label: "Gray" },
] as const;

export const USER_MSG_LIGHT_PRESETS = [
  { color: "#0078d4", label: "Default" },
  { color: "#1a7f37", label: "Green" },
  { color: "#8250df", label: "Purple" },
  { color: "#bf8700", label: "Amber" },
  { color: "#cf222e", label: "Red" },
  { color: "#0e8a9a", label: "Teal" },
  { color: "#7c5cbf", label: "Violet" },
  { color: "#57606a", label: "Gray" },
] as const;

export const DEFAULT_DARK_USER_MSG = "#005fb8";
export const DEFAULT_LIGHT_USER_MSG = "#0078d4";

const UI_FONT_DETECTION_CANDIDATES = [
  "SF Pro Text",
  "SF Pro Display",
  "Helvetica Neue",
  "Arial",
  "Avenir",
  "PingFang SC",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Segoe UI",
  "Tahoma",
  "Verdana",
  "Trebuchet MS",
  "Noto Sans",
  "Noto Sans CJK SC",
  "Source Han Sans SC",
  "Inter",
  "Roboto",
  "Ubuntu",
  "Fira Sans",
  "Monaco",
  "Menlo",
  "Consolas",
  "JetBrains Mono",
  "Source Code Pro",
] as const;

const FONT_DETECTION_FALLBACKS = ["monospace", "sans-serif", "serif"] as const;

export function extractPrimaryFontFamily(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("\"") || trimmed.startsWith("'")) {
    const quote = trimmed[0];
    const endIndex = trimmed.indexOf(quote, 1);
    if (endIndex > 1) {
      return trimmed.slice(1, endIndex).trim();
    }
  }
  const commaIndex = trimmed.indexOf(",");
  const primary = (commaIndex >= 0 ? trimmed.slice(0, commaIndex) : trimmed).trim();
  return primary.replace(/^["']|["']$/g, "").trim();
}

export function formatFontFamilySetting(fontName: string): string {
  const normalized = fontName.trim().replace(/^["']|["']$/g, "").trim();
  if (!normalized) {
    return DEFAULT_UI_FONT_FAMILY;
  }
  return /\s/.test(normalized) ? `"${normalized}"` : normalized;
}

function detectInstalledFontsFromCandidates(candidates: readonly string[]): string[] {
  if (typeof document === "undefined") {
    return [];
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    return [];
  }
  const sampleText = "mmmmmmmmmmlilililWWWWWWW1234567890中文";
  const baseWidths = new Map<string, number>();
  FONT_DETECTION_FALLBACKS.forEach((fallback) => {
    context.font = `72px ${fallback}`;
    baseWidths.set(fallback, context.measureText(sampleText).width);
  });

  const detected: string[] = [];
  candidates.forEach((candidate) => {
    const escaped = candidate.replace(/"/g, "\\\"");
    const quoted = `"${escaped}"`;
    const isAvailable = FONT_DETECTION_FALLBACKS.some((fallback) => {
      context.font = `72px ${quoted}, ${fallback}`;
      const width = context.measureText(sampleText).width;
      const baseWidth = baseWidths.get(fallback);
      return baseWidth != null && width !== baseWidth;
    });
    if (isAvailable) {
      detected.push(candidate);
    }
  });

  return detected;
}

export async function listLocalUiFonts(): Promise<string[]> {
  const discovered = new Set<string>();
  try {
    const localFonts = await (window as any).queryLocalFonts?.();
    if (Array.isArray(localFonts)) {
      localFonts.forEach((entry) => {
        if (entry && typeof entry.family === "string" && entry.family.trim()) {
          discovered.add(entry.family.trim());
        }
      });
    }
  } catch {
    // Ignore Local Font Access errors and fallback to candidate detection.
  }

  if (discovered.size === 0) {
    detectInstalledFontsFromCandidates(UI_FONT_DETECTION_CANDIDATES).forEach((font) => {
      discovered.add(font);
    });
  }

  return Array.from(discovered).sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

export { applyUserMessageBubbleCssVars };
