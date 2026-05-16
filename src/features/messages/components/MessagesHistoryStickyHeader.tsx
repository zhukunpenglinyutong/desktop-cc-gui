/**
 * MessagesHistoryStickyHeader — extracted from MessagesTimeline.
 *
 * Phase P0-1 (deepen) of the coss-ui migration:
 * - Inlines the rules previously in `src/styles/messages.history-sticky.css`
 *   directly onto these JSX elements via the `style` prop.
 * - Pseudo-element `::before` was replaced by an explicit child <span>.
 * - The `.app.canvas-width-wide` cascade override is reproduced by reading
 *   the closest `.app` ancestor's classList through a MutationObserver.
 *
 * The retained class names (`messages-history-sticky-header*`) are kept as
 * no-op markers so existing `querySelector(".messages-history-sticky-header")`
 * checks in Messages.live-behavior.test.tsx keep working.
 */

import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import MessageSquareText from "lucide-react/dist/esm/icons/message-square-text";
import type { HistoryStickyCandidate } from "./messagesRenderUtils";

type MessagesHistoryStickyHeaderProps = {
  candidate: HistoryStickyCandidate;
  isCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
};

const PEEK_WIDTH = "16px";

/**
 * Styles previously defined in `messages.history-sticky.css`, re-expressed as
 * inline `style` objects. The values match the original CSS rules verbatim
 * (rendered through a tiny `--peek-width` custom property so the bubble
 * `is-collapsed` width stays var-driven, just like before).
 */
const ROOT_BASE_STYLE: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 6,
  height: 0,
  pointerEvents: "none",
};

const INNER_BASE_STYLE: CSSProperties = {
  // Longhand padding properties — React warns when the shorthand `padding`
  // is mixed with conditional overrides like `paddingRight: "0px"` on
  // re-render. Keeping all four sides explicit avoids that conflict.
  paddingTop: "4px",
  paddingRight: "var(--main-panel-padding)",
  paddingBottom: "6px",
  paddingLeft: "var(--main-panel-padding)",
  background: "transparent",
};

const CONTENT_BASE_STYLE: CSSProperties & Record<string, string> = {
  // CSS custom property scope — mirrors the original
  //   .messages-history-sticky-header-content {
  //     --messages-history-sticky-peek-width: 16px;
  //   }
  ["--messages-history-sticky-peek-width" as string]: PEEK_WIDTH,
  maxWidth: "none",
  width: "100%",
  marginLeft: "auto",
  marginRight: "auto",
  display: "flex",
  justifyContent: "flex-start",
  overflow: "hidden",
};

const CONTENT_COLLAPSED_OVERRIDE: CSSProperties = {
  justifyContent: "flex-end",
  overflow: "visible",
};

const BUBBLE_BASE_STYLE: CSSProperties = {
  position: "relative",
  width: "100%",
  minHeight: "36px",
  display: "flex",
  alignItems: "center",
  padding: "6px 36px 6px 12px",
  overflow: "hidden",
  isolation: "isolate",
  borderRadius: "14px",
  background:
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 10%, var(--surface-card) 90%)",
  color: "var(--text-strongest, var(--text-stronger))",
  border:
    "1px solid color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 18%, var(--border-strong) 82%)",
  boxShadow: [
    "0 1px 0 color-mix(in srgb, #ffffff 5%, transparent)",
    "0 14px 28px color-mix(in srgb, #020617 9%, transparent)",
    "inset 0 1px 0 color-mix(in srgb, #ffffff 10%, transparent)",
    "inset 0 -1px 0 color-mix(in srgb, #020617 5%, transparent)",
  ].join(", "),
  WebkitBackdropFilter: "blur(12px) saturate(1.06)",
  backdropFilter: "blur(12px) saturate(1.06)",
  transition:
    "transform 220ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 160ms ease, border-color 160ms ease",
  pointerEvents: "auto",
  willChange: "transform",
};

const BUBBLE_COLLAPSED_OVERRIDE: CSSProperties = {
  flex: "0 0 var(--messages-history-sticky-peek-width)",
  width: "var(--messages-history-sticky-peek-width)",
  minWidth: "var(--messages-history-sticky-peek-width)",
  minHeight: "44px",
  padding: 0,
  borderRadius: 0,
  transform: "none",
  boxShadow: [
    "0 6px 14px color-mix(in srgb, #020617 8%, transparent)",
    "inset 0 1px 0 color-mix(in srgb, #ffffff 10%, transparent)",
  ].join(", "),
};

