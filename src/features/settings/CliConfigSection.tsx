import type { EngineId } from "./providers";
import { CliConfigBody } from "./CliConfigBody";
import { CliDeleteConfirm, CliProviderDialog } from "./CliConfigDialogs";
import { CliOfficialEditDialog } from "./CliOfficialEditDialog";
import { useCliConfig } from "./useCliConfig";

/**
 * One CLI's page under the CLI 管理 nav group — the BoardUI ai-chat "Tools"
 * template language:
 *   引擎设置 card (enable switch)
 *   → 官方配置 / auth / 供应商渠道 under one disabled-overlay wrapper
 *   → empty state.
 *
 * State and mutations live in useCliConfig; the loaded UI is CliConfigBody
 * and the dialogs are CliConfigDialogs.
 */
export function CliConfigSection({ engine }: { engine: EngineId }) {
  const cli = useCliConfig(engine);
  const { t, config, error, notice } = cli;
  return (
    <div className="flex w-full flex-col gap-6">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-body-regular text-text-secondary">
          {notice}
        </p>
      )}
      {!config && !error && (
        <p className="text-body-regular text-text-tertiary">{t("common.loading")}</p>
      )}
      {config && <CliConfigBody cli={cli} />}
      <CliProviderDialog cli={cli} />
      <CliOfficialEditDialog cli={cli} />
      <CliDeleteConfirm cli={cli} />
    </div>
  );
}
