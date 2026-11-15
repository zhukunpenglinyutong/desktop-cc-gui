import { create } from "zustand";
import { readStoredJson, writeStored } from "@/lib/storage";
import { textFingerprint } from "./fingerprint";
import { findTranslationLanguage } from "./languages";
import {
  buildTranslationPrompt,
  chunkMarkdown,
  parseTranslationOutput,
  type TranslationSection,
} from "./prompt";
import {
  runTranslationPrompt,
  TranslationCancelledError,
  type TranslationExecution,
} from "./runner";

/**
 * 插件介绍译文的本地缓存（localStorage）与翻译任务。
 *
 * 两类译文分开存：
 * - 摘要：名称 + 简介（精选插件另含精选语与推荐语），列表、精选卡、详情页
 *   页头共用；页头「翻译列表」按批生成，单个插件的翻译顺带生成。
 * - README：详情页正文，长文分块翻译后拼接。
 * 每条译文附原文指纹；原文变化后对不上即标为过期，过期译文仍可查看，直到
 * 用户重新翻译或切回原文。
 *
 * 显示语言是全局的：选了某种语言，所有已有该语言译文的插件都显示译文，
 * 没有译文的保持原文。运行中的任务与错误只在内存里。
 */

const STORAGE_KEY = "ccgui.plugin-translations.v1";
/** 摘要很短：索引规模 × 语言数也远低于此上限。 */
export const MAX_SUMMARIES = 3000;
/** README 译文可能有几十 KB：按翻译时间淘汰最旧的。 */
export const MAX_READMES = 40;
/** 列表翻译每轮的插件数：输入输出都保持在一屏左右的长度。 */
export const LIST_BATCH_SIZE = 15;

export interface SummarySource {
  name: string;
  description: string;
  /** 精选卡的一句话卖点；非精选插件为 null。 */
  tagline: string | null;
  /** 精选卡的推荐语；没有则 null。 */
  note: string | null;
}

interface TranslationMeta {
  pluginId: string;
  language: string;
  /** 原文指纹（summaryFingerprint / textFingerprint）。 */
  hash: string;
  engine: string;
  model: string | null;
  translatedAt: number;
}

export interface SummaryTranslation extends TranslationMeta, SummarySource {}

export interface ReadmeTranslation extends TranslationMeta {
  text: string;
}

interface PersistedTranslations {
  summaries: Record<string, SummaryTranslation>;
  readmes: Record<string, ReadmeTranslation>;
  /** 当前显示的译文语言；null = 显示原文。 */
  displayLanguage: string | null;
  /** 上次选的目标语言，菜单里预选它。 */
  lastLanguage: string | null;
  /** 设置 → 插件翻译：固定的引擎与模型。 */
  preference: TranslationPreference;
}

/**
 * 翻译用哪个引擎/模型。`engine === null` = 跟随当前会话（会话引擎不能零
 * 工具运行时退到第一个可用的受支持引擎）；`model === null` = 引擎默认模型。
 * 渠道不单独选：沿用该引擎当前生效的渠道，与聊天一致。
 */
export interface TranslationPreference {
  engine: string | null;
  model: string | null;
}

export const DEFAULT_TRANSLATION_PREFERENCE: TranslationPreference = { engine: null, model: null };

export type TranslationErrorReason = "failed" | "unparsable";

export interface TranslationJobError {
  reason: TranslationErrorReason;
  /** 引擎/IPC 原始报错（failed 时），用于提示的 title。 */
  detail?: string;
}

export interface TranslationJob {
  controller: AbortController;
  /** 已完成 / 总轮次（列表按插件数计，单个插件按轮次计）。 */
  done: number;
  total: number;
}

interface TranslationStore extends PersistedTranslations {
  jobs: Record<string, TranslationJob>;
  errors: Record<string, TranslationJobError>;
  translatePlugin: (args: {
    pluginId: string;
    language: string;
    summary: SummarySource;
    /** null：没有 README（或拉取失败），只翻译摘要。 */
    readme: string | null;
    execution: TranslationExecution;
  }) => Promise<void>;
  translateList: (args: {
    language: string;
    items: { pluginId: string; summary: SummarySource }[];
    execution: TranslationExecution;
  }) => Promise<void>;
  cancel: (jobKey: string) => void;
  /** 切换显示语言；null = 切回原文。 */
  setDisplayLanguage: (language: string | null) => void;
  /** 设置页改引擎/模型；换引擎时模型回到默认（模型 id 属于具体引擎）。 */
  setPreference: (preference: TranslationPreference) => void;
  dismissError: (jobKey: string) => void;
}

