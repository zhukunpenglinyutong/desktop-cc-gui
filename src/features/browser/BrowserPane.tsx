import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Globe from "lucide-react/dist/esm/icons/globe";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { openExternal } from "@/lib/platform";
import { isWeb } from "@/lib/transport";
import { cx } from "@/utils/cx";
import { useBrowserStore, type BrowserTab } from "./store";
import { normalizeAddress } from "./address";
import { useBrowserOccluded } from "./occlusion";
import {
  browserCurrentUrl,
  browserGoBack,
  browserGoForward,
  browserReload,
  createBrowserWebview,
  listenBrowserNav,
  listenBrowserTitle,
  navigateBrowserWebview,
  setBrowserWebviewBounds,
  setBrowserWebviewVisible,
} from "./webview";

/** Chrome look for the toolbar buttons, same as the sidebar/tab-strip
 * header buttons. */
const TOOL_BUTTON =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150 text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary";

/** App-level subscriptions forwarding native webview events into the store.
 * Mounted once by the center pane while any browser tab exists. */
export function useBrowserNavSync() {
  const setUrl = useBrowserStore((s) => s.setUrl);
  const setTitle = useBrowserStore((s) => s.setTitle);
  useEffect(() => {
    if (isWeb) return;
    let disposed = false;
    const unlisteners: (() => void)[] = [];
    void listenBrowserNav((id, url) => {
      if (!disposed) setUrl(id, url);
    }).then((un) => (disposed ? un() : unlisteners.push(un)));
    void listenBrowserTitle((id, title) => {
      if (!disposed && title) setTitle(id, title);
    }).then((un) => (disposed ? un() : unlisteners.push(un)));
    return () => {
      disposed = true;
      for (const un of unlisteners) un();
    };
  }, [setUrl, setTitle]);
}

/** Owns the native child webview for one browser tab: created lazily on
 * first activation, bounds-synced to the placeholder via ResizeObserver,
 * hidden whenever the tab is not in view. Overlays register in
 * occlusion.ts and hide it the same way, since no z-index can lift HTML
 * over a native webview. */
