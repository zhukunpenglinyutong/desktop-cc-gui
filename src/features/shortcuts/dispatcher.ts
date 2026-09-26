/**
 * 全局 keydown 分发器（自旧版 desktop-cc-gui 移植）。
 *
 * 模块级单例：所有快捷键消费方共享一个 window keydown 监听。handlers 按
 * 注册序执行，任一 handler preventDefault 后后续 handler 不再触发（软
 * 优先级）。编辑区保护不在此层，由各消费 hook 自行判断
 * isEditableShortcutTarget。handlers 清空时自动卸载监听。
 */

type KeyHandler = (event: KeyboardEvent) => void;

const handlers = new Set<KeyHandler>();
let installed = false;

function rootHandler(event: KeyboardEvent) {
  // Not every "keydown" carries a keystroke: when a datalist / autofill
  // suggestion is accepted, Chromium dispatches a bare Event("keydown") on the
  // field before writing the value (WebFormControlElement::SetAutofillValue,
  // reached from AutofillAgent::AcceptDataListSuggestion). It has no `key` and
  // no modifiers, so no shortcut can match it, and handlers that normalize
  // `event.key` would throw on undefined — taking the whole app down through
  // the global error handler. The DOM type says `string`; the runtime does not.
  if (typeof event.key !== "string") {
    return;
  }
  for (const handler of Array.from(handlers)) {
    if (event.defaultPrevented) {
      return;
    }
    handler(event);
  }
}

function ensureInstalled() {
  if (installed) return;
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", rootHandler);
  installed = true;
}

function uninstallIfEmpty() {
  if (!installed) return;
  if (handlers.size > 0) return;
  if (typeof window === "undefined") return;
  window.removeEventListener("keydown", rootHandler);
  installed = false;
}

export function registerKeydownHandler(handler: KeyHandler): () => void {
  handlers.add(handler);
  ensureInstalled();
  return () => {
    handlers.delete(handler);
    uninstallIfEmpty();
  };
}
