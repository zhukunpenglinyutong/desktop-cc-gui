import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@/lib/ipc";

// GeneralSection reads settings on mount; updateAppSettings is the
// persistence assertion point; readFontFile delivers the uploaded bytes.
const { getAppSettings, updateAppSettings, readFontFile, pickFile } = vi.hoisted(() => ({
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(async () => null),
  readFontFile: vi.fn(async () => btoa("\x00\x01\x00\x00fake-font-bytes")),
  pickFile: vi.fn(async () => null as string | null),
}));
vi.mock("@/lib/ipc", () => ({
  ipc: new Proxy(
    { getAppSettings, updateAppSettings, readFontFile },
    {
      get: (target, prop) =>
        prop in target ? Reflect.get(target, prop) : async () => null,
    },
  ),
}));
vi.mock("@/lib/platform", () => ({
  IS_WINDOWS: false,
  isWeb: false,
  pickFile,
  // zoom.ts funnels through the platform shim; a plain stub keeps the zoom row
  // testable without Tauri's webview API.
  setWebviewZoom: vi.fn(),
}));
// Render as the native desktop client (jsdom otherwise looks like the web
// bridge, which skips the zoom shortcut wiring).
vi.mock("@/lib/transport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transport")>()),
  isWeb: false,
}));

import i18n from "@/lib/i18n";
import {
  applyFontPreferences,
  codeFontStack,
  CUSTOM_CODE_FONT_FAMILY,
  CUSTOM_UI_FONT_FAMILY,
  FONT_CHANGE_EVENT,
  readCachedFontPreferences,
  uiFontStack,
} from "./font";
import { GeneralSection } from "./GeneralSection";
import { useChatStore } from "@/features/chat/store";
import { terminalFontFamily } from "@/features/terminal/appearance";
import { changeZoom, onZoomChange, readZoomPct, ZOOM_KEY } from "@/lib/zoom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lacks CSS.escape, which react-aria's listbox calls when a Select
// opens (useSelectableCollection). Keys here are plain words, so a minimal
// polyfill suffices.
if (typeof window.CSS === "undefined" || typeof window.CSS.escape !== "function") {
  const css = (window.CSS ?? {}) as { escape?: (value: string) => string };
  css.escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  window.CSS = css as typeof CSS;
}

/** jsdom has neither FontFace nor document.fonts; the app registers uploaded
 *  files through them, so the test keeps a set of registered faces. */
const registeredFaces = new Set<{ family: string }>();
class FakeFontFace {
  family: string;
  source: unknown;
  constructor(family: string, source: unknown) {
    this.family = family;
    this.source = source;
  }
  async load() {
    return this;
  }
}
vi.stubGlobal("FontFace", FakeFontFace);
Object.defineProperty(document, "fonts", {
  configurable: true,
  value: {
    add: (face: { family: string }) => void registeredFaces.add(face),
    delete: (face: { family: string }) => void registeredFaces.delete(face),
    has: (face: { family: string }) => registeredFaces.has(face),
  },
});

const SETTINGS = {
  theme: "light",
  titlebar: "native",
  language: "zh",
  sidebarThreadLimit: 5,
  uiFontSize: 16,
  contentFontSize: 14,
  codeFontSize: 13,
  uiFontWeight: "standard",
  uiTextContrast: "standard",
  sidebarFontSize: null,
  sidebarFontWeight: null,
  fontFamily: "",
  fontFile: "",
  codeFontFamily: "",
  codeFontFile: "",
  composerSendShortcut: "enter",
  thinkingAutoCollapse: true,
  petEnabled: false,
  petScale: 1,
  petId: "",
  customModels: {},
} as unknown as AppSettings;

/** react-aria pairs pointerdown + click when PointerEvent exists and the
 *  mousedown/up pair otherwise; dispatching the whole sequence keeps presses
 *  working regardless of the jsdom code path (same pattern as
 *  PluginScreenshotCarousel.test.tsx). */
async function press(el: Element) {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  });
}

