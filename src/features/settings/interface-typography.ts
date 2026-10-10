import { writeStored } from "@/lib/storage";

export const FONT_SIZE_LIMITS = { min: 10, max: 32 };
export const TYPOGRAPHY_DEFAULTS = {
  uiFontSize: 16,
  contentFontSize: 14,
  codeFontSize: 13,
  uiFontWeight: "standard",
};
export type FontSizeField = "uiFontSize" | "contentFontSize" | "codeFontSize";
export const UI_FONT_WEIGHTS = ["standard", "medium", "bold"] as const;
export type UiFontWeight = (typeof UI_FONT_WEIGHTS)[number];

export interface InterfaceTypographyPreferences {
  uiFontSize?: number;
  contentFontSize?: number;
  codeFontSize?: number;
  uiFontWeight?: string;
}

const storageKey = (field: keyof InterfaceTypographyPreferences) =>
  `ccgui-next.typography.${field}:v1`;

export function normalizeFontSize(field: FontSizeField, value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value)
    && value >= FONT_SIZE_LIMITS.min && value <= FONT_SIZE_LIMITS.max
    ? value : TYPOGRAPHY_DEFAULTS[field];
}

export function normalizeUiFontWeight(value: string | undefined): UiFontWeight {
  return value === "medium" || value === "bold" ? value : "standard";
}

export function applyInterfaceTypography(prefs: InterfaceTypographyPreferences): void {
  const uiSize = normalizeFontSize("uiFontSize", prefs.uiFontSize);
  const contentSize = normalizeFontSize("contentFontSize", prefs.contentFontSize);
  const codeSize = normalizeFontSize("codeFontSize", prefs.codeFontSize);
  const weight = normalizeUiFontWeight(prefs.uiFontWeight);
  const style = document.documentElement.style;
  style.setProperty("--ui-font-scale", String(uiSize / TYPOGRAPHY_DEFAULTS.uiFontSize));
  style.setProperty("--content-font-scale", String(contentSize / TYPOGRAPHY_DEFAULTS.contentFontSize));
  style.setProperty("--code-font-size", `${codeSize}px`);
  style.setProperty("--code-font-scale", String(codeSize / TYPOGRAPHY_DEFAULTS.codeFontSize));
  const offset = weight === "bold" ? 200 : weight === "medium" ? 100 : 0;
  style.setProperty("--ui-font-weight-offset", String(offset));
  writeStored(storageKey("uiFontSize"), String(uiSize));
  writeStored(storageKey("contentFontSize"), String(contentSize));
  writeStored(storageKey("codeFontSize"), String(codeSize));
  writeStored(storageKey("uiFontWeight"), weight);
}

export function readCachedInterfaceTypography(): InterfaceTypographyPreferences {
  const size = (field: FontSizeField) => normalizeFontSize(
    field, Number(localStorage.getItem(storageKey(field)) ?? TYPOGRAPHY_DEFAULTS[field]),
  );
  return {
    uiFontSize: size("uiFontSize"),
    contentFontSize: size("contentFontSize"),
    codeFontSize: size("codeFontSize"),
    uiFontWeight: normalizeUiFontWeight(localStorage.getItem(storageKey("uiFontWeight")) ?? undefined),
  };
}
