import X from "lucide-react/dist/esm/icons/x";
import CircleX from "lucide-react/dist/esm/icons/circle-x";
import Columns2 from "lucide-react/dist/esm/icons/columns-2";
import Rows2 from "lucide-react/dist/esm/icons/rows-2";
import ArrowLeftToLine from "lucide-react/dist/esm/icons/arrow-left-to-line";
import ArrowRightToLine from "lucide-react/dist/esm/icons/arrow-right-to-line";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import MessageSquarePlus from "lucide-react/dist/esm/icons/message-square-plus";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import { useTranslation } from "react-i18next";
import { ContextMenu, type ContextMenuEntry } from "@/components/context-menu";
import { useSplitStore, openSessionBeside } from "../split/store";
import { useChatStore } from "../store";
import { copyText } from "@/lib/clipboard";
import { ipc } from "@/lib/ipc";
import type { SessionTabItem } from "./SessionTab";

/**
 * Tab right-click context menu offering:
 * - Batch close actions: Close Inactive, Close Left, Close Right, Close All
 * - Conversation split actions (for session tabs): Split Right, Split Down, Unsplit
 * - File actions (for file tabs): Copy Path, Send Path to Composer, Reveal in Explorer/Finder
 */
export function TabStripContextMenu({
  menu,
  tabs,
  onCloseAll,
  onCloseInactive,
  onCloseLeft,
  onCloseRight,
  onDismiss,
}: {
  /** Anchor position and target tab; null when the menu is closed. */
  menu: { x: number; y: number; tab: SessionTabItem } | null;
  tabs: SessionTabItem[];
  onCloseAll?: () => void;
  onCloseInactive?: (targetKey?: string) => void;
  onCloseLeft?: (targetKey: string) => void;
  onCloseRight?: (targetKey: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const split = useSplitStore((s) => s.root !== null);
  const resetLayout = useSplitStore((s) => s.resetLayout);

  if (!menu) return null;

  const targetTab = menu.tab;
  const targetIndex = tabs.findIndex((item) => item.key === targetTab.key);
  const isSession = Boolean(targetTab.session);
  const isFile = targetTab.key.startsWith("file:");

  const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");
  const isWindows = typeof navigator !== "undefined" && navigator.platform.includes("Win");
  const revealLabel = isMac
    ? t("files.revealInFinder")
    : isWindows
      ? t("files.revealInExplorer")
      : t("files.revealInFileManager");

  const closeEntries: ContextMenuEntry[] = [];
  if (onCloseInactive) {
    closeEntries.push({
      id: "close-inactive",
      label: t("chat.closeInactiveTabs"),
      icon: <CircleX className="size-4" aria-hidden />,
      disabled: tabs.length <= 1,
      onSelect: () => {
        const latestIndex = tabs.findIndex((item) => item.key === targetTab.key);
        if (latestIndex < 0) return;
        onCloseInactive(targetTab.key);
      },
    });
  }
  if (onCloseLeft) {
    closeEntries.push({
      id: "close-left",
      label: t("chat.closeLeftTabs"),
      icon: <ArrowLeftToLine className="size-4" aria-hidden />,
      disabled: targetIndex <= 0,
      onSelect: () => {
        const latestIndex = tabs.findIndex((item) => item.key === targetTab.key);
        if (latestIndex <= 0) return;
        onCloseLeft(targetTab.key);
      },
    });
  }
  if (onCloseRight) {
    closeEntries.push({
      id: "close-right",
      label: t("chat.closeRightTabs"),
      icon: <ArrowRightToLine className="size-4" aria-hidden />,
      disabled: targetIndex < 0 || targetIndex >= tabs.length - 1,
      onSelect: () => {
        const latestIndex = tabs.findIndex((item) => item.key === targetTab.key);
        if (latestIndex < 0 || latestIndex >= tabs.length - 1) return;
        onCloseRight(targetTab.key);
      },
    });
  }
  if (onCloseAll) {
    closeEntries.push({
      id: "close-all",
      label: t("chat.closeAllTabs"),
      icon: <X className="size-4" aria-hidden />,
      onSelect: onCloseAll,
    });
  }

  const splitEntries: ContextMenuEntry[] = [];
  if (isSession && targetTab.session) {
    splitEntries.push(
      {
        id: "split-right",
        label: t("chat.splitRight"),
        icon: <Columns2 className="size-4" aria-hidden />,
        onSelect: () => openSessionBeside(targetTab.session!, "right"),
      },
      {
        id: "split-down",
        label: t("chat.splitDown"),
        icon: <Rows2 className="size-4" aria-hidden />,
        onSelect: () => openSessionBeside(targetTab.session!, "bottom"),
      },
    );
  }
  if (split) {
    splitEntries.push({
      id: "reset-split",
      label: t("chat.unsplit"),
      icon: <Columns2 className="size-4" aria-hidden />,
      onSelect: resetLayout,
    });
  }

  const fileEntries: ContextMenuEntry[] = [];
  if (isFile) {
    const filePath = targetTab.title ?? targetTab.key.slice("file:".length);
    fileEntries.push(
      {
        id: "copy-path",
        label: t("files.copyPath"),
        icon: <Link2 className="size-4" aria-hidden />,
        onSelect: () => {
          void copyText(filePath);
        },
      },
      {
        id: "send-path",
        label: t("files.sendPathToComposer"),
        icon: <MessageSquarePlus className="size-4" aria-hidden />,
        onSelect: () => {
          useChatStore.getState().requestMention(filePath);
        },
      },
      {
        id: "reveal",
        label: revealLabel,
        icon: <FolderOpen className="size-4" aria-hidden />,
        onSelect: () => {
          void ipc.revealInFileManager(filePath).catch(() => {});
        },
      },
    );
  }

  const entries: (ContextMenuEntry | "separator")[] = [];
  if (closeEntries.length > 0) {
    entries.push(...closeEntries);
  }
  if (splitEntries.length > 0) {
    if (entries.length > 0) entries.push("separator");
    entries.push(...splitEntries);
  }
  if (fileEntries.length > 0) {
    if (entries.length > 0) entries.push("separator");
    entries.push(...fileEntries);
  }

  if (entries.length === 0) return null;

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      ariaLabel={t("chat.closeAllTabs")}
      entries={entries}
      onClose={onDismiss}
    />
  );
}