export function translationKey(pluginId: string, language: string): string {
  return `${pluginId}\u0000${language}`;
}
export function listJobKey(language: string): string {
  return `list\u0000${language}`;
}
export function pluginJobKey(pluginId: string, language: string): string {
  return `plugin\u0000${pluginId}\u0000${language}`;
}

export function summaryFingerprint(source: SummarySource): string {
  return textFingerprint(
    JSON.stringify([
      source.name.trim(),
      source.description.trim(),
      source.tagline?.trim() || null,
      source.note?.trim() || null,
    ]),
  );
}

export type TranslationFreshness = "fresh" | "stale";

export function summaryFreshness(
  entry: SummaryTranslation,
  source: SummarySource,
): TranslationFreshness {
  return entry.hash === summaryFingerprint(source) ? "fresh" : "stale";
}

/**
 * README 译文是否还对得上原文。`readme === undefined` 表示 README 当前
 * 未知（加载中或拉取失败）：不因一次网络失败把译文判成过期。
 */
export function readmeFreshness(
  entry: ReadmeTranslation,
  readme: string | null | undefined,
): TranslationFreshness {
  if (readme === undefined) return "fresh";
  if (readme === null) return "stale";
  return entry.hash === textFingerprint(readme) ? "fresh" : "stale";
}

// ----------------------------------------------------------------- storage

function isMeta(v: Record<string, unknown>): boolean {
  return (
    typeof v.pluginId === "string" &&
    typeof v.language === "string" &&
    typeof v.hash === "string" &&
    typeof v.engine === "string" &&
    (v.model === null || typeof v.model === "string") &&
    typeof v.translatedAt === "number"
  );
}

function isSummary(value: unknown): value is SummaryTranslation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isMeta(v) &&
    typeof v.name === "string" &&
    typeof v.description === "string" &&
    (v.tagline === null || typeof v.tagline === "string") &&
    (v.note === null || typeof v.note === "string")
  );
}

function isReadme(value: unknown): value is ReadmeTranslation {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return isMeta(v) && typeof v.text === "string";
}

function rebuild<T extends TranslationMeta>(
  raw: unknown,
  guard: (value: unknown) => value is T,
): Record<string, T> {
  const out: Record<string, T> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    if (guard(value)) out[translationKey(value.pluginId, value.language)] = value;
  }
  return out;
}

function validLanguage(value: unknown): string | null {
  return typeof value === "string" && findTranslationLanguage(value) ? value : null;
}

/** 存储里的引擎/模型偏好：形状不对就回到「跟随会话 + 默认模型」。 */
function validPreference(value: unknown): TranslationPreference {
  if (typeof value !== "object" || value === null) return DEFAULT_TRANSLATION_PREFERENCE;
  const v = value as Record<string, unknown>;
  const text = (raw: unknown): string | null =>
    typeof raw === "string" && raw.trim() ? raw.trim() : null;
  const engine = text(v.engine);
  return { engine, model: engine ? text(v.model) : null };
}

function readPersisted(): PersistedTranslations {
  return (
    readStoredJson(STORAGE_KEY, (value): PersistedTranslations | null => {
      if (typeof value !== "object" || value === null) return null;
      const v = value as Record<string, unknown>;
      return {
        summaries: rebuild(v.summaries, isSummary),
        readmes: rebuild(v.readmes, isReadme),
        displayLanguage: validLanguage(v.displayLanguage),
        lastLanguage: validLanguage(v.lastLanguage),
        preference: validPreference(v.preference),
      };
    }) ?? {
      summaries: {},
      readmes: {},
      displayLanguage: null,
      lastLanguage: null,
      preference: DEFAULT_TRANSLATION_PREFERENCE,
    }
  );
}

function persist(state: PersistedTranslations): void {
  writeStored(
    STORAGE_KEY,
    JSON.stringify({
      summaries: state.summaries,
      readmes: state.readmes,
      displayLanguage: state.displayLanguage,
      lastLanguage: state.lastLanguage,
      preference: state.preference,
    }),
  );
}

