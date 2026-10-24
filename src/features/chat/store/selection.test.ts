import { describe, expect, it } from "vitest";

import type { ActiveSession } from "./persistence";
import { sessionSelection, type SelectionState } from "./selection";
import type { SessionState } from "./stream";

const WORKSPACE = "D:\\work";

function tab(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    engine: "pi",
    sessionId: "s-1",
    workspacePath: WORKSPACE,
    ...overrides,
  };
}

function state(overrides: Partial<SelectionState> = {}): SelectionState {
  return {
    active: tab(),
    openTabs: [tab()],
    bySession: {},
    providers: {},
    models: {},
    sessions: [],
    ...overrides,
  };
}

function session(
  overrides: Partial<
    Pick<SessionState, "activeProvider" | "activeModel" | "messages">
  > = {},
): Pick<SessionState, "activeProvider" | "activeModel" | "messages"> {
  return { messages: [], ...overrides };
}

describe("sessionSelection", () => {
  it("reports the engine's own settings as a null provider", () => {
    const selection = sessionSelection(
      state({
        bySession: {
          "pi/s-1": session({
            activeProvider: "__local_settings_json__",
            activeModel: "deepseek/deepseek-flash",
          }),
        },
        providers: { pi: "__local_settings_json__" },
      }),
      "pi",
      "s-1",
      WORKSPACE,
    );

    expect(selection).toEqual({
      provider: null,
      model: "deepseek/deepseek-flash",
    });
  });

  it("reports the concrete channel a native session runs with", () => {
    const selection = sessionSelection(
      state({
        bySession: {
          "pi/s-1": session({
            activeProvider: "channel-1",
            activeModel: "deepseek/deepseek-flash",
          }),
        },
        providers: { pi: "channel-default" },
      }),
      "pi",
      "s-1",
      WORKSPACE,
    );

    expect(selection).toEqual({
      provider: "channel-1",
      model: "deepseek/deepseek-flash",
    });
  });

  it("uses a pending tab's own channel and model overrides", () => {
    const pending = tab({
      sessionId: null,
      provider: "channel-pending",
      model: "deepseek/deepseek-v4-pro",
    });
    const selection = sessionSelection(
      state({
        active: pending,
        openTabs: [pending],
        providers: { pi: "channel-default" },
        models: { pi: "default-model" },
      }),
      "pi",
      null,
      WORKSPACE,
    );

    expect(selection).toEqual({
      provider: "channel-pending",
      model: "deepseek/deepseek-v4-pro",
    });
  });

  it("falls back to the session row before the engine default", () => {
    const selection = sessionSelection(
      state({
        sessions: [
          {
            engine: "pi",
            sessionId: "s-1",
            provider: "__local_settings_json__",
            model: "deepseek/deepseek-v4-pro",
          },
        ],
        models: { pi: "engine-default-model" },
      }),
      "pi",
      "s-1",
      WORKSPACE,
    );

    expect(selection).toEqual({
      provider: null,
      model: "deepseek/deepseek-v4-pro",
    });
  });

  it("falls back to the engine defaults for a session without state", () => {
    const selection = sessionSelection(
      state({
        providers: { pi: "channel-default" },
        models: { pi: "deepseek/deepseek-flash" },
      }),
      "pi",
      "s-missing",
      WORKSPACE,
    );

    expect(selection).toEqual({
      provider: "channel-default",
      model: "deepseek/deepseek-flash",
    });
  });
});
