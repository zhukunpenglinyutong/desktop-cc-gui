import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import projectIconUrl from "../../../../icon.png";
import { isComposingEvent } from "../../../utils/keys";
import type { SearchContentFilter, SearchResult, SearchScope } from "../types";
import { cn } from "@/lib/utils";

const scopeLabelClass =
  "search-palette-scope-label inline-flex items-center justify-center px-1.5 py-0.5 rounded-full border border-border text-[11px] font-semibold tracking-tight text-muted-foreground";

const scopeBtnBase =
  "search-palette-scope-btn rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer border-0 bg-transparent text-muted-foreground transition-colors hover:text-foreground";

const scopeBtnActive =
  "is-active text-foreground bg-secondary border border-border";

const contentBtnBase =
  "search-palette-content-btn rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer border border-border bg-card text-muted-foreground transition-colors hover:text-foreground";

const contentBtnActive = "is-active text-foreground bg-secondary";

const resultBaseClass =
  "search-palette-result w-full border-0 bg-transparent text-foreground px-4 py-2.5 text-left flex gap-3 items-start justify-between border-b border-border/60 transition-colors hover:bg-accent";

const resultActiveClass = "is-active bg-accent";

const tagClass =
  "search-palette-result-tag inline-flex items-center max-w-full px-1.5 py-px rounded-full border border-border bg-card text-muted-foreground text-[10px] leading-snug whitespace-nowrap overflow-hidden text-ellipsis";

const kindBadgeClass =
  "search-palette-kind-badge shrink-0 mt-px px-1.5 py-0.5 rounded-full border border-border text-muted-foreground bg-card text-[10px] font-bold tracking-wide";

const INVISIBLE_QUERY_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;

function sanitizeSearchQueryInput(value: string): string {
  return value.replace(INVISIBLE_QUERY_CHARS_REGEX, "");
}

type SearchPaletteProps = {
  isOpen: boolean;
  scope: SearchScope;
  contentFilters: SearchContentFilter[];
  workspaceName?: string | null;
  query: string;
  results: SearchResult[];
  selectedIndex: number;
  onQueryChange: (value: string) => void;
  onMoveSelection: (direction: "up" | "down") => void;
  onSelect: (result: SearchResult) => void;
  onScopeChange: (scope: SearchScope) => void;
  onContentFilterToggle: (filter: SearchContentFilter) => void;
  onClose: () => void;
};