/** 写入若干条并按上限淘汰最旧的。 */
export function withEntries<T extends TranslationMeta>(
  current: Record<string, T>,
  entries: T[],
  max: number,
): Record<string, T> {
  const next = { ...current };
  for (const entry of entries) next[translationKey(entry.pluginId, entry.language)] = entry;
  const keys = Object.keys(next);
  if (keys.length > max) {
    keys
      .sort((a, b) => next[a].translatedAt - next[b].translatedAt)
      .slice(0, keys.length - max)
      .forEach((key) => delete next[key]);
  }
  return next;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

// ----------------------------------------------------------------- prompts

function summarySections(pluginId: string, summary: SummarySource): TranslationSection[] {
  const sections: TranslationSection[] = [{ key: `name:${pluginId}`, text: summary.name }];
  if (summary.description.trim()) {
    sections.push({ key: `description:${pluginId}`, text: summary.description });
  }
  if (summary.tagline?.trim()) sections.push({ key: `tagline:${pluginId}`, text: summary.tagline });
  if (summary.note?.trim()) sections.push({ key: `note:${pluginId}`, text: summary.note });
  return sections;
}

function summaryFromSections(
  pluginId: string,
  summary: SummarySource,
  sections: Record<string, string>,
): SummarySource {
  const pick = (field: string, original: string | null): string | null =>
    original?.trim() ? (sections[`${field}:${pluginId}`]?.trim() ?? original) : original;
  return {
    name: pick("name", summary.name) ?? summary.name,
    description: pick("description", summary.description) ?? summary.description,
    tagline: pick("tagline", summary.tagline),
    note: pick("note", summary.note),
  };
}

class UnparsableOutputError extends Error {}

/** 每一段都与原文一字不差：模型把「复述标记」当成了全部任务。 */
function echoedSource(sections: TranslationSection[], translated: Record<string, string>): boolean {
  return sections.every((section) => translated[section.key]?.trim() === section.text.trim());
}

async function translateSections(
  execution: TranslationExecution,
  sections: TranslationSection[],
  languageEnglish: string,
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const prompt = buildTranslationPrompt(sections, languageEnglish);
  const keys = sections.map((section) => section.key);
  const attempt = async (): Promise<Record<string, string>> => {
    const parsed = parseTranslationOutput(await runTranslationPrompt(execution, prompt, signal), keys);
    if (!parsed.ok) throw new UnparsableOutputError(parsed.reason);
    return parsed.sections;
  };
  const first = await attempt();
  // 小模型偶尔原样抄回源文本。重试一次；第二次仍一字不差就接受——原文
  // 多半本来就是目标语言（例如把英文插件译成英文）。
  return echoedSource(sections, first) ? attempt() : first;
}

function errorFor(error: unknown): TranslationJobError {
  if (error instanceof UnparsableOutputError) return { reason: "unparsable" };
  return { reason: "failed", detail: error instanceof Error ? error.message : String(error) };
}

// ------------------------------------------------------------------- store

export const usePluginTranslationStore = create<TranslationStore>()((set, get) => {
  /** 登记一个任务；同 key 的旧任务先中止（重新翻译替换掉它）。 */
  const begin = (key: string, total: number): AbortController => {
    get().jobs[key]?.controller.abort();
    const controller = new AbortController();
    set((s) => ({
      jobs: { ...s.jobs, [key]: { controller, done: 0, total } },
      errors: without(s.errors, key),
    }));
    return controller;
  };
  /** 只有仍是本任务时才更新：被替换掉的旧任务晚到的结果不能覆盖新状态。 */
  const owns = (key: string, controller: AbortController): boolean =>
    get().jobs[key]?.controller === controller;
  const progress = (key: string, controller: AbortController, done: number): void => {
    if (!owns(key, controller)) return;
    set((s) => ({ jobs: { ...s.jobs, [key]: { ...s.jobs[key], done } } }));
  };
  const finish = (key: string, controller: AbortController, error: unknown | null): void => {
    if (!owns(key, controller)) return;
    set((s) => ({
      jobs: without(s.jobs, key),
      errors:
        error === null || error instanceof TranslationCancelledError
          ? s.errors
          : { ...s.errors, [key]: errorFor(error) },
    }));
  };
  const showLanguage = (language: string): void => {
    set({ displayLanguage: language, lastLanguage: language });
    persist(get());
  };

  return {
    ...readPersisted(),
    jobs: {},
    errors: {},

    translatePlugin: async ({ pluginId, language, summary, readme, execution }) => {
      const target = findTranslationLanguage(language);
      if (!target) return;
      const key = pluginJobKey(pluginId, language);
      const chunks = readme === null ? [] : chunkMarkdown(readme);
      const controller = begin(key, Math.max(1, chunks.length));
      try {
        // 第一轮：摘要 + README 第一块；之后每轮一块。
        const first = await translateSections(
          execution,
          [
            ...summarySections(pluginId, summary),
            ...(chunks.length ? [{ key: "readme:0", text: chunks[0] }] : []),
          ],
          target.english,
          controller.signal,
        );
        const parts = chunks.length ? [first["readme:0"]] : [];
        for (let i = 1; i < chunks.length; i += 1) {
          progress(key, controller, i);
          const next = await translateSections(
            execution,
            [{ key: `readme:${i}`, text: chunks[i] }],
            target.english,
            controller.signal,
          );
          parts.push(next[`readme:${i}`]);
        }
        if (!owns(key, controller)) return;
        const meta = {
          pluginId,
          language,
          engine: execution.engine,
          model: execution.model,
          translatedAt: Date.now(),
        };
        const summaryEntry: SummaryTranslation = {
          ...meta,
          ...summaryFromSections(pluginId, summary, first),
          hash: summaryFingerprint(summary),
        };
        set((s) => ({
          summaries: withEntries(s.summaries, [summaryEntry], MAX_SUMMARIES),
          readmes:
            readme === null
              ? without(s.readmes, translationKey(pluginId, language))
              : withEntries(
                  s.readmes,
                  [{ ...meta, text: parts.join("\n\n"), hash: textFingerprint(readme) }],
                  MAX_READMES,
                ),
        }));
        showLanguage(language);
        finish(key, controller, null);
      } catch (error) {
        finish(key, controller, error);
      }
    },

    translateList: async ({ language, items, execution }) => {
      const target = findTranslationLanguage(language);
      if (!target) return;
      const key = listJobKey(language);
      // 只翻没有译文或译文已过期的：已有的新鲜译文不重复花调用。
      const todo = items.filter(({ pluginId, summary }) => {
        const cached = get().summaries[translationKey(pluginId, language)];
        return !cached || summaryFreshness(cached, summary) === "stale";
      });
      showLanguage(language);
      if (todo.length === 0) return;
      const controller = begin(key, todo.length);
      try {
        for (let i = 0; i < todo.length; i += LIST_BATCH_SIZE) {
          const batch = todo.slice(i, i + LIST_BATCH_SIZE);
          const sections = await translateSections(
            execution,
            batch.flatMap(({ pluginId, summary }) => summarySections(pluginId, summary)),
            target.english,
            controller.signal,
          );
          if (!owns(key, controller)) return;
          const translatedAt = Date.now();
          // 每批立即落盘：取消或后续失败时已译的部分保留。
          set((s) => ({
            summaries: withEntries(
              s.summaries,
              batch.map(({ pluginId, summary }) => ({
                pluginId,
                language,
                engine: execution.engine,
                model: execution.model,
                translatedAt,
                ...summaryFromSections(pluginId, summary, sections),
                hash: summaryFingerprint(summary),
              })),
              MAX_SUMMARIES,
            ),
          }));
          persist(get());
          progress(key, controller, i + batch.length);
        }
        finish(key, controller, null);
      } catch (error) {
        finish(key, controller, error);
      }
    },

    cancel: (jobKey) => {
      const job = get().jobs[jobKey];
      if (!job) return;
      job.controller.abort();
      set((s) => ({ jobs: without(s.jobs, jobKey) }));
    },

    setDisplayLanguage: (language) => {
      if (language !== null && !findTranslationLanguage(language)) return;
      set(language === null ? { displayLanguage: null } : { displayLanguage: language, lastLanguage: language });
      persist(get());
    },

    setPreference: (preference) => {
      set({ preference: validPreference(preference) });
      persist(get());
    },

    dismissError: (jobKey) => set((s) => ({ errors: without(s.errors, jobKey) })),
  };
});
