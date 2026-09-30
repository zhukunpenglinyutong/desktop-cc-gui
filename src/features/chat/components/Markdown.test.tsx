import { act } from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Markdown from "./Markdown";
import { markdownRegistry } from "@ccgui/plugin-sdk";
import type { Disposer } from "@ccgui/plugin-sdk";

// React's act() environment flag — a well-known global the runtime can't
// validate, so a named cast with no narrowing is the right boundary.
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

/** Two-line fence so the host `pre` override renders the full CodeBlock card
 *  (single-line fences take the compact path). */
const FENCE = "```ts\nconst a = 1;\nconst b = 2;\n```";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderMarkdown(text: string) {
  await act(async () => {
    root.render(<Markdown text={text} workspacePath="/ws" />);
  });
}

describe("Markdown markdownRegistry merge (plan §4.2 #5)", () => {
  it("publishes parsed live text and preserves the full body when settling", async () => {
    vi.useFakeTimers();
    try {
      const text = "稳定文字 🙂 **bold** 与 `code`";
      await act(async () => root.render(<Markdown text={text} workspacePath="/ws" streaming />));
      await act(async () => vi.advanceTimersByTime(300));
      expect(container.textContent).toBe("稳定文字 🙂 bold 与 code");
      await act(async () => root.render(<Markdown text={`${text} 下一批 🙂`} workspacePath="/ws" streaming />));
      expect(container.textContent).toContain("稳定文字 🙂 bold 与 code");
      await act(async () => vi.advanceTimersByTime(300));
      expect(container.textContent).toBe("稳定文字 🙂 bold 与 code 下一批 🙂");
      await act(async () => root.render(<Markdown text={`${text} finished`} workspacePath="/ws" />));
      expect(container.textContent).toBe("稳定文字 🙂 bold 与 code finished");
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders host defaults with no registrations (gfm + CodeBlock card)", async () => {
    await renderMarkdown(`~~gone~~\n\n${FENCE}`);
    // remark-gfm still active: strikethrough is a <del>.
    expect(container.querySelector("del")?.textContent).toBe("gone");
    // Host `pre` override still renders the code-block card.
    expect(container.querySelector(".md-codeblock")).not.toBeNull();
  });

  it("applies a registered plugin's component override", async () => {
    const dispose = markdownRegistry.register({
      id: "plugin:test:md",
      components: {
        code: ({ children }) => <code data-testid="plugin-code">{children}</code>,
      },
    });
    try {
      await renderMarkdown(FENCE);
      expect(container.querySelector("[data-testid='plugin-code']")).not.toBeNull();
    } finally {
      await act(async () => dispose());
    }
  });

  it("registry changes apply live to a mounted render and dispose reverts them", async () => {
    await renderMarkdown(FENCE);
    expect(container.querySelector("[data-testid='plugin-code']")).toBeNull();
    expect(container.querySelector(".md-codeblock")).not.toBeNull();

    let dispose: Disposer = () => {};
    await act(async () => {
      dispose = markdownRegistry.register({
        id: "plugin:test:md",
        components: {
          code: ({ children }) => <code data-testid="plugin-code">{children}</code>,
        },
      });
    });
    expect(container.querySelector("[data-testid='plugin-code']")).not.toBeNull();

    await act(async () => {
      dispose();
    });
    expect(container.querySelector("[data-testid='plugin-code']")).toBeNull();
    expect(container.querySelector(".md-codeblock")).not.toBeNull();
  });
});

describe("math rendering", () => {
  it("typesets inline math instead of leaving the source literal", async () => {
    await renderMarkdown("能量守恒 $E = mc^2$ 收尾");
    expect(container.querySelector(".katex")).not.toBeNull();
    // The raw TeX must not survive as visible text next to the typeset math.
    expect(container.textContent).not.toContain("$E = mc^2$");
  });

  it("typesets display math as a centered block", async () => {
    await renderMarkdown("推导：\n\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$\n\n结束");
    expect(container.querySelector(".katex-display")).not.toBeNull();
    // The raw markup is gone: what remains is typeset, not source. (KaTeX
    // keeps the TeX inside its MathML annotation for assistive tech, which
    // is why the check looks for the delimiters and not for "\frac".)
    expect(container.textContent).not.toContain("$$");
  });

  it("promotes a formula that owns its line to a display block", async () => {
    // Models write this single-line form constantly; the parser alone would
    // render it inline and wedge the formula into the paragraph flow.
    await renderMarkdown("推导：\n\n$$\\int_0^1 x^2 \\, dx = \\frac{1}{3}$$\n\n结束");
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  it("typesets LaTeX `\\[ ... \\]` display math", async () => {
    // gpt/codex write display math with LaTeX delimiters; remark-math does
    // not know them, so before the fix the whole formula leaked as raw TeX.
    await renderMarkdown(
      "这个公式表示总的瞬时波动率：\n\n\\[\n\\sigma_{\\mathrm{总}}(t,S_t,X_t)\n\\]\n\n其中每一项……",
    );
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.textContent).not.toContain("\\[");
    expect(container.textContent).not.toContain("\\]");
  });

  it("typesets LaTeX `\\( ... \\)` inline math", async () => {
    await renderMarkdown("当 \\(x > 0\\) 时收敛");
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).not.toContain("\\(");
  });

  it("keeps math inline when it sits inside a sentence", async () => {
    await renderMarkdown("由 $a^2 + b^2 = c^2$ 可得结论");
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.querySelector(".katex-display")).toBeNull();
  });

  it("renders a box command with nested math-mode dollars as one formula", async () => {
    await renderMarkdown(
      "颜色测试：$\\nabla_\\theta \\mathcal{L} 与 \\colorbox{yellow}{$\\displaystyle \\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}$}$",
    );
    // One formula — the inner `$...$` must not split it into an error span
    // plus a raw-TeX text leak.
    expect(container.querySelectorAll(".katex").length).toBe(1);
    expect(container.querySelector(".katex-error")).toBeNull();
    const outside = [...container.querySelectorAll("*")]
      .filter((el) => !el.closest(".katex") && el.children.length === 0)
      .map((el) => el.textContent ?? "")
      .join("");
    expect(outside).not.toContain("\\int");
    expect(outside).not.toContain("\\colorbox");
  });

  it("renders nested box math in a display formula", async () => {
    await renderMarkdown(
      "$$\n\\hat{p} = \\mathrm{softmax}(Wh + b) \\quad \\colorbox{yellow}{$x^2$}\n$$",
    );
    expect(container.querySelector(".katex-display")).not.toBeNull();
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("leaves dollar signs inside code blocks alone", async () => {
    await renderMarkdown("```sh\necho $HOME\n```");
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$HOME");
  });

  it("preserves KaTeX's inline positioning styles through the span override", async () => {
    // KaTeX lifts superscripts and stacks fractions with inline styles
    // (`style="top:-3.06em"`, strut heights). The host span override once
    // dropped every prop except className, collapsing the whole formula
    // onto the baseline with overlapping glyphs.
    await renderMarkdown("平方 $a^2 + \\frac{1}{\\ln x}$ 完");
    const styled = container.querySelectorAll<HTMLElement>(".katex span[style]");
    expect(styled.length).toBeGreaterThan(0);
    const tops = [...styled].map((el) => el.style.top).filter(Boolean);
    expect(tops.length).toBeGreaterThan(0);
  });

  it("keeps the formula whole while the row is streaming", async () => {
    // Reveal spans render text as a moving prefix; a formula must never be
    // truncated by that (the reveal-plan unit test guards the mechanism).
    await act(async () => {
      root.render(<Markdown text={"$a+b$ 以及 $c$"} workspacePath="/ws" streaming />);
    });
    const katex = container.querySelector(".katex");
    expect(katex).not.toBeNull();
    expect(katex?.textContent ?? "").toContain("a");
    expect(katex?.textContent ?? "").toContain("+");
  });
});

describe("GFM email autolinks (WKWebView lookbehind compatibility)", () => {
  it("autolinks an email at a word boundary", async () => {
    await renderMarkdown("联系 a@b.co 谢谢");
    const link = container.querySelector("a[href='mailto:a@b.co']");
    expect(link?.textContent).toBe("a@b.co");
  });

  it("still refuses an email glued to a preceding non-boundary character", async () => {
    // Boundary behavior the lookbehind used to contribute: an email glued to a
    // preceding "/" must not become a link. The tokenizer rejects it first
    // here, and `findEmail`'s own `previous(match, true)` check keeps rejecting
    // it on any transform-only path.
    await renderMarkdown("请发/a@b.co");
    expect(container.querySelector("a[href^='mailto:']")).toBeNull();
  });

  it("resolves a lookbehind-free email regex for Safari/WKWebView < 16.4", () => {
    // Regression: remark-gfm's email autolink regex used to carry the
    // lookbehind `(?<=^|\s|\p{P}|\p{S})`. JavaScriptCore before Safari 16.4
    // cannot parse lookbehind and throws
    // `SyntaxError: invalid group specifier name` on every Markdown parse,
    // which crashed the whole app on launch (chat restore / release notes).
    // The pnpm patch in patches/ removes it; keep this guard so a future
    // dependency bump cannot silently bring the crash back.
    const requireFromTest = createRequire(import.meta.url);
    const requireFromRemarkGfm = createRequire(requireFromTest.resolve("remark-gfm"));
    const requireFromGfm = createRequire(requireFromRemarkGfm.resolve("mdast-util-gfm"));
    const autolinkEntry = requireFromGfm.resolve("mdast-util-gfm-autolink-literal");
    const source = readFileSync(autolinkEntry, "utf8");
    expect(source).not.toMatch(/\(\?<[=!]/);
  });
});