const LEADING_STYLE: CSSProperties = {
  position: "relative",
  zIndex: 1,
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "18px",
  height: "18px",
  marginRight: "8px",
  borderRadius: "6px",
  color:
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 76%, var(--text-strongest, var(--text-stronger)) 24%)",
  background:
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 10%, transparent)",
  boxShadow:
    "inset 0 0 0 1px color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 12%, transparent)",
};

const LEADING_COLLAPSED_OVERRIDE: CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
  transform: "translateX(10px)",
};

const TEXT_STYLE: CSSProperties = {
  position: "relative",
  zIndex: 1,
  width: "100%",
  display: "block",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
  fontSize: "12.5px",
  lineHeight: 1.25,
  fontWeight: 560,
  letterSpacing: "0.01em",
  textShadow: "0 0.5px 0 color-mix(in srgb, #ffffff 10%, transparent)",
  color:
    "color-mix(in srgb, var(--text-strongest, var(--text-stronger)) 95%, var(--color-message-user-bg, var(--surface-bubble-user)) 5%)",
  transition: "opacity 140ms ease, transform 180ms ease",
};

const TEXT_COLLAPSED_OVERRIDE: CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
  transform: "translateX(10px)",
};

const TOGGLE_BUTTON_BASE: CSSProperties = {
  position: "absolute",
  zIndex: 2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: "none",
  cursor: "pointer",
  color:
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 78%, var(--text-strongest, var(--text-stronger)) 22%)",
  top: "50%",
  right: "6px",
  width: "22px",
  height: "22px",
  borderRadius: "999px",
  background:
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 10%, var(--surface-card) 90%)",
  boxShadow: [
    "inset 0 0 0 1px color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 16%, transparent)",
    "0 4px 10px color-mix(in srgb, #020617 10%, transparent)",
    "0 0 0 1px color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 14%, transparent)",
    "0 0 12px color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 10%, transparent)",
  ].join(", "),
  transform: "translateY(-50%)",
  transition:
    "opacity 140ms ease, transform 180ms ease, background-color 140ms ease, color 140ms ease",
};

const PEEK_BUTTON_BASE: CSSProperties = {
  position: "absolute",
  zIndex: 2,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: "none",
  cursor: "pointer",
  color:
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 78%, var(--text-strongest, var(--text-stronger)) 22%)",
  left: 0,
  top: 0,
  bottom: 0,
  width: "100%",
  borderRadius: 0,
  background: [
    "linear-gradient(180deg,",
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 10%, var(--surface-card) 90%),",
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 6%, var(--surface-card) 94%))",
  ].join(" "),
  boxShadow: [
    "inset 1px 0 0 color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 12%, transparent)",
    "inset 0 1px 0 color-mix(in srgb, #ffffff 8%, transparent)",
    "0 5px 12px color-mix(in srgb, #020617 10%, transparent)",
    "0 0 8px color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 6%, transparent)",
  ].join(", "),
  clipPath: "none",
  // collapsed state (when rendered) is the visible variant; opacity 1
  opacity: 1,
  pointerEvents: "auto",
  transform: "translateX(0)",
  transition:
    "opacity 140ms ease, transform 180ms ease, background-color 140ms ease, color 140ms ease",
};

const PEEK_SLAB_STYLE: CSSProperties = {
  // Replaces the original `.messages-history-sticky-header-peek::before` slab.
  content: '""',
  width: "5px",
  height: "26px",
  borderRadius: "2px",
  background:
    "color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 46%, var(--text-muted) 54%)",
  boxShadow: [
    "inset 0 1px 0 color-mix(in srgb, #ffffff 22%, transparent)",
    "0 0 8px color-mix(in srgb, var(--color-message-user-bg, var(--surface-bubble-user)) 12%, transparent)",
  ].join(", "),
  display: "block",
};

/**
 * Reads the closest `.app` ancestor's classList for the `canvas-width-wide`
 * flag (which previously drove the `.app.canvas-width-wide ...` cascade
 * overrides). Re-reads on mutations so layout/theme toggles propagate.
 */
