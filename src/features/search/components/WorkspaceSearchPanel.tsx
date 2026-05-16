import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import SearchIcon from "lucide-react/dist/esm/icons/search";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import {
  searchWorkspaceText,
  type WorkspaceTextSearchFileResult,
  type WorkspaceTextSearchResponse,
} from "../../../services/tauri";

type FileOpenLocation = {
  line: number;
  column: number;
};

type WorkspaceSearchPanelProps = {
  workspaceId: string | null;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  onOpenFile: (path: string, location?: FileOpenLocation) => void;
};

export function WorkspaceSearchPanel({
  workspaceId,
  filePanelMode: _filePanelMode,
  onFilePanelModeChange: _onFilePanelModeChange,
  onOpenFile,
}: WorkspaceSearchPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchWholeWord, setSearchWholeWord] = useState(false);
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchDetailsVisible, setSearchDetailsVisible] = useState(false);
  const [includePattern, setIncludePattern] = useState("");
  const [excludePattern, setExcludePattern] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceTextSearchResponse | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim();
  const isSearchMode = normalizedQuery.length > 0;

  useEffect(() => {
    setQuery("");
    setSearchCaseSensitive(false);
    setSearchWholeWord(false);
    setSearchRegex(false);
    setSearchDetailsVisible(false);
    setIncludePattern("");
    setExcludePattern("");
    setSearchResults(null);
    setSearchLoading(false);
    setSearchError(null);
    setExpandedFiles(new Set());
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isSearchMode) {
      setSearchResults(null);
      setSearchLoading(false);
      setSearchError(null);
      setExpandedFiles(new Set());
      return;
    }

    let cancelled = false;
    setSearchLoading(true);
    setSearchError(null);
    void searchWorkspaceText(workspaceId, {
      query: normalizedQuery,
      caseSensitive: searchCaseSensitive,
      wholeWord: searchWholeWord,
      isRegex: searchRegex,
      includePattern: includePattern.trim() || null,
      excludePattern: excludePattern.trim() || null,
    })
      .then((response) => {
        if (cancelled) return;
        setSearchResults(response);
        setExpandedFiles(new Set(response.files.map((entry) => entry.path)));
      })
      .catch((error) => {
        if (cancelled) return;
        setSearchResults(null);
        setSearchError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setSearchLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    excludePattern,
    includePattern,
    isSearchMode,
    normalizedQuery,
    searchCaseSensitive,
    searchRegex,
    searchWholeWord,
    workspaceId,
  ]);

  const summaryText = useMemo(() => {
    if (!workspaceId) {
      return t("files.selectWorkspaceToSearch");
    }
    if (!isSearchMode) {
      return t("files.searchReady");
    }
    if (searchLoading) {
      return t("files.searching");
    }
    if (searchError) {
      return searchError;
    }
    if (!searchResults) {
      return t("files.searchReady");
    }
    return t("files.searchResultsSummary", {
      files: searchResults.file_count,
      matches: searchResults.match_count,
    });
  }, [isSearchMode, searchError, searchLoading, searchResults, t, workspaceId]);

  const toggleExpanded = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const renderResult = (result: WorkspaceTextSearchFileResult) => {
    const isExpanded = expandedFiles.has(result.path);
    return (
      <div key={result.path} className="workspace-search-result-group flex flex-col gap-0.5">
        <button
          type="button"
          className="workspace-search-result-file w-full border border-transparent bg-transparent text-(--text-emphasis) text-left flex items-center gap-2 py-1 px-1.5 rounded-lg hover:bg-(--surface-hover) hover:border-(--border-subtle) focus-visible:bg-(--surface-hover) focus-visible:border-(--border-subtle)"
          onClick={() => toggleExpanded(result.path)}
        >
          <span className={`file-tree-chevron${isExpanded ? " is-open" : ""}`}>›</span>
          <span className="workspace-search-result-path flex-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs">{result.path}</span>
          <span className="workspace-search-result-count flex-none min-w-5.5 py-px px-1.5 rounded-full bg-[color-mix(in_srgb,var(--surface-hover)_75%,transparent)] text-(--text-faint) text-[11px] text-center">{result.match_count}</span>
        </button>
        {isExpanded ? (
          <div className="workspace-search-result-matches flex flex-col gap-0.5 pl-4.5">
            {result.matches.map((match, index) => (
              <button
                key={`${result.path}-${match.line}-${match.column}-${index}`}
                type="button"
                className="workspace-search-result-match w-full border border-transparent bg-transparent text-(--text-emphasis) text-left grid grid-cols-[56px_minmax(0,1fr)] gap-2 items-start py-1 px-1.5 rounded-lg hover:bg-(--surface-hover) hover:border-(--border-subtle) focus-visible:bg-(--surface-hover) focus-visible:border-(--border-subtle)"
                onClick={() => onOpenFile(result.path, { line: match.line, column: match.column })}
              >
                <span className="workspace-search-result-location text-(--text-faint) text-[11px]">
                  {match.line}:{match.column}
                </span>
                <span className="workspace-search-result-preview min-w-0 text-xs text-(--text-emphasis) whitespace-nowrap overflow-hidden text-ellipsis">{match.preview}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section className="diff-panel workspace-search-panel flex flex-col gap-0 overflow-hidden">
      <div className="workspace-search-body flex flex-col gap-2 min-h-0 flex-1">
        <div className="workspace-search-bar flex items-center gap-2 min-w-0 py-1.5 px-2 rounded-[10px] border border-(--border-subtle) bg-[color-mix(in_srgb,var(--surface-secondary)_86%,transparent)] text-(--text-faint) focus-within:text-(--text-emphasis)">
          <SearchIcon className="workspace-search-icon w-3.5 h-3.5" aria-hidden />
          <input
            className="workspace-search-input flex-auto min-w-0 border-none outline-none bg-transparent text-inherit text-xs"
            type="search"
            placeholder={t("files.filterPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("files.filterPlaceholder")}
            disabled={!workspaceId}
          />
          <button
            type="button"
            className={`ghost workspace-search-option flex-none min-w-6 h-6 py-0 px-1.5 rounded-md border border-transparent text-(--text-faint) text-[11px] hover:text-(--text-emphasis) hover:border-(--border-subtle) hover:bg-(--surface-hover) focus-visible:text-(--text-emphasis) focus-visible:border-(--border-subtle) focus-visible:bg-(--surface-hover)${searchCaseSensitive ? " is-active text-(--text-emphasis) border-(--border-subtle) bg-(--surface-hover)" : ""}`}
            onClick={() => setSearchCaseSensitive((prev) => !prev)}
            aria-label={t("files.matchCase")}
            title={t("files.matchCase")}
            disabled={!workspaceId}
          >
            Aa
          </button>
          <button
            type="button"
            className={`ghost workspace-search-option flex-none min-w-6 h-6 py-0 px-1.5 rounded-md border border-transparent text-(--text-faint) text-[11px] hover:text-(--text-emphasis) hover:border-(--border-subtle) hover:bg-(--surface-hover) focus-visible:text-(--text-emphasis) focus-visible:border-(--border-subtle) focus-visible:bg-(--surface-hover)${searchWholeWord ? " is-active text-(--text-emphasis) border-(--border-subtle) bg-(--surface-hover)" : ""}`}
            onClick={() => setSearchWholeWord((prev) => !prev)}
            aria-label={t("files.matchWholeWord")}
            title={t("files.matchWholeWord")}
            disabled={!workspaceId}
          >
            ab
          </button>
          <button
            type="button"
            className={`ghost workspace-search-option flex-none min-w-6 h-6 py-0 px-1.5 rounded-md border border-transparent text-(--text-faint) text-[11px] hover:text-(--text-emphasis) hover:border-(--border-subtle) hover:bg-(--surface-hover) focus-visible:text-(--text-emphasis) focus-visible:border-(--border-subtle) focus-visible:bg-(--surface-hover)${searchRegex ? " is-active text-(--text-emphasis) border-(--border-subtle) bg-(--surface-hover)" : ""}`}
            onClick={() => setSearchRegex((prev) => !prev)}
            aria-label={t("files.useRegex")}
            title={t("files.useRegex")}
            disabled={!workspaceId}
          >
            .*
          </button>
          <button
            type="button"
            className={`ghost workspace-search-option flex-none min-w-6 h-6 py-0 px-1.5 rounded-md border border-transparent text-(--text-faint) text-[11px] hover:text-(--text-emphasis) hover:border-(--border-subtle) hover:bg-(--surface-hover) focus-visible:text-(--text-emphasis) focus-visible:border-(--border-subtle) focus-visible:bg-(--surface-hover)${searchDetailsVisible ? " is-active text-(--text-emphasis) border-(--border-subtle) bg-(--surface-hover)" : ""}`}
            onClick={() => setSearchDetailsVisible((prev) => !prev)}
            aria-label={t("files.searchDetails")}
            title={t("files.searchDetails")}
            disabled={!workspaceId}
          >
            …
          </button>
        </div>

        {(searchDetailsVisible || isSearchMode) && workspaceId ? (
          <div className="workspace-search-details grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
            <input
              className="workspace-search-details-input min-w-0 h-7.5 rounded-lg border border-(--border-subtle) bg-[color-mix(in_srgb,var(--surface-secondary)_86%,transparent)] text-(--text-emphasis) text-xs py-0 px-2.5 outline-none"
              type="text"
              placeholder={t("files.includePattern")}
              value={includePattern}
              onChange={(event) => setIncludePattern(event.target.value)}
              aria-label={t("files.includePattern")}
            />
            <input
              className="workspace-search-details-input min-w-0 h-7.5 rounded-lg border border-(--border-subtle) bg-[color-mix(in_srgb,var(--surface-secondary)_86%,transparent)] text-(--text-emphasis) text-xs py-0 px-2.5 outline-none"
              type="text"
              placeholder={t("files.excludePattern")}
              value={excludePattern}
              onChange={(event) => setExcludePattern(event.target.value)}
              aria-label={t("files.excludePattern")}
            />
          </div>
        ) : null}

        <div className="workspace-search-summary text-xs text-(--text-faint)">{summaryText}</div>
        {searchResults?.limit_hit ? (
          <div className="workspace-search-limit text-xs text-(--text-warning,#fbbf24)">{t("files.searchLimitReached")}</div>
        ) : null}

        <div className="workspace-search-results flex flex-col gap-1 overflow-y-auto min-h-0 pr-0.5">
          {!workspaceId ? null : !isSearchMode ? null : searchLoading || searchError ? null :
            !searchResults || searchResults.files.length === 0 ? (
              <div className="workspace-search-empty text-xs text-(--text-faint)">{t("files.noMatchesFound")}</div>
            ) : (
              searchResults.files.map((result) => renderResult(result))
            )}
        </div>
      </div>
    </section>
  );
}
