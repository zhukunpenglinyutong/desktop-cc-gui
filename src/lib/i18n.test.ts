import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  localStorage.removeItem("ccgui-next.language");
  vi.resetModules();
});

it("keeps English, Chinese and Korean as independent languages", async () => {
  const { default: i18n } = await import("./i18n");
  for (const [language, confirm] of [["en", "Confirm"], ["zh", "确认"], ["ko", "확인"]]) {
    await i18n.changeLanguage(language);
    expect(i18n.t("common.confirm")).toBe(confirm);
    expect(i18n.t("settings.langEn")).toBe("English");
    expect(i18n.t("settings.langKo")).toBe("한국어");
    expect(document.documentElement.lang).toBe(language === "zh" ? "zh-CN" : language);
  }
});

it("loads saved Korean before the first render, without a plugin", async () => {
  localStorage.setItem("ccgui-next.language", "ko");
  const { default: i18n } = await import("./i18n");
  expect(i18n.language).toBe("ko");
  expect(i18n.t("common.confirm")).toBe("확인");
  expect(document.documentElement.lang).toBe("ko");
});

it("falls back safely for an unknown saved locale", async () => {
  localStorage.setItem("ccgui-next.language", "unknown");
  const { default: i18n } = await import("./i18n");
  expect(i18n.language).toBe("zh");
});
