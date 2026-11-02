import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  onAction,
} from "@tauri-apps/plugin-notification";
import { isWeb } from "./platform";
import { ipc, type AppSettings } from "./ipc";
import { sessionKey, useChatStore } from "@/features/chat/store";
import { useSplitStore } from "@/features/chat/split/store";
import { listPanes } from "@/features/chat/split/tree";
import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import i18n from "./i18n";

/**
 * 缓存的通知设置：在会话事件中避免每次都异步等待 IPC，
 * 默认开启各项通知，随 settings 更新同步。
 */
let cachedSettings: Partial<AppSettings> | null = null;
let actionListenerInstalled = false;
let nextNotificationId = 1;
const MAX_ACTIVE_NOTIFICATIONS = 50;
/** The window that owns chat sessions (src-tauri/src/lib.rs). */
const MAIN_WINDOW_LABEL = "main";
const activeNotifications = new Map<number, { key: string; onClick?: () => void }>();
/**
 * 格式化通知正文：清理 Markdown 标记（代码块、粗斜体、反引号），
 * 压缩多余空白，并截断至指定长度，以便在桌面 Toast 弹窗中清晰展示。
 * 清理后为空（如正文只是一段代码块）时返回 fallback，避免空 Toast。
 *
 * The limit counts user-perceived characters, not UTF-16 units: a cut
 * through an emoji leaves a lone surrogate, which the native side's JSON
 * parser rejects, and the whole notice is dropped.
 */
export function formatNotificationBody(text: string, maxLength = 160, fallback = ""): string {
  if (!text) return fallback;
  const clean = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return truncateChars(clean, maxLength) || fallback;
}

/** Cut `text` after `max` characters, adding `...` when anything was cut. */
function truncateChars(text: string, max: number): string {
  let out = "";
  let count = 0;
  for (const char of characters(text)) {
    if (count === max) return `${out}...`;
    out += char;
    count += 1;
  }
  return out;
}

/** Graphemes, so flags and ZWJ emoji stay whole; code points where
 *  Intl.Segmenter is missing (older WebKitGTK), which still never split a
 *  surrogate pair. Lazy: a long reply is not segmented in full for a preview. */
function* characters(text: string): Generator<string> {
  if (typeof Intl.Segmenter !== "function") {
    yield* text;
    return;
  }
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) {
    yield segment;
  }
}

/**
 * 确保全局桌面通知点击监听器已安装（桌面端 onAction）。
 *
 * Only the main window listens. Every webview runs bootstrap (the pet
 * overlay loads the same page), and the plugin hands each click to every
 * listener: a listener in the overlay would pull it to the front and race
 * the main window for focus on every click.
 */
export function initNotificationActions(): void {
  if (actionListenerInstalled || isWeb) return;
  if (currentWindowLabel() !== MAIN_WINDOW_LABEL) return;
  actionListenerInstalled = true;
  void onAction((event) => {
    const id = event.notification?.id;
    const item = typeof id === "number" ? activeNotifications.get(id) : undefined;
    if (item?.onClick) {
      activeNotifications.delete(id as number);
      item.onClick();
    } else {
      // Posted before this launch, or evicted from the map: still bring the
      // app forward, there is just no session to route to.
      void focusAppWindow();
    }
  }).catch(() => {
    // No notification plugin here; the next send tries to register again.
    actionListenerInstalled = false;
  });
}

function currentWindowLabel(): string | null {
  try {
    return getCurrentWindow().label;
  } catch {
    return null;
  }
}

/** 别名导出，供应用启动阶段 bootstrap.tsx 初始化调用 */
export const initializeNotifications = initNotificationActions;

/**
 * 读取当前通知设置（优先从本地/IPC 读取最新）。
 */
export async function getNotificationPreferences(): Promise<{
  enabled: boolean;
  onCompletion: boolean;
  onQuestion: boolean;
  onInterrupted: boolean;
  onError: boolean;
  unfocusedOnly: boolean;
}> {
  if (cachedSettings === null) {
    try {
      cachedSettings = await ipc.getAppSettings();
    } catch {
      // Leave the cache unset: a failed read must not pin the defaults as
      // authoritative — the next event retries the IPC instead.
      return {
        enabled: true,
        onCompletion: true,
        onQuestion: true,
        onInterrupted: true,
        onError: true,
        unfocusedOnly: true,
      };
    }
  }
  return {
    enabled: cachedSettings.notificationsEnabled ?? true,
    onCompletion: cachedSettings.notifyOnCompletion ?? true,
    onQuestion: cachedSettings.notifyOnQuestion ?? true,
    onInterrupted: cachedSettings.notifyOnInterrupted ?? true,
    onError: cachedSettings.notifyOnError ?? true,
    unfocusedOnly: cachedSettings.notifyWhenUnfocusedOnly ?? true,
  };
}