export function SearchPalette({
  isOpen,
  scope,
  contentFilters,
  workspaceName,
  query,
  results,
  selectedIndex,
  onQueryChange,
  onMoveSelection,
  onSelect,
  onScopeChange,
  onContentFilterToggle,
  onClose,
}: SearchPaletteProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const badgeLabelByKind: Record<SearchResult["kind"], string> = {
    file: t("searchPalette.typeFile"),
    kanban: t("searchPalette.typeKanban"),
    thread: t("searchPalette.typeThread"),
    message: t("searchPalette.typeMessage"),
    history: t("searchPalette.typeHistory"),
    skill: t("searchPalette.typeSkill"),
    command: t("searchPalette.typeCommand"),
  };

  const sourceLabelByKind: Record<NonNullable<SearchResult["sourceKind"]>, string> = {
    files: t("searchPalette.sourceFiles"),
    kanban: t("searchPalette.sourceKanban"),
    threads: t("searchPalette.sourceThreads"),
    messages: t("searchPalette.sourceMessages"),
    history: t("searchPalette.sourceHistory"),
    skills: t("searchPalette.sourceSkills"),
    commands: t("searchPalette.sourceCommands"),
  };
  const contentFilterOptions: Array<{
    value: SearchContentFilter;
    label: string;
  }> = [
    { value: "all", label: t("searchPalette.contentAll") },
    { value: "files", label: t("searchPalette.contentFiles") },
    { value: "kanban", label: t("searchPalette.contentKanban") },
    { value: "threads", label: t("searchPalette.contentThreads") },
    { value: "messages", label: t("searchPalette.contentMessages") },
    { value: "history", label: t("searchPalette.contentHistory") },
    { value: "skills", label: t("searchPalette.contentSkills") },
    { value: "commands", label: t("searchPalette.contentCommands") },
  ];
  const selectedContentLabels = contentFilterOptions
    .filter((option) => option.value !== "all" && contentFilters.includes(option.value))
    .map((option) => option.label);
  const placeholderText = selectedContentLabels.length
    ? t("searchPalette.placeholderFiltered", { content: selectedContentLabels.join(" / ") })
    : t("searchPalette.placeholder");
  const normalizedVisibleQuery = sanitizeSearchQueryInput(query);
  const shouldShowResults = normalizedVisibleQuery.trim().length > 0;
  const visibleResults = useMemo(
    () => (shouldShowResults ? results : []),
    [results, shouldShowResults],
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    inputRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      const isRecentlyComposing = Date.now() - lastCompositionEndAtRef.current < 120;
      if (isComposingRef.current || isRecentlyComposing || isComposingEvent(event)) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        onMoveSelection("down");
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        onMoveSelection("up");
        return;
      }
      if (event.key === "Enter") {
        if (!visibleResults.length || selectedIndex < 0 || selectedIndex >= visibleResults.length) {
          return;
        }
        event.preventDefault();
        const selectedResult = visibleResults[selectedIndex];
        if (selectedResult) {
          onSelect(selectedResult);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, onMoveSelection, onSelect, selectedIndex, visibleResults]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={cn(
        "search-palette-overlay fixed inset-0 z-[2100]",
        "bg-black/30 backdrop-blur-md",
        "flex items-start justify-center pt-16 px-5 pb-5",
      )}
      onClick={onClose}
      role="presentation"
    >
      <div
        className={cn(
          "search-palette w-full max-w-[760px] rounded-2xl overflow-hidden",
          "border border-border bg-popover text-popover-foreground",
          "shadow-2xl",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="search-palette-top-accent h-[3px] bg-gradient-to-r from-transparent via-border to-transparent" />
        <div
          className={cn(
            "search-palette-input-row flex items-center gap-2.5 px-3.5",
            "border-b border-border bg-card/60",
          )}
        >
          <span
            className="search-palette-search-icon text-muted-foreground text-[15px] leading-none"
            aria-hidden="true"
          >
            ⌕
          </span>
          <input
            ref={inputRef}
            className="search-palette-input w-full bg-transparent border-0 outline-none py-3.5 text-sm text-foreground placeholder:text-muted-foreground/70"
            placeholder={placeholderText}
            aria-label={t("searchPalette.inputAria")}
            value={query}
            onChange={(event) => onQueryChange(sanitizeSearchQueryInput(event.target.value))}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
              onQueryChange(sanitizeSearchQueryInput(event.currentTarget.value));
            }}
          />
          <span
            className="search-palette-project-icon-box inline-flex items-center justify-center p-[3px] rounded-lg border border-border bg-secondary/50 shrink-0"
            aria-hidden="true"
          >
            <img
              className="search-palette-project-icon size-[26px] rounded-md object-cover shrink-0"
              src={projectIconUrl}
              alt=""
            />
          </span>
        </div>
        <div
          className={cn(
            "search-palette-scope flex items-center flex-wrap gap-2.5 px-4 py-2",
            "border-b border-border bg-muted/40",
          )}
        >
          <span className={scopeLabelClass}>{t("searchPalette.scope")}</span>
          <div
            className={cn(
              "search-palette-scope-toggle inline-flex items-center gap-1.5 p-0.5",
              "rounded-full border border-border bg-card/70",
            )}
            role="group"
            aria-label={t("searchPalette.scope")}
          >
            <button
              type="button"
              className={cn(
                scopeBtnBase,
                scope === "active-workspace" && scopeBtnActive,
              )}
              onClick={() => onScopeChange("active-workspace")}
            >
              {t("searchPalette.current")}
            </button>
            <button
              type="button"
              className={cn(scopeBtnBase, scope === "global" && scopeBtnActive)}
              onClick={() => onScopeChange("global")}
            >
              {t("searchPalette.global")}
            </button>
          </div>
          <span className="search-palette-scope-value text-xs text-muted-foreground">
            {scope === "active-workspace"
              ? `${t("searchPalette.currentWorkspace")}${workspaceName ? ` (${workspaceName})` : ""}`
              : t("searchPalette.allWorkspaces")}
          </span>
        </div>
        <div
          className={cn(
            "search-palette-content flex items-center gap-2.5 px-4 py-2",
            "border-b border-border bg-card/30",
          )}
        >
          <span className={scopeLabelClass}>{t("searchPalette.content")}</span>
          <div
            className="search-palette-content-toggle inline-flex items-center gap-1.5 flex-wrap"
            role="group"
            aria-label={t("searchPalette.content")}
          >
            {contentFilterOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  contentBtnBase,
                  contentFilters.includes(option.value) && contentBtnActive,
                )}
                onClick={() => onContentFilterToggle(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="search-palette-results max-h-[min(56vh,520px)] overflow-auto">
          {visibleResults.length === 0 ? (
            <div className="search-palette-empty px-4 pt-4 pb-5">
              <div className="search-palette-empty-title text-foreground/80 text-[13px] font-semibold">
                {t("searchPalette.noResults")}
              </div>
              <div className="search-palette-empty-hint mt-1.5 text-muted-foreground text-xs leading-tight">
                {t("searchPalette.noResultsHint")}
              </div>
            </div>
          ) : (
            visibleResults.map((result, index) => (
              <button
                key={result.id}
                type="button"
                className={cn(resultBaseClass, index === selectedIndex && resultActiveClass)}
                onClick={() => onSelect(result)}
              >
                <span className="search-palette-result-main min-w-0 flex flex-col gap-1">
                  <span className="search-palette-result-title block text-[13px] text-foreground truncate">
                    {result.title}
                  </span>
                  {result.subtitle ? (
                    <span className="search-palette-result-subtitle text-muted-foreground text-[11px] leading-tight truncate">
                      {result.subtitle}
                    </span>
                  ) : null}
                  <span className="search-palette-result-tags flex flex-wrap gap-1.5 mt-1">
                    {result.workspaceName ? (
                      <span className={tagClass}>
                        {t("searchPalette.projectTag")}: {result.workspaceName}
                      </span>
                    ) : null}
                    <span className={tagClass}>
                      {t("searchPalette.typeTag")}: {badgeLabelByKind[result.kind]}
                    </span>
                    {result.sourceKind ? (
                      <span className={tagClass}>
                        {t("searchPalette.sourceTag")}: {sourceLabelByKind[result.sourceKind]}
                      </span>
                    ) : null}
                    {result.locationLabel ? (
                      <span className={tagClass}>
                        {t("searchPalette.locationTag")}: {result.locationLabel}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className={cn(kindBadgeClass, `search-kind-${result.kind}`)}>
                  {badgeLabelByKind[result.kind]}
                </span>
              </button>
            ))
          )}
        </div>
        <div
          className={cn(
            "search-palette-footer flex items-center gap-4 px-3 py-2",
            "border-t border-border text-muted-foreground text-[11px] bg-muted/40",
          )}
        >
          <span className="search-palette-key-hint inline-flex items-center gap-1.5">
            <kbd className="min-w-[22px] px-1.5 py-px rounded-md border border-border bg-card text-foreground/80 text-[10px] font-semibold text-center">
              ↑↓
            </kbd>{" "}
            {t("searchPalette.navigate")}
          </span>
          <span className="search-palette-key-hint inline-flex items-center gap-1.5">
            <kbd className="min-w-[22px] px-1.5 py-px rounded-md border border-border bg-card text-foreground/80 text-[10px] font-semibold text-center">
              Enter
            </kbd>{" "}
            {t("searchPalette.open")}
          </span>
          <span className="search-palette-key-hint inline-flex items-center gap-1.5">
            <kbd className="min-w-[22px] px-1.5 py-px rounded-md border border-border bg-card text-foreground/80 text-[10px] font-semibold text-center">
              Esc
            </kbd>{" "}
            {t("searchPalette.close")}
          </span>
        </div>
      </div>
    </div>
  );
}
