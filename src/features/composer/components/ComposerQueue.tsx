import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  clampRendererContextMenuPosition,
  RendererContextMenu,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import type { QueuedMessage } from "../../../types";

type ComposerQueueProps = {
  queuedMessages: QueuedMessage[];
  onEditQueued?: (item: QueuedMessage) => void;
  onDeleteQueued?: (id: string) => void;
};

export function ComposerQueue({
  queuedMessages,
  onEditQueued,
  onDeleteQueued,
}: ComposerQueueProps) {
  const { t } = useTranslation();
  const [queueMenu, setQueueMenu] = useState<RendererContextMenuState | null>(null);
  const handleQueueMenu = useCallback(
    (event: React.MouseEvent, item: QueuedMessage) => {
      event.preventDefault();
      event.stopPropagation();
      const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
        width: 220,
        height: 120,
      });
      setQueueMenu({
        ...position,
        label: t("composer.queue"),
        items: [
          {
            type: "item",
            id: "edit",
            label: t("composer.editQueued"),
            onSelect: () => onEditQueued?.(item),
          },
          {
            type: "item",
            id: "delete",
            label: t("composer.deleteQueued"),
            tone: "danger",
            onSelect: () => onDeleteQueued?.(item.id),
          },
        ],
      });
    },
    [t, onDeleteQueued, onEditQueued],
  );

  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className="composer-queue flex flex-col gap-[6px] rounded-[10px] border border-[var(--border-muted)] bg-card px-2 py-[6px]">
      <div className="composer-queue-title text-[10px] uppercase tracking-[0.1em] text-[var(--text-fainter)]">
        {t("composer.queue")}
      </div>
      <div className="composer-queue-list flex flex-col gap-1">
        {queuedMessages.map((item) => (
          <div
            key={item.id}
            className="composer-queue-item flex items-center gap-2 rounded-lg bg-[var(--surface-item)] px-[6px] py-1 text-[11px] text-[var(--text-quiet)]"
          >
            <span className="composer-queue-text flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
              {item.text ||
                (item.images?.length
                  ? item.images.length === 1
                    ? "Image"
                    : "Images"
                  : "")}
              {item.images?.length
                ? ` · ${item.images.length} image${item.images.length === 1 ? "" : "s"}`
                : ""}
            </span>
            <button
              className="composer-queue-menu cursor-pointer border-none bg-transparent px-1 py-0.5 text-[11px] text-[var(--text-faint)] hover:text-[var(--text-stronger)]"
              onClick={(event) => handleQueueMenu(event, item)}
              aria-label="Queue item menu"
            >
              ...
            </button>
          </div>
        ))}
      </div>
      {queueMenu ? (
        <RendererContextMenu
          menu={queueMenu}
          onClose={() => setQueueMenu(null)}
          className="renderer-context-menu composer-queue-context-menu"
        />
      ) : null}
    </div>
  );
}
