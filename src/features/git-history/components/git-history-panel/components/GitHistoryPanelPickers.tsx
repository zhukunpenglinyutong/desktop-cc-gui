// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Search from "lucide-react/dist/esm/icons/search";

function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

type ActionSurfaceProps = {
  className?: string;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
  onActivate?: () => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
  title?: string;
  ariaLabel?: string;
  style?: CSSProperties;
};

export function ActionSurface({
  className,
  children,
  disabled,
  active,
  onActivate,
  onContextMenu,
  title,
  ariaLabel,
  style,
}: ActionSurfaceProps) {
  const mergedClassName = [
    "git-history-action",
    className,
    active ? "is-active" : "",
    disabled ? "is-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      className={mergedClassName}
      title={title}
      style={style}
      onClick={() => {
        if (!disabled) {
          onActivate?.();
        }
      }}
      onContextMenu={(event) => {
        if (disabled) {
          return;
        }
        onContextMenu?.(event);
      }}
      onKeyDown={(event) => {
        if (disabled || !onActivate) {
          return;
        }
        if (isActivationKey(event)) {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {children}
    </div>
  );
}

export type GitHistoryPickerOption = {
  id: string;
  label: string;
  kind?: "main" | "worktree";
  parentLabel?: string | null;
};

type GitHistoryPickerSection = {
  id: string | null;
  name: string;
  options: GitHistoryPickerOption[];
};

export type GitHistoryProjectPickerProps = {
  sections: GitHistoryPickerSection[];
  selectedId: string | null;
  selectedLabel: string;
  ariaLabel: string;
  searchPlaceholder: string;
  emptyText: string;
  icon?: ReactNode;
  disabled?: boolean;
  onSelect: (id: string) => void;
};

export type GitHistoryInlinePickerProps = {
  label: string;
  value: string;
  options: GitHistoryInlinePickerOption[];
  disabled?: boolean;
  searchPlaceholder: string;
  emptyText: string;
  triggerIcon?: ReactNode;
  optionIcon?: ReactNode;
  onSelect: (value: string) => void;
};

export type GitHistoryInlinePickerOption = {
  value: string;
  label: string;
  description?: string;
  group?: string | null;
};

export function GitHistoryProjectPicker({
  sections,
  selectedId,
  selectedLabel,
  ariaLabel,
  searchPlaceholder,
  emptyText,
  icon = <GitBranch size={13} />,
  disabled = false,
  onSelect,
}: GitHistoryProjectPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const filteredSections = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return sections;
    }
    return sections
      .map((section) => ({
        ...section,
        options: section.options.filter((entry) => entry.label.toLowerCase().includes(keyword)),
      }))
      .filter((section) => section.options.length > 0);
  }, [query, sections]);
  const showGroupLabel = useMemo(
    () =>
      filteredSections.length > 1
      && filteredSections.some((section) => section.name.trim().length > 0),
    [filteredSections],
  );

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      setQuery("");
    }
  }, [disabled, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!pickerRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const handleSelect = useCallback(
    (id: string) => {
      if (id && id !== selectedId) {
        onSelect(id);
      }
      setOpen(false);
      setQuery("");
    },
    [onSelect, selectedId],
  );

  return (
    <div
      className={`git-history-project-picker relative inline-block min-w-45 max-w-[min(36vw,420px)]${open ? " is-open" : ""}${disabled ? " is-disabled opacity-[0.66]" : ""}`}
      ref={pickerRef}
    >
      <button
        type="button"
        className="git-history-project-display git-history-project-trigger inline-flex items-center gap-2 w-full min-h-7.5 px-2.5 rounded-lg border border-[color-mix(in_srgb,var(--border-default)_64%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_56%,transparent)] text-(--text-primary) box-border text-[12px] leading-[1.2] transition-[background-color_140ms_ease,border-color_140ms_ease,box-shadow_140ms_ease] disabled:cursor-not-allowed hover:not-disabled:border-[color-mix(in_srgb,var(--border-default)_86%,transparent)] hover:not-disabled:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_62%,transparent)] focus-visible:outline-none focus-visible:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_56%,transparent)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent-primary,#2563eb)_18%,transparent)]"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setOpen((prev) => !prev);
        }}
      >
        {icon}
        <span className="git-history-project-value min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{selectedLabel}</span>
        <ChevronDown size={12} className={`git-history-project-caret text-(--text-muted) ml-auto flex-[0_0_auto] transition-transform duration-160 ease-[ease]${open ? " rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="git-history-project-dropdown popover-surface absolute top-[calc(100%+8px)] left-0 min-w-[max(260px,100%)] max-w-[min(52vw,560px)] max-h-105 p-2 rounded-[18px] z-40 flex flex-col gap-2" role="listbox" aria-label={ariaLabel}>
          <div className="git-history-project-search p-0.5">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-full h-9 rounded-xl border border-[color-mix(in_srgb,var(--border-default)_70%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_84%,transparent)] text-(--text-primary) text-[13px] px-3 outline-none focus-visible:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_62%,transparent)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent-primary,#2563eb)_16%,transparent)]"
            />
          </div>
          <div className="git-history-project-list overflow-y-auto max-h-85 flex flex-col gap-0.5 pb-0.5 px-0.5">
            {filteredSections.map((section) => (
              <div key={section.id ?? "ungrouped"} className="git-history-project-group flex flex-col gap-0.5 [&+&]:mt-1.5">
                {showGroupLabel && section.name.trim().length > 0 ? (
                  <div className="git-history-project-group-label px-2.5 pt-1.5 pb-1 text-[11px] leading-[1.2] text-(--text-faint) font-semibold tracking-[0.01em]">{section.name}</div>
                ) : null}
                {section.options.map((entry) => {
                  const selected = entry.id === selectedId;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`git-history-project-item w-full min-h-8.5 border-none rounded-[10px] bg-transparent text-(--text-secondary) inline-flex items-center gap-2 px-2.5 text-left cursor-pointer hover:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_72%,transparent)] hover:text-[color:var(--text-stronger)]${selected ? " is-active bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_76%,#1d4ed8)] text-white font-semibold" : ""}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => handleSelect(entry.id)}
                    >
                      <span className="git-history-project-item-check w-3.5 flex-[0_0_14px] text-center text-[13px]" aria-hidden>
                        {selected ? "✓" : ""}
                      </span>
                      <span
                        className={`git-history-project-item-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap${
                          entry.kind === "worktree" ? " is-worktree text-[color-mix(in_srgb,var(--text-secondary)_84%,var(--text-muted))] pl-1.5" : ""
                        }`}
                      >
                        {entry.kind === "worktree" ? "↳ " : ""}
                        {entry.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {filteredSections.length === 0 && (
              <div className="git-history-project-empty p-2.5 text-(--text-muted) text-[12px] text-center">{emptyText}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function GitHistoryInlinePicker({
  label,
  value,
  options,
  disabled = false,
  searchPlaceholder,
  emptyText,
  triggerIcon,
  optionIcon,
  onSelect,
}: GitHistoryInlinePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const trimmedValue = value.trim();
  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) {
      return options;
    }
    return options.filter((entry) =>
      [entry.value, entry.label, entry.description ?? "", entry.group ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(keyword),
    );
  }, [options, query]);
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, GitHistoryInlinePickerOption[]>();
    for (const option of filteredOptions) {
      const key = option.group?.trim() ?? "";
      const bucket = groups.get(key) ?? [];
      bucket.push(option);
      groups.set(key, bucket);
    }
    return Array.from(groups.entries()).map(([group, items]) => ({ group, items }));
  }, [filteredOptions]);
  const showGroupLabel = useMemo(
    () => groupedOptions.length > 1 || groupedOptions.some((entry) => entry.group.length > 0),
    [groupedOptions],
  );
  const selectedOption = useMemo(
    () => options.find((entry) => entry.value === trimmedValue) ?? null,
    [options, trimmedValue],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!pickerRef.current?.contains(target)) {
        setOpen(false);
        setQuery("");
      }
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
      setQuery("");
    }
  }, [disabled, open]);

  return (
    <div
      className={`git-history-create-pr-picker${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      ref={pickerRef}
    >
      <button
        type="button"
        className="git-history-create-pr-picker-trigger"
        aria-label={label}
        title={trimmedValue}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setOpen((previous) => !previous);
        }}
      >
        {triggerIcon ? (
          <span className="git-history-create-pr-picker-leading-icon" aria-hidden>
            {triggerIcon}
          </span>
        ) : null}
        <span className="git-history-create-pr-picker-value">
          <span className="git-history-create-pr-picker-value-title">
            {(selectedOption?.label ?? trimmedValue) || "-"}
          </span>
          {selectedOption?.description ? (
            <span className="git-history-create-pr-picker-value-hint">{selectedOption.description}</span>
          ) : null}
        </span>
        <ChevronDown size={12} className="git-history-create-pr-picker-caret" />
      </button>

      {open ? (
        <div className="git-history-create-pr-picker-dropdown popover-surface" role="listbox" aria-label={label}>
          <label className="git-history-create-pr-picker-search">
            <Search size={12} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </label>
          <div className="git-history-create-pr-picker-list">
            {groupedOptions.map((groupEntry) => (
              <div
                key={groupEntry.group || "__ungrouped__"}
                className="git-history-create-pr-picker-group"
              >
                {showGroupLabel && groupEntry.group ? (
                  <div className="git-history-create-pr-picker-group-label">{groupEntry.group}</div>
                ) : null}
                {groupEntry.items.map((option) => {
                  const selected = option.value === trimmedValue;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`git-history-create-pr-picker-item${selected ? " is-active" : ""}`}
                      role="option"
                      aria-selected={selected}
                      title={option.value}
                      onClick={() => {
                        onSelect(option.value);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      {optionIcon ? (
                        <span className="git-history-create-pr-picker-item-icon" aria-hidden>
                          {optionIcon}
                        </span>
                      ) : null}
                      <span className="git-history-create-pr-picker-item-main">
                        <span className="git-history-create-pr-picker-item-title">{option.label}</span>
                        {option.description ? (
                          <span className="git-history-create-pr-picker-item-description">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      <span className="git-history-create-pr-picker-item-check" aria-hidden>
                        {selected ? "✓" : ""}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
            {groupedOptions.length === 0 ? (
              <div className="git-history-create-pr-picker-empty">{emptyText}</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
