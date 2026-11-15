import { describe, expect, it } from "vitest";
import type { EngineInfo } from "@/lib/ipc";
import type { ActiveSession } from "@/features/chat/store/persistence";
import { resolveTranslationExecution } from "./execution";
import { defaultTranslationLanguage } from "./languages";

function engine(id: string, overrides: Partial<EngineInfo> = {}): EngineInfo {
  return { id, available: true, enabled: true, supportsImages: false, permissions: ["auto"], ...overrides };
}

function session(overrides: Partial<ActiveSession>): ActiveSession {
  return { engine: "claude", workspacePath: "/ws", sessionId: null, ...overrides } as ActiveSession;
}

describe("resolveTranslationExecution", () => {
  it("follows the current session's engine, model and channel", () => {
    expect(
      resolveTranslationExecution([engine("claude"), engine("pi")], session({ engine: "pi", model: "gpt-5", provider: "work" })),
    ).toEqual({ execution: { engine: "pi", model: "gpt-5", providerId: "work" }, source: "session" });
  });

  it("falls back to a tool-less engine's default model when the session engine cannot run tool-less", () => {
    expect(
      resolveTranslationExecution([engine("codex"), engine("claude")], session({ engine: "codex", model: "o3" })),
    ).toEqual({ execution: { engine: "claude", model: null, providerId: null }, source: "default" });
  });

  it("an engine pinned in settings wins over the session, with its own model", () => {
    expect(
      resolveTranslationExecution(
        [engine("claude"), engine("pi")],
        session({ engine: "claude", model: "opus", provider: "work" }),
        { engine: "pi", model: "gemma4:latest" },
      ),
    ).toEqual({
      execution: { engine: "pi", model: "gemma4:latest", providerId: null },
      source: "settings",
    });
  });

  it("a pinned engine that is gone is reported, not silently swapped for another", () => {
    expect(
      resolveTranslationExecution([engine("claude"), engine("pi", { enabled: false })], null, {
        engine: "pi",
        model: null,
      }),
    ).toEqual({ execution: null, reason: "pinnedUnavailable", engine: "pi" });
    expect(
      resolveTranslationExecution([engine("claude"), engine("codex")], null, {
        engine: "codex",
        model: null,
      }),
    ).toEqual({ execution: null, reason: "pinnedUnavailable", engine: "codex" });
  });

  it("follow-session preference behaves like no preference", () => {
    expect(
      resolveTranslationExecution([engine("claude")], session({ engine: "claude", model: "opus" }), {
        engine: null,
        model: null,
      }),
    ).toEqual({ execution: { engine: "claude", model: "opus", providerId: null }, source: "session" });
  });

  it("skips engines that are missing or disabled", () => {
    expect(
      resolveTranslationExecution(
        [engine("claude", { enabled: false }), engine("pi", { available: false }), engine("codex")],
        null,
      ),
    ).toEqual({ execution: null, reason: "noEngine" });
  });
});

describe("defaultTranslationLanguage", () => {
  it("follows the UI language and falls back to English", () => {
    expect(defaultTranslationLanguage("ko")).toBe("ko");
    expect(defaultTranslationLanguage("zh-CN")).toBe("zh");
    expect(defaultTranslationLanguage("ru-RU")).toBe("ru");
    expect(defaultTranslationLanguage("xx")).toBe("en");
    expect(defaultTranslationLanguage(undefined)).toBe("en");
  });
});
