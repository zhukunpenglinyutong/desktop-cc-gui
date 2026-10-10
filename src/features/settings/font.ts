import { ipc } from "@/lib/ipc";
import {
  applyInterfaceTypography,
  readCachedInterfaceTypography,
  type InterfaceTypographyPreferences,
} from "./interface-typography";
import { writeStored } from "@/lib/storage";

/** localStorage mirrors of the app-settings font preferences, read pre-paint
 *  by bootstrap.tsx (same pattern as THEME_STORAGE_KEY). Value semantics:
 *  "" = 系统默认 (bundled stack + system fallback), "custom" = the uploaded
 *  font file mirrored in the matching `*-file` key. */
export const FONT_FAMILY_STORAGE_KEY = "ccgui-next.font-family:v1";
export const CODE_FONT_FAMILY_STORAGE_KEY = "ccgui-next.code-font-family:v1";
export const FONT_FILE_STORAGE_KEY = "ccgui-next.font-file:v1";
export const CODE_FONT_FILE_STORAGE_KEY = "ccgui-next.code-font-file:v1";
/** Window event fired after font preferences are (re)applied and after an
 *  uploaded face finishes loading; the terminal re-reads its fontFamily. */
export const FONT_CHANGE_EVENT = "ccgui:font-change";

/** Stored `fontFamily` / `codeFontFamily` value meaning "the uploaded file". */
export const CUSTOM_FONT_VALUE = "custom";

const UI_SYSTEM_STACK = "ui-sans-serif, system-ui, sans-serif";
const CODE_SYSTEM_STACK = 'ui-monospace, "SFMono-Regular", Menlo, monospace';

/** Internal family names for uploaded files. Distinct per row so one file
 *  uploaded for both rows registers as two faces, and stable across launches
 *  so the persisted CSS stack keeps pointing at the right face. */
export const CUSTOM_UI_FONT_FAMILY = "CCGUI Custom UI Font";
export const CUSTOM_CODE_FONT_FAMILY = "CCGUI Custom Code Font";

export type CustomFontRole = "ui" | "code";
/** Settings fields carrying each row's mode / uploaded path. */
export type FontField = "fontFamily" | "codeFontFamily";

export interface FontPreferences extends InterfaceTypographyPreferences {
  fontFamily: string;
  codeFontFamily: string;
  fontFile: string;
  codeFontFile: string;
}