/** Let every pending async step (dialog → read → FontFace → save) settle. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function row(anchor: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-setting-anchor="${anchor}"]`);
  if (!el) throw new Error(`row not rendered: ${anchor}`);
  return el;
}

/** Open a row's Select and pick the option with the given text. */
async function selectOption(anchor: string, optionText: string) {
  const slider = row(anchor).querySelector<HTMLInputElement>('input[type="range"]');
  if (slider) {
    const value = anchor === "uiFontWeight"
      ? optionText === i18n.t("settings.uiFontWeight_bold") ? "200"
        : optionText === i18n.t("settings.uiFontWeight_medium") ? "100" : "0"
      : optionText === i18n.t("settings.uiTextContrast_enhanced") ? "100" : "0";
    await editSlider(anchor, value);
    return;
  }
  const trigger = row(anchor).querySelectorAll("button")[0];
  if (!trigger) throw new Error(`no select trigger in row ${anchor}`);
  await press(trigger);
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (el) => el.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`option not rendered: ${optionText}`);
  await press(option);
}

async function editSlider(anchor: string, value: string) {
  const input = row(anchor).querySelector<HTMLInputElement>('input[type="range"]')!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.blur());
  await flush();
}

async function editSize(anchor: string, value: string) {
  const input = row(anchor).querySelector("input")!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => input.blur());
  await flush();
}

/** The file-picker button is the second control in a custom-mode font row. */
function fileButton(anchor: string): HTMLElement {
  const button = row(anchor).querySelectorAll("button")[1];
  if (!button) throw new Error(`no file picker in row ${anchor}`);
  return button;
}