function useWebviewSync(id: string, url: string, active: boolean, placeholderRef: React.RefObject<HTMLDivElement | null>) {
  // HTML overlays (modals, menus) can't paint over the native webview, so
  // an open overlay hides it like a tab switch would.
  const occluded = useBrowserOccluded();
  const visible = active && !occluded;
  // Read by the async create-then-show chain below. Written in a layout
  // effect so render stays pure (React may discard render work before
  // commit) and the value is already current when an IPC promise settles.
  const activeRef = useRef(visible);
  useLayoutEffect(() => {
    activeRef.current = visible;
  }, [visible]);

  useLayoutEffect(() => {
    if (isWeb) return;
    const el = placeholderRef.current;
    if (!el || !visible) return;

    let disposed = false;
    const rectOf = () => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    };
    const sync = () => {
      if (disposed) return;
      const rect = rectOf();
      if (rect.width < 1 || rect.height < 1) return;
      // Until the async create lands there is no webview ("not found"); the
      // create chain applies the latest rect itself, so this is not an error.
      void setBrowserWebviewBounds(id, rect).catch(() => {});
    };

    // Create is idempotent. A new child webview starts out visible, and hide
    // or resize calls sent while the async create was pending hit "not found"
    // and were dropped, so reconcile with the pane's current state once the
    // webview exists. Show follows the bounds write so the page never flashes
    // in at a stale position.
    const rect = rectOf();
    if (rect.width >= 1 && rect.height >= 1) {
      void createBrowserWebview(id, url, rect)
        .then(() => {
          if (!activeRef.current) return setBrowserWebviewVisible(id, false);
          // Disposed but still visible: a newer run of this effect owns bounds and show.
          if (disposed) return;
          const latest = rectOf();
          const bounds = latest.width >= 1 && latest.height >= 1 ? latest : rect;
          return setBrowserWebviewBounds(id, bounds).then(() => {
            if (!disposed && activeRef.current) return setBrowserWebviewVisible(id, true);
          });
        })
        .catch((error) => {
          // Surface the native failure instead of leaving an unexplained
          // blank pane. The tab stays open: hiding and re-showing it (a tab
          // switch) runs this effect again and retries the create.
          console.error("Failed to set up browser webview", { id, url, error });
        });
    }

    const observer = new ResizeObserver(sync);
    observer.observe(el);
    window.addEventListener("resize", sync);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", sync);
      // Hidden, not closed: the page (scroll position, login, media state)
      // survives tab switches. Closing happens in the store's closeTab.
      void setBrowserWebviewVisible(id, false);
    };
  }, [id, url, visible, placeholderRef]);

  // SPA pushState navigations never fire the native nav event; poll the
  // real URL while the tab is active so the address bar follows.
  const setUrl = useBrowserStore((s) => s.setUrl);
  useEffect(() => {
    if (isWeb || !active) return;
    const timer = setInterval(() => {
      void browserCurrentUrl(id).then((current) => {
        if (current && current !== "about:blank") setUrl(id, current);
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [id, active, setUrl]);
}

/** One browser tab: toolbar chrome + the placeholder rect the native
 * webview paints over. Stays mounted while the tab is open; `active`
 * controls both visibility and the webview's show/hide. */
export function BrowserPane({ tab, active }: { tab: BrowserTab; active: boolean }) {
  const { t } = useTranslation();
  const setUrl = useBrowserStore((s) => s.setUrl);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState(tab.url);
  const [addressFocused, setAddressFocused] = useState(false);
  // Same spin → check feedback as the app's other refresh actions.
  const reloadAction = useActionFeedback({ spin: true });
  const reloading = reloadAction.feedback === "running";

  useWebviewSync(tab.id, tab.url, active, placeholderRef);

  // Follow external URL changes (nav events, polling) unless the user is
  // mid-edit in the address bar.
  useEffect(() => {
    if (!addressFocused) setAddress(tab.url);
  }, [tab.url, addressFocused]);

  const submitAddress = () => {
    const url = normalizeAddress(address);
    if (!url) return;
    setAddress(url);
    setUrl(tab.id, url);
    void navigateBrowserWebview(tab.id, url);
  };

  if (isWeb) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-text-tertiary">
        <Globe className="size-6" aria-hidden />
        <span className="text-body-medium">{t("browser.desktopOnly")}</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-separator-border px-3">
        <button
          type="button"
          aria-label={t("browser.goBack")}
          title={t("browser.goBack")}
          onClick={() => void browserGoBack(tab.id)}
          className={TOOL_BUTTON}
        >
          <ArrowLeft className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("browser.goForward")}
          title={t("browser.goForward")}
          onClick={() => void browserGoForward(tab.id)}
          className={TOOL_BUTTON}
        >
          <ArrowRight className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("browser.reload")}
          title={t("browser.reload")}
          disabled={reloading}
          onClick={() => {
            if (reloading) return;
            void reloadAction.start(() => browserReload(tab.id));
          }}
          className={cx(TOOL_BUTTON, "disabled:cursor-default disabled:opacity-60")}
        >
          <ActionFeedbackIcon icon={RotateCw} feedback={reloadAction.feedback} spin />
        </button>
        <input
          type="text"
          aria-label={t("browser.addressPlaceholder")}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onFocus={() => setAddressFocused(true)}
          onBlur={() => setAddressFocused(false)}
          onKeyDown={(e) => {
            // CJK users press Enter to confirm an IME candidate; that Enter
            // must not submit the half-composed address.
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              submitAddress();
              e.currentTarget.blur();
            }
          }}
          onFocusCapture={(e) => e.currentTarget.select()}
          placeholder={t("browser.addressPlaceholder")}
          spellCheck={false}
          className={cx(
            "mx-1 h-7 min-w-0 flex-1 rounded-lg bg-background-tertiary-default px-2.5",
            "text-body-2-medium text-text-primary outline-none placeholder:text-text-tertiary",
            "focus:ring-2 focus:ring-inset focus:ring-border-focus-ring",
          )}
        />
        <button
          type="button"
          aria-label={t("browser.openExternal")}
          title={t("browser.openExternal")}
          onClick={() => openExternal(tab.url)}
          className={TOOL_BUTTON}
        >
          <ExternalLink className="size-4" aria-hidden />
        </button>
      </div>
      {/* The native webview paints exactly over this rect. */}
      <div ref={placeholderRef} className="min-h-0 min-w-0 flex-1 bg-background-primary-default" />
    </div>
  );
}
