import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import Ellipsis from "lucide-react/dist/esm/icons/ellipsis";
import Play from "lucide-react/dist/esm/icons/play";
import Plus from "lucide-react/dist/esm/icons/plus";
import SquareTerminal from "lucide-react/dist/esm/icons/square-terminal";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { menuPopoverSurface } from "@/components/base/dropdown/menu-styles";
import { Input } from "@/components/base/input/input";
import { ModalShell } from "@/components/dialogs";
import { useFilesStore } from "@/features/files/store";
import { requestLaunchScriptEditor } from "@/features/launch-script/launch-script";
import { useTerminalStore } from "@/features/terminal/store";
import { pickFile } from "@/lib/platform";
import { cx } from "@/utils/cx";
import { usePopoverState } from "@/utils/use-dismiss-on-outside-press";
import {
  LAUNCH_SCRIPT_ACTION_ID,
  OPEN_APP_ICONS,
  OPEN_APP_TARGETS,
  TERMINAL_ACTION_ID,
  extractCustomAppIcon,
  openCustomProgram,
  openPathInTarget,
  readCustomApps,
  readPinnedIds,
  readSelectedOpenAppId,
  resolveOpenAppPath,
  subscribePinnedIds,
  writeCustomApps,
  writePinnedIds,
  writeSelectedOpenAppId,
  type CustomApp,
  type OpenAppTarget,
} from "./open-app";

/**
 * Titlebar cluster migrated from the legacy MainHeader: pinned "open in"
 * targets, the terminal dock toggle, and the "更多" menu holding every open
 * target plus the terminal row, each with a pin checkbox controlling header
 * visibility. The menu footer can add a custom program (executable path the
 * backend spawns directly), which then appears as a normal target row.
 */

const ICON_BUTTON_CLASSES = cx(
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors",
  "text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary",
  "focus-visible:ring-2 focus-visible:ring-border-focus-ring",
);

const POPOVER_CLASSES = menuPopoverSurface({
  width: "w-[240px]",
  origin: "origin-top-right",
  padding: "p-1.5",
});

