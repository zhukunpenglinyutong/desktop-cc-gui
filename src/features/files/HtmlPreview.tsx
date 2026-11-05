import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openFilePreview } from "@/lib/preview-url";

/** Sandbox flags for a rendered local page: scripts / forms / modals run
 *  (design drafts need them). No `allow-same-origin`: the page gets an opaque
 *  origin, so it cannot read other preview responses or keep storage, and
 *  top-level navigation and popups stay blocked. What the page can load is
 *  bounded by the backend (only the file's own directory, served with a CSP
 *  that forbids connections out) — see src-tauri/src/preview_protocol.rs. */
const SANDBOX = "allow-scripts allow-forms allow-modals";

type PreviewState = { status: "loading" } | { status: "ready"; url: string } | { status: "error" };

/**
 * Rendered preview of an HTML file: an iframe over the app's own
 * `ccgui-preview` protocol, scoped to the file's directory by a token the
 * backend issues (`preview_open`). Relative references (`draft.css` next to
 * `index.html`) resolve as they do in a browser; nothing outside that
 * directory is served, and the page's scripts cannot send data anywhere.
 * Drafts that pull scripts from a CDN or use module imports may render
 * incompletely — "在浏览器中打开" shows the full page.
 *
 * Desktop only — EditorPane offers this only where the preview protocol
 * exists. `reloadKey` remounts the frame; that is the whole reload mechanism
 * (the document is read from disk by the frame itself, not from the store,
 * so it always shows the saved file, not an unsaved draft).
 *
 * A hidden tab renders none of this: the page's own rAF loops and timers are
 * background work and must stop when the preview is not on screen. Switching
 * back reloads it from disk — a rendered file has no in-page state worth
 * preserving (the code editor keeps its draft because a draft is editable).
 */
export function HtmlPreview({
  path,
  name,
  reloadKey,
  active,
}: {
  path: string;
  name: string;
  reloadKey: number;
  /** False while the tab is hidden — the frame is not mounted then. */
  active: boolean;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    if (!active) return;
    let alive = true;
    setState({ status: "loading" });
    openFilePreview(path)
      .then((url) => {
        if (alive) setState({ status: "ready", url });
      })
      .catch(() => {
        if (alive) setState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [active, path]);

  if (!active) return null;
  if (state.status === "error") {
    return (
      <p role="alert" className="px-4 py-3 text-body-2-regular text-text-secondary">
        {t("files.htmlPreviewUnavailable")}
      </p>
    );
  }
  if (state.status === "loading") return null;
  return (
    <iframe
      key={reloadKey}
      src={state.url}
      title={name}
      sandbox={SANDBOX}
      className="min-h-0 w-full flex-1 border-0"
    />
  );
}
