// Real controls/editors/terminal with fixture-only persistence; no native session is touched.
import { createRoot } from "react-dom/client";
import CodeMirror from "@uiw/react-codemirror";
import "../../src/index.css";
import "../../src/lib/i18n";
import { GeneralSection } from "../../src/features/settings/GeneralSection";
import { applyFontPreferences } from "../../src/features/settings/font";
import { TerminalView } from "../../src/features/terminal/TerminalView";

let settings = {
  theme: "light", titlebar: "native", language: "zh", sidebarThreadLimit: 5,
  uiFontSize: 16, contentFontSize: 14, codeFontSize: 13, uiFontWeight: "standard",
  fontFamily: "", fontFile: "", codeFontFamily: "", codeFontFile: "",
  composerSendShortcut: "enter", thinkingAutoCollapse: true,
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

function EditorSample() {
  return <CodeMirror value={'const 中文 = "emoji ✅";'} onCreateEditor={(view) => { view.contentDOM.id = "editor"; }} />;
}

applyFontPreferences(settings);
createRoot(document.getElementById("fixture")!).render(
  <div className="p-6 text-text-primary">
    <h1 className="text-title-3-semibold">字体与字号预览</h1>
    <p className="my-4 text-body-regular">真实设置与编辑器，保存只在此预览内生效。</p>
    <div className="grid gap-6 lg:grid-cols-2">
      <GeneralSection />
      <section className="rounded-xl border border-separator-border p-6">
        <h2 id="heading" className="text-title-3-semibold">标题与正文保留层级</h2>
        <p id="body" className="prose-chat my-4 text-body-regular">中文与 emoji：缓存策略开发完成 ✅</p>
        <p id="sidebar" className="my-4 text-body-2-medium text-text-secondary">侧边栏：fx-data-server</p>
        <p id="caption" className="my-4 text-caption-1-regular text-text-tertiary">响应中 · 耗时 2m23s · high</p>
        <p id="legacy" className="my-4 text-[11px]">原有小字号标签</p>
        <div id="spacing" className="p-3"><span id="icon" className="inline-block size-5">＋</span></div>
        <div className="prose-chat text-body-regular">
          <p>行内代码：<code id="inline-code">hello("中文 ✅")</code></p>
          <div className="md-codeblock"><pre><code id="code">const message = "代码字号独立设置";</code></pre></div>
        </div>
        <div className="code-typography" id="diff">+ diff sample 中文 ✅</div>
        <EditorSample />
        <div id="terminal" className="relative flex h-40 flex-col">
          <TerminalView id="typography-fixture" cwd="/fixture" />
        </div>
      </section>
    </div>
  </div>,
);
