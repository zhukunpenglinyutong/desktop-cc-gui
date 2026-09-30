import { describe, expect, it } from "vitest";
import type { BotAvatar } from "@/lib/ipc";
import {
  BOT_COLOR_PRESETS,
  BOT_EYES,
  BOT_FOLD_SHAPES,
  avatarConfig,
  avatarFromLegacyIcon,
  avatarHex,
  avatarLabel,
  avatarSeed,
  defaultGeneratedAvatar,
  hexToAppearance,
  normalizeAvatar,
} from "./bot-avatar";

/**
 * The avatar is the one field a user recognises a bot by, so the mapping
 * between what we store and what the BoardUI engine draws is worth pinning:
 * engine vocabularies, legacy folding, and the colour round-trip.
 */

describe("avatar vocabularies match the engine", () => {
  it("uses the engine's nine silhouettes and sixteen expressions", () => {
    expect(BOT_FOLD_SHAPES).toHaveLength(9);
    expect(BOT_EYES).toHaveLength(16);
    expect(BOT_FOLD_SHAPES).toContain("petal");
    expect(BOT_EYES).toContain("curious");
    // Every preset carries a gloss hue the swatch art actually has.
    for (const preset of BOT_COLOR_PRESETS) {
      expect(preset.hue).toBeGreaterThanOrEqual(0);
      expect(preset.hue).toBeLessThanOrEqual(360);
      expect(preset.saturation).toBeGreaterThan(0);
    }
  });
});

describe("normalizeAvatar", () => {
  it("fills a bot without an avatar deterministically", () => {
    const first = defaultGeneratedAvatar("bot-42");
    const again = defaultGeneratedAvatar("bot-42");
    expect(first).toEqual(again);
    expect(BOT_FOLD_SHAPES).toContain(first.foldShape as string);
    expect(BOT_EYES).toContain(first.eyes as string);
    expect(normalizeAvatar(null, "bot-42")).toEqual(first);
  });

  it("folds the first-pass shape/color/face fields into the engine fields", () => {
    const legacy = normalizeAvatar({
      type: "generated",
      shape: "heart",
      color: "#ff0000",
      face: "smile",
    });
    expect(legacy.foldShape).toBe("heart");
    expect(legacy.eyes).toBe("happy");
    expect(legacy.hue).toBe(0);
    expect(legacy.saturation).toBe(100);
  });

  it("drops values the engine does not know instead of rendering nothing", () => {
    const resolved = normalizeAvatar({
      type: "generated",
      foldShape: "hexagon",
      eyes: "smug",
    }, "bot-7");
    expect(BOT_FOLD_SHAPES).toContain(resolved.foldShape as string);
    expect(BOT_EYES).toContain(resolved.eyes as string);
  });

  it("keeps emoji and image avatars, but not empty ones", () => {
    expect(normalizeAvatar({ type: "emoji", value: "🦊" })).toEqual({
      type: "emoji",
      value: "🦊",
    });
    expect(normalizeAvatar({ type: "emoji", value: "  " }, "bot-1").type).toBe("generated");
    expect(normalizeAvatar({ type: "image", value: "" }, "bot-1").type).toBe("generated");
  });
});

describe("avatarConfig", () => {
  it("overrides only the picked fields and keeps the engine defaults", () => {
    const config = avatarConfig(
      { type: "generated", foldShape: "star", eyes: "wink", hue: 321, saturation: 74 },
      "bot-1",
    );
    expect(config.family).toBe("fold");
    expect(config.foldShape).toBe("star");
    expect(config.eyes).toBe("wink");
    expect(config.hue).toBe(321);
    // Engine-owned fields stay on the engine's fold defaults.
    expect(config.eyeGap).toBeGreaterThan(0);
    expect(config.motion).toBeGreaterThan(0);
    expect(config.seed).toBe(avatarSeed("bot-1"));
  });
});

describe("colour round-trip", () => {
  it("turns a hex from the picker back into the stored appearance", () => {
    for (const preset of BOT_COLOR_PRESETS) {
      const avatar: BotAvatar = {
        type: "generated",
        foldShape: "slender",
        eyes: "neutral",
        hue: preset.hue,
        saturation: preset.saturation,
      };
      const hex = avatarHex(avatar, "bot-1");
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      const back = hexToAppearance(hex);
      // Within a couple of degrees: the engine adds the light/dark ramp the
      // picker cannot see.
      expect(Math.abs((back.hue ?? 0) - preset.hue)).toBeLessThan(45);
      expect(back.saturation).toBeGreaterThan(0);
    }
  });
});

describe("legacy icons", () => {
  it("keeps an emoji icon and converts an ASCII preset id", () => {
    expect(avatarFromLegacyIcon("🤖", "a1")).toEqual({ type: "emoji", value: "🤖" });
    const converted = avatarFromLegacyIcon("agent-robot-06", "a2");
    expect(converted.type).toBe("generated");
    // Deterministic: the same id always produces the same character.
    expect(converted).toEqual(avatarFromLegacyIcon("agent-robot-06", "a2"));
  });
});

describe("avatarLabel", () => {
  it("describes the paper avatar and passes through emoji", () => {
    expect(avatarLabel({ type: "emoji", value: "🦊" })).toBe("🦊");
    expect(
      avatarLabel({ type: "generated", foldShape: "star", eyes: "wink" }, (s, e) => `${s}/${e}`),
    ).toBe("star/wink");
    // No formatter: the caller has the name next to the avatar already, so the
    // view falls back to a generic label rather than announcing "star · wink".
    expect(avatarLabel({ type: "generated", foldShape: "star", eyes: "wink" })).toBe("");
  });
});
