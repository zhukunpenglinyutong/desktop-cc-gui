import { describe, expect, it } from "vitest";
import type { EngineInfo } from "@/lib/ipc";
import type { ActiveSession } from "@/features/chat/store/persistence";
import { sessionKey } from "@/features/chat/store/persistence";
import { resolveTranslationExecution, type CurrentSessionExecution } from "./execution";
import { selectCurrentSession } from "./execution-view";
import { defaultTranslationLanguage } from "./languages";

function engine(id: string, overrides: Partial<EngineInfo> = {}): EngineInfo {
  return { id, available: true, enabled: true, supportsImages: false, permissions: ["auto"], ...overrides };
}

function session(overrides: Partial<CurrentSessionExecution>): CurrentSessionExecution {
  return { engine: "claude", model: null, provider: null, ...overrides };
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

describe("selectCurrentSession", () => {
  const tab = (overrides: Partial<ActiveSession>): ActiveSession => ({
    engine: "claude",
    workspacePath: "/ws",
    sessionId: "s1",
    ...overrides,
  });
  const state = (active: ActiveSession, session: Record<string, unknown> | undefined) => ({
    active,
    bySession: session
      ? { [sessionKey(active.engine, active.sessionId, active.workspacePath)]: session }
      : {},
    models: { claude: "sonnet" },
    providers: { claude: "global-channel" },
  }) as never;

  it("uses the model and channel a created session runs with, not stale tab fields", () => {
    expect(
      selectCurrentSession(
        state(tab({ provider: "stale-tab-channel" }), {
          activeModel: "opus",
          activeProvider: "session-relay",
          messages: [],
        }),
      ),
    ).toEqual({ engine: "claude", model: "opus", provider: "session-relay" });
  });

  it("a not-yet-created tab keeps its own picks; otherwise the engine defaults apply", () => {
    expect(
      selectCurrentSession(state(tab({ sessionId: null, model: "haiku", provider: "tab-channel" }), undefined)),
    ).toEqual({ engine: "claude", model: "haiku", provider: "tab-channel" });
    expect(selectCurrentSession(state(tab({ sessionId: null }), undefined))).toEqual({
      engine: "claude",
      model: "sonnet",
      provider: "global-channel",
    });
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
