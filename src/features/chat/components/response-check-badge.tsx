import { useMemo } from "react";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import CircleHelp from "lucide-react/dist/esm/icons/circle-help";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import { Focusable } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipPanel } from "@/components/base/tooltip/tooltip";
import { cx } from "@/utils/cx";
import {
  checkResponseSelection,
  type ResponseCheckState,
  type SelectionVerdict,
} from "../response-check";

/**
 * The response check badge — sits at the end of the tail indicator's meta
 * row ("模型 … · 推理档位 …") while a turn streams: a circled check when the
 * response's own account matches the launch selection, a circled caution
 * when it does not. Hovering opens the same rows as a card, mirroring how
 * a gateway reports "requested vs upstream".
 *
 * Renders nothing until a side was actually reported — an absent report is
 * unknown, never a pass.
 */
export function ResponseCheckBadge({
  check,
}: {
  check?: ResponseCheckState | null;
}) {
  const { t } = useTranslation();
  const view = useMemo(() => checkResponseSelection(check), [check]);
  if (!view.visible) return null;
  const ok = view.verdict !== "mismatch";
  const Icon =
    view.verdict === "unknown" ? CircleHelp : ok ? CircleCheck : CircleAlert;
  const requested = check?.requested;
  const requestedModel =
    requested?.comparisonModel === null && requested.model
      ? `${requested.model} · ${t("chat.checkUnresolved")}`
      : requested?.comparisonModel &&
          requested.comparisonModel !== requested.model
        ? `${requested.model} → ${requested.comparisonModel}`
        : (requested?.model ?? null);
  const mismatch = t("chat.checkMismatch");
  return (
    <Tooltip delay={200}>
      <Focusable>
        <button
          type="button"
          aria-label={
            view.verdict === "unknown"
              ? t("chat.checkUnknownAria")
              : ok
                ? t("chat.checkOkAria")
                : t("chat.checkMismatchAria")
          }
          className={cx(
            "inline-flex shrink-0 cursor-help items-center justify-center transition-colors",
            ok
              ? "text-foreground-icon-quaternary hover:text-text-secondary"
              : "text-text-warning-primary",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      </Focusable>
      <TooltipPanel title={t("chat.checkTitle")}>
        <CheckRow
          label={t("chat.checkRequestedModel")}
          value={requestedModel}
        />
        <CheckRow
          label={t("chat.checkServedModel")}
          value={check?.served.model ?? null}
          verdict={view.model}
          mismatch={mismatch}
        />
        <CheckRow
          label={t("chat.checkRequestedEffort")}
          value={check?.requested.effort ?? null}
        />
        <CheckRow
          label={t("chat.checkServedEffort")}
          value={check?.served.effort ?? null}
          verdict={view.effort}
          mismatch={mismatch}
        />
      </TooltipPanel>
    </Tooltip>
  );
}

/** One request/response row of the card. */
function CheckRow({
  label,
  value,
  verdict = "unknown",
  mismatch = "",
}: {
  label: string;
  value: string | null;
  verdict?: SelectionVerdict;
  mismatch?: string;
}) {
  const { t } = useTranslation();
  const unreported = value === null;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-text-tertiary">{label}</dt>
      <dd
        className={cx(
          "m-0 tabular-nums",
          unreported
            ? "text-text-tertiary"
            : verdict === "mismatch"
              ? "text-text-warning-primary"
              : "text-text-primary",
        )}
      >
        {value ?? t("chat.checkUnreported")}
        {verdict === "mismatch" && (
          <span className="ml-1 text-caption-1-regular">{mismatch}</span>
        )}
      </dd>
    </div>
  );
}
