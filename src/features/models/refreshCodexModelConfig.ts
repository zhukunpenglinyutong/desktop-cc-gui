import { reloadCodexRuntimeConfig } from "../../services/tauri";

type RefreshCodexModelConfigOptions = {
  reloadRuntimeConfig?: typeof reloadCodexRuntimeConfig;
  refreshModels: () => Promise<void> | void;
};

export async function refreshCodexModelConfig({
  reloadRuntimeConfig = reloadCodexRuntimeConfig,
  refreshModels,
}: RefreshCodexModelConfigOptions): Promise<void> {
  await reloadRuntimeConfig();
  await refreshModels();
}
