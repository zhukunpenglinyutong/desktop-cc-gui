export const SHAPES = ["pebble", "circle", "squircle", "triangle", "flower", "diamond"] as const;
export const FAMILIES = ["blob", "fold", "alien", "mascot"] as const;
export const FOLD_SHAPES = ["slender", "pocket", "petal", "flower", "star", "heart", "cloud", "diamond", "shield"] as const;
export const FOLD_DIRECTIONS = ["left", "right"] as const;
export const FOLD_MATERIALS = ["solid", "ribbons"] as const;
export const ALIEN_SHAPES = ["classic", "round", "long"] as const;
export const MASCOT_BUILDS = ["egg", "tall", "round"] as const;
export const MASCOT_OUTFITS = ["plain", "painter", "professional"] as const;
export const MASCOT_ACTIVITIES = ["present", "listening", "thinking", "working", "celebrating"] as const;
export const MASCOT_FINISHES = ["clay", "rubber"] as const;
export type AvatarFamily = typeof FAMILIES[number];
export const MATERIALS = ["mist", "ribbons", "prism", "solid"] as const;
export const EYES = ["neutral", "happy", "angry", "thinking", "shook", "curious", "wink", "sleepy", "sad", "worried", "skeptical", "focused", "excited", "calm", "shy", "confused"] as const;
export const LOOKS = ["wander", "top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"] as const;

export type AvatarConfig = {
  family: AvatarFamily;
  foldShape: typeof FOLD_SHAPES[number];
  foldDirection: typeof FOLD_DIRECTIONS[number];
  foldDepth: number;
  mascotBuild: typeof MASCOT_BUILDS[number];
  mascotOutfit: typeof MASCOT_OUTFITS[number];
  mascotActivity: typeof MASCOT_ACTIVITIES[number];
  mascotFinish: typeof MASCOT_FINISHES[number];
  alienShape: typeof ALIEN_SHAPES[number];
  shape: typeof SHAPES[number];
  material: typeof MATERIALS[number];
  eyes: typeof EYES[number];
  face: boolean;
  idle: boolean;
  lightEyes: boolean;
  hue: number;
  /** Optional custom front-surface lightness; preset paper colors default to 76. */
  lightness?: number;
  spread: number;
  saturation: number;
  grain: number;
  complexity: number;
  eyeSize: number;
  eyeGap: number;
  eyeTilt: number;
  gaze: number;
  lookAt: typeof LOOKS[number];
  expression: number;
  motion: number;
  duration: number;
  seed: number;
};

export type AvatarPreset = { name: string; description: string; config: AvatarConfig };
export const DEFAULT_CONFIG: AvatarConfig = {
  mascotBuild: "egg", mascotOutfit: "plain", mascotActivity: "present", mascotFinish: "clay",
  foldShape: "slender", foldDirection: "right", foldDepth: 15,
  family: "blob", alienShape: "classic",
  shape: "pebble", material: "mist", eyes: "neutral", face: true, idle: false, lightEyes: false,
  hue: 24, spread: 34, saturation: 94, grain: 36, complexity: 5,
  eyeSize: 22, eyeGap: 40, eyeTilt: 0, gaze: 85, lookAt: "wander", expression: 85, motion: 35, duration: 8, seed: 17,
};

export const PRESETS: AvatarPreset[] = [
  { name: "Ember", description: "Warm & thoughtful", config: DEFAULT_CONFIG },
  { name: "Orbit", description: "Curious & playful", config: { ...DEFAULT_CONFIG, shape: "squircle", hue: 240, spread: 52, material: "ribbons", eyes: "curious", grain: 18, seed: 9 } },
  { name: "Moss", description: "Quietly reassuring", config: { ...DEFAULT_CONFIG, shape: "flower", hue: 146, spread: 28, eyes: "happy", motion: 22, grain: 45, seed: 4 } },
  { name: "Prism", description: "A little otherworldly", config: { ...DEFAULT_CONFIG, shape: "circle", hue: 265, spread: 150, material: "prism", face: false, grain: 24, complexity: 7 } },
  { name: "Pip", description: "Small, big personality", config: { ...DEFAULT_CONFIG, shape: "triangle", hue: 210, spread: 0, material: "solid", grain: 0, eyes: "wink", eyeSize: 18, eyeGap: 34 } },
  { name: "Current", description: "Always in motion", config: { ...DEFAULT_CONFIG, shape: "diamond", hue: 192, spread: 115, material: "ribbons", face: false, complexity: 8, grain: 20, duration: 12 } },
];

export const FOLD_CONFIG: AvatarConfig = {
  ...DEFAULT_CONFIG, family: "fold", material: "solid", hue: 14, saturation: 86,
  spread: 14, grain: 18, eyeSize: 23, eyeGap: 42, gaze: 68, motion: 28,
};

