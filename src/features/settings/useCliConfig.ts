import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ipc, type CcSwitchStatus, type CliConfig, type OfficialConfigDraft } from "@/lib/ipc";
import { newId } from "@/lib/id";
import { pickFile } from "@/lib/platform";
import {
  PSEUDO_DISABLED,
  PSEUDO_LOCAL,
  notifyCliConfigChanged,
  providerEntries,
  stripConventionEnv,
  type EngineId,
  type ProviderEntry,
} from "./providers";
import type { ProviderFormValue } from "./ProviderDialog";
import { errorText } from "@/lib/errors";
/** Add (no entry) or edit (with entry) dialog state. */
type DialogState = { entry?: ProviderEntry } | null;

export interface CliConfigState {
  t: TFunction;
  config: CliConfig | null;
  engine: EngineId;
  error: string | null;
  notice: string | null;
  busy: boolean;
  dialog: DialogState;
  setDialog: Dispatch<SetStateAction<DialogState>>;
  pendingDelete: ProviderEntry | null;
  setPendingDelete: Dispatch<SetStateAction<ProviderEntry | null>>;
  /** 官方配置 edit dialog open state (claude/codex/kimi/grok only). */
  officialEditing: boolean;
  setOfficialEditing: Dispatch<SetStateAction<boolean>>;
  /** Save the edited official files; returns the error message (dialog
   *  stays open) or null on success (dialog closed). Backend re-validates. */
  saveOfficialConfig: (files: OfficialConfigDraft[]) => Promise<string | null>;
  ccStatus: CcSwitchStatus | null;
  currentId: string;
  enabled: boolean;
  entries: ProviderEntry[];
  officialActive: boolean;
  mutate: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
  activate: (id: string) => void;
  saveProvider: (value: ProviderFormValue) => void;
  confirmDelete: () => void;
  syncCcSwitch: (target: string) => Promise<void>;
  importCcSwitchFile: () => Promise<void>;
  dismissCcSwitch: () => void;
}

/**
 * State + mutation funnel for CliConfigSection.
 *
 * Semantics (single source of truth is the backend's single `current`):
 *   - Each row carries a Switch showing whether it is current; flipping a
 *     switch on makes that channel current (single-select, radio-style).
 *     Flipping the current custom channel off falls back to 官方配置; the
 *     官方配置 switch can only be turned on, never off.
 *   - 停用 is a per-CLI state (the enable switch), not a channel row.
 *   - 官方配置 is the built-in fallback (the CLI's own config file) and
 *     sits directly below the enable switch, inside the disabled-overlay
 *     wrapper.
 */
