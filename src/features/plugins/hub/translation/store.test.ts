import { beforeEach, describe, expect, it, vi } from "vitest";

const runTranslationPrompt = vi.hoisted(() => vi.fn());
vi.mock("./runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runner")>();
  return { ...actual, runTranslationPrompt };
});

import { textFingerprint } from "./fingerprint";
import { END_MARK, sectionMark } from "./prompt";
import { TranslationCancelledError } from "./runner";
import {
  LIST_BATCH_SIZE,
  listJobKey,
  MAX_READMES,
  pluginJobKey,
  readmeFreshness,
  summaryFingerprint,
  summaryFreshness,
  translationKey,
  usePluginTranslationStore,
  withEntries,
  type ReadmeTranslation,
  type SummarySource,
} from "./store";

const execution = { engine: "claude", model: "sonnet", providerId: null };
const summary: SummarySource = { name: "插件", description: "插件简介", tagline: null, note: null };

/** Fake model: echo every section of the prompt with an "RU " prefix. */
function echoTranslation(prompt: string): string {
  const out: string[] = [];
  const re = /<<<CCGUI_TRANSLATION ([^>]+)>>>\n([\s\S]*?)(?=\n<<<CCGUI_TRANSLATION)/g;
  for (const m of prompt.matchAll(re)) out.push(sectionMark(m[1]), `RU ${m[2]}`);
  return `${out.join("\n")}\n${END_MARK}`;
}

beforeEach(() => {
  localStorage.clear();
  runTranslationPrompt.mockReset();
  runTranslationPrompt.mockImplementation(async (_execution, prompt: string) => echoTranslation(prompt));
  usePluginTranslationStore.setState({
    summaries: {},
    readmes: {},
    displayLanguage: null,
    lastLanguage: null,
    preference: { engine: null, model: null },
    jobs: {},
    errors: {},
  });
});

describe("freshness", () => {
  it("summary goes stale when any visible field changes", () => {
    const store = usePluginTranslationStore.getState();
    const entry = {
      pluginId: "demo",
      language: "ru",
      ...summary,
      hash: summaryFingerprint(summary),
      engine: "claude",
      model: null,
      translatedAt: 1,
    };
    expect(store).toBeDefined();
    expect(summaryFreshness(entry, summary)).toBe("fresh");
    expect(summaryFreshness(entry, { ...summary, description: "新简介" })).toBe("stale");
    expect(summaryFreshness(entry, { ...summary, name: "新名" })).toBe("stale");
    expect(summaryFreshness(entry, { ...summary, tagline: "精选" })).toBe("stale");
    expect(summaryFreshness(entry, { ...summary, description: `  ${summary.description}\n` })).toBe("fresh");
  });

  it("README goes stale on change or removal, and stays fresh while unknown", () => {
    const entry: ReadmeTranslation = {
      pluginId: "demo",
      language: "ru",
      text: "# Т",
      hash: textFingerprint("# 标题"),
      engine: "claude",
      model: null,
      translatedAt: 1,
    };
    expect(readmeFreshness(entry, "# 标题")).toBe("fresh");
    expect(readmeFreshness(entry, "# 新标题")).toBe("stale");
    expect(readmeFreshness(entry, null)).toBe("stale");
    expect(readmeFreshness(entry, undefined)).toBe("fresh");
  });
});

describe("withEntries", () => {
  it("evicts the oldest entries beyond the cap", () => {
    let readmes: Record<string, ReadmeTranslation> = {};
    for (let i = 0; i <= MAX_READMES; i += 1) {
      readmes = withEntries(
        readmes,
        [{ pluginId: `p${i}`, language: "ru", text: "x", hash: "h", engine: "claude", model: null, translatedAt: i + 1 }],
        MAX_READMES,
      );
    }
    expect(Object.keys(readmes)).toHaveLength(MAX_READMES);
    expect(readmes[translationKey("p0", "ru")]).toBeUndefined();
    expect(readmes[translationKey(`p${MAX_READMES}`, "ru")]).toBeDefined();
  });
});

