// Real settings controls with in-memory persistence; no native app or session is touched.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { GeneralSection } from "../../src/features/settings/GeneralSection";
import { applyInterfaceTypography } from "../../src/features/settings/interface-typography";

let settings = {
  theme: "light",
  titlebar: "native",
  language: "zh",
  sidebarThreadLimit: 5,
  uiFontSize: 16,
  contentFontSize: 14,
  codeFontSize: 13,
  uiFontWeight: "standard",
  fontFamily: "",
  fontFile: "",
  codeFontFamily: "",
  codeFontFile: "",
  composerSendShortcut: "enter",
  thinkingAutoCollapse: true,
};

window.__TAURI_INTERNALS__.invoke = async (cmd: string, args?: Record<string, unknown>) => {
  if (cmd === "get_app_settings") return settings;
  if (cmd === "update_app_settings") {
    settings = args?.settings as typeof settings;
    return null;
  }
  if (cmd === "list_prompt_history") return [];
  return null;
};

applyInterfaceTypography(settings);
createRoot(document.getElementById("fixture")!).render(
  <div className="p-6 text-text-primary">
    <h1 className="text-title-3-semibold">界面字号与字重预览</h1>
    <p className="my-4 text-body-regular">
      使用真实设置组件，保存仅在此预览内生效，不影响正在运行的 CC GUI。
    </p>
    <div className="grid gap-6 lg:grid-cols-2">
      <GeneralSection />
      <section className="rounded-xl border border-separator-border p-6">
        <h2 id="heading" className="text-title-3-semibold">标题与正文保留层级</h2>
        <p id="body" className="prose-chat my-4 text-body-regular">中文与 emoji：缓存策略开发完成 ✅</p>
        <p id="sidebar" className="my-4 text-body-2-medium text-text-secondary">侧边栏：fx-data-server</p>
        <p id="caption" className="my-4 text-caption-1-regular text-text-tertiary">响应中 · 耗时 2m23s · high</p>
        <p id="legacy" className="my-4 text-[11px]">原有小字号标签</p>
        <div id="spacing" className="p-3">
          <svg id="icon" className="size-5" viewBox="0 0 20 20" aria-label="图标尺寸保持不变">
            <circle cx="10" cy="10" r="8" fill="currentColor" />
          </svg>
        </div>
        <div className="prose-chat text-body-regular">
          <div className="md-codeblock">
            <pre id="code"><code>const message = "代码字号独立设置";</code></pre>
          </div>
        </div>
        <div className="code-typography" id="diff">+ diff sample</div>
        <div className="cm-editor"><span id="editor" className="text-body-2-regular">代码编辑器样例</span></div>
        <div className="xterm"><span id="terminal" className="text-body-2-regular">终端样例</span></div>
      </section>
    </div>
  </div>,
);
