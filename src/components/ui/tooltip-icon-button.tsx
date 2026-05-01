import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

type TooltipSide = "top" | "right" | "bottom" | "left";
type TooltipAlign = "start" | "center" | "end";

type TooltipIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  tooltipSide?: TooltipSide;
  tooltipAlign?: TooltipAlign;
  tooltipSideOffset?: number;
  tooltipClassName?: string;
  delay?: number;
};

export function TooltipIconButton({
  label,
  children,
  tooltipSide = "bottom",
  tooltipAlign = "center",
  tooltipSideOffset = 6,
  tooltipClassName,
  delay = 200,
  type = "button",
  title,
  "aria-label": ariaLabel,
  onMouseEnter,
  onMouseLeave,
  onFocus,
  onBlur,
  onClick,
  onPointerCancel,
  onPointerDown,
  disabled,
  ...buttonProps
}: TooltipIconButtonProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    const closeTooltip = () => {
      setOpen(false);
    };
    const closeWhenHidden = () => {
      if (document.visibilityState === "hidden") {
        closeTooltip();
      }
    };

    window.addEventListener("blur", closeTooltip);
    document.addEventListener("visibilitychange", closeWhenHidden);

    return () => {
      window.removeEventListener("blur", closeTooltip);
      document.removeEventListener("visibilitychange", closeWhenHidden);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
    }
  }, [disabled]);

  return (
    <Tooltip open={open} onOpenChange={setOpen} disabled={disabled}>
      <TooltipTrigger
        render={<button />}
        delay={delay}
        type={type}
        title={title}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onMouseEnter={(event) => {
          onMouseEnter?.(event);
          if (!disabled) {
            setOpen(true);
          }
        }}
        onMouseLeave={(event) => {
          onMouseLeave?.(event);
          setOpen(false);
        }}
        onFocus={(event) => {
          onFocus?.(event);
          if (!disabled) {
            setOpen(true);
          }
        }}
        onBlur={(event) => {
          onBlur?.(event);
          setOpen(false);
        }}
        onClick={(event) => {
          onClick?.(event);
          setOpen(false);
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          setOpen(false);
        }}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          setOpen(false);
        }}
        {...buttonProps}
      >
        {children}
      </TooltipTrigger>
      {open && (
        <TooltipContent
          role="tooltip"
          side={tooltipSide}
          align={tooltipAlign}
          sideOffset={tooltipSideOffset}
          className={tooltipClassName}
        >
          {label}
        </TooltipContent>
      )}
    </Tooltip>
  );
}
