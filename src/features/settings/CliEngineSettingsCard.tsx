/**
 * 引擎设置 rows under the enable switch, one SettingsCard with
 * hairline-separated rows:
 *   官方配置 — the CLI's own config files: 使用 (radio-style switch) + 编辑
 *     (claude/codex/kimi/grok open the multi-file editor, gated on 官方配置
 *     being active; pi/omp hand off to their models.json/models.yml editor;
 *     dsh has no native config file and hides the row).
 *   自定义 CLI 路径 — AppSettings.<engine>Bin override (dsh keeps its own
 *     picker inside DshHostSection and hides the row here). Codex hides
 *     this row: its one path control is the config-home row below, which
 *     also seeds `$home/bin/codex`.
 *   自定义配置目录 — AppSettings.codexHome (Codex only; other engines keep
 *     their implicit ~/.<engine> homes).
 *   自定义模型 — AppSettings.customModels[engine] list, merged into the chat
 *     model picker by use-engine-models.
 *
 * The official row's state lives in useCliConfig; the bin/models rows use
 * the local read-modify-write AppSettings funnel below (same discipline as
 * useDshSettings: patch onto a fresh read, never persist a stale snapshot).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { Switch } from "@/components/base/switch/switch";
import { Focusable } from "react-aria-components";
import { InfoTip, Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import { SettingsCard } from "@/components/application/settings/settings-rows";
import { ModalShell } from "@/components/dialogs";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { ipc, type AppSettings } from "@/lib/ipc";
import { pickDirectory, pickFile } from "@/lib/platform";
import { cx } from "@/utils/cx";
import { Badge, ChannelAvatar, ROW } from "./CliChannelRow";
import { notifyCliConfigChanged, PSEUDO_LOCAL, type EngineId } from "./providers";
import type { CliConfigState } from "./useCliConfig";

/** Engines whose official config the generic file editor covers. pi/omp edit
 *  their models config in the auth section; dsh has no config files at all. */
const FILE_MANAGED_ENGINES: readonly EngineId[] = ["claude", "codex", "kimi", "grok"];
/** AppSettings bin-override field per engine (dsh's picker stays in
 *  DshConnectionCard, next to the host settings it interacts with). */
const BIN_FIELDS = {
  claude: "claudeBin",
  kimi: "kimiBin",
  grok: "grokBin",
  codex: "codexBin",
  pi: "piBin",
  omp: "ompBin",
} as const;
type BinEngine = keyof typeof BIN_FIELDS;

function useEngineAppSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    void ipc.getAppSettings().then(setSettings).catch(() => {});
  }, []);
  /** Patch onto a fresh read; returns the error message or null. */
  const save = useCallback(async (patch: Partial<AppSettings>): Promise<string | null> => {
    try {
      const latest = await ipc.getAppSettings();
      const next = { ...latest, ...patch };
      await ipc.updateAppSettings(next);
      setSettings(next);
      return null;
    } catch (e) {
      return String(e);
    }
  }, []);
  return { settings, save };
}

