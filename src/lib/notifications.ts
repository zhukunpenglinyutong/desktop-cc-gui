import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  onAction,
} from "@tauri-apps/plugin-notification";
import { isWeb } from "./platform";
import { ipc, type AppSettings } from "./ipc";
import { sessionKey, useChatStore } from "@/features/chat/store";
import { useSplitStore } from "@/features/chat/split/store";
import { listPanes } from "@/features/chat/split/tree";
import i18n from "./i18n";

/**
 * 缓存的通知设置：在会话事件中避免每次都异步等待 IPC，
 * 默认开启各项通知，随 settings 更新同步。
 */
let cachedSettings: Partial<AppSettings> | null = null;
let actionListenerInstalled = false;
let nextNotificationId = 1;
const MAX_ACTIVE_NOTIFICATIONS = 50;
const activeNotifications = new Map<number, { key: string; onClick?: () => void }>();
/**
 * 格式化通知正文：清理 Markdown 标记（代码块、粗斜体、反引号），
 * 压缩多余空白，并截断至指定长度，以便在桌面 Toast 弹窗中清晰展示。
 */
export function formatNotificationBody(text: string, maxLength = 160): string {
  if (!text) return "";
  let clean = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length > maxLength) {
    clean = `${clean.slice(0, maxLength)}...`;
  }
  return clean;
}

/**
 * 确保全局桌面通知点击监听器已安装（桌面端 onAction）。
 */
export function initNotificationActions(): void {
  if (actionListenerInstalled || isWeb) return;
  actionListenerInstalled = true;
  void onAction((event) => {
    void focusAppWindow();
    const id = event.notification?.id;
    if (typeof id === "number" && activeNotifications.has(id)) {
      const item = activeNotifications.get(id);
      activeNotifications.delete(id);
      item?.onClick?.();
    }
  }).catch(() => {
    // 忽略通知事件注册失败（部分无桌面环境时）
  });
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
  if (!cachedSettings) {
    try {
      cachedSettings = await ipc.getAppSettings();
    } catch {
      cachedSettings = {};
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
 * 解析会话 key 对应的显示标题。
 */
export function getSessionDisplayTitle(key: string): string {
  const state = useChatStore.getState();
  // 从全局 sessions 列表查找
  for (const s of state.sessions) {
    const k = sessionKey(s.engine, s.sessionId, s.workspacePath);
    if (k === key) {
      return s.customTitle || s.title || s.sessionId.slice(0, 8);
    }
  }
  // 从打开的 tabs 查找
  for (const t of state.openTabs) {
    const k = sessionKey(t.engine, t.sessionId, t.workspacePath);
    if (k === key) {
      if (t.sessionId) {
        return t.sessionId.slice(0, 8);
      }
      return t.engine;
    }
  }
  return i18n.t("chat.defaultTitle", "CC GUI");
}

/**
 * 点击通知后的跳转激活处理。
 */
function navigateToSession(key: string): void {
  void focusAppWindow();
  const state = useChatStore.getState();

  // 1. 查找是否在 openTabs 中
  const tab = state.openTabs.find(
    (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
  );
  if (tab) {
    void state.selectSession(tab.engine, tab.sessionId ?? "", tab.workspacePath);
    return;
  }

  // 2. 从 sessions 中匹配
  for (const s of state.sessions) {
    const k = sessionKey(s.engine, s.sessionId, s.workspacePath);
    if (k === key) {
      void state.selectSession(s.engine, s.sessionId, s.workspacePath);
      return;
    }
  }
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

  if (activeNotifications.size >= MAX_ACTIVE_NOTIFICATIONS) {
    const oldestKey = activeNotifications.keys().next().value;
    if (oldestKey !== undefined) activeNotifications.delete(oldestKey);
  }
  activeNotifications.set(notifId, { key: options.sessionKey ?? "", onClick: handleClick });

  const spawnWebNotification = () => {
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
  };

  // 1. Web 浏览器模式优先使用标准 Notification 对象
  if (isWeb) {
    return spawnWebNotification();
  }

  // 2. 桌面模式（Tauri）：调用 Tauri Notification 插件
  try {
    sendNotification({
      id: notifId,
      title: options.title,
      body: options.body,
      extra: options.sessionKey ? { sessionKey: options.sessionKey } : undefined,
    });
    return true;
  } catch (err) {
    return spawnWebNotification();
  }
}

/**
 * 对话完成时触发通知。
 */
export async function notifyTurnComplete(key: string, summary?: string): Promise<void> {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled || !prefs.onCompletion) return;

  if (prefs.unfocusedOnly) {
    const unfocused = await isSessionUnfocused(key);
    if (!unfocused) return;
  }

  const sessionTitle = getSessionDisplayTitle(key);
  const eventType = i18n.t("chat.notifyTurnCompleteTitle", "对话已完成");
  const title = sessionTitle ? `${sessionTitle} · ${eventType}` : eventType;
  const fallbackBody = i18n.t("chat.notifyTurnCompleteBodyFallback", "AI 已完成回复，请查看");
  const rawContent = summary && summary.trim() ? summary.trim() : fallbackBody;
  const body = formatNotificationBody(rawContent, 160);
  return sendOSNotification({
    title,
    body,
    sessionKey: key,
    tag: `turn-complete-${key}`,
  }).then(() => {});
}

/**
 * 对话因 API 异常中断或连接断开时触发通知。
 */
export async function notifyInterrupted(key: string, reason?: string): Promise<void> {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled) return;
  if (!prefs.onInterrupted) {
    if (prefs.onError) {
      return notifyTurnError(key, reason);
    }
    return;
  }

  if (prefs.unfocusedOnly) {
    const unfocused = await isSessionUnfocused(key);
    if (!unfocused) return;
  }

  const sessionTitle = getSessionDisplayTitle(key);
  const eventType = i18n.t("chat.notifyInterruptedTitle", "会话已中断");
  const title = sessionTitle ? `${sessionTitle} · ${eventType}` : eventType;
  const fallbackBody = i18n.t("chat.notifyInterruptedBody", "API 连接或响应异常中断");
  const rawContent = reason && reason.trim() ? reason.trim() : fallbackBody;
  const body = formatNotificationBody(rawContent, 160);
  return sendOSNotification({
    title,
    body,
    sessionKey: key,
    tag: `interrupted-${key}`,
  }).then(() => {});
}

/**
 * 对话运行异常时触发通知。
 */
export async function notifyTurnError(key: string, errorText?: string): Promise<void> {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled || !prefs.onError) return;

  if (prefs.unfocusedOnly) {
    const unfocused = await isSessionUnfocused(key);
    if (!unfocused) return;
  }

  const sessionTitle = getSessionDisplayTitle(key);
  const eventType = i18n.t("chat.notifyErrorTitle", "对话异常");
  const title = sessionTitle ? `${sessionTitle} · ${eventType}` : eventType;
  const fallbackBody = i18n.t("chat.notifyErrorBodyFallback", "对话执行遇到错误，请查看详情");
  const rawContent = errorText && errorText.trim() ? errorText.trim() : fallbackBody;
  const body = formatNotificationBody(rawContent, 160);
  return sendOSNotification({
    title,
    body,
    sessionKey: key,
    tag: `error-${key}`,
  }).then(() => {});
}

/**
 * 模型提问（Ask question / 等待用户输入）时触发通知。
 */
export async function notifyQuestion(key: string, questionText: string): Promise<void> {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled || !prefs.onQuestion) return;

  if (prefs.unfocusedOnly) {
    const unfocused = await isSessionUnfocused(key);
    if (!unfocused) return;
  }

  const sessionTitle = getSessionDisplayTitle(key);
  const eventType = i18n.t("chat.notifyQuestionTitle", "需要你的回复");
  const title = sessionTitle ? `${sessionTitle} · ${eventType}` : eventType;
  const body = formatNotificationBody(questionText, 160);
  return sendOSNotification({
    title,
    body,
    sessionKey: key,
    tag: `question-${key}`,
  }).then(() => {});
}

