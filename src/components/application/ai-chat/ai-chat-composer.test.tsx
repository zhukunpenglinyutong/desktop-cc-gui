import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { Composer, StatusBar } from "./ai-chat-composer";
import { getProxyQuickToggleAction } from "./proxy-toggle";
import { ipc, type AppSettings } from "@/lib/ipc";
import { extractText, getCaretOffset } from "./file-tags";
import { clearPromptHistory, recordPrompt } from "@/features/chat/prompt-history";

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

describe("Composer 中文编辑与历史召回", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editable: HTMLElement;
  const onSubmit = vi.fn();

  function ControlledComposer() {
    const [value, setValue] = useState("");
    return <Composer value={value} onValueChange={setValue} onSubmit={onSubmit} />;
  }

  beforeEach(async () => {
    clearPromptHistory();
    recordPrompt("历史提问");
    onSubmit.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        <HashRouter>
          <ControlledComposer />
        </HashRouter>,
      );
    });
    editable = container.querySelector<HTMLElement>(".composer-editable")!;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    clearPromptHistory();
  });

  async function key(key: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      ...options,
    });
    await act(async () => {
      editable.dispatchEvent(event);
    });
    return event;
  }

  it("历史召回后中文编辑结束，方向键不覆盖新草稿", async () => {
    expect((await key("ArrowUp")).defaultPrevented).toBe(true);
    expect(extractText(editable)).toBe("历史提问");
    await act(async () => {
      editable.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    expect((await key("ArrowDown", { isComposing: true, keyCode: 229 })).defaultPrevented).toBe(false);
    expect(extractText(editable)).toBe("历史提问");
    await key("n", { isComposing: true, keyCode: 229 });
    await act(async () => {
      editable.textContent = "历史提问你好😀";
      editable.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        isComposing: true,
        data: "你好😀",
      }));
      editable.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "你好😀",
      }));
    });
    const event = await key("ArrowDown");
    expect(extractText(editable)).toBe("历史提问你好😀");
    expect(event.defaultPrevented).toBe(false);
  });

  it("选字确认和立即发送在同一次 React 批处理中保留完整正文", async () => {
    await act(async () => {
      editable.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      editable.textContent = "完整中文😀";
      editable.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        isComposing: true,
        data: "完整中文😀",
      }));
      editable.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "完整中文😀",
      }));
      editable.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        keyCode: 229,
      }));
      expect(onSubmit).not.toHaveBeenCalled();
      editable.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
        keyCode: 13,
      }));
    });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("完整中文😀");
    expect(extractText(editable)).toBe("完整中文😀");
  });

  it("普通历史导航仍能回到原草稿", async () => {
    await act(async () => recordPrompt("最近提问"));
    await key("ArrowUp");
    expect(extractText(editable)).toBe("最近提问");
    await key("ArrowUp");
    expect(extractText(editable)).toBe("历史提问");
    await key("ArrowDown");
    expect(extractText(editable)).toBe("最近提问");
    await key("ArrowDown");
    expect(extractText(editable)).toBe("");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("取消中文组合输入不发送，下一次选字后的回车仍能发送", async () => {
    await act(async () => {
      editable.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      editable.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => {
      editable.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      editable.textContent = "下一次输入";
      editable.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "下一次输入",
      }));
    });
    await key("Enter", { keyCode: 13 });
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith("下一次输入");
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
describe("代理快捷开关文案", () => {
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
    vi.restoreAllMocks();
  });
  // 回归：已配置地址但代理关闭时，按钮的 aria-label 必须落到真实文案上。
  // proxyOff/proxyTipOff 曾被误删而组件仍引用它们，纯函数测试发现不了——
  // 只有真的渲染这个状态才能钉住。代理开关挂在 StatusBar 上。
  it("已配置但关闭时显示中文开关文案，而不是词条编号", async () => {
    vi.spyOn(ipc, "getAppSettings").mockResolvedValue({
      systemProxyEnabled: false,
      systemProxyUrl: "http://127.0.0.1:7890",
    } as AppSettings);
    await act(async () => {
      root.render(
        <HashRouter>
          <StatusBar />
        </HashRouter>,
      );
    });
    expect(
      container.querySelector('button[aria-label="网络代理：已关闭，点击开启"]'),
    ).not.toBeNull();
    expect(container.querySelector('button[aria-label="chat.proxyOff"]')).toBeNull();
  });
});

