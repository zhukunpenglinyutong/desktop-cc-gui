import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalShell } from "@/components/dialogs";
import { Button } from "@/components/base/buttons/button";
import type { Workspace } from "@/lib/ipc";
import { Select, SelectItem } from "@/components/base/select/select";
import { useCliNavOrder } from "@/lib/cli-nav-order";
import { orderEngineOptions, workspaceEngineOptions } from "./components/engine-options";
import { useChatStore } from "./store";
import { useWorkspaceUIHooks } from "./workspace-ui-bridge";

type Props = { onClose: () => void } & (
  | { workspace: Workspace; unavailable?: never }
  | { workspace?: never; unavailable: { workspacePath: string; engine: string; onOpened?: () => void } }
);

export function WorkspaceEngineDialog({ workspace, unavailable, onClose }: Props) {
  const { t } = useTranslation();
  const engines = useChatStore((s) => s.engines);
  const configured = useChatStore((s) => workspace ? s.workspaceDefaultEngines[workspace.id] ?? "" : "");
  const [selected, setSelected] = useState(configured);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useWorkspaceUIHooks();
  const path = workspace?.path ?? unavailable?.workspacePath ?? "";
  const options = orderEngineOptions(workspaceEngineOptions(engines, path, t), useCliNavOrder());
  const followKey = "follow";
  const valid = (workspace != null && selected === "") || options.some((option) => option.id === selected);
  const label = (id: string) => t(`settings.engines.${id}`, { defaultValue: id });

  async function confirm() {
    if (!valid || saving) return;
    const store = useChatStore.getState();
    if (!workspace) {
      if (!workspaceEngineOptions(store.engines, path, t).some((option) => option.id === selected)) return;
      store.startNewChat(path, selected, unavailable?.onOpened);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      await store.setWorkspaceDefaultEngine(workspace.id, selected);
      onClose();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell label={t("chat.workspaceDefaultEngine")} onClose={() => { if (!saving) onClose(); }}>
      <div className="flex flex-col gap-2 text-body-medium">
        <span>{t("chat.workspaceDefaultEngine")}</span>
        {unavailable && <span>{t("chat.workspaceEngineUnavailable", { engine: label(unavailable.engine) })}</span>}
        <Select
          aria-label={t("chat.workspaceDefaultEngine")}
          selectedKey={selected || (workspace ? followKey : null)}
          onSelectionChange={(key) => setSelected(key === followKey || key == null ? "" : String(key))}
          isDisabled={saving}
          placeholder={t("chat.workspaceDefaultEngine")}
        >
          {workspace && <SelectItem id={followKey}>{t("chat.workspaceFollowEngine")}</SelectItem>}
          {configured && !options.some((option) => option.id === configured) && (
            <SelectItem id={configured} isDisabled>{t("chat.workspaceEngineUnavailable", { engine: label(configured) })}</SelectItem>
          )}
          {options.map((option) => <SelectItem key={option.id} id={option.id}>{option.label}</SelectItem>)}
        </Select>
      </div>
      {options.length === 0 && <p>{t("chat.workspaceNoEngine")}</p>}
      {error && <p role="alert">{t("chat.workspaceEngineSaveFailed")}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="small" disabled={saving} onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" size="small" disabled={!valid || saving} onClick={() => void confirm()}>{t("common.confirm")}</Button>
      </div>
    </ModalShell>
  );
}
