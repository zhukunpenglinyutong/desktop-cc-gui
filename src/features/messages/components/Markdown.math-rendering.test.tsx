// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Markdown } from "./Markdown";

describe("Markdown math rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders inline and display LaTeX formulas", () => {
    const value = [
      "行内公式：$a^2 + b^2 = c^2$",
      "",
      "$$",
      "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
      "$$",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.querySelector(".katex-display")).toBeTruthy();
  });

  it("normalizes codex-style parentheses delimiters for inline formulas", () => {
    const value = [
      "逻辑函数：\\( \\sigma(z)=\\frac{1}{1+e^{-z}} \\)",
      "样本均值（ \\bar{x}=\\frac{1}{n}\\sum_{i=1}^{n}x_i ）",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelectorAll(".katex").length).toBeGreaterThanOrEqual(2);
  });

  it("preserves function-style parentheses inside valid inline formulas", () => {
    const value = "梯度流：$\\frac{d\\theta}{dt}=-\\nabla_\\theta \\mathcal{L}(\\theta)$。";

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    const paragraph = container.querySelector("p");
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(paragraph?.lastChild?.textContent).toBe("。");
  });

  it("promotes standalone bare latex lines inside prose to display math", () => {
    const value = [
      "如果把神经网络训练看成一个动力系统，那么最基础的梯度流可以写成",
      "\\frac{d\\theta}{dt}=-\\nabla_\\theta \\mathcal{L}(\\theta)",
      "更新也常写成",
      "v_{t+1}=\\beta v_t-\\eta \\nabla_\\theta \\mathcal{L}(\\theta_t), \\qquad \\theta_{t+1}=\\theta_t+v_{t+1}",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelectorAll(".katex-display").length).toBeGreaterThanOrEqual(2);
  });

  it("renders standalone single-line double-dollar formulas as display math", () => {
    const value = [
      "经验风险最小化常写成",
      "$$\\hat{R}(f)=\\frac{1}{n}\\sum_{i=1}^{n}\\ell(f(x_i), y_i)$$",
      "这个公式衡量经验分布上的平均损失。",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelector(".katex-display")).toBeTruthy();
  });

  it("keeps standalone single-dollar formulas renderable without wrapping them twice", () => {
    const value = [
      "后验概率满足",
      "$P(\\theta \\mid D)=\\frac{P(D\\mid \\theta)P(\\theta)}{P(D)}$,",
      "这是 Bayes 公式的标准写法。",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelector(".katex")).toBeTruthy();
    expect(container.textContent).not.toContain("$P(\\theta");
  });

  it("keeps indented formulas renderable inside ordered lists", () => {
    const value = [
      "1. 贝叶斯公式",
      "   P(\\theta\\mid D)=\\frac{P(D\\mid \\theta)P(\\theta)}{P(D)}",
      "",
      "2. 经验风险最小化",
      "   $$\\hat{R}(f)=\\frac{1}{n}\\sum_{i=1}^{n}\\ell(f(x_i), y_i)$$",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelectorAll(".katex-display").length).toBeGreaterThanOrEqual(2);
  });

  it("does not double-wrap existing multi-line display math blocks", () => {
    const value = [
      "1. 定义如下：",
      "   $$",
      "   \\int_0^1 x^2 \\, dx = \\frac{1}{3}",
      "   $$",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelectorAll(".katex-display").length).toBe(1);
  });

  it("renders latex fenced blocks even when the source includes outer delimiters", () => {
    const value = [
      "```latex",
      "$$ \\frac{d}{dx}x^2 = 2x $$",
      "```",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelector(".markdown-latexblock .katex-display")).toBeTruthy();
    expect(container.textContent).not.toContain("$$ \\frac{d}{dx}x^2 = 2x $$");
  });

  it("renders dedicated latex fenced blocks with formula preview", () => {
    const value = [
      "```latex",
      "% 1) 二次方程求根公式",
      "x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}",
      "",
      "% 2) 欧拉公式",
      "e^{i\\pi} + 1 = 0",
      "```",
    ].join("\n");

    const { container } = render(
      <Markdown value={value} className="markdown" codeBlockStyle="message" />,
    );

    expect(container.querySelector(".markdown-latexblock")).toBeTruthy();
    expect(container.querySelector(".markdown-latexblock-label")?.textContent).toContain("1) 二次方程求根公式");
    expect(container.querySelectorAll(".markdown-latexblock .katex-display").length).toBeGreaterThanOrEqual(2);
  });
});
