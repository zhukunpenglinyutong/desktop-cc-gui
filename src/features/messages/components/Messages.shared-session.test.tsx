// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
}));

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

describe("Messages shared session provenance", () => {
  it("renders per-message provenance badge for assistant messages", () => {
    const items: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "Compare two implementations",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "Codex answer",
        engineSource: "codex",
      },
      {
        id: "assistant-2",
        kind: "message",
        role: "assistant",
        text: "Claude answer",
        engineSource: "claude",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="shared:thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
  });
});
