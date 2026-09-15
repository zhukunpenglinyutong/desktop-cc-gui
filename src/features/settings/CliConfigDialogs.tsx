import { ConfirmDialog } from "@/components/dialogs";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { ProviderDialog } from "./ProviderDialog";
import {
  claudeSettingsJson,
  codexAuthJson,
  codexConfigToml,
} from "./providers";
import type { CliConfigState } from "./useCliConfig";

/** Add/edit provider dialog; the stored settingsConfig becomes the initial
 *  editor text for claude (settings.json) and codex (config.toml/auth.json). */
export function CliProviderDialog({ cli }: { cli: CliConfigState }) {
  const { t, engine, dialog, setDialog, saveProvider } = cli;
  if (!dialog) return null;
  return (
    <ProviderDialog
      engine={engine}
      title={
        dialog.entry
          ? t("settings.cliDialogEdit")
          : t("settings.cliDialogAddEngine", { name: CLI_DISPLAY_NAMES[engine] })
      }
      initial={
        dialog.entry
          ? {
              name: dialog.entry.name,
              remark: dialog.entry.remark,
              baseUrl: dialog.entry.baseUrl,
              apiKey: dialog.entry.apiKey,
              model: dialog.entry.model,
              settingsJson: engine === "claude" ? claudeSettingsJson(dialog.entry.raw) : "",
              configToml: engine === "codex" ? codexConfigToml(dialog.entry.raw) : "",
              authJson: engine === "codex" ? codexAuthJson(dialog.entry.raw) : "",
            }
          : undefined
      }
      onSubmit={saveProvider}
      onCancel={() => setDialog(null)}
    />
  );
}

/** Channel deletion confirmation. */
export function CliDeleteConfirm({ cli }: { cli: CliConfigState }) {
  const { t, pendingDelete, setPendingDelete, confirmDelete } = cli;
  if (!pendingDelete) return null;
  return (
    <ConfirmDialog
      danger
      message={t("settings.cliDeleteConfirm", { name: pendingDelete.name })}
      onConfirm={confirmDelete}
      onCancel={() => setPendingDelete(null)}
    />
  );
}
