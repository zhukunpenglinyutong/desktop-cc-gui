import { memo, useEffect, useRef, useState } from "react";
import type { IDisposable, Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import { useTranslation } from "react-i18next";
import { isMacPlatform } from "@/features/shortcuts/shortcuts";
import { ipc } from "@/lib/ipc";
import { loadXterm, type XtermModules } from "./xterm-loader";
import { terminalFontFamily, terminalFontSize, terminalTheme } from "./appearance";
import { FONT_CHANGE_EVENT } from "@/features/settings/font";
import { TYPOGRAPHY_CHANGE_EVENT } from "@/features/settings/interface-typography";
import { createPathLinkProvider } from "./links";
import { TerminalContextMenu, type TerminalMenuState } from "./TerminalContextMenu";
import {
  ensureTerminalOutputListener,
  hasTerminalSession,
  markTerminalClosed,
  markTerminalOpened,
  setTerminalWriter,
  terminalBacklog,
} from "./sessions";

/** PTY cols/rows wait this long after the last size change: one IPC per frame
 *  stalled the backend and made height drags feel sticky. Shared by the
 *  container observer and font/size edits (which change cell metrics without
 *  any container resize). */
const PTY_RESIZE_DEBOUNCE_MS = 150;

/** xterm measures glyphs when it opens or when font options change; a bundled
 *  webfont that has not loaded yet would bake the fallback's cell metrics into
 *  the canvas. `document.fonts.load` takes a CSS font shorthand. */
function waitForFontLoad(family: string, size: number): Promise<void> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve();
  try {
    return fonts.load(`${size}px ${family}`).then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // Unparseable shorthand: nothing to wait on; the caller re-measures anyway.
    return Promise.resolve();
  }
}

/**
 * One xterm instance for the active tab; remounts per tab (key = tab id).
 * The backend PTY session persists across mounts and buffered output replays
 * into the fresh instance, so collapse/tab switches lose nothing.
 * Memoized: the dock re-renders per animation frame during height drags, and
 * an xterm re-render per frame would jank the drag.
 */
