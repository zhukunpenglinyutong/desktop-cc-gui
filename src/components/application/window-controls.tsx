import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { cx } from "@/utils/cx";

/**
 * 仿 mac 的三色窗口按钮（Windows 自绘标题栏用；macOS 用系统原生红绿灯）。
 * 圆点悬停显示操作符号；绿色圆点随最大化状态切换 + / 还原。
 * 按钮本身会被各标题栏条的拖拽判定排除（button 不在拖拽区）。
 */
export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    const refresh = () => {
      win
        .isMaximized()
        .then((max) => {
          if (alive) setMaximized(max);
        })
        .catch(() => {});
    };
    refresh();
    const unlisten = win.onResized(refresh);
    return () => {
      alive = false;
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const buttonClass =
    "group flex h-4 w-4 items-center justify-center rounded-full transition-[filter] hover:brightness-95";
  const glyphClass =
    "pointer-events-none text-[9px] font-bold leading-none text-black/50 opacity-0 transition-opacity group-hover:opacity-100";

  return (
    <div
      className={cx("flex items-center gap-2", className)}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-label="关闭"
        title="关闭"
        onClick={() => void getCurrentWindow().close()}
        className={cx(buttonClass, "bg-[#ff5f57]")}
      >
        <span className={glyphClass}>×</span>
      </button>
      <button
        type="button"
        aria-label="最小化"
        title="最小化"
        onClick={() => void getCurrentWindow().minimize()}
        className={cx(buttonClass, "bg-[#febc2e]")}
      >
        <span className={glyphClass}>−</span>
      </button>
      <button
        type="button"
        aria-label={maximized ? "还原" : "最大化"}
        title={maximized ? "还原" : "最大化"}
        onClick={() => void getCurrentWindow().toggleMaximize()}
        className={cx(buttonClass, "bg-[#28c840]")}
      >
        <span className={glyphClass}>{maximized ? "❐" : "+"}</span>
      </button>
    </div>
  );
}
