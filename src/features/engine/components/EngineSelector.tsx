import { useTranslation } from "react-i18next";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
} from "../../../components/ui/select";
import type { EngineType } from "../../../types";
import type { EngineDisplayInfo } from "../hooks/useEngineController";
import { EngineIcon } from "./EngineIcon";
import {
  getEngineAvailabilityStatusKey,
  isEngineSelectable,
} from "../utils/engineAvailability";
import { formatEngineVersionLabel } from "../utils/engineLabels";

type EngineSelectorProps = {
  engines: EngineDisplayInfo[];
  selectedEngine: EngineType;
  onSelectEngine: (engine: EngineType) => void;
  disabled?: boolean;
  showOnlyIfMultiple?: boolean;
  showAllEngines?: boolean;
  opencodeStatusTone?: "is-ok" | "is-runtime" | "is-fail";
};

/**
 * Engine selector dropdown component
 */
export function EngineSelector({
  engines,
  selectedEngine,
  onSelectEngine,
  disabled = false,
  showOnlyIfMultiple = true,
  showLabel = false,
  showAllEngines = true,
  opencodeStatusTone,
}: EngineSelectorProps & { showLabel?: boolean }) {
  const { t } = useTranslation();

  // Build the list of engines to show
  const engineList = showAllEngines ? engines : engines.filter((e) => e.installed);

  // Hide if only one engine is installed and showOnlyIfMultiple is true (only when not showing all)
  if (!showAllEngines && showOnlyIfMultiple) {
    const installedCount = engines.filter((e) => e.installed).length;
    if (installedCount <= 1) {
      return null;
    }
  }

  const selectedEngineInfo = engineList.find((e) => e.type === selectedEngine);

  const handleChange = (value: EngineType | null) => {
    if (!value) {
      return;
    }
    const newEngine = value as EngineType;
    if (isEngineSelectable(engineList, newEngine)) {
      onSelectEngine(newEngine);
    }
  };

  return (
    <div className="composer-select-wrap relative inline-flex w-max max-w-full min-w-0 min-h-6 cursor-pointer items-center gap-[5px] rounded-lg border border-transparent px-2 py-0.5 text-[11px] font-medium text-[var(--text-muted)] transition-[background-color,color,border-color] duration-[180ms] ease-in-out" title={selectedEngineInfo?.shortName || selectedEngine}>
      <span className="composer-icon flex items-center text-inherit [&_svg]:h-3.5 [&_svg]:w-3.5" aria-hidden>
        <EngineIcon engine={selectedEngine} size={16} />
      </span>
      {showLabel && selectedEngineInfo && (
        <span className="composer-select-value max-w-55 overflow-hidden text-ellipsis whitespace-nowrap">
          {selectedEngineInfo.shortName}
        </span>
      )}
      {selectedEngine === "opencode" && opencodeStatusTone && (
        <span
          className={`composer-engine-status-dot ml-0.5 h-2.5 w-2.5 flex-[0_0_0.625rem] rounded-full ${
            opencodeStatusTone === "is-ok"
              ? "bg-[#22c55e]"
              : opencodeStatusTone === "is-runtime"
                ? "bg-[#f59e0b]"
                : "bg-[#ef4444]"
          } ${opencodeStatusTone}`}
          aria-hidden
          title={
            opencodeStatusTone === "is-ok"
              ? "Provider connected"
              : opencodeStatusTone === "is-runtime"
                ? "Session active"
                : "Provider disconnected"
          }
        />
      )}
      <Select
        value={selectedEngine}
        onValueChange={handleChange}
      >
        <SelectTrigger
          aria-label={t("composer.engine")}
          className="composer-inline-select-trigger"
          disabled={disabled}
        />
        <SelectPopup
          side="top"
          sideOffset={8}
          align="start"
          className="composer-inline-select-popup"
        >
        {engineList.map((engine) => {
          const statusKey = getEngineAvailabilityStatusKey(engineList, engine.type);
          const statusText = statusKey ? t(statusKey) : "";
          const versionLabel = engine.availabilityState === "loading"
            ? null
            : formatEngineVersionLabel(engine);

          return (
            <SelectItem
              key={engine.type}
              value={engine.type}
              disabled={disabled || !isEngineSelectable(engineList, engine.type)}
            >
              <span className="composer-inline-select-item">
                <EngineIcon engine={engine.type} size={14} />
                <span className="composer-inline-select-item-label">
                  {engine.displayName}
                  {versionLabel ? ` (${versionLabel})` : ""}
                  {statusText ? `（${statusText}）` : ""}
                </span>
              </span>
            </SelectItem>
          );
        })}
        </SelectPopup>
      </Select>
    </div>
  );
}
