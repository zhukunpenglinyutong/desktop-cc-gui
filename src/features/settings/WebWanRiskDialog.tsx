import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { ModalShell } from "@/components/dialogs";

/** One-time warning before the 外网访问 tab is revealed: everything it enables
 *  hands a remote browser the same reach the user has on this machine. */
export function WebWanRiskDialog({
  onCancel,
  onAccept,
}: {
  onCancel: () => void;
  onAccept: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell onClose={onCancel} className="w-[420px]" label={t("settings.webWanRiskTitle")}>
      <div className="flex flex-col gap-3">
        <p className="text-body-medium text-text-error-primary">{t("settings.webWanRiskTitle")}</p>
        <p className="text-body-2-regular text-text-primary">{t("settings.webWanRiskBody")}</p>
        <p className="rounded-2lg border border-border-error-default p-3 text-body-2-regular text-text-primary">
          {t("settings.webWanRiskPoints")}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="small" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          {/* Accepting is the deliberate act, so it is the danger-styled
           *  button rather than a neutral confirm. */}
          <Button variant="danger" size="small" onClick={onAccept}>
            {t("settings.webWanRiskAccept")}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