/**
 * 设置发生变更时更新本地缓存。
 */
export function updateCachedNotificationPreferences(patch: Partial<AppSettings>): void {
  cachedSettings = { ...(cachedSettings ?? {}), ...patch };
}

/**
 * 检查并请求系统通知权限。
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // 1. 如果是 Web 模式
  if (isWeb) {
    if (!("Notification" in window)) return false;
    if (window.Notification.permission === "granted") return true;
    if (window.Notification.permission === "denied") return false;
    try {
      const res = await window.Notification.requestPermission();
      return res === "granted";
    } catch {
      return false;
    }
  }

  // 2. 桌面模式：调用 Tauri Notification 插件
  try {
    const granted = await isPermissionGranted();
    if (granted) return true;
    const res = await requestPermission();
    return res === "granted";
  } catch (err) {
    // 降级尝试 Web API
    if ("Notification" in window) {
      try {
        const res = await window.Notification.requestPermission();
        return res === "granted";
      } catch {}
    }
    return false;
  }
}

/**
 * 将 CC GUI 应用窗口唤醒并置顶聚焦。
 */
export async function focusAppWindow(): Promise<void> {
  if (isWeb) {
    try {
      window.focus();
    } catch {}
    return;
  }
  try {
    const win = getCurrentWindow();
    await win.unminimize();
    await win.setFocus();
  } catch {
    try {
      window.focus();
    } catch {}
  }
}

/**
 * 判断特定会话在当前界面是否处于后台或失焦状态。
 * 如果用户正在前台且目光聚焦在该会话，则返回 false（无需弹窗打扰）；
 * 否则返回 true（需要发送系统通知提醒）。
 */
export async function isSessionUnfocused(key: string): Promise<boolean> {
  // 1. document 隐藏或失去焦点（例如切到了其他软件）
  if (typeof document !== "undefined") {
    if (document.hidden || !document.hasFocus()) return true;
  }

  // 2. 桌面环境下原生窗口是否失去焦点
  if (!isWeb) {
    try {
      const focused = await getCurrentWindow().isFocused();
      if (!focused) return true;
    } catch {}
  }

  // 3. 检查当前会话是否在分屏可见视图中
  const splitRoot = useSplitStore.getState().root;
  if (splitRoot) {
    const isVisibleInSplit = listPanes(splitRoot).some((pane) => {
      const s = pane.session;
      return s ? sessionKey(s.engine, s.sessionId, s.workspacePath) === key : false;
    });
    if (isVisibleInSplit) return false;
  }

  // 4. 检查当前活跃标签页是否为当前会话
  const active = useChatStore.getState().active;
  const activeKey = active
    ? sessionKey(active.engine, active.sessionId, active.workspacePath)
    : null;
  if (key !== activeKey) return true;

  return false;
}

/**
 * 解析会话 key 对应的显示标题，与页签条（use-chat-tabs.ts）同一规则：
 * 按引擎 + 会话 id 找索引元数据，取 `customTitle || title || 新对话`。
 * A first turn settles before rescanSessions has indexed the chat, so the
 * fallback is the tab's own "new chat" label, not a fragment of the id.
 */
