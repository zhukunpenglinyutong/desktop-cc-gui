import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import test from "node:test";

// Execute the extension shipped by the Rust adapter, not a second implementation.
const adapter = readFileSync(new URL("../src-tauri/src/engine/pi_family.rs", import.meta.url), "utf8");
const source = adapter.match(/const PI_ASK_BRIDGE: &str = r#"([\s\S]*?)"#;/)?.[1];
if (!source) throw new Error("Pi bridge extension not found");
const javascript = stripTypeScriptTypes(source);
// The module is embedded in a Rust string, so it cannot be statically imported.
const { default: registerBridge } = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

type Payload = Record<string, unknown>;
type RequestHook = (event: { payload: unknown }, context: unknown) => unknown;

async function prepareRequest(payload: Payload, api: string, provider = "test"): Promise<unknown> {
  const hooks: RequestHook[] = [];
  registerBridge({
    registerTool() {},
    getThinkingLevel: () => "xhigh",
    on(event: string, handler: RequestHook) {
      if (event === "before_provider_request") hooks.push(handler);
    },
  });
  const context = { model: { api, provider }, thinkingLevel: "xhigh" };
  let outgoing: unknown = payload;
  for (const hook of hooks) {
    const replacement = await hook({ payload: outgoing }, context);
    if (replacement !== undefined) outgoing = replacement;
  }
  return outgoing;
}

test("Codex Responses keeps native reasoning without Chat Completions parameters", async () => {
  const native = {
    model: "gpt-6-astra",
    input: [{ role: "user", content: "hello" }],
    reasoning: { effort: "xhigh", summary: "auto" },
    stream: true,
  };
  assert.deepEqual(await prepareRequest(structuredClone(native), "openai-codex-responses", "openai-codex"), native);
});

test("Chat Completions keeps its native effort without Responses or Anthropic parameters", async () => {
  const native = {
    model: "reasoning-model",
    messages: [{ role: "user", content: "hello" }],
    reasoning_effort: "high",
  };
  assert.deepEqual(await prepareRequest(structuredClone(native), "openai-completions", "openai"), native);
});

test("OpenRouter retains the adapter-selected reasoning dialect", async () => {
  const native = {
    model: "reasoning-model",
    messages: [{ role: "user", content: "hello" }],
    reasoning: { effort: "high", exclude: false },
  };
  assert.deepEqual(await prepareRequest(structuredClone(native), "openai-completions", "openrouter"), native);
});

test("Anthropic budget-based thinking does not acquire adaptive effort or OpenAI fields", async () => {
  const native = {
    model: "budget-thinking-model",
    messages: [{ role: "user", content: "hello" }],
    thinking: { type: "enabled", budget_tokens: 8192 },
    max_tokens: 16384,
  };
  assert.deepEqual(await prepareRequest(structuredClone(native), "anthropic-messages", "anthropic"), native);
});

test("Google keeps its native thinking configuration", async () => {
  const native = {
    request: {
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      generationConfig: { thinkingConfig: { thinkingBudget: 8192, includeThoughts: true } },
    },
  };
  assert.deepEqual(await prepareRequest(structuredClone(native), "google-gemini-cli", "google-antigravity"), native);
});

test("a CLI request with reasoning omitted stays omitted even when the UI selected xhigh", async () => {
  const native = { model: "non-reasoning-model", input: [{ role: "user", content: "hello" }] };
  assert.deepEqual(await prepareRequest(structuredClone(native), "openai-responses", "openai"), native);
});