function RowShell({
  title,
  desc,
  onClick,
  children,
}: {
  title: React.ReactNode;
  desc?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const interactive = Boolean(onClick);
  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={cx(ROW, interactive && "cursor-pointer")}
      onClick={onClick}
      onKeyDown={(e) => {
        if (!interactive || e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-center gap-1.5 text-body-regular text-text-primary">{title}</p>
        {desc && (
          <p className="truncate text-body-2-regular text-text-secondary">{desc}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function RowChevron({ label }: { label: string }) {
  return (
    <span
      aria-label={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary"
    >
      <ChevronRight className="size-4" aria-hidden />
    </span>
  );
}

// ── 官方配置 ────────────────────────────────────────────────────────────────

function OfficialRow({
  cli,
  onEdit,
}: {
  cli: CliConfigState;
  /** pi/omp: open the models.json/models.yml editor in the auth section. */
  onEdit: () => void;
}) {
  const { t, engine, officialActive, busy, requestActivate } = cli;
  // File-managed engines rewrite the native files on channel switches, so
  // editing is only meaningful while 官方配置 is live. pi/omp files are
  // never cc-gui-managed, so their editor is always available.
  const gated = FILE_MANAGED_ENGINES.includes(engine) && !officialActive;
  const editButton = (
    <Button
      variant="secondary"
      size="small"
      disabled={busy || gated}
      onClick={onEdit}
    >
      {t("settings.cliEdit")}
    </Button>
  );
  return (
    <RowShell
      title={
        <>
          <ChannelAvatar fallbackEngine={engine} />
          <span className="truncate">{t("settings.cliOfficial")}</span>
          <Badge>{t("settings.cliBuiltin")}</Badge>
        </>
      }
      desc={t("settings.cliOfficialDesc")}
      onClick={() => !busy && requestActivate(PSEUDO_LOCAL)}
    >
      <span onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
        {gated ? (
          <Tooltip>
            {/* Focusable wrapper: the disabled button can't anchor a tooltip
                itself; the span consumes TooltipTrigger's ref/handlers. */}
            <Focusable>
              <span>{editButton}</span>
            </Focusable>
            <TooltipContent>{t("settings.cliOfficialEditGate")}</TooltipContent>
          </Tooltip>
        ) : (
          editButton
        )}
        <Switch
          size="sm"
          aria-label={t("settings.cliOfficial")}
          isSelected={officialActive}
          onChange={(on) => {
            if (on) requestActivate(PSEUDO_LOCAL);
          }}
          isDisabled={busy}
        />
      </span>
    </RowShell>
  );
}

// ── 自定义 CLI 路径 ─────────────────────────────────────────────────────────

function BinPathRow({ engine }: { engine: BinEngine }) {
  const { t } = useTranslation();
  const { settings, save } = useEngineAppSettings();
  const [open, setOpen] = useState(false);
  const field = BIN_FIELDS[engine];
  const current = settings?.[field] ?? null;
  return (
    <>
      <RowShell
        title={
          <>
            <span className="truncate">
              {t("settings.cliCustomPath", { name: CLI_DISPLAY_NAMES[engine] })}
            </span>
            <InfoTip label={t("settings.cliCustomPathDesc")} />
          </>
        }
        desc={current ?? t("settings.cliCustomPathUnset")}
        onClick={() => setOpen(true)}
      >
        <RowChevron label={t("settings.cliCustomPath", { name: CLI_DISPLAY_NAMES[engine] })} />
      </RowShell>
      {open && (
        <BinPathDialog
          engine={engine}
          current={current}
          save={save}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BinPathDialog({
  engine,
  current,
  save,
  onClose,
}: {
  engine: BinEngine;
  current: string | null;
  save: (patch: Partial<AppSettings>) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(current ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const field = BIN_FIELDS[engine];

  const commit = async (value: string | null) => {
    setSaving(true);
    try {
      const failed = await save({ [field]: value });
      if (failed) setError(failed);
      else onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} className="w-[480px] max-w-[calc(100vw-32px)] p-6">
      <p className="text-title-3-medium text-text-primary">
        {t("settings.cliCustomPath", { name: CLI_DISPLAY_NAMES[engine] })}
      </p>
      <p className="mt-1.5 text-body-2-regular text-text-secondary">
        {t("settings.cliCustomPathDesc")}
      </p>
      <div className="mt-5 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            size="small"
            aria-label={t("settings.cliCustomPath", { name: CLI_DISPLAY_NAMES[engine] })}
            placeholder={t("settings.cliCustomPathUnset")}
            value={draft}
            onChange={setDraft}
          />
        </div>
        <Button
          variant="secondary"
          size="small"
          onClick={() =>
            void pickFile(t("settings.cliCustomPath", { name: CLI_DISPLAY_NAMES[engine] }), [])
              .then((path) => {
                if (path) setDraft(path);
              })
          }
        >
          {t("settings.cliCustomPathChoose")}
        </Button>
      </div>
      {error && <p className="mt-2 text-body-2-regular text-text-error-primary">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {current && (
          <Button variant="secondary" size="small" disabled={saving} onClick={() => void commit(null)}>
            {t("settings.cliCustomPathClear")}
          </Button>
        )}
        <Button variant="secondary" size="small" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="small"
          disabled={saving || !draft.trim() || draft.trim() === (current ?? "")}
          onClick={() => void commit(draft.trim())}
        >
          {t("common.confirm")}
        </Button>
      </div>
    </ModalShell>
  );
}

// ── 自定义 Codex 配置目录 ───────────────────────────────────────────────────

function CodexHomeRow() {
  const { t } = useTranslation();
  const { settings, save } = useEngineAppSettings();
  const [open, setOpen] = useState(false);
  const current = settings?.codexHome ?? null;
  return (
    <>
      <RowShell
        title={
          <>
            <span className="truncate">{t("settings.cliCustomHome", { name: CLI_DISPLAY_NAMES.codex })}</span>
            <InfoTip label={t("settings.cliCustomHomeDesc")} />
          </>
        }
        desc={current ?? t("settings.cliCustomHomeUnset")}
        onClick={() => setOpen(true)}
      >
        <RowChevron label={t("settings.cliCustomHome", { name: CLI_DISPLAY_NAMES.codex })} />
      </RowShell>
      {open && (
        <CodexHomeDialog current={current} save={save} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function CodexHomeDialog({
  current,
  save,
  onClose,
}: {
  current: string | null;
  save: (patch: Partial<AppSettings>) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(current ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const commit = async (value: string | null) => {
    setSaving(true);
    try {
      const failed = await save({ codexHome: value });
      if (failed) setError(failed);
      else {
        notifyCliConfigChanged();
        void ipc.rescanSessions().catch(() => {});
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} className="w-[480px] max-w-[calc(100vw-32px)] p-6">
      <p className="text-title-3-medium text-text-primary">
        {t("settings.cliCustomHome", { name: CLI_DISPLAY_NAMES.codex })}
      </p>
      <p className="mt-1.5 text-body-2-regular text-text-secondary">
        {t("settings.cliCustomHomeDesc")}
      </p>
      <div className="mt-5 flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input
            size="small"
            aria-label={t("settings.cliCustomHome", { name: CLI_DISPLAY_NAMES.codex })}
            placeholder={t("settings.cliCustomHomeUnset")}
            value={draft}
            onChange={setDraft}
          />
        </div>
        <Button
          variant="secondary"
          size="small"
          onClick={() =>
            void pickDirectory(t("settings.cliCustomHome", { name: CLI_DISPLAY_NAMES.codex })).then(
              (path) => {
                if (path) setDraft(path);
              },
            )
          }
        >
          {t("settings.cliCustomHomeChoose")}
        </Button>
      </div>
      {error && <p className="mt-2 text-body-2-regular text-text-error-primary">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        {current && (
          <Button variant="secondary" size="small" disabled={saving} onClick={() => void commit(null)}>
            {t("settings.cliCustomPathClear")}
          </Button>
        )}
        <Button variant="secondary" size="small" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          size="small"
          disabled={saving || !draft.trim() || draft.trim() === (current ?? "")}
          onClick={() => void commit(draft.trim())}
        >
          {t("common.confirm")}
        </Button>
      </div>
    </ModalShell>
  );
}

// ── 自定义模型 ──────────────────────────────────────────────────────────────

function CustomModelsRow({ engine }: { engine: EngineId }) {
  const { t } = useTranslation();
  const { settings, save } = useEngineAppSettings();
  const [open, setOpen] = useState(false);
  const models = settings?.customModels?.[engine] ?? [];
  return (
    <>
      <RowShell
        title={<span className="truncate">{t("settings.cliCustomModels")}</span>}
        desc={t("settings.cliCustomModelsDesc")}
        onClick={() => setOpen(true)}
      >
        {models.length > 0 && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background-tertiary-default text-[11px] font-medium text-text-secondary">
            {models.length}
          </span>
        )}
        <RowChevron label={t("settings.cliCustomModels")} />
      </RowShell>
      {open && (
        <CustomModelsDialog
          engine={engine}
          models={models}
          save={save}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CustomModelsDialog({
  engine,
  models,
  save,
  onClose,
}: {
  engine: EngineId;
  models: string[];
  save: (patch: Partial<AppSettings>) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(models);
  const [newModel, setNewModel] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const add = () => {
    const id = newModel.trim();
    if (!id) return;
    if (draft.includes(id)) {
      setError(t("settings.cliCustomModelsDup"));
      return;
    }
    setError("");
    setDraft((list) => [...list, id]);
    setNewModel("");
  };

  const commit = async () => {
    setSaving(true);
    try {
      const latest = await ipc.getAppSettings().catch(() => null);
      const failed = await save({
        customModels: { ...(latest?.customModels ?? {}), [engine]: draft },
      });
      if (failed) {
        setError(failed);
        return;
      }
      // The chat model picker merges customModels on this event.
      notifyCliConfigChanged();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell onClose={onClose} className="w-[480px] max-w-[calc(100vw-32px)] p-6">
      <p className="text-title-3-medium text-text-primary">
        {t("settings.cliCustomModels")} · {CLI_DISPLAY_NAMES[engine]}
      </p>
      <p className="mt-1.5 text-body-2-regular text-text-secondary">
        {t("settings.cliCustomModelsDialogDesc")}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        {draft.length === 0 && (
          <p className="text-body-2-regular text-text-tertiary">
            {t("settings.cliCustomModelsEmpty")}
          </p>
        )}
        {draft.map((model) => (
          <div
            key={model}
            className="flex items-center gap-2 rounded-lg border border-border-button-default px-3 py-1.5"
          >
            <span className="min-w-0 flex-1 truncate font-mono text-body-2-regular text-text-primary">
              {model}
            </span>
            <button
              type="button"
              aria-label={t("settings.cliDelete")}
              onClick={() => setDraft((list) => list.filter((m) => m !== model))}
              className="flex size-6 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              size="small"
              aria-label={t("settings.cliCustomModelsAdd")}
              placeholder={t("settings.cliCustomModelsPlaceholder")}
              value={newModel}
              onChange={(value) => {
                setNewModel(value);
                setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </div>
          <Button variant="secondary" size="small" onClick={add} disabled={!newModel.trim()}>
            {t("settings.cliCustomModelsAdd")}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-body-2-regular text-text-error-primary">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="small" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button size="small" disabled={saving} onClick={() => void commit()}>
          {t("common.confirm")}
        </Button>
      </div>
    </ModalShell>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────

export function CliEngineSettingsCard({
  cli,
  onEditOfficial,
}: {
  cli: CliConfigState;
  /** pi/omp official edit: open the models config editor in the auth
   *  section below (their files are never cc-gui-managed). */
  onEditOfficial: () => void;
}) {
  const { engine } = cli;
  return (
    <SettingsCard>
      {engine !== "dsh" && <OfficialRow cli={cli} onEdit={onEditOfficial} />}
      {engine !== "dsh" && engine !== "codex" && <BinPathRow engine={engine as BinEngine} />}
      {engine === "codex" && <CodexHomeRow />}
      <CustomModelsRow engine={engine} />
    </SettingsCard>
  );
}