export function getSessionDisplayTitle(key: string): string {
  const { sessions, openTabs } = useChatStore.getState();
  const tab = openTabs.find((t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key);
  const meta = tab
    ? tab.sessionId
      ? sessions.find((s) => s.engine === tab.engine && s.sessionId === tab.sessionId)
      : undefined
    : sessions.find((s) => sessionKey(s.engine, s.sessionId, s.workspacePath) === key);
  return meta?.customTitle || meta?.title || i18n.t("chat.newChat");
}

/**
 * 点击通知后的跳转激活处理（窗口聚焦由调用方负责）。
 */
function navigateToSession(key: string): void {
  const state = useChatStore.getState();
  const tab = state.openTabs.find(
    (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
  );
  const session = tab
    ? undefined
    : state.sessions.find((s) => sessionKey(s.engine, s.sessionId, s.workspacePath) === key);
  // Gone (e.g. deleted since): leave whatever the user has open alone.
  if (!tab && !session) return;

  // A file, diff, browser or plugin page in the center would keep covering
  // the session; clear it first, as the tab strip and the sidebar do.
  dismissCenterSurfaces();

  // 1. 已打开的页签：与页签条同一入口。A pending tab has no session id yet
  //    (its first turn failed early); selectSession would add a second tab.
  if (tab) {
    state.focusTab(tab.engine, tab.sessionId, tab.workspacePath);
    return;
  }

  // 2. 页签已关闭：按会话列表重新打开
  if (session) void state.selectSession(session.engine, session.sessionId, session.workspacePath);
}

export interface SendSystemNotificationOptions {
  title: string;
  body?: string;
  tag?: string;
  sessionKey?: string;
  onClick?: () => void;
}

/**
 * 底层跨平台发送系统通知。
 */
export async function sendOSNotification(options: SendSystemNotificationOptions): Promise<boolean> {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled) return false;

  const granted = await ensureNotificationPermission();
  if (!granted) return false;

  initNotificationActions();
  const tag = options.tag || (options.sessionKey ? `session-${options.sessionKey}` : undefined);

  const notifId = (nextNotificationId++ & 0x7fffffff) || 1;
  const handleClick = () => {
    void focusAppWindow();
    if (options.onClick) {
      options.onClick();
    } else if (options.sessionKey) {
      navigateToSession(options.sessionKey);
    }
  };

  // 1. Web 浏览器模式使用标准 Notification 对象，点击由它自己的 onclick 处理
  if (isWeb) {
    if (typeof window !== "undefined" && "Notification" in window) {
      try {
        const n = new window.Notification(options.title, {
          body: options.body,
          tag,
        });
        n.onclick = (e) => {
          e.preventDefault();
          handleClick();
        };
        return true;
      } catch {}
    }
    return false;
  }

  // 2. 桌面模式（Tauri）：点击经 onAction 按 id 回到这里
  if (activeNotifications.size >= MAX_ACTIVE_NOTIFICATIONS) {
    const oldestKey = activeNotifications.keys().next().value;
    if (oldestKey !== undefined) activeNotifications.delete(oldestKey);
  }
  activeNotifications.set(notifId, { key: options.sessionKey ?? "", onClick: handleClick });
  try {
    // Post through the plugin's command, not its `sendNotification`: that
    // helper returns void and leaves its own invoke uncaught, so a failed
    // post could neither be reported nor kept off the global crash screen.
    // There is no second channel to fall back to — inside Tauri the web
    // `Notification` is the plugin's shim around this same command. `true`
    // means the plugin accepted the post (permission, arguments, IPC); it
    // shows the toast on a background task whose failure is not reported.
    await invoke("plugin:notification|notify", {
      options: {
        id: notifId,
        title: options.title,
        body: options.body,
        extra: options.sessionKey ? { sessionKey: options.sessionKey } : undefined,
      },
    });
    return true;
  } catch (error) {
    activeNotifications.delete(notifId);
    console.warn("[notifications] failed to post a desktop notification:", error);
    return false;
  }
}

type NoticeSwitch = "onCompletion" | "onQuestion" | "onInterrupted" | "onError";

interface SessionNotice {
  /** Event name, shown after the session title. */
  event: string;
  body: string;
  tag: string;
}

/**
 * Shared path of every session notice: honour the master switch, the
 * notice's own switch and「仅在后台或未激活时提醒」, title it after the session,
 * post it. Resolves to whether it was posted and never rejects — engine
 * events fire these without awaiting, and an escaped rejection would open the
 * global crash screen.
 */
async function postSessionNotice(
  key: string,
  gate: NoticeSwitch,
  compose: () => SessionNotice,
): Promise<boolean> {
  try {
    const prefs = await getNotificationPreferences();
    if (!prefs.enabled || !prefs[gate]) return false;
    if (prefs.unfocusedOnly && !(await isSessionUnfocused(key))) return false;
    const { event, body, tag } = compose();
    return await sendOSNotification({
      title: `${getSessionDisplayTitle(key)} · ${event}`,
      body,
      sessionKey: key,
      tag,
    });
  } catch (error) {
    console.warn("[notifications] failed to raise a session notice:", error);
    return false;
  }
}

/** The latest question / grant / plan notice per session, resolving to
 *  whether it was posted. The completed notice of the same turn reads and
 *  clears it; every new card overwrites it, so it never outlives its turn.
 *  Whether the card may stand in for the completed notice is the caller's
 *  `awaitsUser` (turn-notice.ts): a grant card only when the turn ended on it. */
const cardNotices = new Map<string, Promise<boolean>>();

function trackCardNotice(key: string, posted: Promise<boolean>): Promise<void> {
  cardNotices.set(key, posted);
  return posted.then(() => {});
}

/**
 * 对话完成时触发通知。`awaitsUser`: the turn ended on a question, a plan
 * awaiting review or a grant card. When that card's own notice reached the
 * user, it is the thing to act on and a "completed" notice on top would be
 * noise; when it did not (its switch is off, or the user was watching then),
 * this notice is the only one the turn gets.
 */
export async function notifyTurnComplete(
  key: string,
  summary?: string,
  awaitsUser = false,
): Promise<void> {
  // Read and clear synchronously: the card notice may still be in flight
  // (same event batch), and a slow completion must not clear the next turn's.
  const cardNotice = cardNotices.get(key);
  cardNotices.delete(key);
  if (awaitsUser && cardNotice && (await cardNotice)) return;
  await postSessionNotice(key, "onCompletion", () => {
    const fallback = i18n.t("chat.notifyTurnCompleteBodyFallback", "AI 已完成回复，请查看");
    return {
      event: i18n.t("chat.notifyTurnCompleteTitle", "对话已完成"),
      // A summary that is only a code block cleans to "" — fall back to the
      // generic body instead of posting an empty toast.
      body: formatNotificationBody(summary?.trim() || fallback, 160, fallback),
      tag: `turn-complete-${key}`,
    };
  });
}

/**
 * 对话因 API 异常中断或连接断开时触发通知。只看「会话中断提醒」开关：
 * 用户关掉它时不改走「对话异常」通知。
 */
export async function notifyInterrupted(key: string, reason?: string): Promise<void> {
  await postSessionNotice(key, "onInterrupted", () => {
    const fallback = i18n.t("chat.notifyInterruptedBody", "API 连接或响应异常中断");
    return {
      event: i18n.t("chat.notifyInterruptedTitle", "会话已中断"),
      body: formatNotificationBody(reason?.trim() || fallback, 160, fallback),
      tag: `interrupted-${key}`,
    };
  });
}

/**
 * 对话运行异常时触发通知。
 */
export async function notifyTurnError(key: string, errorText?: string): Promise<void> {
  await postSessionNotice(key, "onError", () => {
    const fallback = i18n.t("chat.notifyErrorBodyFallback", "对话执行遇到错误，请查看详情");
    return {
      event: i18n.t("chat.notifyErrorTitle", "对话异常"),
      body: formatNotificationBody(errorText?.trim() || fallback, 160, fallback),
      tag: `error-${key}`,
    };
  });
}

/**
 * 模型提问（Ask question / 等待用户输入）时触发通知。
 */
export function notifyQuestion(key: string, questionText: string): Promise<void> {
  return trackCardNotice(key, postSessionNotice(key, "onQuestion", () => ({
    event: i18n.t("chat.notifyQuestionTitle", "需要你的回复"),
    body: formatNotificationBody(questionText, 160),
    tag: `question-${key}`,
  })));
}

/**
 * 计划待审批时触发通知。
 */
export function notifyPlanReview(key: string, planTitle?: string): Promise<void> {
  return trackCardNotice(key, postSessionNotice(key, "onQuestion", () => {
    const fallback = i18n.t("chat.notifyPlanReviewBodyFallback", "模型提交了新计划等待审批");
    return {
      event: i18n.t("chat.notifyPlanReviewTitle", "计划待审批"),
      body: formatNotificationBody(planTitle || fallback, 160, fallback),
      tag: `plan-review-${key}`,
    };
  }));
}

/**
 * 权限请求待确认时触发通知。`path` is the denied directory; a denial that
 * names none (e.g. a blocked command) is described by `detail`, the CLI's own
 * message or the tool name, instead of an empty "access to directory".
 */
export function notifyPermissionRequest(
  key: string,
  path: string,
  detail = "",
): Promise<void> {
  return trackCardNotice(key, postSessionNotice(key, "onQuestion", () => {
    const fallback = i18n.t("chat.notifyPermissionBodyFallback", "AI 请求了一项尚未授权的操作");
    const text = path
      ? i18n.t("chat.notifyPermissionBody", "请求访问目录 {{path}}", { path })
      : detail.trim() || fallback;
    return {
      event: i18n.t("chat.notifyPermissionTitle", "请求访问权限"),
      body: formatNotificationBody(text, 160, fallback),
      tag: `permission-${key}`,
    };
  }));
}
