import { listenMissionAgentEvents, type EngineEventPayload } from "@/lib/events";
import { ipc } from "@/lib/ipc";
import { safeRandomUUID } from "@/lib/id";

/**
 * 跑一次零工具翻译轮次并收集模型输出的原文（后端 translate.rs）。
 *
 * 事件借用 `mission-agent://event` 流：任务工作台的桥只认自己登记的 run，
 * 这里也只认 `translate-` 前缀、自己登记过的 run。先登记监听再 invoke，
 * 避免错过首批事件。
 */

type Listener = (event: EngineEventPayload) => void;
const listeners = new Map<string, Listener>();
let bridged = false;

function ensureBridged(): void {
  if (bridged) return;
  bridged = true;
  void listenMissionAgentEvents((events) => {
    for (const event of events) {
      const listener = listeners.get(event.runId);
      if (!listener) continue;
      listener(event);
      if (event.kind === "done") listeners.delete(event.runId);
    }
  });
}

export interface TranslationExecution {
  engine: string;
  model: string | null;
  providerId: string | null;
}

export class TranslationCancelledError extends Error {
  constructor() {
    super("translation cancelled");
    this.name = "TranslationCancelledError";
  }
}

export function runTranslationPrompt(
  execution: TranslationExecution,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  ensureBridged();
  const runId = `translate-${safeRandomUUID().replaceAll("-", "").slice(0, 16)}`;
  return new Promise<string>((resolve, reject) => {
    let deltas = "";
    let message = "";
    let settled = false;
    let started = false;

    const finish = (outcome: { ok: true; text: string } | { ok: false; error: Error }): void => {
      if (settled) return;
      settled = true;
      listeners.delete(runId);
      signal.removeEventListener("abort", onAbort);
      if (outcome.ok) resolve(outcome.text);
      else reject(outcome.error);
    };
    const interrupt = (): void => {
      void ipc.translateTextInterrupt(runId).catch(() => {});
    };
    const onAbort = (): void => {
      // 进程可能还在启动窗口里：后端占位条目会接住这次中断。
      if (started) interrupt();
      finish({ ok: false, error: new TranslationCancelledError() });
    };

    if (signal.aborted) {
      finish({ ok: false, error: new TranslationCancelledError() });
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });

    listeners.set(runId, (event) => {
      switch (event.kind) {
        case "delta":
          if (typeof event.data === "string") deltas += event.data;
          break;
        case "message": {
          const data = event.data as { role?: string; text?: string } | null;
          if (data?.role === "assistant" && typeof data.text === "string") message = data.text;
          break;
        }
        case "error": {
          const data = event.data as { message?: string } | string | null;
          const text = typeof data === "string" ? data : (data?.message ?? "translation failed");
          finish({ ok: false, error: new Error(text) });
          break;
        }
        case "done":
          // 与任务工作台 runMissionAgentPrompt 同一取舍：有增量用增量原文，
          // 没有增量（不流式的引擎）才用整条 assistant 消息。
          finish({ ok: true, text: deltas.length > 0 ? deltas : message });
          break;
      }
    });

    started = true;
    ipc
      .translateTextStart({
        runId,
        engine: execution.engine,
        prompt,
        model: execution.model,
        effort: null,
        providerId: execution.providerId,
      })
      .then(() => {
        // 已经取消或失败：确保进程也停下。
        if (settled) interrupt();
      })
      .catch((error: unknown) => {
        finish({ ok: false, error: error instanceof Error ? error : new Error(String(error)) });
      });
  });
}