/** Custom programs carry an OS icon data URL; presets use the catalog. */
function TargetIcon({ target }: { target: { id: string; label: string; icon?: string | null } }) {
  const src = target.icon ?? OPEN_APP_ICONS[target.id];
  if (src) {
    return <img src={src} alt="" aria-hidden className="size-4 shrink-0" />;
  }
  return (
    <span
      aria-hidden
      className="flex size-4 shrink-0 items-center justify-center rounded-[3px] bg-background-secondary-hover text-caption-1-semibold text-foreground-icon-primary"
    >
      {target.label.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * Two-field "add a program" dialog: display name + executable path. The path
 * comes from the native file picker on desktop and free text on web.
 */
function AddProgramDialog({
  onAdd,
  onCancel,
}: {
  onAdd: (app: CustomApp) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");

  const pickExecutable = useCallback(() => {
    void pickFile(t("openApp.addProgram.pickExecutable"), []).then((picked) => {
      if (picked) setPath(picked);
    });
  }, [t]);

  const trimmedLabel = label.trim();
  const trimmedPath = path.trim();
  const canSubmit = trimmedLabel.length > 0 && trimmedPath.length > 0;

  const submit = useCallback(() => {
    if (!canSubmit) return;
    onAdd({
      // Suffix distinguishes custom ids from the preset catalog ids.
      id: `custom:${Date.now().toString(36)}:${trimmedPath}`,
      label: trimmedLabel,
      path: trimmedPath,
    });
  }, [canSubmit, onAdd, trimmedLabel, trimmedPath]);

  return (
    <ModalShell onClose={onCancel} label={t("openApp.addProgram.add")}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-3"
      >
        <Input
          autoFocus
          label={t("openApp.addProgram.name")}
          placeholder={t("openApp.addProgram.namePlaceholder")}
          value={label}
          onChange={setLabel}
          size="small"
        />
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label={t("openApp.addProgram.executable")}
              placeholder={t("openApp.addProgram.executablePlaceholder")}
              value={path}
              onChange={setPath}
              size="small"
            />
          </div>
          <Button variant="secondary" size="small" onClick={pickExecutable} type="button">
            {t("openApp.addProgram.browse")}
          </Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="small" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="small" type="submit" disabled={!canSubmit}>
            {t("common.confirm")}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

export function HeaderOpenActions({ workspacePath }: { workspacePath: string }) {
  const { t } = useTranslation();
  // Editors open the file shown in the active editor tab; Finder always
  // reveals the workspace folder.
  const activeFilePath = useFilesStore((s) => s.activeFilePath);
  const terminalOpen = useTerminalStore((s) => s.open);
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const pinnedIds = useSyncExternalStore(subscribePinnedIds, readPinnedIds);
  const [selectedId, setSelectedId] = useState(readSelectedOpenAppId);
  const [customApps, setCustomApps] = useState<CustomApp[]>(readCustomApps);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const {
    isOpen: menuOpen,
    triggerRef,
    popoverRef,
    close: closeMenu,
    setOpen,
  } = usePopoverState();

  const openTarget = useCallback(
    async (target: OpenAppTarget | CustomApp) => {
      const path = resolveOpenAppPath(target, { workspacePath, activeFilePath });
      setOpenError(null);
      try {
        if ("path" in target) {
          await openCustomProgram(path, target);
        } else {
          await openPathInTarget(path, target);
        }
      } catch (error) {
        setOpenError(
          t("openApp.openFailed", { target: target.label, message: String(error) }),
        );
      }
    },
    [workspacePath, activeFilePath, t],
  );

  const handleSelectTarget = useCallback(
    (target: OpenAppTarget | CustomApp) => {
      setSelectedId(target.id);
      writeSelectedOpenAppId(target.id);
      closeMenu();
      void openTarget(target);
    },
    [closeMenu, openTarget],
  );

  const togglePinned = useCallback(
    (id: string) => {
      writePinnedIds(
        pinnedIds.includes(id) ? pinnedIds.filter((p) => p !== id) : [...pinnedIds, id],
      );
    },
    [pinnedIds],
  );

  const addCustomApp = useCallback(
    (app: CustomApp) => {
      setCustomApps((prev) => {
        const next = [...prev, app];
        writeCustomApps(next);
        return next;
      });
      // New programs appear in the header right away, like the presets do by
      // default.
      if (!pinnedIds.includes(app.id)) writePinnedIds([...pinnedIds, app.id]);
      setAddDialogOpen(false);
    },
    [pinnedIds],
  );

  const removeCustomApp = useCallback((id: string) => {
    setCustomApps((prev) => {
      const next = prev.filter((app) => app.id !== id);
      writeCustomApps(next);
      return next;
    });
    // Drop the pin so the header stops referencing a program that is gone.
    writePinnedIds(pinnedIds.filter((p) => p !== id));
  }, [pinnedIds]);

  // Extract OS icons for programs that don't have one yet (once per entry;
  // a failed extraction persists `null` so it is not retried every mount).
  useEffect(() => {
    const pending = customApps.filter((app) => app.icon === undefined);
    if (pending.length === 0) return;
    let cancelled = false;
    void Promise.all(
      pending.map(async (app) => ({ id: app.id, icon: await extractCustomAppIcon(app) })),
    ).then((results) => {
      if (cancelled) return;
      const iconById = new Map(results.map((result) => [result.id, result.icon]));
      setCustomApps((prev) => {
        const next = prev.map((app) =>
          app.icon === undefined && iconById.has(app.id)
            ? { ...app, icon: iconById.get(app.id) ?? null }
            : app,
        );
        writeCustomApps(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [customApps]);

  // Set form of pinnedIds: lookups below run once per target per render.
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  const terminalPinned = pinnedIdSet.has(TERMINAL_ACTION_ID);
  const terminalLabel = t("openApp.terminal");
  const showInHeaderLabel = t("openApp.showInHeader");

  const renderTargetRow = (target: OpenAppTarget | CustomApp) => {
    const isCustom = "path" in target;
    return (
      <div
        key={target.id}
        className={cx(
          "flex items-center gap-1 rounded-2lg pr-1.5",
          target.id === selectedId && "bg-background-secondary-default",
          // External-app targets are desktop-only; mobile keeps the
          // terminal row below.
          "max-md:hidden",
        )}
      >
        <button
          type="button"
          onClick={() => handleSelectTarget(target)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-2lg p-2 text-left outline-none transition-colors hover:bg-background-primary-hover focus-visible:bg-background-primary-hover"
        >
          <TargetIcon target={target} />
          <span className="truncate text-body-medium text-text-primary">{target.label}</span>
        </button>
        {isCustom && (
          <button
            type="button"
            title={t("openApp.removeProgram")}
            aria-label={t("openApp.removeProgram")}
            onClick={() => removeCustomApp(target.id)}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary outline-none transition-colors hover:bg-background-primary-hover hover:text-foreground-icon-primary focus-visible:bg-background-primary-hover"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        )}
        <Checkbox
          size="sm"
          isSelected={pinnedIdSet.has(target.id)}
          onChange={() => togglePinned(target.id)}
          aria-label={showInHeaderLabel}
        />
      </div>
    );
  };

  return (
    <div className="flex items-center gap-0.5 px-1.5">
      {openError && (
        <ModalShell onClose={() => setOpenError(null)} label={t("openApp.openFailedTitle")}>
          <p role="alert" className="break-words text-body-medium text-text-error-primary">
            {openError}
          </p>
          <div className="mt-4 flex justify-end">
            <Button size="small" onClick={() => setOpenError(null)}>
              {t("common.close")}
            </Button>
          </div>
        </ModalShell>
      )}
      {OPEN_APP_TARGETS.flatMap((target) => {
        if (!pinnedIdSet.has(target.id)) return [];
        return [
          <button
            key={target.id}
            type="button"
            title={t("openApp.openIn", { target: target.label })}
            aria-label={t("openApp.openIn", { target: target.label })}
            onClick={() => void openTarget(target)}
            className={cx(ICON_BUTTON_CLASSES, "max-md:hidden")}
          >
            <img src={OPEN_APP_ICONS[target.id]} alt="" aria-hidden className="size-4" />
          </button>,
        ];
      })}
      {customApps.flatMap((app) => {
        if (!pinnedIdSet.has(app.id)) return [];
        return [
          <button
            key={app.id}
            type="button"
            title={t("openApp.openIn", { target: app.label })}
            aria-label={t("openApp.openIn", { target: app.label })}
            onClick={() => void openTarget(app)}
            className={cx(ICON_BUTTON_CLASSES, "max-md:hidden")}
          >
            <TargetIcon target={app} />
          </button>,
        ];
      })}
      {terminalPinned && (
        <button
          type="button"
          title={terminalLabel}
          aria-label={terminalLabel}
          aria-pressed={terminalOpen}
          onClick={() => toggleTerminal(workspacePath)}
          className={cx(
            ICON_BUTTON_CLASSES,
            terminalOpen && "bg-background-secondary-hover text-foreground-icon-primary",
          )}
        >
          <SquareTerminal className="size-4" aria-hidden />
        </button>
      )}
      <AriaDialogTrigger isOpen={menuOpen} onOpenChange={setOpen}>
        <AriaButton
          ref={triggerRef}
          aria-label={t("openApp.more")}
          className={ICON_BUTTON_CLASSES}
        >
          <Ellipsis className="size-4" aria-hidden />
        </AriaButton>
        <AriaPopover
          ref={popoverRef}
          isNonModal
          placement="bottom end"
          offset={6}
          className={POPOVER_CLASSES}
        >
          <AriaDialog aria-label={t("openApp.more")} className="outline-none">
            <div className="flex w-full flex-col gap-0.5">
              {OPEN_APP_TARGETS.map((target) => renderTargetRow(target))}
              {customApps.map((app) => renderTargetRow(app))}
              <div className="flex items-center gap-1 rounded-2lg pr-1.5">
                <button
                  type="button"
                  onClick={() => {
                    toggleTerminal(workspacePath);
                    closeMenu();
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-2lg p-2 text-left outline-none transition-colors hover:bg-background-primary-hover focus-visible:bg-background-primary-hover"
                >
                  <SquareTerminal
                    className="size-4 shrink-0 text-foreground-icon-secondary"
                    aria-hidden
                  />
                  <span className="truncate text-body-medium text-text-primary">
                    {terminalLabel}
                  </span>
                </button>
                <Checkbox
                  size="sm"
                  isSelected={terminalPinned}
                  onChange={() => togglePinned(TERMINAL_ACTION_ID)}
                  aria-label={showInHeaderLabel}
                />
              </div>

              <div className="flex items-center gap-1 rounded-2lg pr-1.5">
                <button
                  type="button"
                  onClick={() => {
                    requestLaunchScriptEditor();
                    closeMenu();
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-2lg p-2 text-left outline-none transition-colors hover:bg-background-primary-hover focus-visible:bg-background-primary-hover"
                >
                  <Play className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
                  <span className="truncate text-body-medium text-text-primary">
                    {t("launchScript.title")}
                  </span>
                </button>
                <Checkbox
                  size="sm"
                  isSelected={pinnedIdSet.has(LAUNCH_SCRIPT_ACTION_ID)}
                  onChange={() => togglePinned(LAUNCH_SCRIPT_ACTION_ID)}
                  aria-label={showInHeaderLabel}
                />
              </div>
              <div className="my-0.5 h-px bg-border-secondary" aria-hidden />
              <button
                type="button"
                onClick={() => {
                  setAddDialogOpen(true);
                  closeMenu();
                }}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-2lg p-2 text-left outline-none transition-colors hover:bg-background-primary-hover focus-visible:bg-background-primary-hover"
              >
                <Plus className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
                <span className="truncate text-body-medium text-text-primary">
                  {t("openApp.addProgram.add")}
                </span>
              </button>
            </div>
          </AriaDialog>
        </AriaPopover>
      </AriaDialogTrigger>
      {addDialogOpen && <AddProgramDialog onAdd={addCustomApp} onCancel={() => setAddDialogOpen(false)} />}
    </div>
  );
}
