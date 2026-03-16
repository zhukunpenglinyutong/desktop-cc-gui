// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";

function isActivationKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" || event.key === " ";
}

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

type GitHistoryPickerOption = {
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
      className={`git-history-project-picker${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      ref={pickerRef}
    >
      <button
        type="button"
        className="git-history-project-display git-history-project-trigger"
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
        <span className="git-history-project-value">{selectedLabel}</span>
        <ChevronDown size={12} className="git-history-project-caret" />
      </button>

      {open && (
        <div className="git-history-project-dropdown popover-surface" role="listbox" aria-label={ariaLabel}>
          <div className="git-history-project-search">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
          </div>
          <div className="git-history-project-list">
            {filteredSections.map((section) => (
              <div key={section.id ?? "ungrouped"} className="git-history-project-group">
                {showGroupLabel && section.name.trim().length > 0 ? (
                  <div className="git-history-project-group-label">{section.name}</div>
                ) : null}
                {section.options.map((entry) => {
                  const selected = entry.id === selectedId;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className={`git-history-project-item${selected ? " is-active" : ""}`}
                      role="option"
                      aria-selected={selected}
                      onClick={() => handleSelect(entry.id)}
                    >
                      <span className="git-history-project-item-check" aria-hidden>
                        {selected ? "✓" : ""}
                      </span>
                      <span
                        className={`git-history-project-item-label${
                          entry.kind === "worktree" ? " is-worktree" : ""
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
              <div className="git-history-project-empty">{emptyText}</div>
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
