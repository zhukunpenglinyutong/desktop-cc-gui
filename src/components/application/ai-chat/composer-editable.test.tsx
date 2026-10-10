import { act, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import { ComposerEditable } from "./composer-editable";

vi.mock("@/lib/transport", () => ({ isWeb: false }));
vi.mock("@/lib/ipc", () => ({ ipc: { clipboardFilePaths: vi.fn(async () => []) } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Fresh field props per test; `Date.now` and callbacks are per-test spies. */
function makeProps(): ComponentProps<typeof ComposerEditable> {
  return {
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
    resetHistoryNavigation: vi.fn(),
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
    onPasteImages: vi.fn(),
    onPastePaths: vi.fn(),
    manualHeightPx: null,
  };
}

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
    props = makeProps();
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

  it.each([
    ["mentionOpen", "mentionMenuRef"],
    ["slashOpen", "slashMenuRef"],
    ["botOpen", "botMenuRef"],
    ["promptOpen", "promptMenuRef"],
  ] as const)("%s 菜单不接管候选确认，独立回车仍由菜单接管", async (openKey, refKey) => {
    const handleKey = vi.fn(() => true);
    props[openKey] = true;
    props[refKey].current = { handleKey };
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

describe("ComposerEditable 粘贴文件", () => {
  let container: HTMLDivElement;
  let root: Root;
  let editable: HTMLDivElement;
  let props: ComponentProps<typeof ComposerEditable>;
  const clipboardFilePaths = vi.mocked(ipc.clipboardFilePaths);

  beforeEach(async () => {
    clipboardFilePaths.mockReset();
    clipboardFilePaths.mockResolvedValue([]);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    props = makeProps();
    await act(async () => root.render(<ComposerEditable {...props} />));
    editable = props.editableRef.current!;
    editable.textContent = "中文😀";
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  /** ClipboardEvent.clipboardData has no jsdom constructor support. */
  async function paste(data: {
    items?: { kind: string; type: string; file?: File }[];
    text?: string;
    uriList?: string;
  }) {
    const event = new Event("paste", { bubbles: true, cancelable: true });
    const items = (data.items ?? []).map((item) => ({
      kind: item.kind,
      type: item.type,
      getAsFile: () => item.file ?? null,
    }));
    Object.defineProperty(event, "clipboardData", {
      value: {
        items,
        getData: (type: string) =>
          type === "text/plain"
            ? (data.text ?? "")
            : type === "text/uri-list"
              ? (data.uriList ?? "")
              : "",
      },
    });
    await act(async () => {
      editable.dispatchEvent(event);
    });
    // Flush the clipboard probe's promise chain.
    await act(async () => {});
  }

  it("Finder 复制的文件：路径交给宿主，正文不插入文件名", async () => {
    clipboardFilePaths.mockResolvedValue(["/tmp/notes.md", "/tmp/pic.png"]);
    await paste({});
    expect(clipboardFilePaths).toHaveBeenCalledTimes(1);
    expect(props.onPastePaths).toHaveBeenCalledWith(["/tmp/notes.md", "/tmp/pic.png"]);
    expect(props.onPasteImages).not.toHaveBeenCalled();
    expect(editable.textContent).toBe("中文😀");
  });

  it("粘贴板暴露 uri-list 时用它兜底", async () => {
    await paste({ uriList: "file:///tmp/a%20b.md\nhttps://example.com/x" });
    expect(props.onPastePaths).toHaveBeenCalledWith(["/tmp/a b.md"]);
  });

  it("非图片文件丢进输入框时走剪贴板探测而不是塞文件名", async () => {
    const md = new File(["x"], "notes.md");
    clipboardFilePaths.mockResolvedValue(["/tmp/notes.md"]);
    await paste({ items: [{ kind: "file", type: "", file: md }], text: "notes.md" });
    expect(props.onPastePaths).toHaveBeenCalledWith(["/tmp/notes.md"]);
    expect(editable.textContent).toBe("中文😀");
  });

  it("截图字节仍走图片附件管线，不读系统剪贴板", async () => {
    const png = new File(["x"], "shot.png", { type: "image/png" });
    await paste({ items: [{ kind: "file", type: "image/png", file: png }] });
    expect(props.onPasteImages).toHaveBeenCalledWith([png]);
    expect(props.onPastePaths).not.toHaveBeenCalled();
    expect(clipboardFilePaths).not.toHaveBeenCalled();
  });

  it("普通文本仍作为纯文本插入", async () => {
    await paste({ text: "hello" });
    expect(editable.textContent).toBe("中文😀hello");
    expect(clipboardFilePaths).not.toHaveBeenCalled();
    expect(props.onPastePaths).not.toHaveBeenCalled();
  });
});