describe("translatePlugin", () => {
  it("translates the summary and a multi-chunk README, then shows and persists them", async () => {
    const readme = Array.from({ length: 3 }, (_, i) => `## 第${i}节\n\n${"正文".repeat(2500)}`).join("\n\n");
    await usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme, execution });

    const state = usePluginTranslationStore.getState();
    expect(runTranslationPrompt.mock.calls.length).toBeGreaterThan(1);
    expect(runTranslationPrompt.mock.calls[0][1]).toContain("into Russian");
    expect(state.summaries[translationKey("demo", "ru")]).toMatchObject({
      name: "RU 插件",
      description: "RU 插件简介",
      tagline: null,
      hash: summaryFingerprint(summary),
      engine: "claude",
      model: "sonnet",
    });
    const translated = state.readmes[translationKey("demo", "ru")];
    expect(translated.hash).toBe(textFingerprint(readme));
    for (let i = 0; i < 3; i += 1) expect(translated.text).toContain(`第${i}节`);
    expect(state.displayLanguage).toBe("ru");
    expect(state.jobs).toEqual({});
    const stored = JSON.parse(localStorage.getItem("ccgui.plugin-translations.v1") ?? "{}");
    expect(Object.keys(stored.summaries)).toHaveLength(1);
    expect(Object.keys(stored.readmes)).toHaveLength(1);
    expect(stored.displayLanguage).toBe("ru");
  });

  it("records an unparsable reply and keeps the previous translation", async () => {
    await usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme: null, execution });
    const before = usePluginTranslationStore.getState().summaries[translationKey("demo", "ru")];
    runTranslationPrompt.mockResolvedValueOnce("Перевод без маркеров");
    await usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme: null, execution });

    const state = usePluginTranslationStore.getState();
    expect(state.errors[pluginJobKey("demo", "ru")]).toEqual({ reason: "unparsable" });
    expect(state.summaries[translationKey("demo", "ru")]).toEqual(before);
  });

  it("retries once when the model echoes the source untranslated", async () => {
    runTranslationPrompt.mockImplementationOnce(async (_e, prompt: string) =>
      echoTranslation(prompt).replaceAll("RU ", ""),
    );
    await usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme: null, execution });
    expect(runTranslationPrompt).toHaveBeenCalledTimes(2);
    expect(usePluginTranslationStore.getState().summaries[translationKey("demo", "ru")].name).toBe("RU 插件");
  });

  it("records engine failures with their detail", async () => {
    runTranslationPrompt.mockRejectedValueOnce(new Error("engine codex does not support tool-less runs"));
    await usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme: null, execution });
    expect(usePluginTranslationStore.getState().errors[pluginJobKey("demo", "ru")]).toEqual({
      reason: "failed",
      detail: "engine codex does not support tool-less runs",
    });
  });

  it("cancel aborts the run and leaves no error or entry behind", async () => {
    runTranslationPrompt.mockImplementationOnce(
      (_execution, _prompt, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new TranslationCancelledError()));
        }),
    );
    const pending = usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme: null, execution });
    expect(usePluginTranslationStore.getState().jobs[pluginJobKey("demo", "ru")]).toBeDefined();
    usePluginTranslationStore.getState().cancel(pluginJobKey("demo", "ru"));
    await pending;

    const state = usePluginTranslationStore.getState();
    expect(state.jobs).toEqual({});
    expect(state.errors).toEqual({});
    expect(state.summaries).toEqual({});
  });

  it("a superseded run cannot overwrite the newer one", async () => {
    let resolveFirst: (text: string) => void = () => {};
    let firstPrompt = "";
    runTranslationPrompt.mockImplementationOnce(
      (_execution, prompt: string) =>
        new Promise<string>((resolve) => {
          firstPrompt = prompt;
          resolveFirst = resolve;
        }),
    );
    const store = usePluginTranslationStore.getState();
    const first = store.translatePlugin({ pluginId: "demo", language: "ru", summary, readme: null, execution });
    await store.translatePlugin({
      pluginId: "demo",
      language: "ru",
      summary,
      readme: null,
      execution: { ...execution, model: "opus" },
    });
    resolveFirst(echoTranslation(firstPrompt).replaceAll("RU ", "OLD "));
    await first;

    expect(usePluginTranslationStore.getState().summaries[translationKey("demo", "ru")]).toMatchObject({
      name: "RU 插件",
      model: "opus",
    });
  });
});

