import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import CircleX from "lucide-react/dist/esm/icons/circle-x";
import CloudUpload from "lucide-react/dist/esm/icons/cloud-upload";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import Hash from "lucide-react/dist/esm/icons/hash";
import Info from "lucide-react/dist/esm/icons/info";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";

type WorktreeBaseRefOption = {
  name: string;
  group: "local" | "origin" | "upstream" | "remote";
  shortSha: string | null;
};

const BASE_REF_GROUP_ORDER = ["upstream", "origin", "local", "remote"] as const;
const ROOT_BUCKET_KEY = "__root__";

type BaseRefBucketOption = {
  option: WorktreeBaseRefOption;
  shortName: string;
  relativePath: string;
};

type BaseRefBucket = {
  key: string;
  label: string;
  options: BaseRefBucketOption[];
};

type BaseRefTreeSection = {
  group: WorktreeBaseRefOption["group"];
  total: number;
  buckets: BaseRefBucket[];
};

function getRelativeBranchPath(option: WorktreeBaseRefOption): string {
  if ((option.group === "origin" || option.group === "upstream") && option.name.startsWith(`${option.group}/`)) {
    return option.name.slice(option.group.length + 1);
  }
  return option.name;
}

function getShortBranchName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

type WorktreePromptProps = {
  workspaceName: string;
  workspacePath?: string;
  branch: string;
  baseRef: string;
  baseRefOptions: WorktreeBaseRefOption[];
  isLoadingBaseRefs?: boolean;
  isNonGitRepository?: boolean;
  nonGitRepositoryRawError?: string | null;
  publishToOrigin: boolean;
  setupScript: string;
  scriptError?: string | null;
  error?: string | null;
  errorRetryCommand?: string | null;
  onChange: (value: string) => void;
  onBaseRefChange: (value: string) => void;
  onPublishToOriginChange: (value: boolean) => void;
  onSetupScriptChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isBusy?: boolean;
  isSavingScript?: boolean;
};

