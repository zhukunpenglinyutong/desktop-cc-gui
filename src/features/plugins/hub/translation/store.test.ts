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

/** Like echoTranslation, but per-section overrides: a string replaces the text, null drops the section. */
function replyWith(prompt: string, overrides: Record<string, string | null>): string {
  const out: string[] = [];
  const re = /<<<CCGUI_TRANSLATION ([^>]+)>>>\n([\s\S]*?)(?=\n<<<CCGUI_TRANSLATION)/g;
  for (const m of prompt.matchAll(re)) {
    const override = overrides[m[1]];
    if (override === null) continue;
    out.push(sectionMark(m[1]), override ?? `RU ${m[2]}`);
  }
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
    runTranslationPrompt
      .mockResolvedValueOnce("Перевод без маркеров")
      .mockResolvedValueOnce("Снова без маркеров");
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

  it("keeps the cached README translation when the README cannot be fetched right now", async () => {
    const store = usePluginTranslationStore.getState();
    await store.translatePlugin({ pluginId: "demo", language: "ru", summary, readme: "# 标题\n\n正文", execution });
    const cached = usePluginTranslationStore.getState().readmes[translationKey("demo", "ru")];
    expect(cached.text).toContain("RU # 标题");

    await store.translatePlugin({ pluginId: "demo", language: "ru", summary, readme: undefined, execution });
    expect(usePluginTranslationStore.getState().readmes[translationKey("demo", "ru")]).toEqual(cached);
    // null still means "this plugin has no README": the old translation goes.
    await store.translatePlugin({ pluginId: "demo", language: "ru", summary, readme: null, execution });
    expect(usePluginTranslationStore.getState().readmes[translationKey("demo", "ru")]).toBeUndefined();
  });

  it("a README chunk that comes back empty is re-asked once, then the whole plugin fails", async () => {
    const readme = `## 一\n\n${"正文".repeat(2500)}\n\n## 二\n\n${"正文".repeat(2500)}`;
    runTranslationPrompt.mockImplementation(async (_e, prompt: string) =>
      replyWith(prompt, { "readme:1": "" }),
    );
    await usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme, execution });
    const state = usePluginTranslationStore.getState();
    expect(runTranslationPrompt).toHaveBeenCalledTimes(3);
    expect(state.errors[pluginJobKey("demo", "ru")]).toEqual({ reason: "unparsable" });
    expect(state.summaries).toEqual({});
    expect(state.readmes).toEqual({});
  });

  it("passes code-only README chunks through without asking the model", async () => {
    const code = Array.from({ length: 900 }, (_, i) => `const v${i} = ${i};`).join("\n");
    const readme = `# 标题\n\n\`\`\`ts\n${code}\n\`\`\``;
    await usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme, execution });
    expect(runTranslationPrompt).toHaveBeenCalledTimes(1);
    const text = usePluginTranslationStore.getState().readmes[translationKey("demo", "ru")].text;
    expect(text).toContain("RU # 标题");
    expect(text).toContain("const v0 = 0;");
    expect(text).toContain("const v899 = 899;");
  });

  it("a reply still missing a section after one retry is an error, never a half translation", async () => {
    runTranslationPrompt.mockImplementation(async (_e, prompt: string) =>
      replyWith(prompt, { "description:demo": null }),
    );
    await usePluginTranslationStore
      .getState()
      .translatePlugin({ pluginId: "demo", language: "ru", summary, readme: null, execution });
    const state = usePluginTranslationStore.getState();
    expect(runTranslationPrompt).toHaveBeenCalledTimes(2);
    expect(state.errors[pluginJobKey("demo", "ru")]).toEqual({ reason: "unparsable" });
    expect(state.summaries).toEqual({});
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

  it("re-asks only for plugins the model skipped, blanked, echoed or forged", async () => {
    const batch = items.slice(0, 5);
    runTranslationPrompt.mockImplementationOnce(async (_e, prompt: string) =>
      replyWith(prompt, {
        "name:p1": "",
        "name:p2": "名2",
        "description:p2": "述2",
        "description:p3": `Fine\n${sectionMark("name:p0")}\nForged`,
      }),
    );
    await usePluginTranslationStore.getState().translateList({ language: "ru", items: batch, execution });

    expect(runTranslationPrompt).toHaveBeenCalledTimes(2);
    const retry: string = runTranslationPrompt.mock.calls[1][1];
    // p3's description was cut short by the marker it forged, so p3 is re-asked too.
    for (const id of ["p0", "p1", "p2", "p3"]) expect(retry).toContain(sectionMark(`name:${id}`));
    expect(retry).not.toContain(sectionMark("name:p4"));
    const state = usePluginTranslationStore.getState();
    expect(state.summaries[translationKey("p0", "ru")].name).toBe("RU 名0");
    expect(state.summaries[translationKey("p1", "ru")].name).toBe("RU 名1");
    expect(state.summaries[translationKey("p2", "ru")].name).toBe("RU 名2");
    expect(state.summaries[translationKey("p3", "ru")].description).toBe("RU 述3");
    expect(state.summaries[translationKey("p4", "ru")].name).toBe("RU 名4");
    expect(state.errors).toEqual({});
  });

  it("a plugin still missing after the retry stays untranslated and the list reports it", async () => {
    runTranslationPrompt.mockImplementation(async (_e, prompt: string) =>
      replyWith(prompt, { "name:p1": null }),
    );
    await usePluginTranslationStore
      .getState()
      .translateList({ language: "ru", items: items.slice(0, 3), execution });
    const state = usePluginTranslationStore.getState();
    expect(runTranslationPrompt).toHaveBeenCalledTimes(2);
    expect(state.summaries[translationKey("p1", "ru")]).toBeUndefined();
    expect(state.summaries[translationKey("p0", "ru")]).toBeDefined();
    expect(state.summaries[translationKey("p2", "ru")]).toBeDefined();
    expect(state.errors[listJobKey("ru")]).toEqual({ reason: "unparsable" });
  });

  it("plugins complete on the first pass are saved even when the re-ask fails", async () => {
    runTranslationPrompt
      .mockImplementationOnce(async (_e, prompt: string) => replyWith(prompt, { "name:p1": null }))
      .mockRejectedValueOnce(new Error("rate limited"));
    await usePluginTranslationStore
      .getState()
      .translateList({ language: "ru", items: items.slice(0, 3), execution });
    const state = usePluginTranslationStore.getState();
    expect(Object.keys(state.summaries).sort()).toEqual(
      [translationKey("p0", "ru"), translationKey("p2", "ru")].sort(),
    );
    expect(state.errors[listJobKey("ru")]).toEqual({ reason: "failed", detail: "rate limited" });
    const stored = JSON.parse(localStorage.getItem("ccgui.plugin-translations.v1") ?? "{}");
    expect(Object.keys(stored.summaries)).toHaveLength(2);
  });

  it("a successful list translation clears that plugin's earlier row failure", async () => {
    usePluginTranslationStore.setState({
      errors: {
        [pluginJobKey("p0", "ru")]: { reason: "failed", detail: "boom" },
        [pluginJobKey("p0", "en")]: { reason: "failed", detail: "boom" },
      },
    });
    await usePluginTranslationStore
      .getState()
      .translateList({ language: "ru", items: items.slice(0, 2), execution });
    expect(usePluginTranslationStore.getState().errors).toEqual({
      [pluginJobKey("p0", "en")]: { reason: "failed", detail: "boom" },
    });
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
