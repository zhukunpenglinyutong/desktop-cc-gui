import { afterEach, describe, expect, it } from "vitest";
import { sessionKey, useChatStore } from "@/features/chat/store";
import { setActiveComposerDraft } from "./composer-draft";

const ACTIVE = { engine: "claude", sessionId: "s-1", workspacePath: "/ws" };

afterEach(() => {
  useChatStore.setState({ active: null, drafts: {} });
});

describe("setActiveComposerDraft", () => {
  it("replaces the active session's draft under its session key", () => {
    useChatStore.setState({
      active: ACTIVE,
      drafts: { [sessionKey("claude", "s-1", "/ws")]: "old text" },
    });
    setActiveComposerDraft("test-plugin", "帮我修复上述问题");
    expect(useChatStore.getState().drafts[sessionKey("claude", "s-1", "/ws")]).toBe(
      "帮我修复上述问题",
    );
  });

  it("keys pending (never-sent) tabs by engine + workspace", () => {
    useChatStore.setState({ active: { ...ACTIVE, sessionId: null }, drafts: {} });
    setActiveComposerDraft("test-plugin", "draft");
    expect(useChatStore.getState().drafts["new:claude:/ws"]).toBe("draft");
  });

  it("throws when no session is active (failure stays visible to the plugin)", () => {
    useChatStore.setState({ active: null });
    expect(() => setActiveComposerDraft("test-plugin", "x")).toThrow(/no active session/);
    expect(useChatStore.getState().drafts).toEqual({});
  });
});
