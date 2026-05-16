import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { OpenAppTarget } from "@/types";
import { useOpenAppIcons } from "../../../../app/hooks/useOpenAppIcons";
import { GENERIC_APP_ICON, getKnownOpenAppIcon } from "../../../../app/utils/openAppIcons";
import type { OpenAppDraft } from "../actions/settingsViewActions";

type OpenAppsSectionProps = {
  active: boolean;
  t: (key: string) => string;
  openAppDrafts: OpenAppDraft[];
  openAppIconById: Record<string, string>;
  openAppSelectedId: string;
  handleOpenAppDraftChange: (index: number, patch: Partial<OpenAppDraft>) => void;
  handleCommitOpenApps: (drafts: OpenAppDraft[]) => Promise<void>;
  handleOpenAppKindChange: (index: number, kind: OpenAppTarget["kind"]) => void;
  handleSelectOpenAppDefault: (id: string) => void;
  handleMoveOpenApp: (index: number, direction: "up" | "down") => void;
  handleDeleteOpenApp: (index: number) => void;
  handleAddOpenApp: () => void;
};

export function OpenAppsSection({
  active,
  t,
  openAppDrafts,
  openAppIconById,
  openAppSelectedId,
  handleOpenAppDraftChange,
  handleCommitOpenApps,
  handleOpenAppKindChange,
  handleSelectOpenAppDefault,
  handleMoveOpenApp,
  handleDeleteOpenApp,
  handleAddOpenApp,
}: OpenAppsSectionProps) {
  const lazyIconById = useOpenAppIcons(openAppDrafts, { enabled: active });

  if (!active) {
    return null;
  }

  return (
    <section className="settings-section w-full max-w-[980px]">
      <div className="settings-section-title text-[15px] font-semibold text-(--text-strong) mb-1">{t("settings.openInTitle")}</div>
      <div className="settings-section-subtitle text-xs text-(--text-subtle) mb-4">
        {t("settings.openInDescription")}
      </div>
      <div className="settings-open-apps flex flex-col gap-2">
        {openAppDrafts.map((target, index) => {
          const iconSrc =
            getKnownOpenAppIcon(target.id) ??
            lazyIconById[target.id] ??
            openAppIconById[target.id] ??
            GENERIC_APP_ICON;
          return (
            <div key={target.id} className="settings-open-app-row">
              <div className="settings-open-app-icon-wrap" aria-hidden>
                <img
                  className="settings-open-app-icon"
                  src={iconSrc}
                  alt=""
                  width={18}
                  height={18}
                />
              </div>
              <div className="settings-open-app-fields">
                <label className="settings-open-app-field settings-open-app-field--label">
                  <span className="settings-visually-hidden">{t("settings.label")}</span>
                  <input
                    className="settings-input settings-input--compact settings-open-app-input settings-open-app-input--label"
                    value={target.label}
                    placeholder={t("settings.label")}
                    onChange={(event) =>
                      handleOpenAppDraftChange(index, {
                        label: event.target.value,
                      })
                    }
                    onBlur={() => {
                      void handleCommitOpenApps(openAppDrafts);
                    }}
                    aria-label={`Open app label ${index + 1}`}
                  />
                </label>
                <label className="settings-open-app-field settings-open-app-field--type">
                  <span className="settings-visually-hidden">{t("settings.type")}</span>
                  <select
                    className="settings-select settings-select--compact settings-open-app-kind"
                    value={target.kind}
                    onChange={(event) =>
                      handleOpenAppKindChange(
                        index,
                        event.target.value as OpenAppTarget["kind"],
                      )
                    }
                    aria-label={`Open app type ${index + 1}`}
                  >
                    <option value="app">{t("settings.typeApp")}</option>
                    <option value="command">{t("settings.typeCommand")}</option>
                    <option value="finder">{t("settings.typeFinder")}</option>
                  </select>
                </label>
                {target.kind === "app" && (
                  <label className="settings-open-app-field settings-open-app-field--appname">
                    <span className="settings-visually-hidden">{t("settings.appName")}</span>
                    <input
                      className="settings-input settings-input--compact settings-open-app-input settings-open-app-input--appname"
                      value={target.appName ?? ""}
                      placeholder={t("settings.appName")}
                      onChange={(event) =>
                        handleOpenAppDraftChange(index, {
                          appName: event.target.value,
                        })
                      }
                      onBlur={() => {
                        void handleCommitOpenApps(openAppDrafts);
                      }}
                      aria-label={`Open app name ${index + 1}`}
                    />
                  </label>
                )}
                {target.kind === "command" && (
                  <label className="settings-open-app-field settings-open-app-field--command">
                    <span className="settings-visually-hidden">{t("settings.command")}</span>
                    <input
                      className="settings-input settings-input--compact settings-open-app-input settings-open-app-input--command"
                      value={target.command ?? ""}
                      placeholder={t("settings.command")}
                      onChange={(event) =>
                        handleOpenAppDraftChange(index, {
                          command: event.target.value,
                        })
                      }
                      onBlur={() => {
                        void handleCommitOpenApps(openAppDrafts);
                      }}
                      aria-label={`Open app command ${index + 1}`}
                    />
                  </label>
                )}
                {target.kind !== "finder" && (
                  <label className="settings-open-app-field settings-open-app-field--args">
                    <span className="settings-visually-hidden">{t("settings.args")}</span>
                    <input
                      className="settings-input settings-input--compact settings-open-app-input settings-open-app-input--args"
                      value={target.argsText}
                      placeholder={t("settings.args")}
                      onChange={(event) =>
                        handleOpenAppDraftChange(index, {
                          argsText: event.target.value,
                        })
                      }
                      onBlur={() => {
                        void handleCommitOpenApps(openAppDrafts);
                      }}
                      aria-label={`Open app args ${index + 1}`}
                    />
                  </label>
                )}
              </div>
              <div className="settings-open-app-actions">
                <label className="settings-open-app-default">
                  <input
                    type="radio"
                    name="open-app-default"
                    checked={target.id === openAppSelectedId}
                    onChange={() => handleSelectOpenAppDefault(target.id)}
                  />
                  {t("settings.defaultRadio")}
                </label>
                <div className="settings-open-app-order">
                  <button
                    type="button"
                    className="ghost icon-button"
                    onClick={() => handleMoveOpenApp(index, "up")}
                    disabled={index === 0}
                    aria-label={t("settings.moveUp")}
                  >
                    <ChevronUp aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="ghost icon-button"
                    onClick={() => handleMoveOpenApp(index, "down")}
                    disabled={index === openAppDrafts.length - 1}
                    aria-label={t("settings.moveDown")}
                  >
                    <ChevronDown aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  className="ghost icon-button"
                  onClick={() => handleDeleteOpenApp(index)}
                  disabled={openAppDrafts.length <= 1}
                  aria-label={t("settings.removeAppAriaLabel")}
                  title={t("settings.removeApp")}
                >
                  <Trash2 aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="settings-open-app-footer">
        <button
          type="button"
          className="ghost"
          onClick={handleAddOpenApp}
        >
          {t("settings.addApp")}
        </button>
        <div className="settings-help">
          {t("settings.openInHelp")}
        </div>
      </div>
    </section>
  );
}