/**
 * 计划待审批时触发通知。
 */
export async function notifyPlanReview(key: string, planTitle?: string): Promise<void> {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled || !prefs.onQuestion) return;

  if (prefs.unfocusedOnly) {
    const unfocused = await isSessionUnfocused(key);
    if (!unfocused) return;
  }

  const sessionTitle = getSessionDisplayTitle(key);
  const eventType = i18n.t("chat.notifyPlanReviewTitle", "计划待审批");
  const title = sessionTitle ? `${sessionTitle} · ${eventType}` : eventType;
  const detail = planTitle ? `${planTitle}` : i18n.t("chat.notifyPlanReviewBodyFallback", "模型提交了新计划等待审批");
  const body = formatNotificationBody(detail, 160);
  return sendOSNotification({
    title,
    body,
    sessionKey: key,
    tag: `plan-review-${key}`,
  }).then(() => {});
}

/**
 * 权限请求待确认时触发通知。
 */
export async function notifyPermissionRequest(key: string, path: string): Promise<void> {
  const prefs = await getNotificationPreferences();
  if (!prefs.enabled || !prefs.onQuestion) return;

  if (prefs.unfocusedOnly) {
    const unfocused = await isSessionUnfocused(key);
    if (!unfocused) return;
  }

  const sessionTitle = getSessionDisplayTitle(key);
  const eventType = i18n.t("chat.notifyPermissionTitle", "请求访问权限");
  const title = sessionTitle ? `${sessionTitle} · ${eventType}` : eventType;
  const body = formatNotificationBody(i18n.t("chat.notifyPermissionBody", "请求访问目录 {{path}}", { path }), 160);
  return sendOSNotification({
    title,
    body,
    sessionKey: key,
    tag: `permission-${key}`,
  }).then(() => {});
}
