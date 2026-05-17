import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isComposingEvent } from "../../../utils/keys";
import type { SearchContentFilter, SearchResult, SearchScope } from "../types";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";

const scopeLabelClass =
  "search-palette-scope-label inline-flex items-center justify-center px-1.5 py-0.5 rounded-full border border-border text-[11px] font-semibold tracking-tight text-muted-foreground";

const scopeBtnBase =
  "search-palette-scope-btn rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer border-0 bg-transparent text-muted-foreground transition-colors hover:text-foreground";

const scopeBtnActive =
  "is-active text-foreground bg-secondary border border-border";

const contentBtnBase =
  "search-palette-content-btn rounded-full px-2.5 py-0.5 text-[11px] font-semibold cursor-pointer border border-border bg-card text-muted-foreground transition-colors hover:text-foreground";

const contentBtnActive = "is-active text-foreground bg-secondary";

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
  onSelect,
  onScopeChange,
  onContentFilterToggle,
  onClose,
}: SearchPaletteProps) {
  const { t } = useTranslation();
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
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

  const fallbackResult =
    visibleResults.find((result) => result.id === highlightedId) ??
    visibleResults[selectedIndex] ??
    visibleResults[0] ??
    null;

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      const isRecentlyComposing = Date.now() - lastCompositionEndAtRef.current < 120;
      if (isComposingRef.current || isRecentlyComposing || isComposingEvent(event)) {
        return;
      }
      if (event.key === "Enter" && fallbackResult) {
        event.preventDefault();
        onSelect(fallbackResult);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, fallbackResult, onSelect]);

  return (
    <CommandDialog open={isOpen} onOpenChange={(open) => (open ? undefined : onClose())}>
      <CommandDialogPopup className="search-palette w-full max-w-[760px]">
        <Command
          mode="none"
          value={query}
          onValueChange={(value) => onQueryChange(sanitizeSearchQueryInput(value))}
          onItemHighlighted={(highlighted) => {
            setHighlightedId(
              typeof highlighted === "string" ? highlighted : null,
            );
          }}
        >
          <CommandInput
            placeholder={placeholderText}
            aria-label={t("searchPalette.inputAria")}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
            }}
          />

          <div
            className={cn(
              "search-palette-scope flex items-center flex-wrap gap-2.5 px-4 py-2",
              "border-t border-border bg-muted/40",
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
              "border-t border-border bg-card/30",
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

          <CommandList className="border-t border-border max-h-[min(56vh,520px)]">
            <CommandEmpty>
              <div className="search-palette-empty px-4 pt-4 pb-5">
                <div className="search-palette-empty-title text-foreground/80 text-[13px] font-semibold">
                  {t("searchPalette.noResults")}
                </div>
                <div className="search-palette-empty-hint mt-1.5 text-muted-foreground text-xs leading-tight">
                  {t("searchPalette.noResultsHint")}
                </div>
              </div>
            </CommandEmpty>
            {visibleResults.map((result) => (
              <CommandItem
                key={result.id}
                value={result.id}
                className="search-palette-result flex gap-3 items-start justify-between"
                onClick={(event) => {
                  event.preventDefault();
                  onSelect(result);
                }}
              >
                <span className="search-palette-result-main min-w-0 flex flex-col gap-1 flex-1">
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
              </CommandItem>
            ))}
          </CommandList>

          <CommandFooter>
            <span className="search-palette-key-hint inline-flex items-center gap-1.5">
              <Kbd>↑↓</Kbd>
              {t("searchPalette.navigate")}
            </span>
            <span className="search-palette-key-hint inline-flex items-center gap-1.5">
              <Kbd>Enter</Kbd>
              {t("searchPalette.open")}
            </span>
            <span className="search-palette-key-hint inline-flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              {t("searchPalette.close")}
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
