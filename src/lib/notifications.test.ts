import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatNotificationBody,
  getNotificationPreferences,
  updateCachedNotificationPreferences,
  sendOSNotification,
  notifyTurnComplete,
  notifyInterrupted,
  notifyTurnError,
  notifyQuestion,
  notifyPlanReview,
  notifyPermissionRequest,
  focusAppWindow,
} from "./notifications";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

vi.mock("./platform", () => ({
  isWeb: false,
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  onAction: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => {
  const mockWin = {
    unminimize: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    isFocused: vi.fn(async () => false),
    isMinimized: vi.fn(async () => false),
  };
  return {
    getCurrentWindow: vi.fn(() => mockWin),
  };
});

vi.mock("./ipc", () => ({
  ipc: {
    getAppSettings: vi.fn(async () => ({
      notificationsEnabled: true,
      notifyOnCompletion: true,
      notifyOnQuestion: true,
      notifyWhenUnfocusedOnly: true,
    })),
  },
}));

vi.mock("@/features/chat/store", () => ({
  sessionKey: (e: string, s: string | null, w: string) => `${e}:${s || "new"}:${w}`,
  useChatStore: {
    getState: vi.fn(() => ({
      active: { engine: "codex", sessionId: "ses-1", workspacePath: "/workspace" },
      sessions: [
        { engine: "codex", sessionId: "ses-1", workspacePath: "/workspace", title: "测试会话" },
      ],
      openTabs: [],
      bySession: {
        "codex:ses-1:/workspace": {
          messages: [{ role: "assistant", text: "你好，任务已经完成！" }],
        },
      },
      setActiveSession: vi.fn(),
      openTab: vi.fn(),
    })),
  },
}));

describe("notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateCachedNotificationPreferences({
      notificationsEnabled: true,
      notifyOnCompletion: true,
      notifyOnInterrupted: true,
      notifyOnError: true,
      notifyOnQuestion: true,
      notifyWhenUnfocusedOnly: false,
    });
  });

  describe("formatNotificationBody", () => {
    it("strips markdown code blocks and excess whitespace", () => {
      const input = "Here is the code:\n```js\nconsole.log(1);\n```\nDone!";
      const result = formatNotificationBody(input, 100);
      expect(result).toBe("Here is the code: Done!");
    });

    it("truncates long strings with ellipsis", () => {
      const input = "a".repeat(200);
      const result = formatNotificationBody(input, 50);
      expect(result.length).toBeLessThanOrEqual(53);
      expect(result.endsWith("...")).toBe(true);
    });

    it("cleans bold, italic, and backticks", () => {
      const input = "This is **bold** and `code` formatting";
      const result = formatNotificationBody(input, 100);
      expect(result).toBe("This is bold and code formatting");
    });
  });

  describe("preferences", () => {
    it("returns updated preferences correctly", async () => {
      updateCachedNotificationPreferences({
        notificationsEnabled: false,
        notifyOnCompletion: false,
      });
      const prefs = await getNotificationPreferences();
      expect(prefs.enabled).toBe(false);
      expect(prefs.onCompletion).toBe(false);
    });
  });

  describe("sendOSNotification", () => {
    it("calls sendNotification when enabled and allowed", async () => {
      await sendOSNotification({
        title: "Test Title",
        body: "Test Body",
      });

      expect(sendNotification).toHaveBeenCalledWith({
        id: expect.any(Number),
        title: "Test Title",
        body: "Test Body",
        extra: undefined,
      });
    });

    it("does not call sendNotification when notifications are disabled", async () => {
      updateCachedNotificationPreferences({
        notificationsEnabled: false,
      });

      await sendOSNotification({
        title: "Test Title",
        body: "Test Body",
      });

      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe("notifyTurnComplete", () => {
    it("sends turn complete notification when onCompletion is true", async () => {
      await notifyTurnComplete("codex:ses-1:/workspace", "任务顺利完成！");
      expect(sendNotification).toHaveBeenCalled();
      const call = vi.mocked(sendNotification).mock.calls[0][0];
      const title = typeof call === "string" ? call : call.title;
      expect(title).toContain("测试会话");
    });

    it("suppresses notification when notifyOnCompletion is false", async () => {
      updateCachedNotificationPreferences({
        notifyOnCompletion: false,
      });
      await notifyTurnComplete("codex:ses-1:/workspace", "任务顺利完成！");
      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe("notifyInterrupted", () => {
    it("sends interrupted notification when notifyOnInterrupted is true", async () => {
      await notifyInterrupted("codex:ses-1:/workspace", "连接意外中断");
      expect(sendNotification).toHaveBeenCalled();
      const call = vi.mocked(sendNotification).mock.calls[0][0];
      const title = typeof call === "string" ? call : call.title;
      const body = typeof call === "string" ? "" : call.body;
      expect(title).toContain("测试会话");
      expect(body).toContain("连接意外中断");
    });

    it("suppresses notification when both notifyOnInterrupted and notifyOnError are false", async () => {
      updateCachedNotificationPreferences({
        notifyOnInterrupted: false,
        notifyOnError: false,
      });
      await notifyInterrupted("codex:ses-1:/workspace", "stream disconnected");
      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe("notifyTurnError", () => {
    it("sends error notification when notifyOnError is true", async () => {
      await notifyTurnError("codex:ses-1:/workspace", "Rate limit exceeded");
      expect(sendNotification).toHaveBeenCalled();
      const call = vi.mocked(sendNotification).mock.calls[0][0];
      const title = typeof call === "string" ? call : call.title;
      const body = typeof call === "string" ? "" : call.body;
      expect(title).toContain("测试会话");
      expect(body).toContain("Rate limit exceeded");
    });

    it("suppresses error notification when notifyOnError is false", async () => {
      updateCachedNotificationPreferences({
        notifyOnError: false,
      });
      await notifyTurnError("codex:ses-1:/workspace", "Failed to connect");
      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe("notifyQuestion", () => {
    it("sends question notification when notifyOnQuestion is true", async () => {
      await notifyQuestion("codex:ses-1:/workspace", "是否确认删除该文件？");
      expect(sendNotification).toHaveBeenCalled();
      const call = vi.mocked(sendNotification).mock.calls[0][0];
      const title = typeof call === "string" ? call : call.title;
      const body = typeof call === "string" ? "" : call.body;
      expect(title).toContain("测试会话");
      expect(body).toContain("是否确认删除该文件？");
    });

    it("suppresses question notification when notifyOnQuestion is false", async () => {
      updateCachedNotificationPreferences({
        notifyOnQuestion: false,
      });
      await notifyQuestion("codex:ses-1:/workspace", "是否确认删除？");
      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe("notifyPlanReview", () => {
    it("sends plan review notification", async () => {
      await notifyPlanReview("codex:ses-1:/workspace", "实施计划方案A");
      expect(sendNotification).toHaveBeenCalled();
      const call = vi.mocked(sendNotification).mock.calls[0][0];
      const body = typeof call === "string" ? "" : call.body;
      expect(body).toContain("实施计划方案A");
    });
  });

  describe("notifyPermissionRequest", () => {
    it("sends permission request notification", async () => {
      await notifyPermissionRequest("codex:ses-1:/workspace", "/src/sensitive");
      expect(sendNotification).toHaveBeenCalled();
      const call = vi.mocked(sendNotification).mock.calls[0][0];
      const body = typeof call === "string" ? "" : call.body;
      expect(body).toContain("/src/sensitive");
    });
  });

  describe("focusAppWindow", () => {
    it("unminimizes and sets focus on the window", async () => {
      await focusAppWindow();
      const win = getCurrentWindow();
      expect(win.unminimize).toHaveBeenCalled();
      expect(win.setFocus).toHaveBeenCalled();
    });
  });
});
