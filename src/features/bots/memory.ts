/**
 * 记忆的前端入口：注入渲染规则（必须与 Rust `memory::render` 一致，界面上的
 * 用量条就是模型实际读到的字符数）、写入错误的本地化、引擎能力判断，以及记忆
 * 页签与拼装预览共用的只读 store。
 *
 * 写入本身没有前端校验：扫描与容量闸只有后端一处（memory/mcp.rs），界面
 * 只是把它的结构化错误翻成人话。这样面板、MCP 工具、将来的复盘共享同一套
 * 规则，不存在「界面能存进去但工具存不进去」的分叉。
 */
import { create } from "zustand";
import i18n from "@/lib/i18n";
import { errorText } from "@/lib/errors";
import { isWeb, pickSavePath } from "@/lib/platform";
import {
  ipc,
  type EngineInfo,
  type MemoryEntry,
  type MemoryErrorPayload,
  type MemoryReviewOutcome,
  type MemoryView,
} from "@/lib/ipc";

/** 条目 → 注入行。与 `memory::render` 同一条规则：每条一行、`- ` 前缀。 */
export function renderMemory(entries: MemoryEntry[]): string {
  return entries.map((entry) => `- ${entry.content}`).join("\n");
}

/** 能否把 `memory` 工具挂给这个引擎（后端 `supportsMemory`，能力来自它是否
 *  有 MCP 挂载通道）。false 时提示词里不写「记忆使用说明」——不能教模型调用
 *  一个不存在的工具。 */
export function engineSupportsMemory(engines: EngineInfo[], engine: string): boolean {
  return engines.find((entry) => entry.id === engine)?.supportsMemory === true;
}

function asPayload(error: unknown): MemoryErrorPayload | null {
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error) as MemoryErrorPayload;
      return parsed && typeof parsed.code === "string" ? parsed : null;
    } catch {
      return null;
    }
  }
  if (error && typeof error === "object" && typeof (error as MemoryErrorPayload).code === "string") {
    return error as MemoryErrorPayload;
  }
  return null;
}

/** 后端 MemoryError → 可展示文案。扫描细节原样附在括号里：它说明命中了什么
 *  （只给类目的话，用户不知道怎么改）。 */
export function memoryErrorMessage(error: unknown): string {
  const payload = asPayload(error);
  if (!payload) return errorText(error);
  switch (payload.code) {
    case "limit":
      return i18n.t("settings.memoryErrorLimit", {
        used: payload.used ?? payload.limit ?? 0,
        limit: payload.limit ?? 0,
      });
    case "scan": {
      const kind =
        payload.kind === "secret"
          ? i18n.t("settings.memoryErrorScanSecret")
          : payload.kind === "invisible"
            ? i18n.t("settings.memoryErrorScanInvisible")
            : i18n.t("settings.memoryErrorScanInjection");
      return `${kind}（${payload.message}）`;
    }
    case "empty":
      return i18n.t("settings.memoryErrorEmpty");
    case "stale":
      return i18n.t("settings.memoryErrorStale");
    case "not_found":
      return i18n.t("settings.memoryErrorMissing");
    default:
      return payload.message || errorText(error);
  }
}

interface MemoryStore {
  /** 当前载入的是哪个 Bot 的视图；刷新回来时用它丢弃过期响应。 */
  botId: string | null;
  view: MemoryView | null;
  loading: boolean;
  error: string | null;
  /** 最近一次后台复盘的结果（按 Bot 过滤展示；内存态，重启即清）。 */
  lastReview: { botId: string; outcome: MemoryReviewOutcome } | null;
  /** 重新拉取一个 Bot 的两个账本（botId=null 时只有 USER）。失败保留旧
   *  视图并记下错误，面板上的条目不会因为一次查询失败消失。 */
  refresh: (botId: string | null) => Promise<void>;
  /** 记录一次复盘结果（features/bots/memory-review.ts 调用）。 */
  setReview: (botId: string, outcome: MemoryReviewOutcome) => void;
}

export const useMemoryStore = create<MemoryStore>()((set, get) => ({
  botId: null,
  view: null,
  loading: false,
  error: null,
  lastReview: null,
  refresh: async (botId) => {
    set({ botId, loading: true });
    try {
      const view = await ipc.memoryList(botId);
      if (get().botId !== botId) return;
      set({ view, error: null, loading: false });
    } catch (error) {
      if (get().botId !== botId) return;
      set({ error: memoryErrorMessage(error), loading: false });
    }
  },
  setReview: (botId, outcome) => set({ lastReview: { botId, outcome } }),
}));

/** 面板里这个 Bot 的最近复盘结果；别的 Bot 的不展示。 */
export function useMemoryReview(botId: string): MemoryReviewOutcome | null {
  return useMemoryStore((state) =>
    state.lastReview?.botId === botId ? state.lastReview.outcome : null,
  );
}

/** 面板里这个 Bot 的视图：过期的一次查询结果不展示（store 仍是另一个 Bot 的）。 */
export function useMemoryView(botId: string): MemoryView | null {
  return useMemoryStore((state) => (state.botId === botId ? state.view : null));
}

/** 导出为 markdown：`- 内容` 行，和注入到提示词的形状一致，便于直接对照。 */
export function memoryMarkdown(title: string, entries: MemoryEntry[]): string {
  return `# ${title}\n\n${renderMemory(entries)}\n`;
}

/** 一键导出：桌面弹出保存对话框，网页端降级为下载。与性能报告导出同一套
 *  处理（lib/performance-export.ts）。 */
export async function exportMemoryLedger(
  title: string,
  filename: string,
  entries: MemoryEntry[],
): Promise<"saved" | "downloaded" | "cancelled"> {
  const content = memoryMarkdown(title, entries);
  if (!isWeb) {
    const path = await pickSavePath(title, filename);
    if (!path) return "cancelled";
    await ipc.writeFile(path, content);
    return "saved";
  }
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown" }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    return "downloaded";
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
