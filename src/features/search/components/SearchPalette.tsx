import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { isComposingEvent } from "../../../utils/keys";
import type { SearchContentFilter, SearchResult, SearchScope } from "../types";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";

const INVISIBLE_QUERY_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;

const KIND_GROUP_ORDER: SearchResult["kind"][] = [
  "file",
  "kanban",
  "thread",
  "message",
  "history",
  "skill",
  "command",
];

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
  workspaceName,
  query,
  results,
  selectedIndex,
  onQueryChange,
  onSelect,
  onScopeChange,
  onClose,
}: SearchPaletteProps) {
  const { t } = useTranslation();
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  const groupLabelByKind: Record<SearchResult["kind"], string> = {
    file: t("searchPalette.typeFile"),
    kanban: t("searchPalette.typeKanban"),
    thread: t("searchPalette.typeThread"),
    message: t("searchPalette.typeMessage"),
    history: t("searchPalette.typeHistory"),
    skill: t("searchPalette.typeSkill"),
    command: t("searchPalette.typeCommand"),
  };

  const normalizedVisibleQuery = sanitizeSearchQueryInput(query);
  const shouldShowResults = normalizedVisibleQuery.trim().length > 0;
  const visibleResults = useMemo(
    () => (shouldShowResults ? results : []),
    [results, shouldShowResults],
  );

  const groupedResults = useMemo(() => {
    const groups = new Map<SearchResult["kind"], SearchResult[]>();
    for (const result of visibleResults) {
      const bucket = groups.get(result.kind);
      if (bucket) {
        bucket.push(result);
      } else {
        groups.set(result.kind, [result]);
      }
    }
    return KIND_GROUP_ORDER.filter((kind) => groups.has(kind)).map((kind) => ({
      kind,
      items: groups.get(kind) ?? [],
    }));
  }, [visibleResults]);

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

  const scopeLabel =
    scope === "active-workspace"
      ? t("searchPalette.current")
      : t("searchPalette.global");
  const scopeTitle =
    scope === "active-workspace"
      ? `${t("searchPalette.scope")}: ${t("searchPalette.currentWorkspace")}${workspaceName ? ` (${workspaceName})` : ""}`
      : `${t("searchPalette.scope")}: ${t("searchPalette.allWorkspaces")}`;

  return (
    <CommandDialog open={isOpen} onOpenChange={(open) => (open ? undefined : onClose())}>
      <CommandDialogPopup className="search-palette">
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
          <div className="relative">
            <CommandInput
              placeholder={t("searchPalette.placeholder")}
              aria-label={t("searchPalette.inputAria")}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
                lastCompositionEndAtRef.current = Date.now();
              }}
            />
            <button
              type="button"
              className="absolute end-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
              onClick={() =>
                onScopeChange(
                  scope === "active-workspace" ? "global" : "active-workspace",
                )
              }
              title={scopeTitle}
              aria-label={scopeTitle}
            >
              {scopeLabel}
            </button>
          </div>

          <CommandList>
            <CommandEmpty>
              <div className="px-4 text-center">
                <div className="text-foreground/80 text-[13px] font-semibold">
                  {t("searchPalette.noResults")}
                </div>
                <div className="mt-1.5 text-muted-foreground text-xs leading-tight">
                  {t("searchPalette.noResultsHint")}
                </div>
              </div>
            </CommandEmpty>
            {groupedResults.map((group) => (
              <CommandGroup key={group.kind}>
                <CommandGroupLabel>{groupLabelByKind[group.kind]}</CommandGroupLabel>
                {group.items.map((result) => (
                  <CommandItem
                    key={result.id}
                    value={result.id}
                    onClick={(event) => {
                      event.preventDefault();
                      onSelect(result);
                    }}
                  >
                    <span className="flex-1 truncate">{result.title}</span>
                    {result.workspaceName && scope === "global" ? (
                      <CommandShortcut className="font-sans tracking-normal text-[11px] text-muted-foreground/72">
                        {result.workspaceName}
                      </CommandShortcut>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>

          <CommandFooter>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>↑↓</Kbd>
              {t("searchPalette.navigate")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Enter</Kbd>
              {t("searchPalette.open")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Kbd>Esc</Kbd>
              {t("searchPalette.close")}
            </span>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  );
}