export function WorktreePrompt({
  workspaceName,
  workspacePath = "",
  branch,
  baseRef,
  baseRefOptions,
  isLoadingBaseRefs = false,
  isNonGitRepository = false,
  nonGitRepositoryRawError = null,
  publishToOrigin,
  setupScript,
  scriptError = null,
  error = null,
  errorRetryCommand = null,
  onChange,
  onBaseRefChange,
  onPublishToOriginChange,
  onSetupScriptChange,
  onCancel,
  onConfirm,
  isBusy = false,
  isSavingScript = false,
}: WorktreePromptProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const baseRefDropdownRef = useRef<HTMLDivElement | null>(null);
  const [isBaseRefDropdownOpen, setIsBaseRefDropdownOpen] = useState(false);
  const [activeBaseRefGroupTab, setActiveBaseRefGroupTab] = useState<WorktreeBaseRefOption["group"] | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const normalizedBaseRef = baseRef.trim();
  const groupedBaseRefs: Record<WorktreeBaseRefOption["group"], WorktreeBaseRefOption[]> = {
    local: [],
    origin: [],
    upstream: [],
    remote: [],
  };
  for (const option of baseRefOptions) {
    groupedBaseRefs[option.group].push(option);
  }
  const selectedBaseRef = baseRefOptions.find((option) => option.name === normalizedBaseRef) ?? null;
  const basePreview = selectedBaseRef
    ? `${selectedBaseRef.name} @ ${selectedBaseRef.shortSha ?? "unknown"}`
    : null;
  const basePreviewGroup = selectedBaseRef?.group ?? null;
  const basePreviewCommit = selectedBaseRef?.shortSha ?? null;
  const isBaseRefValid = Boolean(selectedBaseRef && selectedBaseRef.shortSha);
  const baseRefError =
    normalizedBaseRef.length > 0 && !isBaseRefValid ? t("workspace.baseBranchInvalid") : null;
  const noviceGuideItems = [
    { key: "branch", title: t("workspace.branchName"), body: t("workspace.noviceGuideBranch"), icon: GitBranch },
    {
      key: "base",
      title: t("workspace.baseBranch"),
      body: t("workspace.noviceGuideBaseBranch"),
      icon: GitCommitHorizontal,
    },
    { key: "preview", title: t("workspace.basePreview"), body: t("workspace.noviceGuideBasePreview"), icon: Info },
    {
      key: "publish",
      title: t("workspace.publishToOrigin"),
      body: t("workspace.noviceGuidePublish"),
      icon: CloudUpload,
    },
    {
      key: "script",
      title: t("workspace.worktreeSetupScript"),
      body: t("workspace.noviceGuideSetupScript"),
      icon: SquareTerminal,
    },
    { key: "cancel", title: t("common.cancel"), body: t("workspace.noviceGuideCancel"), icon: CircleX },
    { key: "create", title: t("common.create"), body: t("workspace.noviceGuideCreate"), icon: CircleCheck },
  ];
  const nonGitRepositoryFriendlyError = t("workspace.nonGitRepositoryError");
  const canSubmit =
    branch.trim().length > 0 && isBaseRefValid && !isLoadingBaseRefs && !isNonGitRepository;
  const showBaseSelectError =
    !isLoadingBaseRefs && normalizedBaseRef.length === 0 && !isNonGitRepository;
  const showGenericError = Boolean(
    error && (!isNonGitRepository || error !== nonGitRepositoryFriendlyError),
  );
  const isBaseRefSelectorDisabled = isBusy || isLoadingBaseRefs || isNonGitRepository;
  const baseRefDisplayValue = selectedBaseRef?.name ?? t("workspace.baseBranchPlaceholder");

  const baseRefTreeSections: BaseRefTreeSection[] = BASE_REF_GROUP_ORDER.map((group) => {
    const options = groupedBaseRefs[group];
    if (options.length === 0) {
      return null;
    }
    const bucketsMap = new Map<string, BaseRefBucket>();
    for (const option of options) {
      const relativePath = getRelativeBranchPath(option);
      const segments = relativePath.split("/").filter(Boolean);
      const firstSegment = segments[0] ?? "";
      const bucketKey = segments.length > 1 ? firstSegment.toLowerCase() : ROOT_BUCKET_KEY;
      const bucketLabel =
        bucketKey === ROOT_BUCKET_KEY ? t("workspace.baseBranchRootGroup") : firstSegment.toUpperCase();
      const bucketOption: BaseRefBucketOption = {
        option,
        shortName: getShortBranchName(relativePath),
        relativePath,
      };
      const existingBucket = bucketsMap.get(bucketKey);
      if (existingBucket) {
        existingBucket.options.push(bucketOption);
      } else {
        bucketsMap.set(bucketKey, {
          key: bucketKey,
          label: bucketLabel,
          options: [bucketOption],
        });
      }
    }
    const sortedBuckets = Array.from(bucketsMap.values()).sort((left, right) => {
      if (left.key === ROOT_BUCKET_KEY) {
        return -1;
      }
      if (right.key === ROOT_BUCKET_KEY) {
        return 1;
      }
      return left.label.localeCompare(right.label);
    });
    return {
      group,
      total: options.length,
      buckets: sortedBuckets,
    };
  }).filter((section): section is BaseRefTreeSection => Boolean(section));
  const availableBaseRefGroups = baseRefTreeSections.map((section) => section.group);
  const availableBaseRefGroupsKey = availableBaseRefGroups.join("|");
  const baseRefSectionsInActiveTab =
    activeBaseRefGroupTab && availableBaseRefGroups.includes(activeBaseRefGroupTab)
      ? baseRefTreeSections.filter((section) => section.group === activeBaseRefGroupTab)
      : baseRefTreeSections.slice(0, 1);

  useEffect(() => {
    if (!isBaseRefDropdownOpen) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      if (
        baseRefDropdownRef.current &&
        event.target instanceof Node &&
        !baseRefDropdownRef.current.contains(event.target)
      ) {
        setIsBaseRefDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsBaseRefDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBaseRefDropdownOpen]);

  useEffect(() => {
    if (isBaseRefSelectorDisabled) {
      setIsBaseRefDropdownOpen(false);
    }
  }, [isBaseRefSelectorDisabled]);

  useEffect(() => {
    if (!isBaseRefDropdownOpen) {
      return;
    }
    const preferredGroup = selectedBaseRef?.group ?? null;
    setActiveBaseRefGroupTab((previousGroup) => {
      if (preferredGroup && availableBaseRefGroups.includes(preferredGroup)) {
        return preferredGroup;
      }
      if (previousGroup && availableBaseRefGroups.includes(previousGroup)) {
        return previousGroup;
      }
      return availableBaseRefGroups[0] ?? null;
    });
  }, [availableBaseRefGroups, availableBaseRefGroupsKey, isBaseRefDropdownOpen, selectedBaseRef?.group]);

  return (
    <>
      <style>{`
        .worktree-modal-aside::after {
          content: "";
          position: absolute;
          top: 8px;
          right: -7px;
          width: 1px;
          height: calc(100% - 16px);
          background: linear-gradient(
            180deg,
            transparent 0%,
            color-mix(in srgb, var(--border-subtle), transparent 48%) 24%,
            color-mix(in srgb, var(--border-subtle), transparent 52%) 76%,
            transparent 100%
          );
          pointer-events: none;
        }
        @media (max-width: 980px) {
          .worktree-modal-aside::after { display: none; }
        }
        .app.reduced-transparency .worktree-modal-backdrop {
          backdrop-filter: none;
        }
      `}</style>
      <div className="worktree-modal fixed inset-0 z-40" role="dialog" aria-modal="true">
        <div
          className="worktree-modal-backdrop absolute inset-0 bg-black/[.64] backdrop-blur-sm"
          onClick={() => {
            if (!isBusy) {
              onCancel();
            }
          }}
        />
        <div className="worktree-modal-card absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(980px,calc(100vw-28px))] max-h-[calc(100vh-24px)] overflow-hidden rounded-[18px] border border-(--border-stronger)/[.64] shadow-[0_24px_56px_rgba(0,0,0,0.3)] bg-card p-3 box-border grid grid-cols-[minmax(280px,320px)_minmax(0,1fr)] gap-[10px] max-[980px]:w-[min(760px,calc(100vw-16px))] max-[980px]:max-h-[calc(100vh-18px)] max-[980px]:grid-cols-1 max-[640px]:w-[calc(100vw-12px)] max-[640px]:max-h-[calc(100vh-12px)] max-[640px]:p-2">
          <aside className="worktree-modal-aside relative self-stretch overflow-y-auto overflow-x-hidden p-[6px_6px_6px_2px] flex flex-col gap-[7px] max-[980px]:max-h-[28vh] max-[980px]:p-[4px_2px]">
            <div className="worktree-modal-aside-kicker inline-flex items-center rounded-full border border-blue-500/[.32] bg-blue-600/[.12] text-(--text-strong) text-[10px] font-bold tracking-[0.08em] uppercase py-[3px] px-2 w-fit">{t("workspace.noviceGuideTitle")}</div>
            <div className="worktree-modal-aside-title m-0 text-(--text-strong) text-[15px] font-bold leading-[1.28] max-[640px]:text-[15px]">{t("workspace.noviceGuideSubtitle")}</div>
            {isNonGitRepository && (
              <div className="worktree-modal-aside-git-guide rounded-[11px] border border-amber-500/[.48] bg-gradient-to-b from-amber-500/[.14] to-amber-500/[.08] p-2 flex flex-col gap-[6px]">
                <div className="worktree-modal-aside-git-guide-title inline-flex items-center gap-[6px] text-[12px] font-bold leading-[1.24]">
                  <Info className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                  {t("workspace.nonGitRepositoryGuideTitle")}
                </div>
                <p className="m-0 text-(--text-subtle) text-[12px] leading-[1.36]">{t("workspace.nonGitRepositoryGuideDescription")}</p>
                <code className="rounded-[8px] border border-amber-500/[.38] bg-(--surface-card) text-(--text-strong) text-[11px] leading-[1.3] py-[6px] px-[7px] whitespace-normal overflow-wrap-anywhere">git init</code>
                <code className="rounded-[8px] border border-amber-500/[.38] bg-(--surface-card) text-(--text-strong) text-[11px] leading-[1.3] py-[6px] px-[7px] whitespace-normal overflow-wrap-anywhere">git add . &amp;&amp; git commit -m \"chore: init repository\"</code>
                <code className="rounded-[8px] border border-amber-500/[.38] bg-(--surface-card) text-(--text-strong) text-[11px] leading-[1.3] py-[6px] px-[7px] whitespace-normal overflow-wrap-anywhere">git rev-parse --is-inside-work-tree</code>
              </div>
            )}
            <ol className="worktree-modal-guide-list m-0 p-0 list-none flex flex-col gap-[6px]">
              {noviceGuideItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.key} className="worktree-modal-guide-item grid grid-cols-[30px_minmax(0,1fr)] gap-[7px] items-start rounded-[11px] border border-(--border-subtle)/[.72] bg-(--surface-card)/[.54] p-[6px] max-[640px]:grid-cols-[26px_minmax(0,1fr)]">
                    <span className="worktree-modal-guide-icon inline-flex items-center justify-center w-6 h-6 rounded-[8px] border border-blue-500/[.46] bg-gradient-to-b from-blue-600/[.18] to-blue-600/[.08] text-blue-200 max-[640px]:w-[22px] max-[640px]:h-[22px]" aria-hidden>
                      <Icon className="worktree-modal-guide-icon-svg w-[14px] h-[14px] stroke-[2.1]" />
                    </span>
                    <div className="worktree-modal-guide-content min-w-0">
                      <div className="worktree-modal-guide-item-title text-(--text-strong) text-[12px] font-bold leading-[1.2]">{item.title}</div>
                      <p className="m-[2px_0_0] text-(--text-subtle) text-[11px] leading-[1.38]">{item.body}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </aside>
          <section className="worktree-modal-main overflow-y-auto overflow-x-hidden p-[1px_3px_1px_0] flex flex-col gap-[7px] max-[980px]:p-0">
            <header className="worktree-modal-header rounded-[11px] border border-(--border-subtle)/[.86] bg-(--surface-card)/[.82] p-[9px_10px] flex items-start justify-between gap-[10px] max-[980px]:p-[8px_9px] max-[640px]:flex-col max-[640px]:items-stretch max-[640px]:gap-2">
              <div className="worktree-modal-header-main min-w-0 flex-1">
                <div className="worktree-modal-title m-0 text-[24px] font-extrabold tracking-[-0.018em] text-(--text-strong) leading-[1.08] max-[640px]:text-[22px]">{t("workspace.newWorktreeAgent")}</div>
                <div className="worktree-modal-subtitle mt-[5px] text-(--text-subtle) text-[13px] leading-[1.34]">
                  {t("workspace.createWorktreeUnder", { name: workspaceName })}
                </div>
              </div>
              <div className="worktree-modal-header-workspace flex-none rounded-full border border-(--border-accent)/[.82] bg-(--surface-active)/[.65] text-(--text-strong) text-[11px] leading-[1.1] font-bold py-[6px] px-[10px] max-w-[min(38%,240px)] whitespace-nowrap overflow-hidden text-ellipsis max-[980px]:max-w-[48%] max-[640px]:max-w-full max-[640px]:w-fit">{workspaceName}</div>
            </header>
            {isNonGitRepository && (
              <div className="worktree-modal-non-git-alert rounded-[11px] border border-amber-500/[.56] bg-gradient-to-b from-amber-500/[.14] to-amber-500/[.08] p-[9px_10px] flex flex-col gap-[7px]" role="status" aria-live="polite">
                <div className="worktree-modal-non-git-alert-title inline-flex items-center gap-[6px] text-[13px] font-extrabold leading-[1.2]">
                  <CircleX className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                  {t("workspace.nonGitRepositoryAlertTitle")}
                </div>
                <p className="m-0 text-(--text-subtle) text-[12px] leading-[1.4]">{t("workspace.nonGitRepositoryAlertDescription", { path: workspacePath || workspaceName })}</p>
                <div className="worktree-modal-non-git-alert-hint inline-flex items-start gap-[6px] text-[12px] leading-[1.36]">
                  <SquareTerminal className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                  {t("workspace.nonGitRepositoryAlertHint")}
                </div>
                {nonGitRepositoryRawError && (
                  <div className="worktree-modal-non-git-raw-error rounded-[9px] border border-(--border-subtle)/[.84] bg-(--surface-card)/[.9] p-[7px] flex flex-col gap-[5px]">
                    <span className="text-(--text-subtle) text-[11px] leading-[1.3]">{t("workspace.nonGitRepositoryTechnicalDetail")}</span>
                    <code className="text-(--text-strong) text-[11px] leading-[1.35] whitespace-normal break-all">{nonGitRepositoryRawError}</code>
                  </div>
                )}
              </div>
            )}
            <div className="worktree-modal-fieldset rounded-[10px] border border-(--border-subtle)/[.82] bg-(--surface-card)/[.74] p-[7px] min-w-0 flex flex-col gap-[5px]">
              <label className="worktree-modal-label text-[11px] font-bold tracking-[0.06em] uppercase text-(--text-faint)" htmlFor="worktree-branch">
                {t("workspace.branchName")}
              </label>
              <div className="worktree-modal-field-hint text-[12px] leading-[1.35] text-(--text-subtle)">{t("workspace.branchNameHint")}</div>
              <input
                id="worktree-branch"
                ref={inputRef}
                className="worktree-modal-input w-full rounded-[10px] border border-(--border-subtle)/[.9] bg-(--surface-card)/[.92] text-(--text-strong) box-border h-[38px] px-[10px] text-[14px] font-[family-name:var(--code-font-family,_JetBrains_Mono,_monospace)] leading-none focus:outline-2 focus:outline-blue-600 focus:outline-offset-1"
                value={branch}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    if (!isBusy) {
                      onCancel();
                    }
                  }
                  if (event.key === "Enter" && !isBusy && canSubmit) {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
              />
            </div>
            <div className="worktree-modal-fieldset rounded-[10px] border border-(--border-subtle)/[.82] bg-(--surface-card)/[.74] p-[7px] min-w-0 flex flex-col gap-[5px]">
              <label className="worktree-modal-label text-[11px] font-bold tracking-[0.06em] uppercase text-(--text-faint)" htmlFor="worktree-base-ref">
                {t("workspace.baseBranch")}
              </label>
              <div className="worktree-modal-field-hint text-[12px] leading-[1.35] text-(--text-subtle)">{t("workspace.baseBranchHint")}</div>
              <div
                ref={baseRefDropdownRef}
                className={`worktree-modal-select-wrap relative${isBaseRefDropdownOpen ? " is-open z-[4]" : ""}`}
              >
                <button
                  id="worktree-base-ref"
                  className="worktree-modal-dropdown-trigger w-full rounded-[10px] border border-(--border-subtle)/[.9] bg-(--surface-card)/[.92] text-(--text-strong) box-border h-[38px] px-[10px] text-[14px] font-[family-name:var(--code-font-family,_JetBrains_Mono,_monospace)] leading-none flex items-center justify-between cursor-pointer text-left transition-[border-color,background-color] duration-[160ms] ease-in focus:outline-2 focus:outline-blue-600 focus:outline-offset-1 hover:border-blue-600/[.46] hover:bg-blue-600/[.05] disabled:cursor-not-allowed disabled:opacity-65 max-[640px]:h-[38px] max-[640px]:text-[13px]"
                  type="button"
                  onClick={() => setIsBaseRefDropdownOpen((open) => !open)}
                  disabled={isBaseRefSelectorDisabled}
                  aria-expanded={isBaseRefDropdownOpen}
                  aria-haspopup="listbox"
                >
                  <span
                    className={`worktree-modal-dropdown-trigger-value min-w-0 overflow-hidden text-ellipsis whitespace-nowrap${
                      selectedBaseRef ? " is-selected text-(--text-strong)" : " is-placeholder text-(--text-subtle)"
                    }`}
                  >
                    {baseRefDisplayValue}
                  </span>
                  <span className={`worktree-modal-select-chevron inline-flex items-center justify-center ml-2 text-(--text-subtle) pointer-events-none transition-transform duration-[160ms] ease-in${isBaseRefDropdownOpen ? " rotate-180" : ""}`} aria-hidden>
                    <ChevronDown className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                  </span>
                </button>
                {isBaseRefDropdownOpen && (
                  <div className="worktree-modal-dropdown-panel absolute left-0 top-[calc(100%+6px)] w-full max-h-[min(420px,48vh)] overflow-auto rounded-[14px] border border-(--border-subtle)/[.92] bg-card shadow-[0_18px_36px_rgba(2,8,23,0.2),0_0_0_1px_rgba(37,99,235,0.14)_inset] p-2" role="listbox" aria-labelledby="worktree-base-ref">
                    {baseRefTreeSections.length === 0 ? (
                      <div className="worktree-modal-dropdown-empty p-[10px_12px] text-[12px] text-(--text-subtle)">{t("workspace.baseBranchNoOptions")}</div>
                    ) : (
                      <>
                        {baseRefTreeSections.length > 1 && (
                          <div className="worktree-modal-dropdown-tabs flex items-center gap-[6px] mb-2" role="tablist" aria-label={t("workspace.baseBranch")}>
                            {baseRefTreeSections.map((section) => {
                              const isActive = section.group === activeBaseRefGroupTab;
                              return (
                                <button
                                  key={`tab-${section.group}`}
                                  type="button"
                                  role="tab"
                                  aria-selected={isActive}
                                  className={`worktree-modal-dropdown-tab border border-(--border-subtle)/[.80] bg-(--surface-card)/[.86] text-(--text-subtle) min-h-[24px] rounded-full px-2 text-[10px] font-bold tracking-[0.04em] uppercase cursor-pointer inline-flex items-center gap-[6px] hover:border-blue-600/[.48] hover:text-blue-600${isActive ? " is-active border-blue-600/[.56] text-(--text-strong) bg-blue-600/[.12]" : ""}`}
                                  onClick={() => setActiveBaseRefGroupTab(section.group)}
                                >
                                  <span>{t(`workspace.baseBranchGroup.${section.group}`)}</span>
                                  <span className="worktree-modal-dropdown-tab-count text-[10px] opacity-[.92]">{section.total}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {baseRefSectionsInActiveTab.map((section) => (
                          <section key={section.group} className="worktree-modal-dropdown-section [&+&]:border-t [&+&]:border-(--border-subtle)/[.68] [&+&]:mt-2 [&+&]:pt-2">
                            <div className="worktree-modal-dropdown-section-content worktree-modal-dropdown-tab-content mt-0 flex flex-col gap-2">
                              {section.buckets.map((bucket) => (
                                <div key={`${section.group}-${bucket.key}`} className="worktree-modal-dropdown-bucket">
                                  <div className="worktree-modal-dropdown-bucket-header flex items-center justify-between gap-2 min-h-[22px] p-[2px_2px_2px_4px]">
                                    <span className="worktree-modal-dropdown-bucket-title inline-flex items-center gap-[6px] text-[9px] font-bold tracking-[0.08em] uppercase text-(--text-subtle)">
                                      <FolderTree className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                                      {bucket.label}
                                    </span>
                                    <span className="worktree-modal-dropdown-bucket-count text-[10px] text-(--text-subtle) font-bold">
                                      {bucket.options.length}
                                    </span>
                                  </div>
                                  <div className="worktree-modal-dropdown-options flex flex-col">
                                    {bucket.options.map((bucketOption) => {
                                      const option = bucketOption.option;
                                      const isSelected = option.name === selectedBaseRef?.name;
                                      return (
                                        <button
                                          key={option.name}
                                          className={`worktree-modal-dropdown-option border-0 w-full text-left rounded-[10px] bg-transparent text-inherit cursor-pointer p-[5px_8px] min-h-[32px] flex items-center hover:bg-blue-600/[.10]${
                                            isSelected ? " is-selected bg-gradient-to-b from-blue-600/[.16] to-transparent" : ""
                                          }`}
                                          role="option"
                                          type="button"
                                          aria-selected={isSelected}
                                          title={option.name}
                                          onClick={() => {
                                            onBaseRefChange(option.name);
                                            setIsBaseRefDropdownOpen(false);
                                          }}
                                        >
                                          <span className="worktree-modal-dropdown-option-main flex items-center gap-[6px] min-w-0 w-full">
                                            <GitBranch className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                                            <span className="worktree-modal-dropdown-option-text-row min-w-0 inline-flex items-baseline flex-auto overflow-hidden whitespace-nowrap">
                                              <span className="worktree-modal-dropdown-option-main-text min-w-0 flex-[0_1_auto] text-(--text-strong) text-[13px] leading-[1.2] font-bold">
                                                {bucketOption.shortName}
                                              </span>
                                              {bucketOption.relativePath !== bucketOption.shortName && (
                                                <>
                                                  <span className="worktree-modal-dropdown-option-inline-sep flex-none text-(--text-subtle) text-[11px]"> · </span>
                                                  <span className="worktree-modal-dropdown-option-inline-sub min-w-0 flex-auto overflow-hidden text-ellipsis text-(--text-subtle) text-[11px] leading-[1.2]">
                                                    {bucketOption.relativePath}
                                                  </span>
                                                </>
                                              )}
                                            </span>
                                            {isSelected && (
                                              <Check
                                                className="worktree-modal-inline-icon worktree-modal-dropdown-option-check w-[13px] h-[13px] stroke-[2.1] flex-none ml-auto text-blue-500"
                                              />
                                            )}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </section>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
              {isLoadingBaseRefs && (
                <div className="worktree-modal-hint text-[12px] leading-[1.35] text-(--text-subtle)">{t("workspace.baseBranchLoading")}</div>
              )}
              {!isLoadingBaseRefs && showBaseSelectError && (
                <div className="worktree-modal-error flex items-start gap-[6px] text-[12px] leading-[1.35] text-red-400 border border-red-500/[.46] bg-red-500/[.12] rounded-[10px] p-[7px_8px]">
                  <CircleX className="worktree-modal-error-icon w-[14px] h-[14px] stroke-[2.1] flex-none mt-[1px]" />
                  <span>{t("workspace.baseBranchPlaceholderError")}</span>
                </div>
              )}
              <div className="worktree-modal-base-preview flex flex-col gap-[4px] mt-[2px] min-w-0">
                <span className="worktree-modal-label text-[11px] font-bold tracking-[0.06em] uppercase text-(--text-faint)">{t("workspace.basePreview")}</span>
                <div
                  className={`worktree-modal-base-preview-card rounded-[11px] border border-(--border-subtle)/[.88] bg-(--surface-card)/[.84] p-[7px] flex flex-col gap-[6px] min-w-0${
                    selectedBaseRef ? ` is-active is-${selectedBaseRef.group} border-blue-600/[.52] bg-gradient-to-b from-blue-600/[.09] to-blue-600/[.04]` : " is-empty opacity-[.86]"
                  }`}
                >
                  <div className="worktree-modal-base-preview-meta flex items-center justify-between gap-2">
                    <span
                      className={`worktree-modal-base-group inline-flex items-center gap-[4px] rounded-full min-h-[22px] px-2 text-[11px] leading-none font-bold whitespace-nowrap max-w-full uppercase border ${
                        basePreviewGroup === "upstream"
                          ? "is-upstream text-teal-700 border-teal-700/[.38] bg-teal-700/[.12]"
                          : basePreviewGroup === "origin"
                            ? "is-origin text-blue-600 border-blue-600/[.40] bg-blue-600/[.12]"
                            : basePreviewGroup === "local"
                              ? "is-local text-amber-700 border-amber-700/[.38] bg-amber-700/[.12]"
                              : basePreviewGroup === "remote"
                                ? "is-remote text-(--text-strong) border-slate-600/[.32] bg-slate-600/[.12]"
                                : "is-empty text-(--text-subtle) border-(--border-subtle)/[.74] bg-(--surface-card)/[.66]"
                      }`}
                    >
                      <GitCommitHorizontal className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                      {basePreviewGroup
                        ? t(`workspace.baseBranchGroup.${basePreviewGroup}`)
                        : t("workspace.basePreviewSourceUnknown")}
                    </span>
                    <span className="worktree-modal-base-commit-pill inline-flex items-center gap-[4px] rounded-full min-h-[22px] px-2 text-[11px] leading-none font-bold whitespace-nowrap max-w-full text-(--text-strong) border border-(--border-subtle)/[.86] bg-(--surface-card)/[.84] font-[family-name:var(--code-font-family,_monospace)] overflow-hidden text-ellipsis">
                      <Hash className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                      {basePreviewCommit ?? t("workspace.basePreviewCommitUnavailable")}
                    </span>
                  </div>
                  <div className="worktree-modal-base-preview-ref grid grid-cols-[auto_minmax(0,1fr)] items-start gap-[6px] rounded-[9px] border border-(--border-subtle)/[.84] bg-(--surface-card)/[.82] p-[7px_8px]">
                    <GitBranch className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                    <code className="min-w-0 text-(--text-strong) text-[12px] leading-[1.36] whitespace-normal break-words">{basePreview ?? t("workspace.basePreviewUnavailable")}</code>
                  </div>
                  <div className="worktree-modal-base-preview-note flex items-start gap-[6px] text-(--text-subtle) text-[11px] leading-[1.35]">
                    <Info className="worktree-modal-inline-icon w-[13px] h-[13px] stroke-[2.1] flex-none" />
                    {t("workspace.basePreviewHint")}
                  </div>
                </div>
              </div>
            </div>
            <div className="worktree-modal-fieldset worktree-modal-fieldset-publish rounded-[10px] border border-(--border-subtle)/[.82] bg-(--surface-card)/[.74] p-[6px_8px] min-w-0 flex flex-col gap-[5px]">
              <button
                type="button"
                className={`worktree-modal-switch flex items-center gap-[9px] w-full border-0 rounded-[10px] bg-transparent text-left p-[3px_1px] cursor-pointer text-inherit disabled:opacity-60 disabled:cursor-not-allowed${publishToOrigin ? " on" : ""}`}
                role="switch"
                aria-checked={publishToOrigin}
                onClick={() => onPublishToOriginChange(!publishToOrigin)}
                disabled={isBusy}
              >
                <span className={`worktree-modal-switch-track relative flex-none w-[38px] h-[21px] rounded-full border border-(--border-subtle)/[.90] bg-(--surface-card) transition-colors duration-[180ms] ease-in${publishToOrigin ? " bg-blue-600/[.35] border-blue-600/[.58]" : ""}`} aria-hidden>
                  <span className={`worktree-modal-switch-thumb absolute top-[1px] left-[1px] w-[17px] h-[17px] rounded-full bg-blue-300 shadow-[0_2px_8px_rgba(3,12,24,0.45)] transition-[transform,background-color] duration-[180ms] ease-in${publishToOrigin ? " translate-x-[17px] bg-blue-100" : ""}`} />
                </span>
                <span className="worktree-modal-switch-copy flex flex-col gap-0 min-w-0">
                  <span className="worktree-modal-switch-title text-(--text-strong) text-[14px] font-bold leading-[1.24]">{t("workspace.publishToOrigin")}</span>
                  <span className="worktree-modal-switch-hint text-(--text-subtle) text-[12px] leading-[1.32]">{t("workspace.publishToOriginHint")}</span>
                </span>
              </button>
            </div>
            <div className="worktree-modal-divider h-px bg-(--border-subtle)/[.68] my-[2px]" />
            <div className="worktree-modal-section-title text-(--text-strong) text-[15px] font-bold leading-[1.2]">{t("workspace.worktreeSetupScript")}</div>
            <div className="worktree-modal-field-hint text-[12px] leading-[1.35] text-(--text-subtle)">{t("workspace.worktreeSetupScriptHint")}</div>
            <textarea
              id="worktree-setup-script"
              className="worktree-modal-textarea w-full rounded-[10px] border border-(--border-subtle)/[.90] bg-(--surface-card)/[.92] text-(--text-strong) box-border min-h-[80px] p-[8px_9px] text-[12px] leading-[1.4] resize-y font-[family-name:var(--code-font-family,_Menlo,_Monaco,_monospace)] focus:outline-2 focus:outline-blue-600 focus:outline-offset-1 max-[640px]:min-h-[76px]"
              value={setupScript}
              onChange={(event) => onSetupScriptChange(event.target.value)}
              placeholder="pnpm install"
              rows={4}
              disabled={isBusy || isSavingScript}
            />
            {scriptError && (
              <div className="worktree-modal-error flex items-start gap-[6px] text-[12px] leading-[1.35] text-red-400 border border-red-500/[.46] bg-red-500/[.12] rounded-[10px] p-[7px_8px]">
                <CircleX className="worktree-modal-error-icon w-[14px] h-[14px] stroke-[2.1] flex-none mt-[1px]" />
                <span>{scriptError}</span>
              </div>
            )}
            {baseRefError && (
              <div className="worktree-modal-error flex items-start gap-[6px] text-[12px] leading-[1.35] text-red-400 border border-red-500/[.46] bg-red-500/[.12] rounded-[10px] p-[7px_8px]">
                <CircleX className="worktree-modal-error-icon w-[14px] h-[14px] stroke-[2.1] flex-none mt-[1px]" />
                <span>{baseRefError}</span>
              </div>
            )}
            {showGenericError && (
              <div className="worktree-modal-error flex items-start gap-[6px] text-[12px] leading-[1.35] text-red-400 border border-red-500/[.46] bg-red-500/[.12] rounded-[10px] p-[7px_8px]">
                <CircleX className="worktree-modal-error-icon w-[14px] h-[14px] stroke-[2.1] flex-none mt-[1px]" />
                <span>{error}</span>
              </div>
            )}
            {showGenericError && errorRetryCommand ? (
              <div className="worktree-modal-retry-command flex flex-col gap-[5px] text-[12px] leading-[1.35] text-(--text-subtle) border border-dashed border-(--border-accent)/[.66] bg-(--surface-card)/[.82] rounded-[10px] p-[7px_8px]">
                <span>{t("workspace.worktreePublishRetryCommandLabel")}</span>
                <code className="font-[family-name:var(--code-font-family,_Menlo,_Monaco,_monospace)] text-[11px] leading-[1.35] text-(--text-strong) break-all">{errorRetryCommand}</code>
              </div>
            ) : null}
            <div className="worktree-modal-actions-hint text-[12px] leading-[1.35] text-(--text-subtle)">{t("workspace.actionsHint")}</div>
            <div className="worktree-modal-actions flex justify-end gap-2 pt-[2px] max-[640px]:gap-[7px]">
              <button
                className="ghost worktree-modal-button rounded-[10px] min-w-[72px] h-[33px] px-3 text-[13px] font-bold border border-(--border-subtle)/[.95] bg-(--surface-card)/[.78] max-[640px]:min-w-[70px] max-[640px]:h-[32px] max-[640px]:px-[11px]"
                onClick={onCancel}
                type="button"
                disabled={isBusy}
              >
                {t("common.cancel")}
              </button>
              <button
                className="primary worktree-modal-button rounded-[10px] min-w-[72px] h-[33px] px-3 text-[13px] font-bold border border-blue-600/[.82] bg-gradient-to-b from-blue-600 to-blue-700 text-blue-50 max-[640px]:min-w-[70px] max-[640px]:h-[32px] max-[640px]:px-[11px]"
                onClick={onConfirm}
                type="button"
                disabled={isBusy || !canSubmit}
                aria-busy={isBusy}
              >
                {isBusy ? t("common.creating") : t("common.create")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
