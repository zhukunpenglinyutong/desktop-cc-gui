import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import ArrowRightLeft from "lucide-react/dist/esm/icons/arrow-right-left";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Copy from "lucide-react/dist/esm/icons/copy";
import Download from "lucide-react/dist/esm/icons/download";
import Upload from "lucide-react/dist/esm/icons/upload";
import type { CustomPromptOption, WorkspaceInfo } from "../../../../types";
import { useCustomPrompts } from "../../../prompts/hooks/useCustomPrompts";
import {
  consumePendingPromptCreationRequest,
  subscribePromptCreationRequests,
} from "../../../prompts/promptEvents";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type PromptSectionProps = {
  activeWorkspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
};

type PromptEditorState = {
  mode: "create" | "edit";
  scope: "workspace" | "global";
  path?: string;
  name: string;
  description: string;
  argumentHint: string;
  content: string;
};

type PromptImportPayload = {
  format?: string;
  prompts?: Array<{
    name?: string;
    description?: string;
    argumentHint?: string;
    content?: string;
    scope?: "workspace" | "global";
  }>;
};

const PROMPT_EXPORT_FORMAT = "ccgui-prompts-export-v1";

function normalizePromptScope(prompt: CustomPromptOption): "workspace" | "global" {
  return prompt.scope === "workspace" ? "workspace" : "global";
}

