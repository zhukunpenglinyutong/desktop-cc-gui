"use client";

import { Button as AriaButton } from "react-aria-components";
import { Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import { cx } from "@/utils/cx";

/**
 * 「1M 上下文」开关：形态参考模型面板里 Codex 的 Fast 闪电按钮
 * （`omp-speed-section.tsx` 的 header 行）——32px 圆角图标按钮，选中态高亮、
 * 未选态沉底并在 hover 时提亮。这里是独立组件而不是复用 `OmpSpeedSection`：
 * 那个组件的语义、图标与重置按钮都绑定在 OMP / Codex 的 service tier 上，
 * 泛化它只会把两个不相干的开关耦合在一起。class 因此内联同款状态组合。
 *
 * 提示走宿主 react-aria `Tooltip`，而不是原生 `title`：原生 title 由
 * `NativeTitleTooltip` 统一接管，它渲染的固定层 z-[130] 远低于浮层（react-aria
 * 的 z-index 100000），在模型浮层里会被整块盖住、看不到。Tooltip 与浮层同在
 * react-aria 的顶层里按打开顺序叠放，按钮后悬停即在其上。
 */
export function OneMToggle({
  enabled,
  onChange,
  label,
  tip,
}: {
  enabled: boolean;
  onChange: (next: boolean) => void;
  /** 无障碍名（读屏用）。 */
  label: string;
  /** 悬停提示：说清点击会做什么。 */
  tip: string;
}) {
  return (
    <Tooltip>
      <AriaButton
        aria-label={label}
        aria-pressed={enabled}
        onPress={() => onChange(!enabled)}
        className={cx(
          "flex size-8 shrink-0 items-center justify-center rounded-lg text-body-2-medium transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2",
          enabled
            ? "bg-background-tertiary-hover text-text-primary"
            : "bg-background-secondary-default text-text-tertiary hover:text-text-primary",
        )}
      >
        1M
      </AriaButton>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}