export function normalizeFontFamily(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/** Font preference mode: "" = 系统默认, "custom" = the uploaded file. The
 *  界面字体/代码字体 select merged 默认 and 系统 into one option, so every
 *  legacy value ("system", an installed family name written by the pre-upload
 *  picker) collapses to the default and its root variable is dropped. */
export function normalizeFontMode(value: string | null | undefined): string {
  return normalizeFontFamily(value) === CUSTOM_FONT_VALUE ? CUSTOM_FONT_VALUE : "";
}

export function fontRole(field: FontField): CustomFontRole {
  return field === "fontFamily" ? "ui" : "code";
}

export function customFontFamily(role: CustomFontRole): string {
  return role === "ui" ? CUSTOM_UI_FONT_FAMILY : CUSTOM_CODE_FONT_FAMILY;
}

/** CSS family stack behind a preference value, or null for 系统默认 (root
 *  variable left untouched so theme.css keeps its own stack). */
export function uiFontStack(pref: string): string | null {
  return fontStack(pref, CUSTOM_UI_FONT_FAMILY, UI_SYSTEM_STACK);
}

export function codeFontStack(pref: string): string | null {
  return fontStack(pref, CUSTOM_CODE_FONT_FAMILY, CODE_SYSTEM_STACK);
}

function fontStack(pref: string, customFamily: string, fallback: string): string | null {
  if (normalizeFontMode(pref) !== CUSTOM_FONT_VALUE) return null;
  return `${JSON.stringify(customFamily)}, ${fallback}`;
}

/** Apply preferences to the document root, mirror them into storage for the
 *  next pre-paint read, and notify listeners (terminal). All four fields are
 *  required: a partial patch would silently reset the other font. Uploaded
 *  files are registered in the background — the stack above falls back until
 *  the face is ready, and an unreadable file never drops the setting. */
export function applyFontPreferences(prefs: FontPreferences): void {
  applyInterfaceTypography(prefs);
  const fontFamily = normalizeFontMode(prefs.fontFamily);
  const codeFontFamily = normalizeFontMode(prefs.codeFontFamily);
  const fontFile = normalizeFontFamily(prefs.fontFile);
  const codeFontFile = normalizeFontFamily(prefs.codeFontFile);
  const style = document.documentElement.style;
  const uiStack = uiFontStack(fontFamily);
  const codeStack = codeFontStack(codeFontFamily);
  if (uiStack === null) style.removeProperty("--font-inter");
  else style.setProperty("--font-inter", uiStack);
  if (codeStack === null) style.removeProperty("--font-mono-source");
  else style.setProperty("--font-mono-source", codeStack);
  writeStored(FONT_FAMILY_STORAGE_KEY, fontFamily);
  writeStored(CODE_FONT_FAMILY_STORAGE_KEY, codeFontFamily);
  writeStored(FONT_FILE_STORAGE_KEY, fontFile);
  writeStored(CODE_FONT_FILE_STORAGE_KEY, codeFontFile);
  if (fontFamily === CUSTOM_FONT_VALUE) {
    void ensureCustomFontLoaded("ui", fontFile).catch(() => {});
  }
  if (codeFontFamily === CUSTOM_FONT_VALUE) {
    void ensureCustomFontLoaded("code", codeFontFile).catch(() => {});
  }
  window.dispatchEvent(new Event(FONT_CHANGE_EVENT));
}

export function readCachedFontPreferences(): FontPreferences {
  return {
    ...readCachedInterfaceTypography(),
    fontFamily: normalizeFontMode(localStorage.getItem(FONT_FAMILY_STORAGE_KEY)),
    codeFontFamily: normalizeFontMode(localStorage.getItem(CODE_FONT_FAMILY_STORAGE_KEY)),
    fontFile: normalizeFontFamily(localStorage.getItem(FONT_FILE_STORAGE_KEY)),
    codeFontFile: normalizeFontFamily(localStorage.getItem(CODE_FONT_FILE_STORAGE_KEY)),
  };
}

/** The registered face per row; a new pick replaces the previous face on the
 *  same family instead of stacking two candidates. */
const registeredFaces = new Map<CustomFontRole, FontFace>();
/** In-flight/completed loads keyed by row, so re-applying the same path never
 *  re-reads the file. `force` is the explicit re-pick path. */
const fontLoads = new Map<CustomFontRole, { path: string; promise: Promise<void> }>();

/**
 * Read, register and load the uploaded font file for one row. Resolves once
 * the face is usable (or immediately when the environment has no FontFace
 * API); rejections are cached together with the path until a forced re-pick.
 */
export function ensureCustomFontLoaded(
  role: CustomFontRole,
  path: string,
  options?: { force?: boolean },
): Promise<void> {
  const value = normalizeFontFamily(path);
  if (!value) return Promise.resolve();
  const cached = fontLoads.get(role);
  if (!options?.force && cached?.path === value) return cached.promise;
  const promise = loadCustomFont(role, value);
  // A rejected load still belongs to its path (re-applying a stale value must
  // not re-read the disk every settings open); callers that need a retry pass
  // force. Park a no-op catch so the map's copy is never an unhandled
  // rejection, while the returned promise still rejects for the caller.
  promise.catch(() => {});
  fontLoads.set(role, { path: value, promise });
  return promise;
}

async function loadCustomFont(role: CustomFontRole, path: string): Promise<void> {
  // Environments without the FontFace API (jsdom in tests) cannot register a
  // face; the preference still persists and applies where supported. Checked
  // before the read so the skip path does not touch the disk.
  if (typeof FontFace === "undefined" || !document.fonts) return;
  const encoded = await ipc.readFontFile(path);
  const face = new FontFace(customFontFamily(role), decodeBase64(encoded));
  let loaded: FontFace;
  try {
    loaded = await face.load();
  } catch {
    throw new Error("font.err.unsupported");
  }
  const previous = registeredFaces.get(role);
  if (previous) document.fonts.delete(previous);
  document.fonts.add(loaded);
  registeredFaces.set(role, loaded);
  // The terminal measures its font when it opens; let it re-read now that the
  // face can render instead of falling back to the monospace stack.
  window.dispatchEvent(new Event(FONT_CHANGE_EVENT));
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Stable backend error codes → localized text; technical errors pass through. */
const FONT_ERROR_KEYS: Record<string, string> = {
  "font.err.read_failed": "settings.fontErrRead",
  "font.err.too_large": "settings.fontErrTooLarge",
  "font.err.unsupported": "settings.fontErrUnsupported",
};

export function fontErrorMessage(error: unknown, t: (key: string) => string): string {
  const raw = String(error);
  const key = FONT_ERROR_KEYS[raw.trim()];
  return key ? t(key) : raw;
}