// Regression: a blocked send control must say WHY it is blocked. The tooltip
// only exists when `disabledReason` reaches ComposerToolbar, so a natively
// disabled button (no hover, no focus) would keep the reason unreadable.
describe("发送键的前置条件解释", () => {
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

  it("有禁用原因时保持可 hover（aria-disabled + 守卫），而不是原生 disabled", async () => {
    const onSubmit = vi.fn();
    const reason = "先在侧栏新建一个会话，才能发送消息";
    await act(async () => {
      root.render(
        <HashRouter>
          <Composer value="hello" disabled disabledReason={reason} onSubmit={onSubmit} />
        </HashRouter>,
      );
    });

    // aria-label 走 i18n：查到的是真文案（「发送」），不是词条编号。
    const send = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${i18n.t("chat.send")}"]`,
    );
    expect(send).not.toBeNull();
    expect(send!.getAttribute("aria-disabled")).toBe("true");
    expect(send!.disabled).toBe(false);

    await act(async () => {
      send!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("没有原因时保持原来的原生 disabled 语义（不额外加 tooltip 包装）", async () => {
    await act(async () => {
      root.render(
        <HashRouter>
          <Composer value="hello" disabled onSubmit={vi.fn()} />
        </HashRouter>,
      );
    });

    // aria-label 走 i18n：查到的是真文案（「发送」），不是词条编号。
    const send = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${i18n.t("chat.send")}"]`,
    );
    expect(send).not.toBeNull();
    expect(send!.disabled).toBe(true);
    expect(send!.hasAttribute("aria-disabled")).toBe(false);
  });

  it("有原因时原因能被读到（tooltip 真的挂在按钮上，而不是只传了个 prop）", async () => {
    const reason = "先在侧栏新建一个会话，才能发送消息";
    await act(async () => {
      root.render(
        <HashRouter>
          <Composer value="hello" disabled disabledReason={reason} onSubmit={vi.fn()} />
        </HashRouter>,
      );
    });

    const send = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${i18n.t("chat.send")}"]`,
    );
    // 键盘可达正是这条分支的意义：聚焦就该把原因显示出来。
    // （原生 disabled 收不到 focus，这条断言在旧实现下必然失败。）
    await act(async () => {
      send!.focus();
    });
    expect(document.body.textContent).toContain(reason);
  });
});

/**
 * 发送被前置条件挡住时，输入框不能再宣传「Enter 发送」——那种状态下 Enter 被
 * onKeyDown 守卫直接丢弃。这里钉住「占位提示真的落到了 DOM 上」，否则把
 * placeholder 传丢/传错 prop 都不会被任何用例发现。
 */
describe("输入框占位提示的前提改口", () => {
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

  it("给了 placeholder 就顶掉默认文案", async () => {
    const blocked = "先在侧栏新建一个会话，再在这里输入";
    await act(async () => {
      root.render(
        <HashRouter>
          <Composer value="hello" disabled disabledReason={blocked} placeholder={blocked} onSubmit={vi.fn()} />
        </HashRouter>,
      );
    });

    const box = container.querySelector('[data-placeholder]');
    expect(box?.getAttribute("data-placeholder")).toBe(blocked);
  });

  it("没给 placeholder 时保持默认文案", async () => {
    await act(async () => {
      root.render(
        <HashRouter>
          <Composer value="hello" onSubmit={vi.fn()} />
        </HashRouter>,
      );
    });

    const box = container.querySelector('[data-placeholder]');
    expect(box?.getAttribute("data-placeholder")).toBe(i18n.t("chat.inputPlaceholder"));
  });
});
