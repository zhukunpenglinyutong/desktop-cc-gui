import { supportsOmpFastMode, type OmpServiceTier } from "@/lib/omp-service-tier";
"use client";

import { Fragment, useEffect, useState } from "react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import { menuPopoverSurface } from "@/components/base/dropdown/menu-styles";
import { ModalShell } from "@/components/dialogs";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { MOBILE_MEDIA, useMediaQuery } from "@/hooks/use-media-query";
import { cx } from "@/utils/cx";
import { usePopoverState } from "@/utils/use-dismiss-on-outside-press";
import { EFFORT_LEVELS } from "./effort-levels";
import { EFFORT_LABEL_KEYS, type EffortLevel } from "./effort-levels";
import { EngineFlyout, EngineModelPanel } from "./engine-model-panel";

export type { EffortLevel } from "./effort-levels";

/**
 * Board UI → "ai_chat" dropdowns (nodes 4035:6313 / 4035:6925), adapted to
 * live data. Same react-aria non-modal popover recipe as the template;
 * contents are props-driven:
 * - CliMenu — CLI + model switcher opened from the composer's engine
 *   button: each engine row flies out a model + effort panel to the right
 *   (search field over a "Models" radio group over the effort slider,
 *   Board UI node 4035:6925). */

/** CLI picker panel: shadcn-style menu (reference: desktop-cc-gui's
 *  ModelSelect) — 8px radius, 4px padding, hairline separators between rows,
 *  no header label. Distinct from the other ai_chat popovers above. */
const CLI_POPOVER_CLASSES = menuPopoverSurface({
  width: "w-64",
  origin: "origin-bottom-left",
  radius: "rounded-lg",
  padding: "p-1",
});

/* ------------------------------------------------------------- engine picker */

export interface MenuOption {
  id: string;
  label: string;
  /** Engine is installed and spawnable — drives the status dot. */
  available?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

export interface ModelOption {
  /** "" selects the CLI/provider default model. */
  id: string;
  label: string;
  /** Secondary line under the label (e.g. "Custom Opus model"). */
  description?: string;
  /** Catalog provider ("kimi-code"); derived from the "provider/model" id
   *  when the catalog entry is missing. Two or more distinct providers turn
   *  the flyout list into labeled sections. */
  provider?: string;
}

/* -------------------------------------------------------------- engine row */

/** One engine row in the CLI list: brand mark, name, selection dot (active
 *  engine only) and the chevron that hints at the flyout. */
function EngineRow({
  option,
  selected,
  flyoutOpen,
  onSelect,
  onHover,
}: {
  option: MenuOption;
  selected: boolean;
  /** This engine's flyout is currently open. */
  flyoutOpen: boolean;
  /** Row click: show this engine's model list (the engine itself switches
   *  when a model is picked there). */
  onSelect: () => void;
  /** Pointer enter / keyboard focus: pre-open this engine's model flyout
   *  (desktop only; mobile passes nothing). */
  onHover?: () => void;
}) {
  return (
    <button
      type="button"
      aria-disabled={option.disabled || undefined}
      title={option.disabled ? option.disabledReason : undefined}
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={onHover}
      onFocus={onHover}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors",
        selected || flyoutOpen
          ? "bg-background-primary-hover"
          : "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover",
        option.disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <EngineIcon
        engine={option.id}
        size={18}
        className="shrink-0 text-foreground-icon-primary"
      />
      <span className="text-body-medium text-text-primary">
        {CLI_DISPLAY_NAMES[option.id] ?? option.label}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {selected && (
          <span
            aria-hidden
            className="size-1.5 rounded-full bg-notification-success-foreground"
          />
        )}
        <ChevronRight
          className="size-4 text-foreground-icon-secondary"
          aria-hidden
        />
      </span>
    </button>
  );
}

/** Trigger min-width lock while the popover is open: snapshot on open, clear
 *  on close, so shorter model labels can't shrink the trigger mid-session
 *  and slide the top-end popover. Adjusted during render (prev-prop pattern)
 *  so every open/close path — trigger press, outside press, Esc — flips it,
 *  not just onOpenChange. */
function useLockedMinWidth(isOpen: boolean, triggerRef: Ref<HTMLButtonElement>) {
  const [lockedMinWidth, setLockedMinWidth] = useState<number | undefined>();
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setLockedMinWidth(undefined);
    } else {
      const node =
        triggerRef && typeof triggerRef !== "function" ? triggerRef.current : null;
      if (node) setLockedMinWidth(node.offsetWidth);
    }
  }
  return lockedMinWidth;
}

