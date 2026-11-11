import { describe, expect, it } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { attachInputBridge } from "./input-bridge";

interface SetupOptions {
  /** Stands in for xterm's `_inputEvent` gate: true when it also emits. */
  deliver?: (text: string) => boolean;
  screenReaderMode?: boolean;
}

function setup({ deliver = () => false, screenReaderMode = false }: SetupOptions = {}) {
  const element = document.createElement("div");
  const textarea = document.createElement("textarea");
  element.appendChild(textarea);
  document.body.appendChild(element);

  const handlers = new Set<(data: string) => void>();
  const term = {
    element,
    options: { screenReaderMode },
    onData(handler: (data: string) => void) {
      handlers.add(handler);
      return { dispose: () => handlers.delete(handler) };
    },
  } as unknown as Terminal;

  // Mirrors xterm's textarea capture listener: it owns non-composition
  // insertText events and emits them through onData when its gate allows.
  textarea.addEventListener(
    "input",
    (event) => {
      const input = event as InputEvent;
      if (input.inputType !== "insertText" || !input.data || input.isComposing) return;
      if (deliver(input.data)) for (const handler of handlers) handler(input.data);
    },
    true,
  );

  const sent: string[] = [];
  const disposable = attachInputBridge(term, (data) => sent.push(data));

  return {
    sent,
    element,
    textarea,
    term,
    emit: (data: string) => {
      for (const handler of handlers) handler(data);
    },
    type: (
      data: string,
      overrides: { inputType?: string; isComposing?: boolean } = {},
    ) => {
      textarea.value += data;
      textarea.dispatchEvent(
        new InputEvent("input", {
          inputType: overrides.inputType ?? "insertText",
          data,
          composed: true,
          bubbles: true,
          isComposing: overrides.isComposing ?? false,
        }),
      );
    },
    dispose: () => {
      disposable.dispose();
      element.remove();
    },
  };
}

describe("attachInputBridge", () => {
  it("forwards insertText when xterm's gate drops it (WKWebView IME shape)", () => {
    const ctx = setup({ deliver: () => false });
    try {
      ctx.type("a");
      expect(ctx.sent).toEqual(["a"]);
    } finally {
      ctx.dispose();
    }
  });

  it("does not duplicate an insertText xterm already emitted", () => {
    const ctx = setup({ deliver: () => true });
    try {
      ctx.type("a");
      expect(ctx.sent).toEqual(["a"]);
    } finally {
      ctx.dispose();
    }
  });

  it("drops xterm's late textarea-diff echo of an insertion", () => {
    const ctx = setup({ deliver: () => false });
    try {
      ctx.type("a");
      ctx.emit("a");
      expect(ctx.sent).toEqual(["a"]);
    } finally {
      ctx.dispose();
    }
  });

  it("drops a deferred echo of the newest insertion while earlier ones remain", () => {
    const ctx = setup({ deliver: () => false });
    try {
      ctx.type("j");
      ctx.type("k");
      // keydown(j)'s textarea timer fires after k was inserted: the diff is k.
      ctx.emit("k");
      expect(ctx.sent).toEqual(["j", "k"]);
    } finally {
      ctx.dispose();
    }
  });

  it("drops an echo that batches several rolled-over insertions", () => {
    const ctx = setup({ deliver: () => false });
    try {
      ctx.type("k");
      ctx.type("l");
      ctx.emit("kl");
      expect(ctx.sent).toEqual(["k", "l"]);
    } finally {
      ctx.dispose();
    }
  });

  it("keeps rapid repeated characters", () => {
    const ctx = setup({ deliver: () => false });
    try {
      ctx.type("l");
      ctx.type("l");
      expect(ctx.sent).toEqual(["l", "l"]);
    } finally {
      ctx.dispose();
    }
  });

  it("does not resend a character xterm delivered through its keypress path", () => {
    const ctx = setup({ deliver: () => false });
    try {
      const keypress = new KeyboardEvent("keypress", { bubbles: true, cancelable: true });
      Object.defineProperty(keypress, "charCode", { get: () => 97 });
      ctx.textarea.dispatchEvent(keypress);
      ctx.emit("a");
      ctx.type("a");
      expect(ctx.sent).toEqual(["a"]);
    } finally {
      ctx.dispose();
    }
  });

  it("ignores a keypress record cleared by the next keydown", () => {
    const ctx = setup({ deliver: () => false });
    try {
      const keypress = new KeyboardEvent("keypress", { bubbles: true, cancelable: true });
      Object.defineProperty(keypress, "charCode", { get: () => 97 });
      ctx.textarea.dispatchEvent(keypress);
      ctx.textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      ctx.type("a");
      expect(ctx.sent).toEqual(["a"]);
    } finally {
      ctx.dispose();
    }
  });

  it("leaves composition input to xterm", () => {
    const ctx = setup({ deliver: () => false });
    try {
      ctx.type("你", { inputType: "insertCompositionText" });
      ctx.type("你", { isComposing: true });
      expect(ctx.sent).toEqual([]);
    } finally {
      ctx.dispose();
    }
  });

  it("passes non-insertion onData through untouched", () => {
    const ctx = setup();
    try {
      ctx.emit("\r");
      ctx.emit("\x1b[A");
      expect(ctx.sent).toEqual(["\r", "\x1b[A"]);
    } finally {
      ctx.dispose();
    }
  });

  it("does not forward insertText in screen-reader mode", () => {
    const ctx = setup({ screenReaderMode: true });
    try {
      ctx.type("a");
      expect(ctx.sent).toEqual([]);
    } finally {
      ctx.dispose();
    }
  });

  it("stops listening after dispose", () => {
    const ctx = setup({ deliver: () => false });
    try {
      ctx.dispose();
      ctx.textarea.dispatchEvent(
        new InputEvent("input", { inputType: "insertText", data: "a", bubbles: true }),
      );
      expect(ctx.sent).toEqual([]);
    } finally {
      ctx.element.remove();
    }
  });
});
