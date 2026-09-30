import { describe, expect, it } from "vitest";
import { buildBotBlock, hasAgentBlock, stripAgentBlock } from "./agent-block";

/** The v1 shape of the block, minus the bot id line. */
const buildAgentBlock = (input: { name: string; icon?: string; prompt: string }) =>
  buildBotBlock({ name: input.name, icon: input.icon, body: input.prompt });

describe("stripAgentBlock", () => {
  it("leaves text without an agent block untouched", () => {
    const text = "hello world\n\nsecond paragraph";
    expect(stripAgentBlock(text)).toEqual({ text });
    expect(hasAgentBlock(text)).toBe(false);
  });

  it("strips a tail block and parses name and icon", () => {
    const text =
      "fix the bug" +
      buildAgentBlock({ name: "Reviewer", icon: "🧐", prompt: "Be strict." });
    expect(hasAgentBlock(text)).toBe(true);
    expect(stripAgentBlock(text)).toEqual({
      text: "fix the bug",
      agentName: "Reviewer",
      agentIcon: "🧐",
    });
  });

  it("omits icon when the icon line is empty", () => {
    const text =
      "hi" + buildAgentBlock({ name: "Solo", prompt: "Do things." });
    expect(stripAgentBlock(text)).toEqual({
      text: "hi",
      agentName: "Solo",
      agentIcon: undefined,
    });
  });

  it("strips a streaming half-block that has no end yet", () => {
    const text = "draft\n\n## Agent Role and Instructions\n\nAgent Name: Rev";
    const stripped = stripAgentBlock(text);
    expect(stripped.text).toBe("draft");
    expect(stripped.agentName).toBe("Rev");
  });

  it("shows an empty body when the message opens with the block", () => {
    const text = buildAgentBlock({
      name: "Opener",
      icon: "🚀",
      prompt: "Lead.",
    }).trimStart();
    const stripped = stripAgentBlock(text);
    expect(stripped.text).toBe("");
    expect(stripped.agentName).toBe("Opener");
    expect(stripped.agentIcon).toBe("🚀");
  });

  it("parses the bot id line so the badge can render a generated avatar", () => {
    const text =
      "hi" +
      buildBotBlock({
        name: "太奶",
        icon: "",
        botId: "bot-123",
        body: "# 你的人格\n先讲结论。",
      });
    expect(stripAgentBlock(text)).toEqual({
      text: "hi",
      agentName: "太奶",
      agentIcon: undefined,
      botId: "bot-123",
    });
  });

  it("tolerates CRLF line endings", () => {
    const text =
      "body\r\n\r\n## Agent Role and Instructions\r\n\r\nAgent Name: Win\r\n\r\nDo.";
    const stripped = stripAgentBlock(text);
    expect(stripped.text).toBe("body");
    expect(stripped.agentName).toBe("Win");
  });
});
