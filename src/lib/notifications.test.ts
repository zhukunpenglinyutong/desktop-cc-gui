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
  getSessionDisplayTitle,
} from "./notifications";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useChatStore } from "@/features/chat/store";
import i18n from "./i18n";

// Shared across `vi.resetModules()`: the mock factories re-run for a fresh
// module registry but keep pointing at these objects.
const h = vi.hoisted(() => ({
  win: {
    label: "main",
    unminimize: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    isFocused: vi.fn(async () => false),
    isMinimized: vi.fn(async () => false),
  },
  store: {} as Record<string, unknown>,
  dismissCenterSurfaces: vi.fn(),
}));

vi.mock("@/features/chat/center-surfaces", () => ({
  dismissCenterSurfaces: h.dismissCenterSurfaces,
}));

vi.mock("./platform", () => ({
  isWeb: false,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => "granted"),
  onAction: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => h.win),
}));

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

vi.mock("@/features/chat/store", async () => ({
  // The real key shape (`engine/sessionId`, `new:engine:workspace` while
  // pending): title and click routing both match tabs and sessions by it.
  sessionKey: (await vi.importActual<typeof import("@/features/chat/store/persistence")>(
    "@/features/chat/store/persistence"
  )).sessionKey,
  useChatStore: {
    getState: vi.fn(() => h.store),
  },
}));

const KEY = "codex/ses-1";

function resetStore() {
  h.store = {
    active: { engine: "codex", sessionId: "ses-1", workspacePath: "/workspace" },
    sessions: [
      { engine: "codex", sessionId: "ses-1", workspacePath: "/workspace", title: "测试会话" },
    ],
    openTabs: [],
    bySession: {
      [KEY]: {
        messages: [{ role: "assistant", text: "你好，任务已经完成！" }],
      },
    },
    selectSession: vi.fn(async () => {}),
    focusTab: vi.fn(),
  };
}

type PostedNotice = { id: number; title: string; body?: string; extra?: Record<string, unknown> };

/** What reached the plugin's `notify` command, in call order. */
function postedNotices(mock = vi.mocked(invoke)): PostedNotice[] {
  return mock.mock.calls
    .filter(([cmd]) => cmd === "plugin:notification|notify")
    .map(([, args]) => (args as { options: PostedNotice }).options);
}

