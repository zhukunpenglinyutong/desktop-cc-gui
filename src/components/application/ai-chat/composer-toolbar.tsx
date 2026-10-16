import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up";
import CircleStop from "lucide-react/dist/esm/icons/circle-stop";
import { Focusable } from "react-aria-components";
import { Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import { cx } from "@/utils/cx";

/**
 * ComposerToolbar — the composer's bottom row: menu slots (add attachment,
 * CLI + model switcher, permission mode) on the left; the send button on the
 * right, which becomes a stop control while a turn streams.
 */
export function ComposerToolbar({
  addMenu,
  cliMenu,
  permissionMenu,
  streaming = false,
  disabled = false,
  disabledReason,
  onStop,
  onSend,
}: {
  /** Slot for the add-attachment menu (template AddMenu). */
  addMenu?: ReactNode;
  /** Slot for the CLI + model switcher (CliMenu). */
  cliMenu?: ReactNode;
  /** Slot for the permission-mode picker (PermissionMenu). */
  permissionMenu?: ReactNode;
  /** A turn is in flight: send becomes stop. */
  streaming?: boolean;
  /** Greys out send. */
  disabled?: boolean;
  /** Why send is inert ("prerequisite not met"): rendered as the send
   *  control's tooltip. Unlike `disabled`, it keeps the control hoverable and
   *  focusable (`aria-disabled` + a press guard) so the explanation is
   *  actually readable — see agent-limits-card's auto-compact switch. */
  disabledReason?: string;
  /** Fires on the stop button while streaming. */
  onStop?: () => void;
  /** Fires on the send button. */
  onSend: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 select-none">
      {addMenu}

      {cliMenu}

      {permissionMenu}

      <div aria-hidden className="min-w-0 flex-1" />

      {streaming ? (
        <button
          type="button"
          aria-label={t("chat.stop")}
          onClick={() => onStop?.()}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-button-primary p-2 transition-opacity duration-200 ease"
        >
          <CircleStop className="size-5 text-text-white" aria-hidden />
        </button>
      ) : disabledReason ? (
        // 前置条件未满足（无会话/无工作区）：保持可 hover、可聚焦，把原因
        // 说出来。原生 disabled 收不到 hover，tooltip 永远读不到，所以这里
        // 用 aria-disabled + 点击守卫——与自动压缩开关同一条规则。
        <Tooltip>
          {/* 触发元素必须被 Focusable 包住：AriaTooltipTrigger 靠 FocusableContext
              下发 ref 与 hover/focus 处理器，裸 DOM 元素会让 trigger ref 为 null，
              tooltip 就钉在视口左上角而不是锚在按钮上（见 tooltip.tsx 的契约）。 */}
          <Focusable>
            <button
              type="button"
              aria-label={t("chat.send")}
              // 与 agent-limits-card 的既有写法一致：只在真禁用时自称禁用。
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (disabled) return;
                onSend();
              }}
              className={cx(
                "flex size-9 shrink-0 items-center justify-center rounded-full bg-button-primary p-2 transition-opacity duration-200 ease",
                // 键盘可达正是这条分支的意义（原生 disabled 收不到 focus），
                // 所以焦点环必须显式给上。
                "outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              )}
            >
              <ArrowUp className="size-5 text-text-white" aria-hidden />
            </button>
          </Focusable>
          <TooltipContent>{disabledReason}</TooltipContent>
        </Tooltip>
      ) : (
        <button
          type="button"
          aria-label={t("chat.send")}
          disabled={disabled}
          onClick={onSend}
          className={cx(
            "flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-button-primary p-2 transition-opacity duration-200 ease",
            // 与上面那条禁用分支统一到 opacity-50（§3：禁用态 50~60）：同一个
            // 发送键不该因为「有没有解释」而在两种灰之间跳。
            disabled && "cursor-not-allowed opacity-50",
          )}
        >
          <ArrowUp className="size-5 text-text-white" aria-hidden />
        </button>
      )}
    </div>
  );
}
