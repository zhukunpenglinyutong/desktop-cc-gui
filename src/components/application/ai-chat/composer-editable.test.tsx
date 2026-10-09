import { act, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { ComposerEditable } from "./composer-editable";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ComposerEditable IME Enter", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editable: HTMLDivElement;
  let props: ComponentProps<typeof ComposerEditable>;

  beforeEach(async () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = {
      editableRef: createRef<HTMLDivElement>(),
      sendShortcut: "enter",
      mentionOpen: false,
      slashOpen: false,
      botOpen: false,
      promptOpen: false,
      completionSuffix: "",
      acceptCompletion: vi.fn(),
      setEditableText: vi.fn(),
      handleHistoryKeyDown: vi.fn(() => false),
      mentionMenuRef: { current: null },
      slashMenuRef: { current: null },
      botMenuRef: { current: null },
      promptMenuRef: { current: null },
      isComposingRef: { current: false },
      setIsComposing: vi.fn(),
      emitChange: vi.fn(),
      syncTags: vi.fn(),
      updateTriggers: vi.fn(),
      disabled: false,
      onSubmit: vi.fn(),
      manualHeightPx: null,
    };
    await render();
    editable.textContent = "中文😀";
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render() {
    await act(async () => root.render(<ComposerEditable {...props} />));
    editable = props.editableRef.current!;
  }

  async function compose(type: "compositionstart" | "compositionend") {
    await act(async () => {
      editable.dispatchEvent(new CompositionEvent(type, { bubbles: true, data: "中文😀" }));
    });
  }

  async function enter(options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Enter",
      keyCode: 13,
      ...options,
    });
    await act(async () => {
      editable.dispatchEvent(event);
    });
    return event;
  }

  it.each([0, 20, 99, 100])("选字结束 %dms 后的独立回车立即发送", async (delay) => {
    await compose("compositionstart");
    await compose("compositionend");
    vi.mocked(Date.now).mockReturnValue(1000 + delay);
    expect((await enter()).defaultPrevented).toBe(true);
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith("中文😀");
  });

  it("WebKit 候选确认回车保留输入法默认行为、不发送，紧接的独立回车发送", async () => {
    await compose("compositionstart");
    await compose("compositionend");
    expect((await enter({ keyCode: 229 })).defaultPrevented).toBe(false);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect((await enter()).defaultPrevented).toBe(true);
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith("中文😀");
  });

  it("组合输入期间的确认键由输入法处理", async () => {
    await compose("compositionstart");
    expect((await enter({ isComposing: true, keyCode: 229 })).defaultPrevented).toBe(false);
    expect((await enter()).defaultPrevented).toBe(false);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.handleHistoryKeyDown).not.toHaveBeenCalled();
  });

  it("原生组合输入标记也阻止发送与历史召回", async () => {
    expect((await enter({ isComposing: true })).defaultPrevented).toBe(false);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect(props.handleHistoryKeyDown).not.toHaveBeenCalled();
  });

  it("候选确认不选补全菜单，独立回车仍由菜单接管", async () => {
    const handleKey = vi.fn(() => true);
    props.mentionOpen = true;
    props.mentionMenuRef.current = { handleKey };
    await render();
    await compose("compositionstart");
    await compose("compositionend");
    expect((await enter({ keyCode: 229 })).defaultPrevented).toBe(false);
    expect(handleKey).not.toHaveBeenCalled();
    expect((await enter()).defaultPrevented).toBe(true);
    expect(handleKey).toHaveBeenCalledExactlyOnceWith("Enter");
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("普通英文回车仍发送", async () => {
    editable.textContent = "hello";
    expect((await enter()).defaultPrevented).toBe(true);
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith("hello");
  });

  it("选字后 Shift+Enter 仍换行", async () => {
    await compose("compositionend");
    expect((await enter({ shiftKey: true })).defaultPrevented).toBe(false);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it.each(["metaKey", "ctrlKey"])("cmdEnter 模式选字后 %s+Enter 立即发送", async (modifier) => {
    props.sendShortcut = "cmdEnter";
    await render();
    await compose("compositionend");
    expect((await enter()).defaultPrevented).toBe(false);
    expect(props.onSubmit).not.toHaveBeenCalled();
    expect((await enter({ [modifier]: true })).defaultPrevented).toBe(true);
    expect(props.onSubmit).toHaveBeenCalledExactlyOnceWith("中文😀");
  });

  it("禁用时不发送且不意外换行", async () => {
    props.disabled = true;
    await render();
    await compose("compositionend");
    expect((await enter()).defaultPrevented).toBe(true);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
});