/** Borderless trigger carrying the whole selection at a glance:
 *  "{CLI} / {model} · {effort}" (CLI name / model / effort). The model
 *  part only drops out when the engine has no model list at all.
 *  min-w-0 lets the trigger shrink instead of pushing the send button out
 *  of the composer on narrow widths; below md it collapses to icon +
 *  truncated model (aria-label carries the full selection). */
function CliMenuTrigger({
  triggerRef,
  engine,
  engineName,
  model,
  effort,
  ompServiceTier,
  codexServiceTier,
  modelId,
  isOpen,
}: {
  triggerRef: Ref<HTMLButtonElement>;
  engine: string;
  /** Display name of the active engine. */
  engineName: string;
  /** Selected model of the active engine, when it has a model list. */
  model: ModelOption | undefined;
  effort: EffortLevel;
  ompServiceTier: OmpServiceTier;
  codexServiceTier: OmpServiceTier;
  modelId: string;
  /** While open, lock the trigger's min-width so model picks don't shrink it
   *  and nudge the top-end popover. */
  isOpen: boolean;
}) {
  const { t } = useTranslation();
  const showFast =
    (engine === "omp" && supportsOmpFastMode(modelId) && ompServiceTier === "priority") ||
    (engine === "codex" && codexServiceTier === "priority");
  // Snapshot width on open; clear on close. Shorter model labels then can't
  // shrink the trigger mid-session and slide the popover.
  const lockedMinWidth = useLockedMinWidth(isOpen, triggerRef);
  return (
    <AriaButton
      ref={triggerRef}
      aria-label={`${engineName}${model ? ` / ${model.label}` : ""} · ${t(EFFORT_LABEL_KEYS[effort])}`}
      style={lockedMinWidth ? { minWidth: lockedMinWidth } : undefined}
      className="group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
    >
      <EngineIcon engine={engine} size={16} className="shrink-0 text-foreground-icon-secondary" />
      <span className="flex min-w-0 items-center gap-1 text-body-2-medium whitespace-nowrap text-text-secondary transition-colors duration-150 ease group-hover:text-text-primary">
        <span className="shrink-0 max-md:hidden">{engineName}</span>
        {model && (
          <>
            <span aria-hidden className="shrink-0 text-text-tertiary max-md:hidden">
              /
            </span>
            <span className="max-w-44 truncate max-md:max-w-28">{model.label}</span>
          </>
        )}
        <span aria-hidden className="shrink-0 text-text-tertiary max-md:hidden">
          ·
        </span>
        {/* Reserve the widest localized level so the right-aligned popover stays put. */}
        <span className="inline-grid shrink-0 max-md:hidden">
          {EFFORT_LEVELS.map(level => (
            <span key={level} aria-hidden={level !== effort} className={cx("col-start-1 row-start-1", level !== effort && "invisible")}>
              {t(EFFORT_LABEL_KEYS[level])}
            </span>
          ))}
        </span>
        {(engine === "omp" && supportsOmpFastMode(modelId)) || engine === "codex" ? (
          <span aria-hidden={!showFast} className={cx("w-7 shrink-0 text-center text-text-primary", !showFast && "invisible")}>Fast</span>
        ) : null}
      </span>
    </AriaButton>
  );
}

/** Popover body: the hairline-separated engine rows and, on desktop, the
 *  hovered engine's model flyout floating to the right. Pointer entering
 *  or leaving the rows+flyout cluster cancels/schedules the flyout's close
 *  grace period (owned by the parent). */
