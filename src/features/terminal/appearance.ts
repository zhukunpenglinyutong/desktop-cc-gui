import type { ITheme } from "@xterm/xterm";
import {
  codeFontStack,
  DEFAULT_CODE_FONT_STACK,
  readCachedFontPreferences,
} from "@/features/settings/font";

/** 代码字体 fallback size; mirrors TYPOGRAPHY_DEFAULTS.codeFontSize. */
export const TERMINAL_DEFAULT_FONT_SIZE = 13;

/**
 * The live `--font-mono` stack exactly as the browser resolves it (var()
 * references already substituted), so the terminal canvas uses the same face
 * as code blocks — including an uploaded custom font. Empty when the variable
 * cannot be read (jsdom, or the stylesheet not applied yet).
 */
export function computedMonoFontStack(): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "";
  try {
    return getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  } catch {
    return "";
  }
}

/**
 * Terminal font family: mirrors 设置 → 通用 → 外观 → 代码字体.
 *
 * Prefers the computed `--font-mono` so the canvas always matches code blocks;
 * falls back to the localStorage mirror (the terminal has no settings prop
 * chain, and the CSS variable is unreadable before the stylesheet applies)
 * and finally to the bundled default stack.
 */
export function terminalFontFamily(): string {
  return (
    computedMonoFontStack()
    // An empty computed/mirror value means "系统默认"; the mirror returns null
    // for it, so `||` (not `??`) also catches a bare empty string.
    || codeFontStack(readCachedFontPreferences().codeFontFamily)
    || DEFAULT_CODE_FONT_STACK
  );
}

/** Terminal font size, mirroring the 代码 font size preference (default 13). */
export function terminalFontSize(): number {
  return readCachedFontPreferences().codeFontSize ?? TERMINAL_DEFAULT_FONT_SIZE;
}

/**
 * Palettes keyed off the app's `.dark` class rather than read from CSS
 * variables: Tailwind v4 tokens serialize as oklch()/color-mix(), which
 * xterm's color parser (hex/rgb only) rejects. Values mirror the app theme:
 * dark background matches --color-neutral-925 (#0d0d0d), ANSI colors follow
 * the VS Code dark/light palettes.
 */
export function terminalTheme(): ITheme {
  if (document.documentElement.classList.contains("dark")) {
    return {
      background: "#0d0d0d",
      foreground: "#e6e6e6",
      cursor: "#e6e6e6",
      selectionBackground: "rgba(255, 255, 255, 0.22)",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#ffffff",
    };
  }
  return {
    background: "#ffffff",
    foreground: "#1f2328",
    cursor: "#1f2328",
    selectionBackground: "rgba(0, 0, 0, 0.16)",
    black: "#000000",
    red: "#cd3131",
    green: "#00bc00",
    yellow: "#9a6700",
    blue: "#0451a5",
    magenta: "#bc05bc",
    cyan: "#0598bc",
    white: "#555555",
    brightBlack: "#666666",
    brightRed: "#cd3131",
    brightGreen: "#14ce14",
    brightYellow: "#7d5500",
    brightBlue: "#0451a5",
    brightMagenta: "#bc05bc",
    brightCyan: "#0598bc",
    brightWhite: "#a5a5a5",
  };
}
