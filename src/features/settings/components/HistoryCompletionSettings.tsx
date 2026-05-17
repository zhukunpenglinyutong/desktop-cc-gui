/**
 * History completion management section for the settings page.
 *
 * Provides UI to browse, add, edit, and delete history items
 * used by the inline history completion feature.
 */

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  loadHistoryWithImportance,
  deleteHistoryItem,
  clearAllHistory,
  addHistoryItem,
  updateHistoryItem,
  clearLowImportanceHistory,
  type HistoryItem,
} from "../../composer/hooks/useInputHistoryStore";
import { HistoryItemEditor } from "./HistoryItemEditor";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Plus from "lucide-react/dist/esm/icons/plus";
import Filter from "lucide-react/dist/esm/icons/filter";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import X from "lucide-react/dist/esm/icons/x";
import Inbox from "lucide-react/dist/esm/icons/inbox";

interface EditorState {
  isOpen: boolean;
  mode: "add" | "edit";
  item?: HistoryItem;
}

export function HistoryCompletionSettings() {
  const { t } = useTranslation();
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [showList, setShowList] = useState(false);
  const [editorState, setEditorState] = useState<EditorState>({
    isOpen: false,
    mode: "add",
  });

  const reloadHistory = useCallback(() => {
    try {
      setHistoryItems(loadHistoryWithImportance());
    } catch {
      setHistoryItems([]);
    }
  }, []);

  useEffect(() => {
    if (showList) {
      reloadHistory();
    }
  }, [showList, reloadHistory]);

  const handleDeleteItem = useCallback((item: HistoryItem) => {
    try {
      deleteHistoryItem(item.text);
      setHistoryItems((prev) => prev.filter((i) => i.text !== item.text));
    } catch {
      // ignore
    }
  }, []);

  const handleClearAll = useCallback(() => {
    try {
      clearAllHistory();
      setHistoryItems([]);
    } catch {
      // ignore
    }
  }, []);

  const handleClearLowImportance = useCallback(() => {
    try {
      const deleted = clearLowImportanceHistory(1);
      if (deleted > 0) {
        reloadHistory();
      }
    } catch {
      // ignore
    }
  }, [reloadHistory]);

  const handleSaveEditor = useCallback(
    (text: string, importance: number) => {
      try {
        if (editorState.mode === "add") {
          addHistoryItem(text, importance);
        } else if (editorState.item) {
          updateHistoryItem(editorState.item.text, text, importance);
        }
        reloadHistory();
      } catch {
        // ignore
      }
    },
    [editorState.mode, editorState.item, reloadHistory],
  );

  const lowImportanceCount = historyItems.filter(
    (item) => item.importance <= 1,
  ).length;

  return (
    <>
      <button
        type="button"
        className="history-expand-btn flex items-center gap-1.5 bg-none border-none text-(--text-muted) cursor-pointer py-1 px-0 text-[13px]"
        onClick={() => setShowList(!showList)}
      >
        {showList ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{t("settings.historyManageTitle")}</span>
        {historyItems.length > 0 && showList && (
          <span className="history-count-badge text-xs text-(--text-muted) opacity-70">({historyItems.length})</span>
        )}
      </button>

      {showList && (
        <div className="history-list-container mt-2 border border-(--border-muted) rounded-lg p-2 max-h-80 overflow-y-auto">
          {historyItems.length === 0 ? (
            <>
              <div className="history-empty flex items-center justify-center gap-2 p-4 text-(--text-muted) text-[13px]">
                <Inbox size={16} />
                <span>{t("settings.historyManageEmpty")}</span>
              </div>
              <div className="history-list-actions flex items-center gap-2 mb-2 flex-wrap">
                <button
                  type="button"
                  className="history-action-btn inline-flex items-center gap-1 bg-none border border-(--border-muted) rounded-md text-(--text-muted) cursor-pointer py-1 px-2 text-xs"
                  onClick={() =>
                    setEditorState({ isOpen: true, mode: "add" })
                  }
                >
                  <Plus size={12} />
                  <span>{t("settings.historyAdd")}</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="history-list-actions flex items-center gap-2 mb-2 flex-wrap">
                <button
                  type="button"
                  className="history-action-btn inline-flex items-center gap-1 bg-none border border-(--border-muted) rounded-md text-(--text-muted) cursor-pointer py-1 px-2 text-xs"
                  onClick={() =>
                    setEditorState({ isOpen: true, mode: "add" })
                  }
                >
                  <Plus size={12} />
                  <span>{t("settings.historyAdd")}</span>
                </button>
                <div className="history-list-actions-spacer flex-1" />
                {lowImportanceCount > 0 && (
                  <button
                    type="button"
                    className="history-action-btn inline-flex items-center gap-1 bg-none border border-(--border-muted) rounded-md text-(--text-muted) cursor-pointer py-1 px-2 text-xs"
                    onClick={handleClearLowImportance}
                  >
                    <Filter size={12} />
                    <span>
                      {t("settings.historyClearLow")} ({lowImportanceCount})
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="history-action-btn history-action-btn--danger inline-flex items-center gap-1 bg-none border border-(--border-muted) rounded-md cursor-pointer py-1 px-2 text-xs text-(--text-error)"
                  onClick={handleClearAll}
                >
                  <Trash2 size={12} />
                  <span>{t("settings.historyClearAll")}</span>
                </button>
              </div>
              <ul className="history-list list-none p-0 m-0 flex flex-col gap-0.5">
                {historyItems.map((item, index) => (
                  <li
                    key={`${item.text}-${index}`}
                    className="history-item flex items-center gap-2 py-1.5 px-2 rounded"
                  >
                    <span
                      className="history-importance-badge text-xs font-semibold text-(--text-accent) whitespace-nowrap min-w-7.5"
                      title={t("settings.historyImportance")}
                    >
                      [{item.importance}]
                    </span>
                    <span className="history-item-text flex-1 text-[13px] text-(--text-default) overflow-hidden text-ellipsis whitespace-nowrap" title={item.text}>
                      {item.text}
                    </span>
                    <div className="history-item-actions">
                      <button
                        type="button"
                        className="history-item-btn inline-flex items-center justify-center w-6 h-6 border-none bg-none rounded cursor-pointer text-(--text-muted)"
                        onClick={() =>
                          setEditorState({
                            isOpen: true,
                            mode: "edit",
                            item,
                          })
                        }
                        title={t("common.edit")}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className="history-item-btn history-item-btn--delete inline-flex items-center justify-center w-6 h-6 border-none bg-none rounded cursor-pointer text-(--text-muted)"
                        onClick={() => handleDeleteItem(item)}
                        title={t("common.delete")}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <HistoryItemEditor
        isOpen={editorState.isOpen}
        onClose={() => setEditorState((prev) => ({ ...prev, isOpen: false }))}
        onSave={handleSaveEditor}
        mode={editorState.mode}
        initialText={editorState.item?.text}
        initialImportance={editorState.item?.importance}
      />
    </>
  );
}
