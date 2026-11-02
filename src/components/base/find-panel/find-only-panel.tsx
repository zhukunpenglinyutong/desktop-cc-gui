import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import X from "lucide-react/dist/esm/icons/x";
import { cx } from "@/utils/cx";
import {
  FIND_FIELD_CLASS,
  FIND_ICON_BUTTON_CLASS,
  FIND_INPUT_CLASS,
  FIND_PANEL_ANIMATION_CLASS,
  FIND_PANEL_CARD_CLASS,
  findToggleClass,
  keepFindInputFocus,
} from "./find-panel-ui";

export interface FindOnlyPanelProps {
  inputRef: MutableRefObject<HTMLInputElement | null>;
  /** Surface-specific placeholder, e.g. "Search conversation". */
  placeholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  caseSensitive: boolean;
  onCaseSensitiveChange: (value: boolean) => void;
  wholeWord: boolean;
  onWholeWordChange: (value: boolean) => void;
  useRegex: boolean;
  onUseRegexChange: (value: boolean) => void;
  /** 1-based current match; 0 when there is no match. */
  current: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/**
 * Find-only version of the editor find card, shared by read-only surfaces
 * (Markdown preview, chat timeline). It keeps the same visual tokens as
 * `EditorSearchPanel` but has no replace row/chevron.
 */
export function FindOnlyPanel({
  inputRef,
  placeholder,
  query,
  onQueryChange,
  caseSensitive,
  onCaseSensitiveChange,
  wholeWord,
  onWholeWordChange,
  useRegex,
  onUseRegexChange,
  current,
  total,
  onPrev,
  onNext,
  onClose,
}: FindOnlyPanelProps) {
  const { t } = useTranslation();
  const hasQuery = query.length > 0;
  const noMatches = hasQuery && total === 0;
  const statusText =
    hasQuery && total > 0
      ? `${current}/${total}`
      : t("files.editorSearch.noResults");

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.shiftKey) onPrev();
      else onNext();
    }
  };

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <div
      role="search"
      aria-label={t("files.editorSearch.find")}
      onKeyDown={handlePanelKeyDown}
      className={cx(FIND_PANEL_CARD_CLASS, FIND_PANEL_ANIMATION_CLASS)}
    >
      <div className="flex items-center gap-1">
        <div className={FIND_FIELD_CLASS}>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleInputKeyDown}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={placeholder}
            aria-label={placeholder}
            className={FIND_INPUT_CLASS}
          />
          <button
            type="button"
            className={findToggleClass(caseSensitive)}
            onClick={() => onCaseSensitiveChange(!caseSensitive)}
            onMouseDown={keepFindInputFocus}
            aria-pressed={caseSensitive}
            aria-label={t("files.editorSearch.caseSensitive")}
            title={t("files.editorSearch.caseSensitive")}
          >
            Aa
          </button>
          <button
            type="button"
            className={findToggleClass(wholeWord)}
            onClick={() => onWholeWordChange(!wholeWord)}
            onMouseDown={keepFindInputFocus}
            aria-pressed={wholeWord}
            aria-label={t("files.editorSearch.wholeWord")}
            title={t("files.editorSearch.wholeWord")}
          >
            W
          </button>
          <button
            type="button"
            className={cx(findToggleClass(useRegex), "mr-1 font-mono")}
            onClick={() => onUseRegexChange(!useRegex)}
            onMouseDown={keepFindInputFocus}
            aria-pressed={useRegex}
            aria-label={t("files.editorSearch.regex")}
            title={t("files.editorSearch.regex")}
          >
            .*
          </button>
        </div>
        <span
          role="status"
          aria-live="polite"
          className={cx(
            "min-w-[3.4rem] shrink-0 text-center text-caption-1-regular",
            noMatches ? "text-text-error-primary" : "text-text-tertiary",
          )}
        >
          {statusText}
        </span>
        <button
          type="button"
          className={FIND_ICON_BUTTON_CLASS}
          onClick={onPrev}
          onMouseDown={keepFindInputFocus}
          disabled={!hasQuery || total === 0}
          aria-label={t("files.editorSearch.previousMatch")}
          title={t("files.editorSearch.previousMatch")}
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className={FIND_ICON_BUTTON_CLASS}
          onClick={onNext}
          onMouseDown={keepFindInputFocus}
          disabled={!hasQuery || total === 0}
          aria-label={t("files.editorSearch.nextMatch")}
          title={t("files.editorSearch.nextMatch")}
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          className={FIND_ICON_BUTTON_CLASS}
          onClick={onClose}
          onMouseDown={keepFindInputFocus}
          aria-label={t("files.editorSearch.close")}
          title={t("files.editorSearch.close")}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