function useAncestorCanvasWidthWide(
  ref: React.RefObject<HTMLElement | null>,
): boolean {
  const [isWide, setIsWide] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const app = node.closest(".app");
    if (!app) return;
    const update = () => {
      setIsWide(app.classList.contains("canvas-width-wide"));
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(app, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [ref]);
  return isWide;
}

function mergeStyles(...styles: Array<CSSProperties | undefined | false>): CSSProperties {
  return Object.assign({}, ...styles.filter(Boolean));
}

export const MessagesHistoryStickyHeader = memo(function MessagesHistoryStickyHeader({
  candidate,
  isCollapsed,
  onCollapse,
  onExpand,
}: MessagesHistoryStickyHeaderProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const isWideCanvas = useAncestorCanvasWidthWide(rootRef);

  // .messages-history-sticky-header[data-history-sticky-collapsed="true"]
  //   { margin-right: calc(-1 * var(--main-panel-padding)) }
  // overridden to `-25px` under `.app.canvas-width-wide` and collapsed.
  const rootCollapsedMarginOverride: CSSProperties | undefined = isCollapsed
    ? {
        marginRight: isWideCanvas
          ? "-25px"
          : "calc(-1 * var(--main-panel-padding))",
      }
    : undefined;

  // .app.canvas-width-wide .messages-history-sticky-header-inner {
  //   padding-left: 50px; padding-right: 25px;
  // }
  // .messages-history-sticky-header[data-history-sticky-collapsed="true"]
  //   .messages-history-sticky-header-inner { padding-right: 0; }
  const innerOverride: CSSProperties = {};
  if (isWideCanvas) {
    innerOverride.paddingLeft = "50px";
    innerOverride.paddingRight = "25px";
  }
  if (isCollapsed) {
    innerOverride.paddingRight = "0px";
  }

  const handleCollapseClick = useCallback(() => {
    onCollapse();
  }, [onCollapse]);
  const handleExpandClick = useCallback(() => {
    onExpand();
  }, [onExpand]);

  return (
    <div
      ref={rootRef}
      className="messages-history-sticky-header"
      data-history-sticky-message-id={candidate.id}
      data-history-sticky-collapsed={isCollapsed ? "true" : "false"}
      style={mergeStyles(ROOT_BASE_STYLE, rootCollapsedMarginOverride)}
    >
      <div
        className="messages-history-sticky-header-inner"
        style={mergeStyles(INNER_BASE_STYLE, innerOverride)}
      >
        <div
          className="messages-history-sticky-header-content"
          style={mergeStyles(
            CONTENT_BASE_STYLE,
            isCollapsed ? CONTENT_COLLAPSED_OVERRIDE : undefined,
          )}
        >
          <div
            className={`messages-history-sticky-header-bubble${
              isCollapsed ? " is-collapsed" : ""
            }`}
            style={mergeStyles(
              BUBBLE_BASE_STYLE,
              isCollapsed ? BUBBLE_COLLAPSED_OVERRIDE : undefined,
            )}
          >
            {!isCollapsed ? (
              <button
                type="button"
                className="messages-history-sticky-header-toggle"
                data-history-sticky-toggle="collapse"
                aria-label={t("messages.collapseStickyHeader")}
                title={t("messages.collapseStickyHeader")}
                aria-expanded={!isCollapsed}
                onClick={handleCollapseClick}
                style={TOGGLE_BUTTON_BASE}
              >
                <ChevronRight size={15} aria-hidden />
              </button>
            ) : null}
            <span
              className="messages-history-sticky-header-leading"
              aria-hidden="true"
              style={mergeStyles(
                LEADING_STYLE,
                isCollapsed ? LEADING_COLLAPSED_OVERRIDE : undefined,
              )}
            >
              <MessageSquareText size={12} />
            </span>
            <div
              className="messages-history-sticky-header-text"
              style={mergeStyles(
                TEXT_STYLE,
                isCollapsed ? TEXT_COLLAPSED_OVERRIDE : undefined,
              )}
            >
              {candidate.text}
            </div>
            {isCollapsed ? (
              <button
                type="button"
                className="messages-history-sticky-header-peek"
                data-history-sticky-toggle="expand"
                aria-label={t("messages.expandStickyHeader")}
                title={t("messages.expandStickyHeader")}
                aria-expanded={!isCollapsed}
                onClick={handleExpandClick}
                style={PEEK_BUTTON_BASE}
              >
                <span
                  className="messages-history-sticky-header-peek-slab"
                  aria-hidden="true"
                  style={PEEK_SLAB_STYLE}
                />
                <ChevronLeft size={14} aria-hidden style={{ display: "none" }} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
});