function EngineMenuBody({
  options,
  value,
  openEngine,
  modelsByEngine,
  models,
  efforts,
  query,
  onQueryChange,
  isMobile,
  onSelectEngine,
  onHoverEngine,
  onPickModel,
  onEffortChange,
  ompServiceTier,
  onOmpServiceTierChange,
  codexServiceTier,
  onCodexServiceTierChange,
  onRefreshModels,
  loadingEngines,
}: {
  options: MenuOption[];
  value: string;
  /** Engine whose model flyout is open, null when closed. */
  openEngine: string | null;
  modelsByEngine: Record<string, ModelOption[]>;
  models: Record<string, string>;
  efforts: Record<string, EffortLevel>;
  query: string;
  onQueryChange: (value: string) => void;
  isMobile: boolean;
  onSelectEngine: (option: MenuOption) => void;
  /** Row hover/focus: pre-open this engine's model flyout. */
  onHoverEngine: (option: MenuOption) => void;
  onPickModel: (engine: string, id: string) => void;
  onEffortChange: (engine: string, level: EffortLevel) => void;
  ompServiceTier: OmpServiceTier;
  onOmpServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  codexServiceTier: OmpServiceTier;
  onCodexServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  onRefreshModels?: () => void | Promise<void>;
  /** Engine ids whose catalog probe has not returned yet. */
  loadingEngines?: readonly string[];
}) {
  const flyoutOption = options.find((o) => o.id === openEngine);
  return (
    <div className="flex w-full flex-col">
      <div className="relative">
        <div className="flex w-full flex-col">
          {options.map((option, index) => (
            <Fragment key={option.id}>
              {index > 0 && (
                <div
                  aria-hidden
                  className="-mx-1 my-1 border-t border-separator-border"
                />
              )}
              {/* Not `disabled`: that attribute would swallow the hover and
                  click events that switch the panel. */}
              <EngineRow
                option={option}
                selected={option.id === value}
                flyoutOpen={option.id === openEngine}
                onSelect={() => onSelectEngine(option)}
                onHover={isMobile ? undefined : () => onHoverEngine(option)}
              />
            </Fragment>
          ))}
        </div>

        {!isMobile && flyoutOption && (
          <EngineFlyout
              option={flyoutOption}
              models={modelsByEngine[flyoutOption.id] ?? []}
              selectedModelId={models[flyoutOption.id] ?? ""}
              query={query}
              onQueryChange={onQueryChange}
              effort={efforts[flyoutOption.id] ?? "medium"}
              onPickModel={onPickModel}
              onEffortChange={onEffortChange}
              ompServiceTier={ompServiceTier}
              onOmpServiceTierChange={onOmpServiceTierChange}
              codexServiceTier={codexServiceTier}
              onCodexServiceTierChange={onCodexServiceTierChange}
            onRefresh={onRefreshModels}
            loading={loadingEngines?.includes(flyoutOption.id)}
          />
        )}
      </div>
    </div>
  );
}

/** Mobile second-level model dialog: touch has no hover flyout, so tapping
 *  an engine row opens the same EngineModelPanel in a modal instead. */
