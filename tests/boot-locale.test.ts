import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const watchdog = fs.readFileSync(new URL("../public/boot-watchdog.js", import.meta.url), "utf8");

for (const [locale, lang, splash, failure, reload] of [
  ["ko", "ko", "CC GUI 시작 중…", "CC GUI를 시작하지 못했습니다", "다시 불러오기"],
  ["en", "en", "Starting CC GUI…", "Failed to start CC GUI", "Reload"],
  ["zh", "zh-CN", "正在启动 CC GUI…", "CC GUI 启动失败", "重新加载"],
  ["unknown", "zh-CN", "正在启动 CC GUI…", "CC GUI 启动失败", "重新加载"],
]) {
  test(`boot and recovery use saved ${locale} before the module loads`, () => {
    const dom = new JSDOM(html, { url: "https://ccgui.test", runScripts: "outside-only" });
    try {
      dom.window.localStorage.setItem("ccgui-next.language", locale);
      dom.window.eval(watchdog);
      assert.equal(dom.window.document.documentElement.lang, lang);
      assert.equal(dom.window.document.querySelector("#boot-splash span")?.textContent, splash);
      dom.window.__ccguiShowBootFailure("diagnostic reason");
      assert.equal(dom.window.document.querySelector("h1")?.textContent, failure);
      assert.equal(dom.window.document.querySelector("button")?.textContent, reload);
      assert.equal(dom.window.document.querySelector(".boot-failure-reason")?.textContent, "diagnostic reason");
    } finally {
      dom.window.close();
    }
  });
}

test("blocked startup storage still renders a safe default", () => {
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  try {
    assert.doesNotThrow(() => dom.window.eval(watchdog));
    assert.equal(dom.window.document.documentElement.lang, "zh-CN");
    assert.equal(dom.window.document.querySelector("#boot-splash span")?.textContent, "正在启动 CC GUI…");
  } finally {
    dom.window.close();
  }
});
