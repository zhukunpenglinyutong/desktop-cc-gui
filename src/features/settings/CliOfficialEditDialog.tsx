/**
 * 编辑官方配置 dialog: one raw-text pane per native config file of the
 * engine's 官方配置 (claude settings.json; codex config.toml + auth.json;
 * kimi/grok config.toml). Panes come from `official_config_read`, so the
 * frontend never hardcodes paths or formats.
 *
 * The backend retires known legacy channel writes before reading these
 * files; migration conflicts are shown without overwriting either copy.
 */
import { useEffect, useState } from "react";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { TextArea } from "@/components/base/input/textarea";
import { ModalShell } from "@/components/dialogs";
import { ipc, type OfficialConfigFile } from "@/lib/ipc";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import type { CliConfigState } from "./useCliConfig";
import { errorText } from "@/lib/errors";

/** Client-side JSON check so the save button disables before the round-trip;
 *  TOML panes rely on the backend's parse error, shown inline. */
function jsonErrorOf(format: string, content: string): string | null {
  if (format !== "json") return null;
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "object";
    return null;
  } catch {
    return "syntax";
  }
}

export function CliOfficialEditDialog({ cli }: { cli: CliConfigState }) {
  const { t, engine, officialEditing, setOfficialEditing, saveOfficialConfig, busy } = cli;
  const [files, setFiles] = useState<OfficialConfigFile[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");

  // Adjust state during render (React's recommended pattern): a changed edit
  // target — dialog reopened or another engine picked — restarts from fresh
  // panes without the stale flash a reset effect would paint after commit.
  const editTarget = officialEditing ? engine : null;
  const [prevEditTarget, setPrevEditTarget] = useState(editTarget);
  if (editTarget !== prevEditTarget) {
    setPrevEditTarget(editTarget);
    setFiles(null);
    setDrafts({});
    setLoadError("");
    setSaveError("");
  }

  useEffect(() => {
    if (!officialEditing) return;
    let cancelled = false;
    ipc
      .officialConfigRead(engine)
      .then((read) => {
        if (cancelled) return;
        setFiles(read);
        // A missing JSON file seeds an empty object so the first save passes
        // the must-be-an-object validation.
        setDrafts(
          Object.fromEntries(
            read.map((f) => [f.path, f.exists || f.content ? f.content : "{\n}\n"]),
          ),
        );
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorText(e));
      });
    return () => {
      cancelled = true;
    };
  }, [officialEditing, engine]);

  if (!officialEditing) return null;

  const invalid = (files ?? []).some((f) => jsonErrorOf(f.format, drafts[f.path] ?? "") != null);

  const formatJson = (path: string) => {
    try {
      const parsed: unknown = JSON.parse(drafts[path] ?? "");
      setDrafts((d) => ({ ...d, [path]: JSON.stringify(parsed, null, 2) + "\n" }));
    } catch {
      // Malformed JSON stays as typed; the per-pane hint already flags it.
    }
  };

  const save = async () => {
    setSaveError("");
    const error = await saveOfficialConfig(
      (files ?? []).map((f) => ({ path: f.path, content: drafts[f.path] ?? "" })),
    );
    if (error) setSaveError(error);
  };

  return (
    <ModalShell
      onClose={() => setOfficialEditing(false)}
      className="max-h-[calc(100vh-48px)] w-[640px] max-w-[calc(100vw-32px)] overflow-y-auto p-6"
    >
      <div className="flex items-start justify-between gap-4">
        <p className="text-title-3-medium text-text-primary">
          {t("settings.cliOfficialEditTitle", { name: CLI_DISPLAY_NAMES[engine] })}
        </p>
        <button
          type="button"
          aria-label={t("common.cancel")}
          onClick={() => setOfficialEditing(false)}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p className="mt-1.5 text-body-2-regular text-text-secondary">
        {t("settings.cliOfficialEditDesc")}
      </p>

      <div className="mt-5 flex flex-col gap-5">
        {loadError && <p className="text-body-2-regular text-text-error-primary">{loadError}</p>}
        {!files && !loadError && (
          <p className="text-body-2-regular text-text-tertiary">{t("common.loading")}</p>
        )}
        {files?.map((file) => {
          const draft = drafts[file.path] ?? "";
          const jsonError = jsonErrorOf(file.format, draft);
          return (
            <div key={file.path} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <code className="min-w-0 flex-1 truncate font-mono text-body-2-regular text-text-secondary">
                  {file.path}
                </code>
                {file.format === "json" && (
                  <button
                    type="button"
                    onClick={() => formatJson(file.path)}
                    className="shrink-0 rounded-lg border border-border-button-default px-2 py-0.5 text-body-2-medium text-text-secondary transition-colors hover:bg-background-secondary-hover"
                  >
                    {t("settings.cliFormatJson")}
                  </button>
                )}
              </div>
              <TextArea
                mono
                rows={file.format === "json" && files.length > 1 ? 6 : 12}
                spellCheck={false}
                aria-label={file.path}
                value={draft}
                onChange={(content) =>
                  setDrafts((d) => ({ ...d, [file.path]: content }))
                }
                isInvalid={jsonError != null}
                hint={
                  jsonError === "object"
                    ? t("settings.cliOfficialEditJsonObject")
                    : jsonError
                      ? t("settings.cliOfficialEditJsonInvalid")
                      : undefined
                }
                inputClassName="whitespace-pre"
              />
            </div>
          );
        })}
        {saveError && <p className="text-body-2-regular text-text-error-primary">{saveError}</p>}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="small" onClick={() => setOfficialEditing(false)}>
          {t("common.cancel")}
        </Button>
        <Button
          size="small"
          disabled={busy || !files || invalid || Boolean(loadError)}
          onClick={() => void save()}
        >
          {t("common.confirm")}
        </Button>
      </div>
    </ModalShell>
  );
}
