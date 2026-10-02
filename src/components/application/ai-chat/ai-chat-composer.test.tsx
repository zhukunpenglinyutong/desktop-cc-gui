import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "@/lib/i18n";
import { Composer, getProxyQuickToggleAction } from "./ai-chat-composer";
import { extractText, getCaretOffset } from "./file-tags";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const PREFILL = "/ccgui-plugin-creator ";

/**
 * 草稿恢复（外部 value 变化）会重建 editable 的 DOM；重建时浏览器手里的插入
 * 点一并消失，随后 focus()（creator flow 的 focusComposerWhenVisible）把光标
 * 放回内容开头。这里钉住修复后的落点：文本末尾，用户可以直接接着敲需求；
 * 文本本身按原文渲染（斜杠指令不再有特殊展示逻辑）。
 */
describe("Composer 草稿恢复", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  /** 用受控 value 渲染（等价于 store 的 draft），返回 editable。 */
  async function render(value: string): Promise<HTMLElement> {
    await act(async () => {
      root.render(
        <HashRouter>
          <Composer value={value} onValueChange={() => {}} />
        </HashRouter>,
      );
    });
    const el = container.querySelector<HTMLElement>(".composer-editable");
    expect(el).not.toBeNull();
    return el!;
  }

  it("挂载即带草稿时光标落在文本末尾", async () => {
    const el = await render(PREFILL);
    expect(extractText(el)).toBe(PREFILL);
    expect(getCaretOffset(el)).toBe(PREFILL.length);
  });

  it("挂载后才收到草稿（插件中心「创建插件」）同样落在末尾", async () => {
    await render("");
    const el = await render(PREFILL);
    expect(extractText(el)).toBe(PREFILL);
    expect(getCaretOffset(el)).toBe(PREFILL.length);
  });
});

describe("代理快捷开关", () => {
  it("无配置时保留图标并打开代理设置", () => {
    expect(getProxyQuickToggleAction({ enabled: false, url: null })).toBe("settings");
    expect(getProxyQuickToggleAction({ enabled: false, url: "" })).toBe("settings");
  });

  it("有有效地址时切换代理，而不是打开设置", () => {
    expect(getProxyQuickToggleAction({ enabled: false, url: "http://127.0.0.1:7890" })).toBe(
      "toggle",
    );
  });

  it("已启用时即使地址失效也允许关闭", () => {
    expect(getProxyQuickToggleAction({ enabled: true, url: "not-a-url" })).toBe("toggle");
  });
});