export const FOLD_PRESETS: AvatarPreset[] = [
  { name: "Folio", description: "A warm little optimist", config: FOLD_CONFIG },
  { name: "Peri", description: "Always a little curious", config: { ...FOLD_CONFIG, hue: 254, saturation: 66, foldDirection: "left", eyes: "curious", seed: 8 } },
  { name: "Sage", description: "Space to think", config: { ...FOLD_CONFIG, hue: 153, saturation: 36, eyes: "thinking", seed: 23 } },
  { name: "Butter", description: "A bright side to everything", config: { ...FOLD_CONFIG, hue: 43, saturation: 90, foldDepth: 60, eyes: "happy", seed: 14 } },
  { name: "Ink", description: "Quietly observant", config: { ...FOLD_CONFIG, hue: 212, saturation: 38, foldShape: "slender", foldDirection: "left", seed: 41 } },
  { name: "Ribbon", description: "A thought in motion", config: { ...FOLD_CONFIG, hue: 329, saturation: 65, material: "ribbons", spread: 26, seed: 4 } },
];

export const ALIEN_CONFIG: AvatarConfig = {
  ...DEFAULT_CONFIG, family: "alien", hue: 158, spread: 25, saturation: 60,
  grain: 24, complexity: 4, eyeSize: 23, eyeGap: 56, gaze: 65, motion: 28, seed: 29,
};

export const ALIEN_PRESETS: AvatarPreset[] = [
  { name: "Nova", description: "A curious visitor", config: ALIEN_CONFIG },
  { name: "Luna", description: "Soft & perceptive", config: { ...ALIEN_CONFIG, alienShape: "round", hue: 260, spread: 18, eyes: "curious", seed: 12 } },
  { name: "Echo", description: "Quietly otherworldly", config: { ...ALIEN_CONFIG, alienShape: "long", hue: 190, spread: 30, saturation: 42, eyes: "thinking", seed: 7 } },
  { name: "Sol", description: "A warm welcome", config: { ...ALIEN_CONFIG, hue: 28, spread: 22, saturation: 88, eyes: "happy", seed: 21 } },
  { name: "Vega", description: "A vivid imagination", config: { ...ALIEN_CONFIG, material: "ribbons", hue: 255, spread: 75, grain: 16, seed: 11 } },
  { name: "Lux", description: "Simple & watchful", config: { ...ALIEN_CONFIG, material: "solid", hue: 162, saturation: 46, grain: 12, alienShape: "round", seed: 19 } },
];

export const MASCOT_CONFIG: AvatarConfig = {
  ...DEFAULT_CONFIG, family: "mascot", hue: 24, saturation: 64, grain: 18,
  spread: 22, eyeSize: 23, eyeGap: 52, gaze: 60, motion: 40,
};

export const MASCOT_PRESETS: AvatarPreset[] = [
  { name: "Milo", description: "A little everyday companion", config: MASCOT_CONFIG },
  { name: "Palette", description: "Your creative accomplice", config: { ...MASCOT_CONFIG, mascotOutfit: "painter", hue: 255, saturation: 44, eyes: "curious", seed: 31 } },
  { name: "Counsel", description: "Calm, considered advice", config: { ...MASCOT_CONFIG, mascotOutfit: "professional", hue: 205, saturation: 36, eyes: "thinking", seed: 8 } },
  { name: "Clover", description: "A patient little listener", config: { ...MASCOT_CONFIG, mascotBuild: "round", hue: 152, saturation: 35, mascotActivity: "listening", seed: 12 } },
  { name: "Peach", description: "Small wins, big feelings", config: { ...MASCOT_CONFIG, mascotBuild: "tall", hue: 350, saturation: 55, eyes: "happy", seed: 16 } },
  { name: "Blue", description: "A soft spot for ideas", config: { ...MASCOT_CONFIG, hue: 220, saturation: 62, mascotFinish: "rubber", seed: 42 } },
];

const ranges: Record<string, [number, number]> = {
  hue: [0, 360], spread: [0, 180], saturation: [0, 100], grain: [0, 100],
  complexity: [2, 12], eyeSize: [6, 30], eyeGap: [18, 56], eyeTilt: [-30, 30],
  motion: [0, 100], duration: [3, 20], seed: [1, 9999],
  gaze: [0, 100], expression: [0, 100], foldDepth: [15, 75],
};