describe("font preference stacks", () => {
  it("maps 系统默认/custom values to CSS family stacks", () => {
    expect(uiFontStack("")).toBeNull();
    expect(uiFontStack("custom")).toBe(
      `"${CUSTOM_UI_FONT_FAMILY}", ui-sans-serif, system-ui, sans-serif`,
    );
    expect(codeFontStack("")).toBeNull();
    expect(codeFontStack("custom")).toContain(`"${CUSTOM_CODE_FONT_FAMILY}"`);
    // Legacy values (the old "system" option, installed family names written
    // before the upload picker) collapse to 系统默认: the root variable is
    // left to theme.css instead of applying a half-supported family.
    expect(uiFontStack("system")).toBeNull();
    expect(codeFontStack("system")).toBeNull();
    expect(uiFontStack("LXGW WenKai")).toBeNull();
  });

  it("applies preferences to root variables, mirrors storage, and notifies", () => {
    let notified = 0;
    const listener = () => {
      notified += 1;
    };
    window.addEventListener(FONT_CHANGE_EVENT, listener);
    try {
      applyFontPreferences({
        fontFamily: "custom",
        codeFontFamily: "custom",
        fontFile: "/tmp/My Font.ttf",
        codeFontFile: "/tmp/My Code.ttf",
      });
      const style = document.documentElement.style;
      expect(style.getPropertyValue("--font-inter")).toContain(`"${CUSTOM_UI_FONT_FAMILY}"`);
      expect(style.getPropertyValue("--font-mono-source")).toContain(
        `"${CUSTOM_CODE_FONT_FAMILY}"`,
      );
      expect(readCachedFontPreferences()).toEqual({
        uiFontSize: 16,
        contentFontSize: 14,
        codeFontSize: 13,
        uiFontWeight: "standard",
        uiTextContrast: "standard",
        sidebarFontSize: null,
        sidebarFontWeight: null,
        fontFamily: "custom",
        codeFontFamily: "custom",
        fontFile: "/tmp/My Font.ttf",
        codeFontFile: "/tmp/My Code.ttf",
      });
      expect(notified).toBe(1);

      // Back to 系统默认: the variables are removed so theme.css wins again.
      applyFontPreferences({
        fontFamily: "",
        codeFontFamily: "",
        fontFile: "",
        codeFontFile: "",
      });
      expect(style.getPropertyValue("--font-inter")).toBe("");
      expect(style.getPropertyValue("--font-mono-source")).toBe("");
      expect(notified).toBe(2);
    } finally {
      window.removeEventListener(FONT_CHANGE_EVENT, listener);
    }
  });

  it("normalizes the legacy system value to 系统默认 in the mirror", () => {
    applyFontPreferences({
      fontFamily: "system",
      codeFontFamily: "system",
      fontFile: "/tmp/remembered.ttf",
      codeFontFile: "",
    });
    expect(document.documentElement.style.getPropertyValue("--font-inter")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--font-mono-source")).toBe("");
    // The remembered path survives so switching back to 自定义 re-applies it.
    expect(readCachedFontPreferences()).toEqual({
      uiFontSize: 16,
      contentFontSize: 14,
      codeFontSize: 13,
      uiFontWeight: "standard",
      uiTextContrast: "standard",
      sidebarFontSize: null,
      sidebarFontWeight: null,
      fontFamily: "",
      codeFontFamily: "",
      fontFile: "/tmp/remembered.ttf",
      codeFontFile: "",
    });
  });

  it("terminal font follows the code font preference, default keeps the legacy stack", () => {
    applyFontPreferences({
      fontFamily: "",
      codeFontFamily: "",
      fontFile: "",
      codeFontFile: "",
    });
    expect(terminalFontFamily()).toBe('Menlo, Monaco, "Courier New", monospace');
    applyFontPreferences({
      fontFamily: "",
      codeFontFamily: "custom",
      fontFile: "",
      codeFontFile: "/tmp/MapleMono.ttf",
    });
    expect(terminalFontFamily()).toBe(
      `"${CUSTOM_CODE_FONT_FAMILY}", ui-monospace, "SFMono-Regular", Menlo, monospace`,
    );
    applyFontPreferences({
      fontFamily: "",
      codeFontFamily: "",
      fontFile: "",
      codeFontFile: "",
    });
  });
});

describe("interface zoom", () => {
  beforeEach(() => localStorage.removeItem(ZOOM_KEY));

  it("snaps to the step grid, clamps to bounds, and notifies listeners", () => {
    const seen: number[] = [];
    const off = onZoomChange((pct) => seen.push(pct));
    try {
      expect(changeZoom(124)).toBe(120);
      expect(changeZoom(999)).toBe(200);
      expect(changeZoom(1)).toBe(50);
      expect(seen).toEqual([120, 200, 50]);
      expect(readZoomPct()).toBe(50);
    } finally {
      off();
    }
  });

  it("falls back to 100 on missing or corrupt storage", () => {
    expect(readZoomPct()).toBe(100);
    localStorage.setItem(ZOOM_KEY, "not-a-number");
    expect(readZoomPct()).toBe(100);
    localStorage.setItem(ZOOM_KEY, "9999");
    expect(readZoomPct()).toBe(100);
  });
});

describe("General section rows", () => {
  let container: HTMLDivElement;
  let root: Root;

  async function mount(settings: Partial<AppSettings> = {}) {
    getAppSettings.mockResolvedValue({ ...structuredClone(SETTINGS), ...settings });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<GeneralSection />);
    });
  }

  beforeEach(async () => {
    localStorage.clear();
    registeredFaces.clear();
    document.documentElement.style.removeProperty("--font-inter");
    document.documentElement.style.removeProperty("--font-mono-source");
    updateAppSettings.mockClear();
    readFontFile.mockClear();
    pickFile.mockReset();
    pickFile.mockResolvedValue(null);
    await mount();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("sidebar follows existing rules by default and stores absolute overrides", async () => {
    applyFontPreferences(SETTINGS);
    await press(row("typographyAdvanced"));
    expect(row("sidebarFontSize").querySelector("input")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-size")).toBe("");
    await selectOption("sidebarFontSize", i18n.t("settings.fontCustom"));
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-size")).toBe("16px");
    getAppSettings.mockResolvedValue({ ...SETTINGS, sidebarFontSize: 16 });
    await editSize("sidebarFontSize", "18");
    getAppSettings.mockResolvedValue({ ...SETTINGS, sidebarFontSize: 18 });
    await selectOption("sidebarFontWeight", i18n.t("settings.sidebarWeightRegular"));
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      sidebarFontSize: 18, sidebarFontWeight: 400, uiFontSize: 16, uiFontWeight: "standard",
    }));
    const cached = readCachedFontPreferences();
    applyFontPreferences({ ...cached, uiFontSize: 24, uiFontWeight: "bold" });
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-size")).toBe("18px");
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-weight")).toBe("400");
    document.documentElement.style.removeProperty("--sidebar-title-font-size");
    applyFontPreferences(cached);
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-size")).toBe("18px");
  });

  it("following interface and restoring sidebar clear only overrides", async () => {
    applyFontPreferences({ ...SETTINGS, sidebarFontSize: 18, sidebarFontWeight: 400 });
    await press(row("typographyAdvanced"));
    await selectOption("sidebarFontSize", i18n.t("settings.fontCustom"));
    getAppSettings.mockResolvedValue({ ...SETTINGS, sidebarFontSize: 16, sidebarFontWeight: 400 });
    await selectOption("sidebarFontWeight", i18n.t("settings.sidebarWeightRegular"));
    await selectOption("sidebarFontSize", i18n.t("settings.sidebarTypographyInherit"));
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-size")).toBe("");
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-weight")).toBe("400");
    const reset = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === i18n.t("settings.sidebarTypographyReset"),
    )!;
    await press(reset);
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      sidebarFontSize: null, sidebarFontWeight: null, uiFontSize: 16, uiTextContrast: "standard",
    }));
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-weight")).toBe("");
    expect(readCachedFontPreferences().sidebarFontSize).toBeNull();
  });

  it("a failed sidebar save preserves the inherited typography", async () => {
    applyFontPreferences(SETTINGS);
    await press(row("typographyAdvanced"));
    updateAppSettings.mockRejectedValueOnce(new Error("sidebar save failed"));
    await selectOption("sidebarFontSize", i18n.t("settings.fontCustom"));
    expect(row("sidebarFontSize").querySelector("input")).toBeNull();
    expect(document.documentElement.style.getPropertyValue("--sidebar-title-font-size")).toBe("");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("sidebar save failed");
  });

  it("contrast applies independently, persists and restores before paint", async () => {
    await press(row("typographyAdvanced"));
    await selectOption("uiFontWeight", i18n.t("settings.uiFontWeight_medium"));
    getAppSettings.mockResolvedValue({ ...SETTINGS, uiFontWeight: "medium" });
    await selectOption("uiTextContrast", i18n.t("settings.uiTextContrast_enhanced"));
    expect(document.documentElement.dataset.textContrast).toBe("enhanced");
    expect(document.documentElement.style.getPropertyValue("--ui-font-weight-offset")).toBe("100");
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      uiTextContrast: "enhanced", uiFontSize: 16, uiFontWeight: "medium",
    }));
    const cached = readCachedFontPreferences();
    document.documentElement.dataset.textContrast = "standard";
    applyFontPreferences(cached);
    expect(document.documentElement.dataset.textContrast).toBe("enhanced");
    await selectOption("uiTextContrast", i18n.t("settings.uiTextContrast_standard"));
    expect(document.documentElement.dataset.textContrast).toBe("standard");
  });

  it("failed contrast save restores the previous contrast", async () => {
    applyFontPreferences(SETTINGS);
    await press(row("typographyAdvanced"));
    updateAppSettings.mockRejectedValueOnce(new Error("contrast save failed"));
    await selectOption("uiTextContrast", i18n.t("settings.uiTextContrast_enhanced"));
    expect(document.documentElement.dataset.textContrast).toBe("standard");
    expect(readCachedFontPreferences().uiTextContrast).toBe("standard");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("contrast save failed");
  });

  it("slider previews before release and persists once when keyboard adjustment ends", async () => {
    await press(row("typographyAdvanced"));
    const slider = row("uiTextContrast").querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => {
      slider.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "37");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.documentElement.style.getPropertyValue("--ui-text-contrast")).toBe("37%");
    expect(updateAppSettings).not.toHaveBeenCalled();
    await act(async () => slider.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })));
    await flush();
    await act(async () => slider.blur());
    expect(updateAppSettings).toHaveBeenCalledTimes(1);
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({ uiTextContrast: "37" }));
  });

  it("continuous weight and contrast values persist and restore from the startup mirror", async () => {
    await press(row("typographyAdvanced"));
    await editSlider("uiFontWeight", "73");
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({ uiFontWeight: "73" }));
    expect(document.documentElement.style.getPropertyValue("--ui-font-weight-offset")).toBe("73");
    getAppSettings.mockResolvedValue({ ...SETTINGS, uiFontWeight: "73" });
    await editSlider("uiTextContrast", "42");
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({ uiTextContrast: "42" }));
    const cached = readCachedFontPreferences();
    document.documentElement.removeAttribute("style");
    applyFontPreferences(cached);
    expect(document.documentElement.style.getPropertyValue("--ui-font-weight-offset")).toBe("73");
    expect(document.documentElement.style.getPropertyValue("--ui-text-contrast")).toBe("42%");
  });

  it("font size buttons step by one, respect bounds, and restore after save failure", async () => {
    await press(row("typographyAdvanced"));
    const increase = () => row("uiFontSize").querySelector<HTMLButtonElement>('[aria-label="增大界面字号"]')!;
    const decrease = () => row("uiFontSize").querySelector<HTMLButtonElement>('[aria-label="减小界面字号"]')!;
    await press(increase());
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({ uiFontSize: 17 }));
    expect(row("uiFontSize").querySelector("input")?.value).toBe("17");
    getAppSettings.mockResolvedValue({ ...SETTINGS, uiFontSize: 17 });
    await press(decrease());
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({ uiFontSize: 16 }));
    getAppSettings.mockResolvedValue(SETTINGS);
    updateAppSettings.mockRejectedValueOnce(new Error("step save failed"));
    await press(increase());
    expect(row("uiFontSize").querySelector("input")?.value).toBe("16");
    await editSize("uiFontSize", "10");
    expect(decrease().disabled).toBe(true);
    expect(increase().disabled).toBe(false);
    await editSize("uiFontSize", "32");
    expect(increase().disabled).toBe(true);
    expect(decrease().disabled).toBe(false);
  });

  it("independent px sizes and weight persist and restore before paint", async () => {
    await press(row("typographyAdvanced"));
    await editSize("uiFontSize", "18");
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({ uiFontSize: 18 }));
    expect(document.documentElement.style.getPropertyValue("--ui-font-scale")).toBe("1.125");
    getAppSettings.mockResolvedValue({ ...SETTINGS, uiFontSize: 18 });
    await editSize("contentFontSize", "20");
    expect(document.documentElement.style.getPropertyValue("--content-font-scale")).toBe(String(20 / 14));
    getAppSettings.mockResolvedValue({ ...SETTINGS, uiFontSize: 18, contentFontSize: 20 });
    await editSize("codeFontSize", "15");
    expect(document.documentElement.style.getPropertyValue("--code-font-size")).toBe("15px");
    getAppSettings.mockResolvedValue({ ...SETTINGS, uiFontSize: 18, contentFontSize: 20, codeFontSize: 15 });
    await selectOption("uiFontWeight", i18n.t("settings.uiFontWeight_medium"));
    expect(updateAppSettings).toHaveBeenLastCalledWith(expect.objectContaining({
      uiFontSize: 18, contentFontSize: 20, codeFontSize: 15, uiFontWeight: "medium",
    }));
    const cached = readCachedFontPreferences();
    document.documentElement.removeAttribute("style");
    applyFontPreferences(cached);
    expect(document.documentElement.style.getPropertyValue("--ui-font-scale")).toBe("1.125");
    expect(document.documentElement.style.getPropertyValue("--content-font-scale")).toBe(String(20 / 14));
    expect(document.documentElement.style.getPropertyValue("--code-font-size")).toBe("15px");
    expect(document.documentElement.style.getPropertyValue("--ui-font-weight-offset")).toBe("100");
    expect(terminalFontFamily()).toBe('Menlo, Monaco, "Courier New", monospace');
  });

  it("a failed typography save restores the applied preference and shows the error", async () => {
    await press(row("typographyAdvanced"));
    updateAppSettings.mockRejectedValueOnce(new Error("write failed"));
    await editSize("uiFontSize", "20");
    expect(document.documentElement.style.getPropertyValue("--ui-font-scale")).toBe("1");
    expect(readCachedFontPreferences().uiFontSize).toBe(16);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("write failed");
  });

  it("invalid sizes keep the current value without saving", async () => {
    await press(row("typographyAdvanced"));
    for (const value of ["", "9", "33", "14.5"]) {
      await editSize("contentFontSize", value);
      expect(row("contentFontSize").querySelector("input")?.value).toBe("14");
    }
    expect(updateAppSettings).not.toHaveBeenCalled();
  });

  it("reset restores only typography preferences in one save", async () => {
    const reset = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === i18n.t("settings.typographyReset"),
    )!;
    await press(reset);
    expect(updateAppSettings).toHaveBeenCalledTimes(1);
    expect(updateAppSettings).toHaveBeenCalledWith(expect.objectContaining({
      uiFontSize: 16, contentFontSize: 14, codeFontSize: 13, uiFontWeight: "standard", uiTextContrast: "standard",
      theme: "light", fontFamily: "", codeFontFamily: "",
    }));
  });

  it("自定义 shows a file picker; picking a font applies and persists it", async () => {
    await selectOption("fontFamily", i18n.t("settings.fontCustom"));
    expect(row("fontFamily").textContent).toContain(i18n.t("settings.fontChooseFile"));
    expect(updateAppSettings).not.toHaveBeenCalled();

    pickFile.mockResolvedValue("/Users/me/Fonts/LXGWWenKai.ttf");
    await press(fileButton("fontFamily"));
    await flush();

    expect(pickFile).toHaveBeenCalledWith(
      i18n.t("settings.fontPickTitle"),
      expect.arrayContaining([
        expect.objectContaining({ extensions: ["ttf", "otf", "ttc", "woff", "woff2"] }),
      ]),
    );
    expect(readFontFile).toHaveBeenCalledWith("/Users/me/Fonts/LXGWWenKai.ttf");
    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ fontFamily: "custom", fontFile: "/Users/me/Fonts/LXGWWenKai.ttf" }),
    );
    expect(document.documentElement.style.getPropertyValue("--font-inter")).toContain(
      `"${CUSTOM_UI_FONT_FAMILY}"`,
    );
    // The picker now shows the uploaded file instead of the prompt.
    expect(row("fontFamily").textContent).toContain("LXGWWenKai.ttf");
    expect([...registeredFaces].some((face) => face.family === CUSTOM_UI_FONT_FAMILY)).toBe(true);
  });

  it("a cancelled dialog keeps the picker and leaves settings untouched", async () => {
    await selectOption("codeFontFamily", i18n.t("settings.fontCustom"));
    pickFile.mockResolvedValue(null);
    await press(fileButton("codeFontFamily"));
    await flush();
    expect(readFontFile).not.toHaveBeenCalled();
    expect(updateAppSettings).not.toHaveBeenCalled();
    expect(row("codeFontFamily").textContent).toContain(i18n.t("settings.fontChooseFile"));
  });

  it("an unreadable file reports the localized error and keeps the old mode", async () => {
    await selectOption("fontFamily", i18n.t("settings.fontCustom"));
    pickFile.mockResolvedValue("/tmp/not-really-a-font.bin");
    readFontFile.mockRejectedValueOnce("font.err.unsupported");
    await press(fileButton("fontFamily"));
    await flush();

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(i18n.t("settings.fontErrUnsupported"));
    expect(updateAppSettings).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--font-inter")).toBe("");
    expect(row("fontFamily").textContent).toContain(i18n.t("settings.fontChooseFile"));
  });

  it("returning to 自定义 re-applies the remembered file without a new pick", async () => {
    await act(async () => root.unmount());
    container.remove();
    await mount({ fontFile: "/Users/me/Fonts/Remembered.otf" });

    await selectOption("fontFamily", i18n.t("settings.fontCustom"));
    await flush();

    expect(pickFile).not.toHaveBeenCalled();
    expect(readFontFile).toHaveBeenCalledWith("/Users/me/Fonts/Remembered.otf");
    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ fontFamily: "custom" }),
    );
    expect(row("fontFamily").textContent).toContain("Remembered.otf");
  });

  it("shows a stored uploaded file name in custom mode", async () => {
    await act(async () => root.unmount());
    container.remove();
    await mount({ fontFamily: "custom", fontFile: "/Users/me/Fonts/Already On.ttf" });
    expect(row("fontFamily").textContent).toContain("Already On.ttf");
    expect(row("fontFamily").textContent).toContain(i18n.t("settings.fontCustom"));
  });

  it("switching back to 系统默认 clears the custom stack and persists the default", async () => {
    await act(async () => root.unmount());
    container.remove();
    await mount({ codeFontFamily: "custom", codeFontFile: "/tmp/MyCode.ttf" });
    // The row opens in custom mode with the remembered file…
    expect(row("codeFontFamily").textContent).toContain("MyCode.ttf");
    // …and the merged 系统默认 option drops the custom stack again.
    await selectOption("codeFontFamily", i18n.t("settings.fontDefault"));
    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ codeFontFamily: "" }),
    );
    expect(document.documentElement.style.getPropertyValue("--font-mono-source")).toBe("");
  });

  it("zoom select writes the shared zoom storage the status bar reads", async () => {
    await selectOption("uiZoom", "120%");
    expect(readZoomPct()).toBe(120);
  });

  it("宽幕布 switch drives the chat column and persists the app setting", async () => {
    const toggle = row("chatWideLayout").querySelector<HTMLElement>('input[type="checkbox"]');
    expect(toggle).not.toBeNull();
    expect(useChatStore.getState().wideLayout).toBe(false);

    await press(toggle!);
    expect(useChatStore.getState().wideLayout).toBe(true);
    expect(updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ chatWideLayout: true }),
    );

    await press(toggle!);
    expect(useChatStore.getState().wideLayout).toBe(false);
    expect(updateAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ chatWideLayout: false }),
    );
  });
});
