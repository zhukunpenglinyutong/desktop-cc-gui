import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Copy from "lucide-react/dist/esm/icons/copy";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";
import { copyText } from "@/lib/clipboard";
import { isPathUnder, pathExistsOnDisk } from "@/features/chat/file-link-resolution";
import { resolveFilePath } from "@/lib/fileLinks";
import { ipc } from "@/lib/ipc";

export interface TerminalMenuState {
  x: number;
  y: number;
  /** Terminal selection at right-click time. */
  text: string;
}

/**
 * Right-click menu for terminal selections. Always offers copy; when the
 * selection is a path, adds the same 在访达中显示 entry as chat file links.
 *
 * The reveal entry renders immediately but stays disabled until the async
 * existence probe confirms the path (mirrors FileLinkContextMenu's
 * sync-gate/async-upgrade pattern, so the menu never pops late). Probing is
 * skipped entirely for paths outside the terminal's cwd: listDir on an
 * unregistered root would surface a grant dialog from a context menu, which
 * is worse than a disabled entry. Absolute outside paths still reveal — the
 * explicit click makes the backend's grant prompt acceptable there.
 */
export function TerminalContextMenu({
  menu,
  cwd,
  onClose,
}: {
  menu: TerminalMenuState;
  cwd: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  const isMac = navigator.platform.includes("Mac");
  const isWindows = navigator.platform.includes("Win");
  const revealLabel = isMac
    ? t("files.revealInFinder")
    : isWindows
      ? t("files.revealInExplorer")
      : t("files.revealInFileManager");

  const text = menu.text.trim();
  // A multi-line selection is never a single path; quoting stays (shell
  // output doesn't quote, and resolveFilePath would fail on quotes anyway).
  const resolved = text.includes("\n") ? null : resolveFilePath(text, cwd);
  const [exists, setExists] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    setExists(null);
    if (resolved) {
      if (!isPathUnder(resolved, cwd)) {
        // Outside the workspace the probe itself would pop a grant dialog;
        // the explicit click is consent enough, so enable on the raw path.
        setExists(true);
      } else {
        void pathExistsOnDisk(resolved)
          .then((ok) => {
            if (!cancelled) setExists(ok);
          })
          .catch(() => {
            if (!cancelled) setExists(false);
          });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [resolved, cwd]);

  const entries: ContextMenuEntry[] = [
    {
      id: "copy",
      label: t("terminal.copy"),
      icon: <Copy className="size-4" aria-hidden />,
      onSelect: () => {
        void copyText(menu.text);
      },
    },
  ];
  if (resolved) {
    entries.push({
      id: "reveal",
      label: revealLabel,
      icon: <FolderOpen className="size-4" aria-hidden />,
      // null = still probing; outside-workspace paths skip the probe and
      // enable immediately (see the effect above).
      disabled: exists === null,
      onSelect: () => {
        void ipc.revealInFileManager(resolved).catch(() => {});
      },
    });
  }

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={text}
      entries={entries}
      onClose={onClose}
    />
  );
}
