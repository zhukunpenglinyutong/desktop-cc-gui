import { useEffect, useState } from "react";

import { ipc } from "@/lib/ipc";
import { IS_WINDOWS, isWeb } from "@/lib/platform";

export type TitlebarStyle = "native" | "mac";

/**
 * 当前标题栏样式（Windows）："native" = 系统原生标题栏，"mac" = 仿 mac 自绘
 * 标题栏（无装饰窗口 + 三色按钮）。macOS 恒为系统原生红绿灯，这里只会是
 * "native"（语义上：macOS 不需要自绘按钮）。设置改动需重启生效，本 hook 只
 * 负责把已落盘的样式读出来，首次渲染会先以 native 出现、随后一次修正。
 */
export function useTitlebarStyle(): TitlebarStyle {
  const [style, setStyle] = useState<TitlebarStyle>("native");
  useEffect(() => {
    // 网页访问模式（Windows 浏览器）没有窗口 API，也不该出现自绘按钮。
    if (!IS_WINDOWS || isWeb) return;
    let alive = true;
    ipc
      .getAppSettings()
      .then((settings) => {
        if (alive && settings.titlebar === "mac") setStyle("mac");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return style;
}

/**
 * 是否要渲染自绘的三色窗口按钮（仅 Windows 桌面 + 仿 mac 标题栏）。
 * 页签条、侧栏条、发丝线判定三处共用，保持同一套判定。
 */
export function needsWindowControls(style: TitlebarStyle): boolean {
  return IS_WINDOWS && !isWeb && style === "mac";
}
