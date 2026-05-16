import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import { openWorkspaceIn } from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { OpenAppTarget } from "../../../types";
import { useOpenAppIcons } from "../hooks/useOpenAppIcons";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "../constants";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { GENERIC_APP_ICON, getKnownOpenAppIcon } from "../utils/openAppIcons";

type OpenTarget = {
  id: string;
  label: string;
  icon: string;
  target: OpenAppTarget;
};

type OpenAppMenuProps = {
  path: string;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  iconById?: Record<string, string>;
  iconOnly?: boolean;
};

export function OpenAppMenu({
  path,
  openTargets,
  selectedOpenAppId,
  onSelectOpenAppId,
  iconById = {},
  iconOnly = false,
}: OpenAppMenuProps) {
  const { t } = useTranslation();
  const [openMenuOpen, setOpenMenuOpen] = useState(false);
  const openMenuRef = useRef<HTMLDivElement | null>(null);
  const availableTargets =
    openTargets.length > 0 ? openTargets : DEFAULT_OPEN_APP_TARGETS;
  const lazyIconById = useOpenAppIcons(availableTargets, { enabled: openMenuOpen });
  const openAppId = useMemo(
    () =>
      availableTargets.find((target) => target.id === selectedOpenAppId)?.id,
    [availableTargets, selectedOpenAppId],
  );
  const resolvedOpenAppId =
    openAppId ?? availableTargets[0]?.id ?? DEFAULT_OPEN_APP_ID;

  const resolvedOpenTargets = useMemo<OpenTarget[]>(
    () =>
      availableTargets.map((target) => ({
        id: target.id,
        label: target.label,
        icon:
          getKnownOpenAppIcon(target.id) ??
          lazyIconById[target.id] ??
          iconById[target.id] ??
          GENERIC_APP_ICON,
        target,
      })),
    [availableTargets, iconById, lazyIconById],
  );

  const fallbackTarget: OpenTarget = {
    id: DEFAULT_OPEN_APP_ID,
    label: DEFAULT_OPEN_APP_TARGETS[0]?.label ?? "Open",
    icon: getKnownOpenAppIcon(DEFAULT_OPEN_APP_ID) ?? GENERIC_APP_ICON,
    target:
      DEFAULT_OPEN_APP_TARGETS[0] ?? {
        id: DEFAULT_OPEN_APP_ID,
        label: "VS Code",
        kind: "app",
        appName: "Visual Studio Code",
        command: null,
        args: [],
      },
  };
  const selectedOpenTarget =
    resolvedOpenTargets.find((target) => target.id === resolvedOpenAppId) ??
    resolvedOpenTargets[0] ??
    fallbackTarget;
  const selectedOpenLabel = t("settings.openInTarget", {
    target: selectedOpenTarget.label,
  });
  const selectEditorLabel = t("settings.selectEditor");

  const reportOpenError = (error: unknown, target: OpenTarget) => {
    const message = error instanceof Error ? error.message : String(error);
    pushErrorToast({
      title: t("errors.couldntOpenWorkspace"),
      message,
    });
    console.warn("Failed to open workspace in target app", {
      message,
      path,
      targetId: target.id,
    });
  };

  useEffect(() => {
    if (!openMenuOpen) {
      return;
    }
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const openContains = openMenuRef.current?.contains(target) ?? false;
      if (!openContains) {
        setOpenMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => {
      window.removeEventListener("mousedown", handleClick);
    };
  }, [openMenuOpen]);

  const openWithTarget = async (target: OpenTarget) => {
    try {
      if (target.target.kind === "finder") {
        await revealItemInDir(path);
        return;
      }
      if (target.target.kind === "command") {
        if (!target.target.command) {
          return;
        }
        await openWorkspaceIn(path, {
          command: target.target.command,
          args: target.target.args,
        });
        return;
      }
      const appName = target.target.appName || target.label;
      if (!appName) {
        return;
      }
      await openWorkspaceIn(path, {
        appName,
        args: target.target.args,
      });
    } catch (error) {
      reportOpenError(error, target);
    }
  };

  const handleOpen = async () => {
    if (!selectedOpenTarget) {
      return;
    }
    await openWithTarget(selectedOpenTarget);
  };

  const handleSelectOpenTarget = async (target: OpenTarget) => {
    onSelectOpenAppId(target.id);
    writeClientStoreValue("app", "openWorkspaceApp", target.id);
    setOpenMenuOpen(false);
    await openWithTarget(target);
  };

  if (iconOnly) {
    return (
      <div className="open-app-menu is-icon-only relative inline-flex items-center [-webkit-app-region:no-drag]" ref={openMenuRef}>
        <TooltipIconButton
          className="ghost main-header-action open-app-fusion-trigger p-1.5 rounded-lg inline-flex items-center justify-center gap-[7px] h-7 px-2 border border-(--border-strong) bg-transparent text-(--text-muted) leading-none hover:bg-(--surface-control-hover) hover:text-(--text-stronger)"
          onClick={() => setOpenMenuOpen((prev) => !prev)}
          data-tauri-drag-region="false"
          aria-haspopup="menu"
          aria-expanded={openMenuOpen}
          label={selectedOpenLabel}
        >
          <img
            className="open-app-icon open-app-fusion-icon w-[19px] h-[19px] rounded-[3px] shrink-0"
            src={selectedOpenTarget.icon}
            alt=""
            aria-hidden
          />
          <ChevronDown size={14} aria-hidden />
        </TooltipIconButton>
        {openMenuOpen && (
          <div className="open-app-secondary-group popover-surface absolute left-1/2 top-[calc(100%+6px)] -translate-x-1/2 inline-flex items-center gap-1 p-1 rounded-[10px] z-20" role="menu">
            {resolvedOpenTargets.map((target) => (
              <button
                key={target.id}
                type="button"
                className={`open-app-secondary-option w-6 h-6 border border-transparent rounded-[7px] bg-transparent inline-flex items-center justify-center p-0 text-(--text-muted) hover:bg-(--surface-control-hover) hover:text-(--text-stronger) [&_.open-app-icon]:w-[18px] [&_.open-app-icon]:h-[18px]${
                  target.id === resolvedOpenAppId ? " is-active" : ""
                }`}
                onClick={() => handleSelectOpenTarget(target)}
                role="menuitem"
                data-tauri-drag-region="false"
                aria-label={target.label}
                title={target.label}
              >
                <img className="open-app-icon w-3.5 h-3.5 rounded-[3px] shrink-0" src={target.icon} alt="" aria-hidden />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="open-app-menu relative inline-flex items-center" ref={openMenuRef}>
      <div className={`open-app-button inline-flex items-stretch gap-0 border border-(--border-strong) rounded-md overflow-hidden${iconOnly ? " is-icon-only h-7 items-center" : ""}`}>
        <button
          type="button"
          className={`ghost main-header-action open-app-action p-1.5 rounded-lg inline-flex items-center justify-center py-1 px-2.5 border-none bg-transparent shadow-none${iconOnly ? " is-icon-only px-1.5 min-w-7 h-[26px]" : ""}`}
          onClick={handleOpen}
          data-tauri-drag-region="false"
          aria-label={selectedOpenLabel}
          title={selectedOpenLabel}
        >
          {iconOnly ? (
            <img
              className="open-app-icon w-3.5 h-3.5 rounded-[3px] shrink-0"
              src={selectedOpenTarget.icon}
              alt=""
              aria-hidden
            />
          ) : (
            <span className="open-app-label inline-flex items-center gap-1.5 text-xs leading-none">
              <img
                className="open-app-icon w-3.5 h-3.5 rounded-[3px] shrink-0"
                src={selectedOpenTarget.icon}
                alt=""
                aria-hidden
              />
              <span className="open-app-label-text inline">
                {selectedOpenTarget.label}
              </span>
            </span>
          )}
        </button>
        <button
          type="button"
          className={`ghost main-header-action open-app-toggle p-1 px-2 rounded-none border-l border-(--border-subtle) inline-flex items-center justify-center bg-transparent shadow-none${iconOnly ? " is-icon-only px-1 min-w-[21px] h-[26px] border-l border-(--border-subtle)" : ""}`}
          onClick={() => setOpenMenuOpen((prev) => !prev)}
          data-tauri-drag-region="false"
          aria-haspopup="menu"
          aria-expanded={openMenuOpen}
          aria-label={selectEditorLabel}
          title={selectEditorLabel}
        >
          <ChevronDown size={14} aria-hidden />
        </button>
      </div>
      {openMenuOpen && (
        <div className="open-app-dropdown absolute right-0 top-[calc(100%+8px)] min-w-40 p-1.5 rounded-xl bg-(--surface-popover) border border-(--border-muted) shadow-[0_14px_34px_rgba(0,0,0,0.3)] z-[5]" role="menu">
          {resolvedOpenTargets.map((target) => (
            <button
              key={target.id}
              type="button"
              className={`open-app-option w-full inline-flex items-center gap-2 py-1.5 px-2 rounded-lg bg-transparent text-(--text-muted) text-xs text-left hover:bg-(--surface-hover) hover:text-(--text-stronger)${
                target.id === resolvedOpenAppId ? " is-active bg-(--surface-hover) text-(--text-stronger)" : ""
              }`}
              onClick={() => handleSelectOpenTarget(target)}
              role="menuitem"
              data-tauri-drag-region="false"
            >
              <img className="open-app-icon w-3.5 h-3.5 rounded-[3px] shrink-0" src={target.icon} alt="" aria-hidden />
              {target.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