describe("translateList", () => {
  const items = Array.from({ length: LIST_BATCH_SIZE + 3 }, (_, i) => ({
    pluginId: `p${i}`,
    summary: { name: `名${i}`, description: `述${i}`, tagline: i === 0 ? "精选" : null, note: null },
  }));

  it("translates in batches, keeps featured copy and shows the language", async () => {
    await usePluginTranslationStore.getState().translateList({ language: "ru", items, execution });
    const state = usePluginTranslationStore.getState();
    expect(runTranslationPrompt).toHaveBeenCalledTimes(2);
    expect(Object.keys(state.summaries)).toHaveLength(items.length);
    expect(state.summaries[translationKey("p0", "ru")]).toMatchObject({
      name: "RU 名0",
      description: "RU 述0",
      tagline: "RU 精选",
    });
    expect(state.displayLanguage).toBe("ru");
    expect(state.jobs).toEqual({});
  });

  it("only retranslates missing and outdated entries", async () => {
    await usePluginTranslationStore.getState().translateList({ language: "ru", items, execution });
    runTranslationPrompt.mockClear();
    const changed = items.map((item, i) =>
      i === 4 ? { ...item, summary: { ...item.summary, description: "改了" } } : item,
    );
    await usePluginTranslationStore.getState().translateList({ language: "ru", items: changed, execution });
    expect(runTranslationPrompt).toHaveBeenCalledTimes(1);
    expect(runTranslationPrompt.mock.calls[0][1]).toContain("改了");
    expect(runTranslationPrompt.mock.calls[0][1]).not.toContain("述3");
  });

  it("keeps finished batches when a later batch fails", async () => {
    runTranslationPrompt
      .mockImplementationOnce(async (_e, prompt: string) => echoTranslation(prompt))
      .mockRejectedValueOnce(new Error("rate limited"));
    await usePluginTranslationStore.getState().translateList({ language: "ru", items, execution });
    const state = usePluginTranslationStore.getState();
    expect(Object.keys(state.summaries)).toHaveLength(LIST_BATCH_SIZE);
    expect(state.errors[listJobKey("ru")]).toEqual({ reason: "failed", detail: "rate limited" });
  });

  it("setPreference persists the pinned engine/model and drops a model without an engine", () => {
    usePluginTranslationStore.getState().setPreference({ engine: "pi", model: " gemma4:latest " });
    expect(usePluginTranslationStore.getState().preference).toEqual({ engine: "pi", model: "gemma4:latest" });
    const stored = JSON.parse(localStorage.getItem("ccgui.plugin-translations.v1") ?? "{}");
    expect(stored.preference).toEqual({ engine: "pi", model: "gemma4:latest" });

    usePluginTranslationStore.getState().setPreference({ engine: null, model: "opus" });
    expect(usePluginTranslationStore.getState().preference).toEqual({ engine: null, model: null });
  });

  it("setDisplayLanguage(null) returns to the originals", () => {
    usePluginTranslationStore.getState().setDisplayLanguage("ru");
    usePluginTranslationStore.getState().setDisplayLanguage(null);
    expect(usePluginTranslationStore.getState().displayLanguage).toBeNull();
    expect(usePluginTranslationStore.getState().lastLanguage).toBe("ru");
  });
});