describe("notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.win.label = "main";
    resetStore();
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

    it("falls back when stripping leaves nothing (code-block-only body)", () => {
      const result = formatNotificationBody("```js\nconsole.log(1);\n```", 100, "默认正文");
      expect(result).toBe("默认正文");
    });

    it("keeps the cleaned body when it is non-empty", () => {
      const result = formatNotificationBody("**完成**", 100, "默认正文");
      expect(result).toBe("完成");
    });

    it("never cuts an emoji in half at the length limit", () => {
      // 😀 is two UTF-16 units. Half of it is a lone surrogate, which the
      // native side's JSON parser rejects, so the whole notice would be lost.
      const result = formatNotificationBody(`${"a".repeat(159)}😀😀`, 160);
      expect(result).toBe(`${"a".repeat(159)}😀...`);
      expect(result.isWellFormed()).toBe(true);
    });

    it("keeps a multi-code-point emoji whole at the length limit", () => {
      // A flag is two code points; a code-point cut would leave half of it.
      expect(formatNotificationBody(`${"a".repeat(159)}🇨🇳🇨🇳`, 160)).toBe(`${"a".repeat(159)}🇨🇳...`);
      const family = "👨‍👩‍👧";
      expect(formatNotificationBody(`${"a".repeat(159)}${family}b`, 160)).toBe(`${"a".repeat(159)}${family}...`);
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

    it("retries the IPC after a failed settings read instead of pinning defaults", async () => {
      // Static import cannot work here: the preference cache is module-level
      // state that starts unset only in a fresh registry, so this case must
      // load the module boundary anew. Both modules must also share the same
      // (re-created) ipc mock instance.
      vi.resetModules();
      const { ipc } = await import("./ipc");
      const fresh = await import("./notifications");

      vi.mocked(ipc.getAppSettings).mockRejectedValueOnce(new Error("ipc down"));
      const fallback = await fresh.getNotificationPreferences();
      expect(fallback.enabled).toBe(true);
      expect(fallback.unfocusedOnly).toBe(true);

      // The failure must not pin the defaults: the next call reaches the IPC
      // again (a cached `{}` would short-circuit and never call it twice).
      await fresh.getNotificationPreferences();
      expect(ipc.getAppSettings).toHaveBeenCalledTimes(2);
    });
  });

  describe("sendOSNotification", () => {
    it("posts through the plugin's notify command when enabled and allowed", async () => {
      await expect(sendOSNotification({ title: "Test Title", body: "Test Body" })).resolves.toBe(true);
      expect(postedNotices()).toEqual([
        { id: expect.any(Number), title: "Test Title", body: "Test Body", extra: undefined },
      ]);
    });

    it("does not post when notifications are disabled", async () => {
      updateCachedNotificationPreferences({
        notificationsEnabled: false,
      });

      await sendOSNotification({
        title: "Test Title",
        body: "Test Body",
      });

      expect(postedNotices()).toHaveLength(0);
    });

    it("reports a failed native post instead of claiming success", async () => {
      // The plugin's own `sendNotification` returns void and leaves its invoke
      // uncaught, so a failure there could neither be reported nor kept off
      // the global crash screen. The command's rejection must land here.
      vi.mocked(invoke).mockRejectedValueOnce(new Error("notify failed"));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(sendOSNotification({ title: "T", body: "B" })).resolves.toBe(false);
      expect(postedNotices()).toHaveLength(1);
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe("click handling", () => {
    it("installs the click listener only in the main window", async () => {
      // The pet overlay loads the same page and runs the same bootstrap; the
      // plugin hands every click to every listener, so a listener there would
      // pull the overlay to the front on each click.
      h.win.label = "pet-overlay";
      vi.resetModules();
      const plugin = await import("@tauri-apps/plugin-notification");
      const fresh = await import("./notifications");
      fresh.initNotificationActions();
      expect(plugin.onAction).not.toHaveBeenCalled();
    });

    /** Post a notice for `sessionKey` through a fresh module, then click it. */
    async function clickPostedNotice(sessionKey: string) {
      vi.resetModules();
      const plugin = await import("@tauri-apps/plugin-notification");
      const core = await import("@tauri-apps/api/core");
      const fresh = await import("./notifications");
      fresh.updateCachedNotificationPreferences({ notificationsEnabled: true });

      await fresh.sendOSNotification({ title: "T", sessionKey });
      expect(plugin.onAction).toHaveBeenCalledTimes(1);
      const [notice] = postedNotices(vi.mocked(core.invoke));
      const onClick = vi.mocked(plugin.onAction).mock.calls[0][0];
      onClick({ actionId: "tap", inputValue: null, notification: { id: notice.id } } as never);
    }

    it("routes a click on a posted notice back to its open tab", async () => {
      h.store.openTabs = [{ engine: "codex", sessionId: "ses-1", workspacePath: "/workspace" }];
      await clickPostedNotice(KEY);

      // Same entry the tab strip uses, so the tab keeps its own overrides.
      expect(h.store.focusTab).toHaveBeenCalledWith("codex", "ses-1", "/workspace");
      expect(h.store.selectSession).not.toHaveBeenCalled();
      // A file, diff or plugin page left open in the center would otherwise
      // keep covering the session the click switched to.
      const focusTab = h.store.focusTab as ReturnType<typeof vi.fn>;
      expect(h.dismissCenterSurfaces).toHaveBeenCalledTimes(1);
      expect(h.dismissCenterSurfaces.mock.invocationCallOrder[0]).toBeLessThan(
        focusTab.mock.invocationCallOrder[0],
      );
      // focusAppWindow awaits unminimize before it focuses.
      await vi.waitFor(() => expect(h.win.setFocus).toHaveBeenCalled());
    });

    it("focuses a pending tab (no session id yet) instead of opening a copy of it", async () => {
      // A first turn that fails before the CLI reports its id still notifies.
      // selectSession(engine, "") would add a second tab with sessionId "".
      h.store.openTabs = [{ engine: "claude", sessionId: null, workspacePath: "/ws" }];
      await clickPostedNotice("new:claude:/ws");

      expect(h.store.focusTab).toHaveBeenCalledWith("claude", null, "/ws");
      expect(h.store.selectSession).not.toHaveBeenCalled();
    });

    it("reopens a session whose tab was closed from the session list", async () => {
      h.store.openTabs = [];
      await clickPostedNotice(KEY);

      expect(h.store.selectSession).toHaveBeenCalledWith("codex", "ses-1", "/workspace");
      expect(h.store.focusTab).not.toHaveBeenCalled();
      expect(h.dismissCenterSurfaces).toHaveBeenCalledTimes(1);
    });

    it("leaves the center alone when the session is gone (deleted since)", async () => {
      h.store.openTabs = [];
      h.store.sessions = [];
      await clickPostedNotice(KEY);

      expect(h.dismissCenterSurfaces).not.toHaveBeenCalled();
      expect(h.store.focusTab).not.toHaveBeenCalled();
      expect(h.store.selectSession).not.toHaveBeenCalled();
      // The window still comes forward.
      await vi.waitFor(() => expect(h.win.setFocus).toHaveBeenCalled());
    });
  });

  describe("getSessionDisplayTitle", () => {
    it("titles a new chat that is not indexed yet like its tab does", () => {
      h.store.openTabs = [{ engine: "claude", sessionId: "3f2a9c1b-77aa", workspacePath: "/ws" }];
      expect(getSessionDisplayTitle("claude/3f2a9c1b-77aa")).toBe(i18n.t("chat.newChat"));
    });

    it("uses the indexed title for an open tab", () => {
      h.store.openTabs = [{ engine: "codex", sessionId: "ses-1", workspacePath: "/workspace" }];
      expect(getSessionDisplayTitle(KEY)).toBe("测试会话");
    });

    it("titles a pending tab (no session id yet) as a new chat", () => {
      h.store.openTabs = [{ engine: "codex", sessionId: null, workspacePath: "/workspace" }];
      expect(getSessionDisplayTitle("new:codex:/workspace")).toBe(i18n.t("chat.newChat"));
    });

    it("prefers the custom title", () => {
      h.store.sessions = [
        { engine: "codex", sessionId: "ses-1", workspacePath: "/workspace", title: "测试会话", customTitle: "我的会话" },
      ];
      expect(getSessionDisplayTitle(KEY)).toBe("我的会话");
    });
  });

  describe("notifyTurnComplete", () => {
    it("sends turn complete notification when onCompletion is true", async () => {
      await notifyTurnComplete(KEY, "任务顺利完成！");
      const [notice] = postedNotices();
      expect(notice.title).toContain("测试会话");
    });

    it("suppresses notification when notifyOnCompletion is false", async () => {
      updateCachedNotificationPreferences({
        notifyOnCompletion: false,
      });
      await notifyTurnComplete(KEY, "任务顺利完成！");
      expect(postedNotices()).toHaveLength(0);
    });

    it("falls back to the generic body when the summary is only a code block", async () => {
      await notifyTurnComplete(KEY, "```js\nconsole.log(1);\n```");
      const [notice] = postedNotices();
      expect(notice.body).toBe("AI 已完成回复，请查看");
    });

    it("skips the completed notice when the pending card's own notice went out", async () => {
      // Same batch: the card's notice is still in flight when done settles.
      const card = notifyPlanReview(KEY, "实施方案A");
      const done = notifyTurnComplete(KEY, "计划如下", true);
      await Promise.all([card, done]);
      expect(postedNotices().map((n) => n.body)).toEqual(["实施方案A"]);
    });

    it("still sends the completed notice when the card's notice was switched off", async () => {
      updateCachedNotificationPreferences({ notifyOnQuestion: false });
      const card = notifyQuestion(KEY, "继续吗？");
      const done = notifyTurnComplete(KEY, "做完了", true);
      await Promise.all([card, done]);
      expect(postedNotices().map((n) => n.body)).toEqual(["做完了"]);
    });

    it("a grant notice raised mid-turn does not silence the completed notice", async () => {
      // A denial does not stop the turn: the CLI works around it and keeps
      // going, often for minutes, so the caller passes awaitsUser = false.
      await notifyPermissionRequest(KEY, "/etc/hosts");
      await notifyTurnComplete(KEY, "做完了", false);
      expect(postedNotices().map((n) => n.body)).toEqual([
        i18n.t("chat.notifyPermissionBody", { path: "/etc/hosts" }),
        "做完了",
      ]);
    });

    it("a grant card the turn ended on stands in for the completed notice", async () => {
      // Claude reports stdio denials only on its result line, right before
      // done: two notices at once for the same moment would be noise.
      const grant = notifyPermissionRequest(KEY, "", "Bash");
      const done = notifyTurnComplete(KEY, "做完了", true);
      await Promise.all([grant, done]);
      expect(postedNotices().map((n) => n.body)).toEqual(["Bash"]);
    });

    it("an earlier turn's card notice does not silence a later turn", async () => {
      await notifyQuestion(KEY, "继续吗？");
      await notifyTurnComplete(KEY, "第一轮", false);
      await notifyTurnComplete(KEY, "第二轮", true);
      expect(postedNotices().map((n) => n.body)).toEqual(["继续吗？", "第一轮", "第二轮"]);
    });

    it("never rejects, even when composing the notice throws", async () => {
      // Engine events fire these without awaiting; an escaped rejection would
      // open the global crash screen.
      vi.mocked(useChatStore.getState).mockImplementationOnce(() => {
        throw new Error("store gone");
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await expect(notifyTurnComplete(KEY, "x")).resolves.toBeUndefined();
      warn.mockRestore();
    });
  });

  describe("notifyInterrupted", () => {
    it("sends interrupted notification when notifyOnInterrupted is true", async () => {
      await notifyInterrupted(KEY, "连接意外中断");
      const [notice] = postedNotices();
      expect(notice.title).toContain("测试会话");
      expect(notice.body).toContain("连接意外中断");
    });

    it("suppresses notification when both notifyOnInterrupted and notifyOnError are false", async () => {
      updateCachedNotificationPreferences({
        notifyOnInterrupted: false,
        notifyOnError: false,
      });
      await notifyInterrupted(KEY, "stream disconnected");
      expect(postedNotices()).toHaveLength(0);
    });

    it("honours its own switch instead of detouring through the error notice", async () => {
      updateCachedNotificationPreferences({
        notifyOnInterrupted: false,
        notifyOnError: true,
      });
      await notifyInterrupted(KEY, "stream disconnected");
      expect(postedNotices()).toHaveLength(0);
    });
  });

  describe("notifyTurnError", () => {
    it("sends error notification when notifyOnError is true", async () => {
      await notifyTurnError(KEY, "Rate limit exceeded");
      const [notice] = postedNotices();
      expect(notice.title).toContain("测试会话");
      expect(notice.body).toContain("Rate limit exceeded");
    });

    it("suppresses error notification when notifyOnError is false", async () => {
      updateCachedNotificationPreferences({
        notifyOnError: false,
      });
      await notifyTurnError(KEY, "Failed to connect");
      expect(postedNotices()).toHaveLength(0);
    });
  });

  describe("notifyQuestion", () => {
    it("sends question notification when notifyOnQuestion is true", async () => {
      await notifyQuestion(KEY, "是否确认删除该文件？");
      const [notice] = postedNotices();
      expect(notice.title).toContain("测试会话");
      expect(notice.body).toContain("是否确认删除该文件？");
    });

    it("suppresses question notification when notifyOnQuestion is false", async () => {
      updateCachedNotificationPreferences({
        notifyOnQuestion: false,
      });
      await notifyQuestion(KEY, "是否确认删除？");
      expect(postedNotices()).toHaveLength(0);
    });
  });

  describe("notifyPlanReview", () => {
    it("sends plan review notification", async () => {
      await notifyPlanReview(KEY, "实施计划方案A");
      const [notice] = postedNotices();
      expect(notice.body).toContain("实施计划方案A");
    });
  });

  describe("notifyPermissionRequest", () => {
    it("sends permission request notification", async () => {
      await notifyPermissionRequest(KEY, "/src/sensitive");
      const [notice] = postedNotices();
      expect(notice.body).toContain("/src/sensitive");
    });

    it("describes a denial that names no directory by its own message", async () => {
      // e.g. a denied Bash call: there is no path for "access to directory {{path}}".
      await notifyPermissionRequest(KEY, "", "Claude requested permissions to use Bash");
      const [notice] = postedNotices();
      expect(notice.body).toBe("Claude requested permissions to use Bash");
    });

    it("falls back to a generic body when the denial carries no detail", async () => {
      await notifyPermissionRequest(KEY, "");
      const [notice] = postedNotices();
      expect(notice.body).toBe(i18n.t("chat.notifyPermissionBodyFallback"));
      expect(notice.body).not.toBe(i18n.t("chat.notifyPermissionBody", { path: "" }));
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