function EngineModelDialog({
  option,
  modelsByEngine,
  models,
  efforts,
  query,
  onQueryChange,
  onPickModel,
  onEffortChange,
  ompServiceTier,
  onOmpServiceTierChange,
  codexServiceTier,
  onCodexServiceTierChange,
  onRefreshModels,
  onClose,
}: {
  /** Engine being configured; undefined when the dialog is closed. */
  option: MenuOption | undefined;
  modelsByEngine: Record<string, ModelOption[]>;
  models: Record<string, string>;
  efforts: Record<string, EffortLevel>;
  query: string;
  onQueryChange: (value: string) => void;
  onPickModel: (engine: string, id: string) => void;
  onEffortChange: (engine: string, level: EffortLevel) => void;
  ompServiceTier: OmpServiceTier;
  onOmpServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  codexServiceTier: OmpServiceTier;
  onCodexServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  onRefreshModels?: () => void | Promise<void>;
  onClose: () => void;
}) {
  if (!option) return null;
  return (
    <ModalShell
      onClose={onClose}
      className="max-w-[calc(100vw-32px)]"
    >
      <EngineModelPanel
        option={option}
        models={modelsByEngine[option.id] ?? []}
        selectedModelId={models[option.id] ?? ""}
        query={query}
        onQueryChange={onQueryChange}
        effort={efforts[option.id] ?? "medium"}
        onPickModel={onPickModel}
        onEffortChange={onEffortChange}
        ompServiceTier={ompServiceTier}
        onOmpServiceTierChange={onOmpServiceTierChange}
        codexServiceTier={codexServiceTier}
        onCodexServiceTierChange={onCodexServiceTierChange}
        onRefresh={onRefreshModels}
        onClose={onClose}
      />
    </ModalShell>
  );
}

/**
 * CLI + model switcher, visually mirroring the reference ModelSelect
 * (desktop-cc-gui): a borderless trigger showing the full selection —
 * "{CLI} / {model} · {effort}" — hairline-separated engine rows where
 * only the active engine carries a status dot, and a per-engine flyout.
 * Picking a model in another engine's flyout switches to that engine (when
 * installed) and keeps the panel open for Fast / effort.
 */