export const TerminalView = memo(function TerminalView({ id, cwd }: { id: string; cwd: string }) {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [xterm, setXterm] = useState<XtermModules | null>(null);
  const [menu, setMenu] = useState<TerminalMenuState | null>(null);
  // The live xterm instance, for the contextmenu handler outside the
  // setup effect's closure.
  const liveTermRef = useRef<Terminal | null>(null);

  // xterm loads lazily on mount; the module-level promise caches the load,
  // so this resolves immediately for every tab after the first.
  useEffect(() => {
    let cancelled = false;
    ensureTerminalOutputListener();
    void loadXterm()
      .then((modules) => {
        if (!cancelled) setXterm(modules);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !xterm) return;
    let resizeTimer: number | undefined;
    let termRef: Terminal | null = null;
    let fitRef: FitAddon | null = null;
    let inputDisposable: IDisposable | null = null;
    let linkDisposable: IDisposable | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;
    // The family currently assigned to xterm; OptionsService silently ignores
    // an identical reassignment, so the code below needs to detect "same face,
    // freshly loaded" to force a re-measure through a probe value.
    let currentFontFamily = "";
    let fontLoadVersion = 0;
    let disposed = false;

    const safeFit = () => {
      try {
        fitRef?.fit();
      } catch {
        // Zero-size host mid-layout; the next ResizeObserver tick refits.
      }
    };

    // Debounced PTY size sync. Fit every frame so the canvas tracks drags, but
    // only push cols/rows once the change settles.
    const schedulePtyResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = undefined;
        if (termRef && hasTerminalSession(id)) {
          void ipc.terminalResize(id, termRef.cols, termRef.rows).catch(() => {});
        }
      }, PTY_RESIZE_DEBOUNCE_MS);
    };

    // OptionsService treats an identical fontFamily assignment as a no-op, so a
    // face that finished loading after the previous measure would never be
    // picked up. Bounce through a probe stack to push xterm down its public
    // option path (re-measure char size + reset the texture atlas), then
    // restore the real family. Never touches xterm private internals.
    const remeasureFont = (family: string) => {
      const term = termRef;
      if (!term) return;
      term.options.fontFamily = `${family}, monospace`;
      term.options.fontFamily = family;
    };

    // Wait for the face to be usable, then re-measure. Late arrivals (unmount,
    // or a newer font choice) must not touch the live view.
    const refitAfterFontLoad = (family: string, size: number) => {
      const version = ++fontLoadVersion;
      void waitForFontLoad(family, size).then(() => {
        if (disposed || !termRef || version !== fontLoadVersion) return;
        remeasureFont(family);
        safeFit();
        schedulePtyResize();
      });
    };

    // Follow 设置 → 通用 → 外观 → 代码字体 changes live. Declared outside
    // the try so the cleanup below removes the very same listener references.
    const onFontChange = () => {
      const term = termRef;
      if (!term) return;
      const family = terminalFontFamily();
      const size = terminalFontSize();
      term.options.fontSize = size;
      if (family !== currentFontFamily) {
        currentFontFamily = family;
        // Assigning a new family already re-measures, but the face may not be
        // loaded yet — refitAfterFontLoad re-runs the measure once it is.
        term.options.fontFamily = family;
      } else {
        // Same family (an uploaded face finished loading): force the measure.
        remeasureFont(family);
      }
      safeFit();
      schedulePtyResize();
      refitAfterFontLoad(family, size);
    };

    const onTypographyChange = () => {
      const term = termRef;
      if (!term) return;
      const size = terminalFontSize();
      if (term.options.fontSize === size) return;
      term.options.fontSize = size;
      safeFit();
      schedulePtyResize();
      refitAfterFontLoad(currentFontFamily, size);
    };

    try {
      const { Terminal, FitAddon, WebglAddon } = xterm;
      const initialFontFamily = terminalFontFamily();
      const initialFontSize = terminalFontSize();
      currentFontFamily = initialFontFamily;
      const term = new Terminal({
        fontFamily: initialFontFamily,
        fontSize: initialFontSize,
        cursorBlink: true,
        scrollback: 5000,
        theme: terminalTheme(),
        // Option-as-meta so word jumps (⌥←/⌥→) reach readline on macOS.
        macOptionIsMeta: true,
        // Option+click is the reveal gesture on macOS (links.ts); xterm's
        // default alt-click-moves-cursor would fire for the same click and
        // move the shell cursor to the clicked cell. Keep the feature where
        // it cannot collide (Windows/Linux reveal with Ctrl+click).
        altClickMovesCursor: !isMacPlatform(),
      });
      termRef = term;
      liveTermRef.current = term;
      const fit = new FitAddon();
      fitRef = fit;
      term.loadAddon(fit);
      term.open(host);
      try {
        // GPU renderer; falls back to canvas when WebGL is unavailable.
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose());
        term.loadAddon(webgl);
      } catch {
        // Canvas renderer remains active.
      }

      const backlog = terminalBacklog(id);
      if (backlog) term.write(backlog);
      setTerminalWriter(id, (data) => term.write(data));

      const openSession = () =>
        ipc
          .terminalOpen({ id, cwd, cols: term.cols, rows: term.rows })
          .then(() => {
            // Unmounted before the open resolved: leave the PTY alone (it
            // outlives the view by design — a remount reopens/reuses it),
            // but don't mark or touch state for a dead view.
            if (disposed) return;
            markTerminalOpened(id);
            // Font loading may have refitted while PTY spawn was pending.
            // Replay the latest cell dimensions once the session can resize.
            schedulePtyResize();
            setError(null);
          })
          .catch((e: unknown) => {
            if (!disposed) setError(String(e));
          });

      safeFit();
      void openSession();
      // The default 代码 face is a bundled webfont; xterm measured at open,
      // possibly against a fallback. Re-measure once the face is ready.
      refitAfterFontLoad(initialFontFamily, initialFontSize);

      // Absolute paths in output become modifier-click-to-reveal links
      // (see links.ts).
      linkDisposable = term.registerLinkProvider(
        createPathLinkProvider({
          term,
          cwd,
          onActivate: (path) => {
            void ipc.revealInFileManager(path).catch(() => {});
          },
        }),
      );

      inputDisposable = term.onData((data) => {
        const write = () =>
          ipc.terminalWrite(id, data).catch((e: unknown) => {
            // Shell exited (exit/Ctrl-D): respawn, then deliver the input.
            if (String(e).includes("Terminal session not found")) {
              markTerminalClosed(id);
              void openSession().then(() =>
                ipc.terminalWrite(id, data).catch(() => {}),
              );
            }
          });
        if (hasTerminalSession(id)) void write();
        else void openSession().then(write);
      });

      resizeObserver = new ResizeObserver(() => {
        safeFit();
        // Fit every frame so the canvas tracks the drag; the PTY resize
        // itself waits for the drag to settle (see schedulePtyResize).
        schedulePtyResize();
      });
      resizeObserver.observe(host);

      // Follow app theme flips (the dark class on <html>).
      themeObserver = new MutationObserver(() => {
        term.options.theme = terminalTheme();
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      // Follow 设置 → 通用 → 外观 → 代码字体 / 代码字号 changes live.
      window.addEventListener(FONT_CHANGE_EVENT, onFontChange);
      window.addEventListener(TYPOGRAPHY_CHANGE_EVENT, onTypographyChange);
    } catch (e: unknown) {
      setError(String(e));
    }

    return () => {
      disposed = true;
      clearTimeout(resizeTimer);
      inputDisposable?.dispose();
      linkDisposable?.dispose();
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      window.removeEventListener(FONT_CHANGE_EVENT, onFontChange);
      window.removeEventListener(TYPOGRAPHY_CHANGE_EVENT, onTypographyChange);
      if (termRef) {
        setTerminalWriter(id, null);
        termRef.dispose();
        liveTermRef.current = null;
      }
    };
  }, [xterm, id, cwd]);

  return (
    <div
      className="relative min-h-0 flex-1 bg-background-full"
      onContextMenu={(e) => {
        // Only a non-empty selection earns a menu (copy / reveal in file
        // manager); otherwise the webview default is a no-op anyway.
        const selection = liveTermRef.current?.getSelection();
        if (!selection) return;
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, text: selection });
      }}
    >
      <div ref={hostRef} className="terminal-host absolute inset-0" />
      {menu && (
        <TerminalContextMenu menu={menu} cwd={cwd} onClose={() => setMenu(null)} />
      )}
      {error && (
        <div className="absolute inset-x-0 top-0 z-10 border-b border-separator-border bg-background-quaternary-error px-3 py-1.5 text-caption-1-medium text-text-error-primary">
          {t("terminal.failed", { message: error })}
        </div>
      )}
    </div>
  );
});
