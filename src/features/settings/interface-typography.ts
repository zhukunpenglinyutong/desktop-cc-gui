import { writeStored } from "@/lib/storage";

export const FONT_SIZE_LIMITS = { min: 10, max: 32 };
export const TYPOGRAPHY_DEFAULTS = {
  uiFontSize: 16,
  contentFontSize: 14,
  codeFontSize: 13,
  uiFontWeight: "standard",
  uiTextContrast: "standard",
  sidebarFontSize: null,
  sidebarFontWeight: null,
};
export type FontSizeField = "uiFontSize" | "contentFontSize" | "codeFontSize";
export const UI_FONT_WEIGHTS = ["standard", "medium", "bold"] as const;
export type UiFontWeight = (typeof UI_FONT_WEIGHTS)[number];

export interface InterfaceTypographyPreferences {
  uiFontSize?: number;
  contentFontSize?: number;
  codeFontSize?: number;
  uiFontWeight?: string;
  uiTextContrast?: string;
  sidebarFontSize?: number | null;
  sidebarFontWeight?: number | null;
}

const storageKey = (field: keyof InterfaceTypographyPreferences) =>
  `ccgui-next.typography.${field}:v1`;

export function normalizeFontSize(field: FontSizeField, value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value)
    && value >= FONT_SIZE_LIMITS.min && value <= FONT_SIZE_LIMITS.max
    ? value : TYPOGRAPHY_DEFAULTS[field];
}

export function fontWeightOffset(value: string | undefined): number {
  if (value === "medium") return 100;
  if (value === "bold") return 200;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(200, Math.max(0, n))) : 0;
}

export function normalizeUiFontWeight(value: string | undefined): string {
  const n = fontWeightOffset(value);
  return n === 0 ? "standard" : n === 100 ? "medium" : n === 200 ? "bold" : String(n);
}

export function textContrastAmount(value: string | undefined): number {
  if (value === "enhanced") return 100;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(100, Math.max(0, n))) : 0;
}

export function normalizeTextContrast(value: string | undefined): string {
  const n = textContrastAmount(value);
  return n === 0 ? "standard" : n === 100 ? "enhanced" : String(n);
}

export function normalizeSidebarFontSize(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value)
    && value >= FONT_SIZE_LIMITS.min && value <= FONT_SIZE_LIMITS.max ? value : null;
}

export function normalizeSidebarFontWeight(value: number | null | undefined): number | null {
  return value === 400 || value === 500 || value === 600 ? value : null;
}

export function applyInterfaceTypography(prefs: InterfaceTypographyPreferences): void {
  const uiSize = normalizeFontSize("uiFontSize", prefs.uiFontSize);
  const contentSize = normalizeFontSize("contentFontSize", prefs.contentFontSize);
  const codeSize = normalizeFontSize("codeFontSize", prefs.codeFontSize);
  const weight = normalizeUiFontWeight(prefs.uiFontWeight);
  const contrast = normalizeTextContrast(prefs.uiTextContrast);
  document.documentElement.dataset.textContrast = contrast === "standard" ? "standard" : "enhanced";
  const style = document.documentElement.style;
  const sidebarSize = normalizeSidebarFontSize(prefs.sidebarFontSize);
  const sidebarWeight = normalizeSidebarFontWeight(prefs.sidebarFontWeight);
  if (sidebarSize === null) {
    style.removeProperty("--sidebar-title-font-size");
    style.removeProperty("--sidebar-title-line-height");
  } else {
    style.setProperty("--sidebar-title-font-size", `${sidebarSize}px`);
    style.setProperty("--sidebar-title-line-height", `${sidebarSize * 18 / 13}px`);
  }
  if (sidebarWeight === null) style.removeProperty("--sidebar-title-font-weight");
  else style.setProperty("--sidebar-title-font-weight", String(sidebarWeight));
  style.setProperty("--ui-font-scale", String(uiSize / TYPOGRAPHY_DEFAULTS.uiFontSize));
  style.setProperty("--content-font-scale", String(contentSize / TYPOGRAPHY_DEFAULTS.contentFontSize));
  style.setProperty("--code-font-size", `${codeSize}px`);
  style.setProperty("--code-font-scale", String(codeSize / TYPOGRAPHY_DEFAULTS.codeFontSize));
  style.setProperty("--ui-text-contrast", `${textContrastAmount(contrast)}%`);
  const offset = fontWeightOffset(weight);
  style.setProperty("--ui-font-weight-offset", String(offset));
  writeStored(storageKey("uiFontSize"), String(uiSize));
  writeStored(storageKey("contentFontSize"), String(contentSize));
  writeStored(storageKey("codeFontSize"), String(codeSize));
  writeStored(storageKey("uiFontWeight"), weight);
  writeStored(storageKey("uiTextContrast"), contrast);
  writeStored(storageKey("sidebarFontSize"), String(sidebarSize));
  writeStored(storageKey("sidebarFontWeight"), String(sidebarWeight));
}

export function readCachedInterfaceTypography(): InterfaceTypographyPreferences {
  const size = (field: FontSizeField) => normalizeFontSize(
    field, Number(localStorage.getItem(storageKey(field)) ?? TYPOGRAPHY_DEFAULTS[field]),
  );
  return {
    sidebarFontSize: normalizeSidebarFontSize(Number(localStorage.getItem(storageKey("sidebarFontSize")))),
    sidebarFontWeight: normalizeSidebarFontWeight(Number(localStorage.getItem(storageKey("sidebarFontWeight")))),
    uiFontSize: size("uiFontSize"),
    contentFontSize: size("contentFontSize"),
    codeFontSize: size("codeFontSize"),
    uiFontWeight: normalizeUiFontWeight(localStorage.getItem(storageKey("uiFontWeight")) ?? undefined),
    uiTextContrast: normalizeTextContrast(localStorage.getItem(storageKey("uiTextContrast")) ?? undefined),
  };
}