export function CliMenu({
  options,
  value,
  onChange,
  modelsByEngine,
  models,
  onModelChange,
  efforts,
  onEffortChange,
  ompServiceTier,
  onOmpServiceTierChange,
  codexServiceTier,
  onCodexServiceTierChange,
  onRefreshModels,
  loadingEngines,
}: {
  options: MenuOption[];
  value: string;
  onChange: (id: string) => void;
  /** Per-engine model lists; concrete ids only, CLI default first. */
  modelsByEngine: Record<string, ModelOption[]>;
  /** Selected model id per engine. */
  models: Record<string, string>;
  onModelChange: (engine: string, id: string) => void;
  /** Per-engine reasoning effort, rendered under each flyout's model list. */
  efforts: Record<string, EffortLevel>;
  onEffortChange: (engine: string, level: EffortLevel) => void;
  ompServiceTier: OmpServiceTier;
  onOmpServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  codexServiceTier: OmpServiceTier;
  onCodexServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  /** Re-probe provider configs and model catalogs (flyout refresh button). */
  onRefreshModels?: () => void | Promise<void>;
  /** Engine ids whose catalog probe has not returned yet (loading hint). */
  loadingEngines?: readonly string[];
}) {
  const { t } = useTranslation();
  const { isOpen, triggerRef, popoverRef, close, setOpen } = usePopoverState();
  const current = options.find((o) => o.id === value);

  // Trigger carries the whole selection at a glance:
  // "Claude Code / 默认 · 高" (CLI name / model / effort). The model part
  // only drops out when the engine has no model list at all.
  const selectedModelId = models[value] ?? "";
  const selectedModel = (modelsByEngine[value] ?? []).find((m) => m.id === selectedModelId);
  const engineName = CLI_DISPLAY_NAMES[value] ?? current?.label ?? value;
  const triggerEffort: EffortLevel = efforts[value] ?? "medium";

  // Which engine's model flyout is open. Pre-opens on the active engine so
  // the current selection is visible the moment the menu opens.
  const [openEngine, setOpenEngine] = useState<string | null>(null);
  // Mobile has no hover, so the flyout never renders there; tapping an
  // engine row opens the same panel as a second-level modal instead.
  const isMobile = useMediaQuery(MOBILE_MEDIA);
  const [dialogEngine, setDialogEngine] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // The filter belongs to the search, not to one engine: switching the flyout
  // must not wipe what the user typed.
  useEffect(() => {
    setQuery("");
  }, [dialogEngine]);

  const handleOpenChange = (o: boolean) => {
    if (!setOpen(o)) return;
    setOpenEngine(o ? value : null);
    if (!o) setQuery("");
  };

  const dialogOption = options.find((o) => o.id === dialogEngine);

  // Keep the menu open after a model pick so Fast / effort can be adjusted in
  // the same panel (Codex desktop behavior). A model on another installed
  // engine still switches the active CLI; the flyout stays on that engine.
  const pickModel = (engine: string, id: string) => {
    onModelChange(engine, id);
    const target = options.find((o) => o.id === engine);
    if (engine !== value && target && !target.disabled) onChange(engine);
    if (!isMobile) setOpenEngine(engine);
  };

  // Hover (and keyboard focus) pre-open the hovered engine's flyout without
  // touching the active engine. Engines without a catalog have nothing to
  // preview — they stay click-to-switch so a stray pointer can't change
  // the engine or close the menu.
  const hoverEngine = (option: MenuOption) => {
    if (option.disabled) return;
    if ((modelsByEngine[option.id] ?? []).length === 0) return;
    setOpenEngine(option.id);
  };

  const selectEngine = (option: MenuOption) => {
    // Mobile: the row tap drills into the second-level model dialog instead
    // of switching engines outright — the engine switches when a model is
    // picked there.
    if (isMobile) {
      setDialogEngine(option.id);
      close();
      return;
    }
    if (option.disabled) return;
    // Desktop: the row switches WHICH model list is shown, nothing more. The
    // engine itself changes when a model is picked from that list (see
    // pickModel), so browsing another CLI can never yank the panel away
    // mid-search — hovering a row only pre-opens that engine's list, and
    // the shared search query survives the switch.
    // An engine with no catalog has nothing to browse: keep the old
    // behaviour of switching outright.
    if ((modelsByEngine[option.id] ?? []).length === 0) {
      onChange(option.id);
      close();
      return;
    }
    setOpenEngine(option.id);
  };



  return (
    <>
    <AriaDialogTrigger isOpen={isOpen} onOpenChange={handleOpenChange}>
      <CliMenuTrigger
        triggerRef={triggerRef}
        engine={value}
        engineName={engineName}
        model={selectedModel}
        effort={triggerEffort}
        ompServiceTier={ompServiceTier}
        codexServiceTier={codexServiceTier}
        modelId={selectedModelId}
        isOpen={isOpen}
      />

      <AriaPopover
        ref={popoverRef}
        isNonModal
        placement="top end"
        offset={8}
        className={CLI_POPOVER_CLASSES}
      >
        <AriaDialog aria-label={t("chat.cliPicker")} className="outline-none">
          <EngineMenuBody
            options={options}
            value={value}
            openEngine={openEngine}
            modelsByEngine={modelsByEngine}
            models={models}
            efforts={efforts}
            query={query}
            onQueryChange={setQuery}
            isMobile={isMobile}
            onSelectEngine={selectEngine}
            onHoverEngine={hoverEngine}
            onPickModel={pickModel}
            onEffortChange={onEffortChange}
            ompServiceTier={ompServiceTier}
            onOmpServiceTierChange={onOmpServiceTierChange}
            codexServiceTier={codexServiceTier}
            onCodexServiceTierChange={onCodexServiceTierChange}
            onRefreshModels={onRefreshModels}
            loadingEngines={loadingEngines}
          />
        </AriaDialog>
      </AriaPopover>
    </AriaDialogTrigger>

    <EngineModelDialog
      option={dialogOption}
      modelsByEngine={modelsByEngine}
      models={models}
      efforts={efforts}
      query={query}
      onQueryChange={setQuery}
      onPickModel={pickModel}
      onEffortChange={onEffortChange}
      ompServiceTier={ompServiceTier}
      onOmpServiceTierChange={onOmpServiceTierChange}
      codexServiceTier={codexServiceTier}
      onCodexServiceTierChange={onCodexServiceTierChange}
      onRefreshModels={onRefreshModels}
      onClose={() => setDialogEngine(null)}
    />
    </>
  );
}
