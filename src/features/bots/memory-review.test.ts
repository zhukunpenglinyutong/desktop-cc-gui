/**
 * 后台复盘的前端规则：对话裁剪（去掉注入的 Bot 块、只留正文、超长保留尾部）
 * 与触发节奏（每 N 轮 / 会话结束、失败不丢轮次、同会话不叠请求）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/ipc";

const ipcMock = vi.hoisted(() => ({
  memoryReview: vi.fn(),
  memoryList: vi.fn(),
}));

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return { ...actual, ipc: { ...actual.ipc, ...ipcMock } };
});

import { useMemoryStore } from "./memory";
import {
  noteSessionEnded,
  noteTurnCompleted,
  resetMemoryReviewState,
  reviewSchedule,
  reviewTranscript,
  type ReviewContext,
} from "./memory-review";

function message(role: string, text: string): Message {
  return { seq: 1, role, text, ts: null };
}

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    key: "claude/s-1",
    botId: "bot-1",
    engine: "claude",
    providerId: "relay-1",
    model: "claude-sonnet-4-6",
    everyNTurns: 5,
    transcript: "用户：记住项目用 pnpm",
    ...overrides,
  };
}

const applied = {
  status: "applied" as const,
  applied: 1,
  staged: 0,
  failed: 0,
  at: Date.now(),
};

beforeEach(() => {
  ipcMock.memoryReview.mockReset();
  ipcMock.memoryReview.mockResolvedValue(applied);
  ipcMock.memoryList.mockReset();
  resetMemoryReviewState();
  useMemoryStore.setState({
    botId: null,
    view: null,
    loading: false,
    error: null,
    lastReview: null,
  });
});

describe("reviewTranscript", () => {
  it("keeps only user and assistant prose, stripping the injected bot block", () => {
    const transcript = reviewTranscript([
      message(
        "user",
        "记住项目用 pnpm\n\n## Agent Role and Instructions\n\nAgent Name: 太奶\n\n你是「太奶」。",
      ),
      message("tool", "Read file"),
      message("assistant", "好的，我记住了。"),
      message("thinking", "先检查一下"),
    ]);
    expect(transcript).toBe("用户：记住项目用 pnpm\n\n助手：好的，我记住了。");
  });

  it("clips one huge message and keeps the tail of the whole transcript", () => {
    const huge = "长".repeat(5_000);
    expect(reviewTranscript([message("user", huge)])).toBe(
      `用户：${"长".repeat(4_000)}……`,
    );

    const many = Array.from({ length: 200 }, (_, i) =>
      message("user", `第 ${i} 轮：${"字".repeat(200)}`),
    );
    const clipped = reviewTranscript(many);
    expect(clipped.startsWith("……（更早的对话已省略）")).toBe(true);
    // 保留的是最近的一段：最后一轮一定在。
    expect(clipped).toContain("第 199 轮");
    expect(clipped).not.toContain("第 0 轮");
  });
});

describe("reviewSchedule", () => {
  it("requires both memory and review to be on", () => {
    expect(reviewSchedule(null)).toBeNull();
    const memory = {
      enabled: true,
      writeApproval: false,
      memoryCharLimit: 2200,
      reviewEnabled: true,
      reviewEveryNTurns: 3,
    };
    expect(reviewSchedule({ memory })).toEqual({ everyNTurns: 3 });
    expect(reviewSchedule({ memory: { ...memory, reviewEnabled: false } })).toBeNull();
    expect(reviewSchedule({ memory: { ...memory, enabled: false } })).toBeNull();
  });
});

describe("noteTurnCompleted", () => {
  it("counts turns and only calls the backend at the rhythm", async () => {
    const ctx = context({ everyNTurns: 2 });
    noteTurnCompleted(ctx);
    expect(ipcMock.memoryReview).not.toHaveBeenCalled();
    noteTurnCompleted(ctx);
    await vi.waitFor(() => {
      expect(ipcMock.memoryReview).toHaveBeenCalledTimes(1);
    });
    expect(ipcMock.memoryReview).toHaveBeenCalledWith({
      botId: "bot-1",
      engine: "claude",
      providerId: "relay-1",
      model: "claude-sonnet-4-6",
      transcript: "用户：记住项目用 pnpm",
    });
  });

  it("records the outcome for the panel and resets the turn counter", async () => {
    const ctx = context({ everyNTurns: 1 });
    noteTurnCompleted(ctx);
    await vi.waitFor(() => {
      expect(useMemoryStore.getState().lastReview?.outcome.status).toBe("applied");
    });
    expect(useMemoryStore.getState().lastReview?.botId).toBe("bot-1");
    // 复盘刚跑完，会话结束时没有未复盘的轮次，不再触发。
    noteSessionEnded(ctx);
    await Promise.resolve();
    expect(ipcMock.memoryReview).toHaveBeenCalledTimes(1);
  });

  it("restores the turn count when the review fails so it retries", async () => {
    ipcMock.memoryReview.mockRejectedValueOnce(new Error("offline"));
    const ctx = context({ everyNTurns: 1 });
    noteTurnCompleted(ctx);
    await vi.waitFor(() => {
      expect(useMemoryStore.getState().lastReview?.outcome.status).toBe("failed");
    });
    // 失败没有吞掉轮次：下一次落定会再试。
    noteTurnCompleted(ctx);
    await vi.waitFor(() => {
      expect(ipcMock.memoryReview).toHaveBeenCalledTimes(2);
    });
    expect(useMemoryStore.getState().lastReview?.outcome.status).toBe("applied");
  });
});

describe("noteSessionEnded", () => {
  it("reviews the remaining turns once and never duplicates", async () => {
    const ctx = context({ everyNTurns: 5 });
    noteTurnCompleted(ctx);
    noteSessionEnded(ctx);
    await vi.waitFor(() => {
      expect(ipcMock.memoryReview).toHaveBeenCalledTimes(1);
    });
    // 关标签和切走可能都触发 sessionEnded：第二次不该再付一次调用。
    noteSessionEnded(ctx);
    await Promise.resolve();
    expect(ipcMock.memoryReview).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is nothing unreviewed", async () => {
    noteSessionEnded(context());
    await Promise.resolve();
    expect(ipcMock.memoryReview).not.toHaveBeenCalled();
  });
});
