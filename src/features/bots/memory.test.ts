/**
 * 记忆前端工具层：渲染规则必须与 Rust 的后端一致（用量条读的就是注入的字符
 * 数），结构化错误翻成本地化文案，引擎能力判断只认后端字段。
 */
import { describe, expect, it } from "vitest";
import { engineSupportsMemory, memoryErrorMessage, renderMemory } from "./memory";
import type { EngineInfo, MemoryEntry } from "@/lib/ipc";

function entry(id: string, content: string): MemoryEntry {
  return {
    id,
    target: "memory",
    botId: "bot-1",
    content,
    source: "agent",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("renderMemory", () => {
  it("renders one bullet line per entry, in order", () => {
    expect(renderMemory([entry("1", "项目用 pnpm"), entry("2", "启动命令是 pnpm dev")])).toBe(
      "- 项目用 pnpm\n- 启动命令是 pnpm dev",
    );
    expect(renderMemory([])).toBe("");
  });
});

describe("engineSupportsMemory", () => {
  const engines = [
    { id: "claude", supportsMemory: true },
    { id: "kimi", supportsMemory: false },
    { id: "pi" },
  ] as EngineInfo[];
  it("reads the backend field, defaulting to false", () => {
    expect(engineSupportsMemory(engines, "claude")).toBe(true);
    expect(engineSupportsMemory(engines, "kimi")).toBe(false);
    expect(engineSupportsMemory(engines, "pi")).toBe(false);
    expect(engineSupportsMemory(engines, "unknown")).toBe(false);
  });
});

describe("memoryErrorMessage", () => {
  it("maps the capacity refusal to usage", () => {
    const text = memoryErrorMessage({ code: "limit", message: "memory is full", used: 2410, limit: 2200 });
    expect(text).toContain("2410");
    expect(text).toContain("2200");
  });

  it("names the scan category and keeps the detail", () => {
    const text = memoryErrorMessage({
      code: "scan",
      message: 'injection: ignore previous instructions ("忽略之前的指令")',
      kind: "injection",
    });
    expect(text).toContain("提示词注入");
    expect(text).toContain("忽略之前的指令");
  });

  it("accepts a JSON-string error (older bridge shape)", () => {
    const text = memoryErrorMessage(JSON.stringify({ code: "empty", message: "must not be empty" }));
    expect(text).toContain("不能为空");
  });

  it("falls back to the raw message for unknown shapes", () => {
    expect(memoryErrorMessage(new Error("boom"))).toBe("boom");
    expect(memoryErrorMessage("plain text")).toBe("plain text");
  });
});
