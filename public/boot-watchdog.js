/**
 * Boot watchdog — the first of the app's three crash-defence layers.
 *
 * Runs as a classic script from index.html BEFORE the module bundle, so it
 * still executes when the bundle fails to load or throws before React mounts.
 * If the app hasn't marked itself mounted within BOOT_TIMEOUT_MS, it replaces
 * the splash with a failure panel that names the reason (read from the same
 * `ccgui:last-crash` record src/lib/crash.ts writes) and offers a reload.
 *
 * Kept as a standalone file (not inline) because the packaged CSP is
 * `script-src 'self'` with no 'unsafe-inline'.
 */
(function () {
  var BOOT_TIMEOUT_MS = 8000;
  var LAST_CRASH_KEY = "ccgui:last-crash";

  // This classic script must work even if the React/i18next bundle fails.
  // Use the same startup cache as src/lib/i18n.ts without loading that bundle.
  var language = "zh";
  try {
    var stored = localStorage.getItem("ccgui-next.language");
    if (stored === "en" || stored === "ko") language = stored;
  } catch (error) {
    // Storage can be unavailable in restricted webviews; keep the default.
  }
  var bootMessages = {
    zh: ["正在启动 CC GUI…", "CC GUI 启动失败", "可以重新加载应用再试一次。", "重新加载"],
    en: ["Starting CC GUI…", "Failed to start CC GUI", "Reload the app to try again.", "Reload"],
    ko: ["CC GUI 시작 중…", "CC GUI를 시작하지 못했습니다", "앱을 다시 불러와 재시도하세요.", "다시 불러오기"],
  };
  var messages = bootMessages[language];
  document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  var splashLabel = document.querySelector("#boot-splash span");
  if (splashLabel) splashLabel.textContent = messages[0];

  function lastCrashReason() {
    try {
      var raw = localStorage.getItem(LAST_CRASH_KEY);
      if (!raw) return "";
      var report = JSON.parse(raw);
      if (!report || !report.message) return "";
      return (report.source ? "[" + report.source + "] " : "") + report.message;
    } catch (error) {
      return "";
    }
  }

  function showBootFailure(reason) {
    var root = document.getElementById("root");
    if (!root || document.documentElement.dataset.appMounted === "1") return;

    var panel = document.createElement("div");
    panel.className = "boot-failure";

    var title = document.createElement("h1");
    title.textContent = messages[1];
    panel.appendChild(title);

    if (reason) {
      var reasonEl = document.createElement("p");
      reasonEl.className = "boot-failure-reason";
      reasonEl.textContent = reason;
      panel.appendChild(reasonEl);
    }

    var hint = document.createElement("p");
    hint.className = "boot-failure-hint";
    hint.textContent = messages[2];
    panel.appendChild(hint);

    var button = document.createElement("button");
    button.type = "button";
    button.textContent = messages[3];
    button.addEventListener("click", function () {
      location.reload();
    });
    panel.appendChild(button);

    root.textContent = "";
    root.appendChild(panel);
  }

  window.__ccguiShowBootFailure = showBootFailure;

  // Catch errors thrown before the module bundle (or the React boundary) is
  // up; defer one tick so a crash handler that reports synchronously wins.
  window.addEventListener("error", function (event) {
    if (!event.error && !event.message) return;
    window.setTimeout(function () {
      if (document.documentElement.dataset.appMounted !== "1") {
        showBootFailure(event.message || lastCrashReason());
      }
    }, 0);
  });

  window.setTimeout(function () {
    if (document.documentElement.dataset.appMounted === "1") return;
    showBootFailure(lastCrashReason());
  }, BOOT_TIMEOUT_MS);
})();