export function useCliConfig(engine: EngineId): CliConfigState {
  const { t } = useTranslation();
  const [config, setConfig] = useState<CliConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<ProviderEntry | null>(null);
  const [officialEditing, setOfficialEditing] = useState(false);
  const [ccStatus, setCcStatus] = useState<CcSwitchStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    ipc
      .getCliConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      });
    ipc
      .checkCcSwitch()
      .then((s) => {
        if (!cancelled && s.installed) setCcStatus(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Mutations go through one funnel: run → tell the chat tree → re-read.
  // Re-reading after each write keeps the UI on the backend's persisted
  // state (map order, current) instead of drifting on optimistic copies.
  const mutate = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      const result = await fn();
      notifyCliConfigChanged();
      setConfig(await ipc.getCliConfig());
      setError(null);
      return result;
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  const section = config?.[engine];
  // Unset current uses the CLI's own configuration without a channel overlay.
  const currentId = section?.current || PSEUDO_LOCAL;
  const enabled = currentId !== PSEUDO_DISABLED;
  const entries = useMemo(() => providerEntries(engine, section), [engine, section]);

  const activate = (id: string) => {
    if (id !== currentId) void mutate(() => ipc.setCurrentProvider(engine, id));
  };

  const saveProvider = (value: ProviderFormValue) => {
    const rawObj =
      dialog?.entry?.raw && typeof dialog.entry.raw === "object"
        ? (dialog.entry.raw as Record<string, unknown>)
        : {};
    let next: Record<string, unknown>;
    if (engine === "claude" || engine === "codex") {
      // The claude/codex dialogs own env/settingsConfig outright (JSON and
      // TOML editors); unknown top-level keys (source, customModels, …)
      // survive.
      next = { ...rawObj };
      for (const key of ["name", "remark", "baseUrl", "apiKey", "model", "settingsConfig", "env"]) {
        delete next[key];
      }
    } else {
      // stripConventionEnv keeps unknown fields (source, customModels, …), so
      // editing a cc-switch-imported channel preserves its origin marker.
      next = dialog?.entry ? stripConventionEnv(engine, rawObj) : {};
    }
    const put = (key: string, val: string) => {
      const trimmed = val.trim();
      if (trimmed) next[key] = trimmed;
    };
    put("name", value.name);
    put("remark", value.remark);
    put("baseUrl", value.baseUrl);
    put("apiKey", value.apiKey);
    if (engine === "claude") {
      // The JSON editor is the source of truth for env; the flat `model`
      // field is migrated into it (ANTHROPIC_MODEL) at dialog open.
      try {
        const parsed: unknown = JSON.parse(value.settingsJson || "{}");
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          next.settingsConfig = parsed;
        }
      } catch {
        // The dialog blocks submit on invalid JSON.
      }
    } else if (engine === "codex") {
      put("model", value.model);
      // The TOML/auth editors own settingsConfig.config/auth; other keys a
      // cc-switch import may have added survive.
      const sc: Record<string, unknown> = {};
      const prevSc = rawObj.settingsConfig;
      if (prevSc && typeof prevSc === "object") {
        for (const [k, v] of Object.entries(prevSc)) {
          if (k !== "config" && k !== "auth") sc[k] = v;
        }
      }
      if (value.configToml.trim()) sc.config = value.configToml.trim();
      if (value.authJson.trim()) {
        try {
          sc.auth = JSON.parse(value.authJson);
        } catch {
          // The dialog blocks submit on invalid JSON.
        }
      }
      if (Object.keys(sc).length > 0) next.settingsConfig = sc;
    } else {
      put("model", value.model);
    }
    const id = dialog?.entry?.id ?? newId();
    setDialog(null);
    void mutate(() => ipc.upsertProvider(engine, id, next));
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    void mutate(() => ipc.deleteProvider(engine, id));
  };

  /** Shared import→notice funnel. `target` is an engine id or "all" (banner).
   *  setState happens in the handler, not inside the `mutate` callback (React
   *  treats updater-style callbacks as pure and may invoke them twice). */
  const syncCcSwitch = async (target: string) => {
    const r = await mutate(() => ipc.importCcSwitch(target));
    if (!r) return;
    setCcStatus((s) => (s ? { ...s, changed: false } : s));
    setNotice(
      t("settings.cliSynced", {
        added: r.added,
        updated: r.updated,
        removed: r.removed,
      }),
    );
  };

  const importCcSwitchFile = async () => {
    const path = await pickFile(t("settings.cliImportFile"), [
      { name: "cc-switch", extensions: ["db", "json"] },
    ]);
    if (!path) return;
    const r = await mutate(() => ipc.importCcSwitchFromPath(path, engine));
    if (!r) return;
    setNotice(
      t("settings.cliSynced", {
        added: r.added,
        updated: r.updated,
        removed: r.removed,
      }),
    );
  };

  const dismissCcSwitch = () => {
    if (!ccStatus) return;
    void ipc.dismissCcSwitch(ccStatus.hash).catch(() => {});
    setCcStatus({ ...ccStatus, changed: false });
  };

  const officialActive = currentId === PSEUDO_LOCAL;

  const saveOfficialConfig = useCallback(
    async (files: OfficialConfigDraft[]): Promise<string | null> => {
      setBusy(true);
      try {
        await ipc.officialConfigWrite(engine, files);
        setOfficialEditing(false);
        return null;
      } catch (e) {
        return errorText(e);
      } finally {
        setBusy(false);
      }
    },
    [engine],
  );

  return {
    t,
    config,
    engine,
    error,
    notice,
    busy,
    dialog,
    setDialog,
    pendingDelete,
    setPendingDelete,
    officialEditing,
    setOfficialEditing,
    saveOfficialConfig,
    ccStatus,
    currentId,
    enabled,
    entries,
    officialActive,
    mutate,
    activate,
    saveProvider,
    confirmDelete,
    syncCcSwitch,
    importCcSwitchFile,
    dismissCcSwitch,
  };
}
