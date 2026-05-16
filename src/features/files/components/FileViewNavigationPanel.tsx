import type { LspLocationLike } from "../utils/fileViewNavigationUtils";
import { relativePathFromFileUri } from "../utils/fileViewNavigationUtils";

type FileViewNavigationPanelProps = {
  workspacePath: string;
  navigationError: string | null;
  definitionCandidates: LspLocationLike[];
  onCloseDefinitionCandidates: () => void;
  referenceResults: LspLocationLike[] | null;
  onCloseReferenceResults: () => void;
  onNavigateToLocation: (location: LspLocationLike) => void;
  t: (key: string) => string;
};

export function FileViewNavigationPanel({
  workspacePath,
  navigationError,
  definitionCandidates,
  onCloseDefinitionCandidates,
  referenceResults,
  onCloseReferenceResults,
  onNavigateToLocation,
  t,
}: FileViewNavigationPanelProps) {
  const hasDefinitionCandidates = definitionCandidates.length > 0;
  const hasReferenceResults = referenceResults !== null;
  if (!navigationError && !hasDefinitionCandidates && !hasReferenceResults) {
    return null;
  }

  const navigationItemCls =
    "fvp-navigation-item w-full border-0 rounded-md bg-transparent text-inherit flex items-center justify-between gap-2.5 py-1.5 px-2 text-left text-[11px] hover:bg-[color-mix(in_srgb,var(--surface-hover)_70%,transparent)]";
  const navigationPathCls =
    "fvp-navigation-path min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-(--text-strong) font-[var(--code-font-family)]";
  const navigationLineCls =
    "fvp-navigation-line text-(--text-faint) font-[var(--code-font-family)] whitespace-nowrap";
  const navigationCloseCls =
    "ghost fvp-navigation-close border border-[color-mix(in_srgb,var(--border-subtle)_70%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control)_85%,transparent)] text-(--text-muted) text-[10px] py-0.5 px-2 leading-[1.2] hover:text-(--text-strong)";
  const navigationHeaderCls =
    "fvp-navigation-header flex items-center justify-between gap-2 py-1.5 px-2 border-b border-b-[color-mix(in_srgb,var(--border-subtle)_70%,transparent)] text-[11px] font-semibold text-(--text-strong)";
  const navigationSectionCls =
    "fvp-navigation-section border border-[color-mix(in_srgb,var(--border-subtle)_84%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control)_68%,transparent)]";
  const navigationListCls = "fvp-navigation-list list-none m-0 p-0";

  return (
    <div className="fvp-navigation-panel shrink-0 border-t border-(--border-subtle) bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)] flex flex-col gap-2 max-h-[min(34vh,260px)] overflow-auto py-2 px-3">
      {navigationError ? (
        <div className="fvp-navigation-error border border-[color-mix(in_srgb,var(--status-error)_65%,var(--border-subtle))] rounded-lg py-2 px-2.5 text-[12px] text-(--status-error) bg-[color-mix(in_srgb,var(--status-error)_10%,transparent)]">{navigationError}</div>
      ) : null}
      {hasDefinitionCandidates ? (
        <div className={navigationSectionCls}>
          <div className={navigationHeaderCls}>
            <span>{t("files.definitionCandidates")}</span>
            <button
              type="button"
              className={navigationCloseCls}
              onClick={onCloseDefinitionCandidates}
            >
              {t("common.close")}
            </button>
          </div>
          <ul className={navigationListCls}>
            {definitionCandidates.map((location, index) => {
              const relativePath = relativePathFromFileUri(location.uri, workspacePath);
              const path = relativePath || location.uri;
              return (
                <li key={`${location.uri}-${location.line}-${location.character}-${index}`}>
                  <button
                    type="button"
                    className={navigationItemCls}
                    onClick={() => onNavigateToLocation(location)}
                  >
                    <span className={navigationPathCls} title={path}>
                      {path}
                    </span>
                    <span className={navigationLineCls}>
                      L{location.line + 1}:C{location.character + 1}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {hasReferenceResults ? (
        <div className={navigationSectionCls}>
          <div className={navigationHeaderCls}>
            <span>{t("files.referenceResults")}</span>
            <button
              type="button"
              className={navigationCloseCls}
              onClick={onCloseReferenceResults}
            >
              {t("common.close")}
            </button>
          </div>
          {referenceResults && referenceResults.length > 0 ? (
            <ul className={navigationListCls}>
              {referenceResults.map((location, index) => {
                const relativePath = relativePathFromFileUri(location.uri, workspacePath);
                const path = relativePath || location.uri;
                return (
                  <li key={`${location.uri}-${location.line}-${location.character}-${index}`}>
                    <button
                      type="button"
                      className={navigationItemCls}
                      onClick={() => onNavigateToLocation(location)}
                    >
                      <span className={navigationPathCls} title={path}>
                        {path}
                      </span>
                      <span className={navigationLineCls}>
                        L{location.line + 1}:C{location.character + 1}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="fvp-navigation-empty py-2 px-2.5 text-[11px] text-(--text-faint)">{t("files.noReferencesFound")}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