export function PromptSection({
  activeWorkspace,
  workspaces,
  selectedWorkspaceId,
  onWorkspaceChange,
}: PromptSectionProps) {
  const { t } = useTranslation();
  const {
    prompts,
    refreshPrompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    movePrompt,
    getWorkspacePromptsDir,
    getGlobalPromptsDir,
  } = useCustomPrompts({ activeWorkspace });
  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<"all" | "workspace" | "global">(
    "all",
  );
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editor, setEditor] = useState<PromptEditorState | null>(null);
  const [importText, setImportText] = useState("");
  const [showImport, setShowImport] = useState(false);

  const workspaceAvailable = Boolean(activeWorkspace?.id);

  const loadPrompts = useCallback(async () => {
    if (!workspaceAvailable) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await refreshPrompts();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [refreshPrompts, workspaceAvailable]);

  useEffect(() => {
    void loadPrompts();
  }, [loadPrompts]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  const filteredPrompts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return prompts.filter((prompt) => {
      const scope = normalizePromptScope(prompt);
      if (scopeFilter !== "all" && scope !== scopeFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      const haystack = `${prompt.name} ${prompt.description ?? ""} ${prompt.path}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [prompts, query, scopeFilter]);

  const groupedPrompts = useMemo(() => {
    const workspace: CustomPromptOption[] = [];
    const global: CustomPromptOption[] = [];
    filteredPrompts.forEach((prompt) => {
      if (normalizePromptScope(prompt) === "workspace") {
        workspace.push(prompt);
      } else {
        global.push(prompt);
      }
    });
    return {
      workspace,
      global,
    };
  }, [filteredPrompts]);

  const startCreate = useCallback((scope: "workspace" | "global") => {
    setEditor({
      mode: "create",
      scope,
      name: "",
      description: "",
      argumentHint: "",
      content: "",
    });
    setError(null);
  }, []);

  useEffect(() => {
    const pendingRequest = consumePendingPromptCreationRequest();
    if (pendingRequest) {
      startCreate(pendingRequest.scope);
    }
    return subscribePromptCreationRequests((request) => {
      startCreate(request.scope);
    });
  }, [startCreate]);

  const startEdit = (prompt: CustomPromptOption) => {
    setEditor({
      mode: "edit",
      scope: normalizePromptScope(prompt),
      path: prompt.path,
      name: prompt.name,
      description: prompt.description ?? "",
      argumentHint: prompt.argumentHint ?? "",
      content: prompt.content ?? "",
    });
    setError(null);
  };

  const saveEditor = async () => {
    if (!editor) {
      return;
    }
    const name = editor.name.trim();
    if (!name) {
      setError(t("settings.prompt.nameRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editor.mode === "create") {
        await createPrompt({
          scope: editor.scope,
          name,
          description: editor.description.trim() || null,
          argumentHint: editor.argumentHint.trim() || null,
          content: editor.content,
        });
        setNotice(t("settings.prompt.created"));
      } else if (editor.path) {
        await updatePrompt({
          path: editor.path,
          name,
          description: editor.description.trim() || null,
          argumentHint: editor.argumentHint.trim() || null,
          content: editor.content,
        });
        setNotice(t("settings.prompt.updated"));
      }
      await refreshPrompts();
      setEditor(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (prompt: CustomPromptOption) => {
    const ok = window.confirm(
      t("settings.prompt.deleteConfirm", { name: prompt.name }),
    );
    if (!ok) {
      return;
    }
    setError(null);
    try {
      await deletePrompt(prompt.path);
      setNotice(t("settings.prompt.deleted"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const handleMove = async (
    prompt: CustomPromptOption,
    targetScope: "workspace" | "global",
  ) => {
    setError(null);
    try {
      await movePrompt({ path: prompt.path, scope: targetScope });
      setNotice(t("settings.prompt.moved"));
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : String(moveError));
    }
  };

  const handleExportToClipboard = useCallback(async () => {
    const payload = {
      format: PROMPT_EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      prompts,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setNotice(t("settings.prompt.exported"));
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    }
  }, [prompts, t]);

  const handleImportFromJson = useCallback(async () => {
    let parsed: PromptImportPayload;
    try {
      parsed = JSON.parse(importText) as PromptImportPayload;
    } catch {
      setError(t("settings.prompt.importInvalidJson"));
      return;
    }
    const incoming = Array.isArray(parsed.prompts) ? parsed.prompts : [];
    if (incoming.length === 0) {
      setError(t("settings.prompt.importEmpty"));
      return;
    }
    setSaving(true);
    setError(null);
    let createdCount = 0;
    let updatedCount = 0;
    try {
      const existingByScopeAndName = new Map<string, CustomPromptOption>();
      prompts.forEach((prompt) => {
        const scope = normalizePromptScope(prompt);
        existingByScopeAndName.set(`${scope}:${prompt.name}`, prompt);
      });
      for (const entry of incoming) {
        const name = String(entry.name ?? "").trim();
        const content = String(entry.content ?? "");
        if (!name) {
          continue;
        }
        const scope = entry.scope === "workspace" ? "workspace" : "global";
        const key = `${scope}:${name}`;
        const matched = existingByScopeAndName.get(key);
        if (matched) {
          await updatePrompt({
            path: matched.path,
            name,
            description: entry.description?.trim() || null,
            argumentHint: entry.argumentHint?.trim() || null,
            content,
          });
          updatedCount += 1;
          continue;
        }
        await createPrompt({
          scope,
          name,
          description: entry.description?.trim() || null,
          argumentHint: entry.argumentHint?.trim() || null,
          content,
        });
        createdCount += 1;
      }
      await refreshPrompts();
      setShowImport(false);
      setImportText("");
      setNotice(
        t("settings.prompt.imported", {
          created: createdCount,
          updated: updatedCount,
        }),
      );
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setSaving(false);
    }
  }, [createPrompt, importText, prompts, refreshPrompts, t, updatePrompt]);

  return (
    <section className="settings-section">
      <div className="settings-section-title">{t("settings.prompt.title")}</div>
      <div className="settings-section-subtitle">{t("settings.prompt.description")}</div>

      <div className="settings-workspace-picker settings-workspace-picker--section settings-workspace-picker--prompt">
        <div className="settings-workspace-picker-label">
          {t("settings.workspacePickerLabel")}
        </div>
        {workspaces.length > 0 ? (
          <div className="settings-select-wrap">
            <select
              className="settings-select"
              value={selectedWorkspaceId ?? ""}
              onChange={(event) => onWorkspaceChange(event.target.value || null)}
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="settings-inline-muted">
            {t("settings.workspacePickerEmpty")}
          </div>
        )}
      </div>

      {!workspaceAvailable ? (
        <div className="settings-inline-muted">{t("settings.prompt.workspaceRequired")}</div>
      ) : (
        <>
          <div className="settings-prompt-search-row">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.prompt.searchPlaceholder")}
            />
          </div>

          <div className="settings-prompt-toolbar settings-prompt-toolbar--primary">
            <div className="settings-select-wrap settings-prompt-filter-wrap">
              <select
                className="settings-select settings-select--compact"
                value={scopeFilter}
                onChange={(event) =>
                  setScopeFilter(event.target.value as "all" | "workspace" | "global")
                }
              >
                <option value="all">{t("settings.prompt.scopeAll")}</option>
                <option value="workspace">{t("settings.prompt.scopeWorkspace")}</option>
                <option value="global">{t("settings.prompt.scopeGlobal")}</option>
              </select>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadPrompts()}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? "is-spin" : ""} />
              {t("settings.prompt.refresh")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={handleExportToClipboard}>
              <Download size={14} />
              {t("settings.prompt.exportClipboard")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowImport((prev) => !prev)}
            >
              <Upload size={14} />
              {t("settings.prompt.importFromJson")}
            </Button>
            <Button type="button" size="sm" onClick={() => startCreate("workspace")}>
              <Plus size={14} />
              {t("settings.prompt.create")}
            </Button>
          </div>

          <div className="settings-prompt-toolbar settings-prompt-toolbar--secondary">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void getWorkspacePromptsDir().then((path) => revealItemInDir(path));
              }}
            >
              <FolderOpen size={14} />
              {t("settings.prompt.revealWorkspace")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void getGlobalPromptsDir().then((path) => {
                  if (path) {
                    return revealItemInDir(path);
                  }
                  return Promise.resolve();
                });
              }}
            >
              <FolderOpen size={14} />
              {t("settings.prompt.revealGlobal")}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => startCreate("global")}>
              <Plus size={14} />
              {t("settings.prompt.createGlobal")}
            </Button>
          </div>

          {showImport && (
            <div className="settings-prompt-editor-card border border-(--border-muted) rounded-[10px] bg-(--surface-card) mt-2 p-3">
              <div className="settings-subsection-title">{t("settings.prompt.importTitle")}</div>
              <Textarea
                className="settings-prompt-textarea min-h-[140px]"
                value={importText}
                onChange={(event) => setImportText(event.target.value)}
                placeholder={t("settings.prompt.importPlaceholder")}
              />
              <div className="settings-prompt-actions mt-2.5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowImport(false);
                    setImportText("");
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="button" size="sm" onClick={() => void handleImportFromJson()} disabled={saving}>
                  <Copy size={14} />
                  {t("settings.prompt.importApply")}
                </Button>
              </div>
            </div>
          )}

          {editor && (
            <div className="settings-prompt-editor-card border border-(--border-muted) rounded-[10px] bg-(--surface-card) mt-2 p-3">
              <div className="settings-subsection-title">
                {editor.mode === "create"
                  ? t("settings.prompt.create")
                  : t("settings.prompt.edit")}
              </div>
              <div className="settings-prompt-grid grid gap-2.5 mb-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
                <label className="settings-field">
                  <span>{t("settings.prompt.name")}</span>
                  <Input
                    value={editor.name}
                    onChange={(event) =>
                      setEditor((prev) =>
                        prev ? { ...prev, name: event.target.value } : prev,
                      )
                    }
                  />
                </label>
                <label className="settings-field">
                  <span>{t("settings.prompt.scope")}</span>
                  <select
                    className="settings-select"
                    value={editor.scope}
                    onChange={(event) =>
                      setEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              scope: event.target.value as "workspace" | "global",
                            }
                          : prev,
                      )
                    }
                  >
                    <option value="workspace">{t("settings.prompt.scopeWorkspace")}</option>
                    <option value="global">{t("settings.prompt.scopeGlobal")}</option>
                  </select>
                </label>
                <label className="settings-field">
                  <span>{t("settings.prompt.descriptionLabel")}</span>
                  <Input
                    value={editor.description}
                    onChange={(event) =>
                      setEditor((prev) =>
                        prev ? { ...prev, description: event.target.value } : prev,
                      )
                    }
                  />
                </label>
                <label className="settings-field">
                  <span>{t("settings.prompt.argumentHintLabel")}</span>
                  <Input
                    value={editor.argumentHint}
                    onChange={(event) =>
                      setEditor((prev) =>
                        prev ? { ...prev, argumentHint: event.target.value } : prev,
                      )
                    }
                  />
                </label>
              </div>
              <label className="settings-field">
                <span>{t("settings.prompt.contentLabel")}</span>
                <Textarea
                  className="settings-prompt-textarea min-h-[140px]"
                  value={editor.content}
                  onChange={(event) =>
                    setEditor((prev) =>
                      prev ? { ...prev, content: event.target.value } : prev,
                    )
                  }
                />
              </label>
              <div className="settings-prompt-actions mt-2.5 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditor(null)}
                  disabled={saving}
                >
                  {t("common.cancel")}
                </Button>
                <Button type="button" size="sm" onClick={() => void saveEditor()} disabled={saving}>
                  {saving ? t("settings.saving") : t("settings.prompt.save")}
                </Button>
              </div>
            </div>
          )}

          {notice && <div className="settings-inline-success">{notice}</div>}
          {error && <div className="settings-inline-error">{error}</div>}
          {loading && <div className="settings-inline-muted">{t("settings.loading")}</div>}

          {!loading && groupedPrompts.workspace.length === 0 && groupedPrompts.global.length === 0 ? (
            <div className="settings-inline-muted">{t("settings.prompt.empty")}</div>
          ) : (
            <div className="settings-prompt-list flex flex-col gap-2">
              {groupedPrompts.workspace.length > 0 && (
                <>
                  <div className="settings-subsection-title">
                    {t("settings.prompt.scopeWorkspace")}
                  </div>
                  {groupedPrompts.workspace.map((prompt) => (
                    <div key={prompt.path} className="settings-prompt-card border border-(--border-muted) rounded-[10px] bg-(--surface-card) py-2.5 px-3">
                      <div className="settings-prompt-card-head flex items-center justify-between gap-2">
                        <div className="settings-prompt-name text-[13px] text-(--text-strong) font-semibold">{prompt.name}</div>
                        <div className="settings-prompt-card-actions flex gap-1.5 flex-wrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(prompt)}
                          >
                            <Pencil size={14} />
                            {t("common.edit")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleMove(prompt, "global")}
                          >
                            <ArrowRightLeft size={14} />
                            {t("settings.prompt.moveToGlobal")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDelete(prompt)}
                          >
                            <Trash2 size={14} />
                            {t("common.delete")}
                          </Button>
                        </div>
                      </div>
                      {prompt.description && (
                        <div className="settings-prompt-description mt-1.5 text-xs text-(--text-subtle)">{prompt.description}</div>
                      )}
                      {prompt.argumentHint && (
                        <div className="settings-prompt-meta mt-1 text-[11px] text-(--text-muted)">
                          {t("settings.prompt.argumentHintLabel")}: {prompt.argumentHint}
                        </div>
                      )}
                      <div className="settings-prompt-content-preview mt-2 text-xs text-(--text-strong) whitespace-pre-wrap break-words border-t border-dashed border-(--border-muted) pt-2 max-h-[120px] overflow-auto">
                        {prompt.content}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {groupedPrompts.global.length > 0 && (
                <>
                  <div className="settings-subsection-title">
                    {t("settings.prompt.scopeGlobal")}
                  </div>
                  {groupedPrompts.global.map((prompt) => (
                    <div key={prompt.path} className="settings-prompt-card border border-(--border-muted) rounded-[10px] bg-(--surface-card) py-2.5 px-3">
                      <div className="settings-prompt-card-head flex items-center justify-between gap-2">
                        <div className="settings-prompt-name text-[13px] text-(--text-strong) font-semibold">{prompt.name}</div>
                        <div className="settings-prompt-card-actions flex gap-1.5 flex-wrap">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(prompt)}
                          >
                            <Pencil size={14} />
                            {t("common.edit")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleMove(prompt, "workspace")}
                          >
                            <ArrowRightLeft size={14} />
                            {t("settings.prompt.moveToWorkspace")}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void handleDelete(prompt)}
                          >
                            <Trash2 size={14} />
                            {t("common.delete")}
                          </Button>
                        </div>
                      </div>
                      {prompt.description && (
                        <div className="settings-prompt-description mt-1.5 text-xs text-(--text-subtle)">{prompt.description}</div>
                      )}
                      {prompt.argumentHint && (
                        <div className="settings-prompt-meta mt-1 text-[11px] text-(--text-muted)">
                          {t("settings.prompt.argumentHintLabel")}: {prompt.argumentHint}
                        </div>
                      )}
                      <div className="settings-prompt-content-preview mt-2 text-xs text-(--text-strong) whitespace-pre-wrap break-words border-t border-dashed border-(--border-muted) pt-2 max-h-[120px] overflow-auto">
                        {prompt.content}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