/** Imported and persisted recipes are data, never trusted renderer input. */
export function parsePreset(value: unknown): AvatarPreset {
  if (!value || typeof value !== "object") throw new Error("Choose an Avatar Lab recipe.");
  const p = value as Record<string, unknown>;
  if (typeof p.name !== "string" || !p.config || typeof p.config !== "object") throw new Error("The recipe needs a name and settings.");
  const c = { ...p.config } as Record<string, unknown>;
  // Keep early saved studies usable as the experimental face rig evolves.
  c.gaze ??= DEFAULT_CONFIG.gaze;
  c.expression ??= DEFAULT_CONFIG.expression;
  c.lookAt ??= "wander";
  c.idle ??= false;
  c.family ??= "blob";
  c.foldShape ??= "slender";
  if (c.foldShape === "soft" || c.foldShape === "round") c.foldShape = "slender";
  c.foldDirection ??= "right";
  c.foldDepth ??= 15;
  c.mascotBuild ??= "egg";
  if (c.mascotBuild === "cushion") c.mascotBuild = "egg";
  if (c.mascotBuild === "bean") c.mascotBuild = "tall";
  c.mascotOutfit ??= "plain";
  c.mascotActivity ??= "present";
  c.mascotFinish ??= "clay";
  c.alienShape ??= "classic";
  if (typeof c.mouth === "boolean" && typeof c.eyeSize === "number" && c.eyeSize >= 6 && c.eyeSize <= 20) c.eyeSize = Math.round(c.eyeSize * 1.4);
  if (c.eyes === "oval" || c.eyes === "round") c.eyes = "neutral";
  if (c.eyes === "surprised") c.eyes = "shook";
  const config = { ...DEFAULT_CONFIG };
  if (c.lightness !== undefined) {
    if (typeof c.lightness !== "number" || !Number.isFinite(c.lightness) || c.lightness < 0 || c.lightness > 100) throw new Error("Invalid lightness");
    config.lightness = c.lightness;
  }
  if (!FAMILIES.includes(c.family as AvatarFamily) || !ALIEN_SHAPES.includes(c.alienShape as AvatarConfig["alienShape"])) throw new Error("Unknown avatar family or head shape.");
  if (!MASCOT_BUILDS.includes(c.mascotBuild as AvatarConfig["mascotBuild"]) || !MASCOT_OUTFITS.includes(c.mascotOutfit as AvatarConfig["mascotOutfit"]) || !MASCOT_ACTIVITIES.includes(c.mascotActivity as AvatarConfig["mascotActivity"]) || !MASCOT_FINISHES.includes(c.mascotFinish as AvatarConfig["mascotFinish"])) throw new Error("Unknown mascot style.");
  config.mascotBuild = c.mascotBuild as AvatarConfig["mascotBuild"];
  config.mascotOutfit = c.mascotOutfit as AvatarConfig["mascotOutfit"];
  config.mascotActivity = c.mascotActivity as AvatarConfig["mascotActivity"];
  config.mascotFinish = c.mascotFinish as AvatarConfig["mascotFinish"];
  if (!FOLD_SHAPES.includes(c.foldShape as AvatarConfig["foldShape"]) || !FOLD_DIRECTIONS.includes(c.foldDirection as AvatarConfig["foldDirection"])) throw new Error("Unknown fold style.");
  config.foldShape = c.foldShape as AvatarConfig["foldShape"];
  config.foldDirection = c.foldDirection as AvatarConfig["foldDirection"];
  config.family = c.family as AvatarFamily;
  config.alienShape = c.alienShape as AvatarConfig["alienShape"];
  for (const key of Object.keys(ranges)) {
    const v = c[key];
    const [min, max] = ranges[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid ${key} in recipe.`);
    (config as unknown as Record<string, unknown>)[key] = v;
  }
  for (const key of ["face", "idle", "lightEyes"] as const) {
    if (typeof c[key] !== "boolean") throw new Error(`Invalid ${key} in recipe.`);
    config[key] = c[key];
  }
  if (!SHAPES.includes(c.shape as AvatarConfig["shape"]) || !MATERIALS.includes(c.material as AvatarConfig["material"]) || !EYES.includes(c.eyes as AvatarConfig["eyes"])) throw new Error("Unknown avatar style.");
  config.shape = c.shape as AvatarConfig["shape"];
  if (config.family === "fold" && !FOLD_MATERIALS.includes(c.material as typeof FOLD_MATERIALS[number])) throw new Error("Unknown fold surface.");
  config.material = c.material as AvatarConfig["material"];
  config.eyes = c.eyes as AvatarConfig["eyes"];
  if (!LOOKS.includes(c.lookAt as AvatarConfig["lookAt"])) throw new Error("Unknown gaze direction.");
  config.lookAt = c.lookAt as AvatarConfig["lookAt"];
  return { name: p.name.slice(0, 48) || "Untitled", description: "Your saved direction", config };
}
