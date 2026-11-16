import { describe, expect, it } from "vitest";
import {
  PRESETS,
  buildCodexConfigToml,
  claudeTemplateJson,
  findMatchedPreset,
} from "./providerPresets";

describe("API Route preset configuration", () => {
  it("writes Claude's root endpoint and overrides the template's tier models", () => {
    const preset = PRESETS.claude!.find((p) => p.name === "API Route")!;
    const settings = JSON.parse(claudeTemplateJson(preset.baseUrl, "test-key", preset.env));
    expect(new URL("/v1/messages", settings.env.ANTHROPIC_BASE_URL).href).toBe(
      "https://global.api-route.com/v1/messages",
    );
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe("test-key");
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("claude-fable-5-1");
    expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-haiku-4-5");
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-5");
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-opus-5");
    expect(findMatchedPreset(PRESETS.claude!, settings.env.ANTHROPIC_BASE_URL)).toBe(preset);
  });

  it("generates a Codex Responses configuration rather than the chat fallback", () => {
    const preset = PRESETS.codex!.find((p) => p.name === "API Route")!;
    const config = buildCodexConfigToml(preset.name, preset.baseUrl, preset.model, preset.wireApi ?? "chat");
    expect(config).toContain('base_url = "https://global.api-route.com/v1"');
    expect(config).toContain('model = "gpt-6.1-sol"');
    expect(config).toContain('wire_api = "responses"');
    expect(config).toContain("requires_openai_auth = true");
    expect(config).not.toContain("disable_response_storage");
    expect(findMatchedPreset(PRESETS.codex!, preset.baseUrl)).toBe(preset);
  });
describe("TeaPotRouter preset configuration", () => {
  it("writes Claude's root endpoint and pins the current tier models", () => {
    const preset = PRESETS.claude!.find((p) => p.name === "TeaPotRouter")!;
    const settings = JSON.parse(claudeTemplateJson(preset.baseUrl, "test-key", preset.env));
    expect(new URL("/v1/messages", settings.env.ANTHROPIC_BASE_URL).href).toBe(
      "https://api.teapotrouter.com/v1/messages",
    );
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe("test-key");
    expect(settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("claude-fable-5-2");
    expect(settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-haiku-4-5");
    expect(settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-5-5");
    expect(settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-opus-5-5");
    expect(findMatchedPreset(PRESETS.claude!, settings.env.ANTHROPIC_BASE_URL)).toBe(preset);
  });

  it("generates a Codex Responses configuration", () => {
    const preset = PRESETS.codex!.find((p) => p.name === "TeaPotRouter")!;
    const config = buildCodexConfigToml(preset.name, preset.baseUrl, preset.model, preset.wireApi ?? "chat");
    expect(config).toContain('base_url = "https://api.teapotrouter.com/v1"');
    expect(config).toContain('model = "gpt-6.1-sol"');
    expect(config).toContain('wire_api = "responses"');
    expect(findMatchedPreset(PRESETS.codex!, preset.baseUrl)).toBe(preset);
  });
});
});
