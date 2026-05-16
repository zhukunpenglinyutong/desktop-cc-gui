import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { CustomPromptOption } from "../../../types";
import { expandCustomPromptText, getPromptArgumentHint } from "../../../utils/customPrompts";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import {
  clampRendererContextMenuPosition,
  RendererContextMenu,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import MoreHorizontal from "lucide-react/dist/esm/icons/more-horizontal";
import Plus from "lucide-react/dist/esm/icons/plus";
import ScrollText from "lucide-react/dist/esm/icons/scroll-text";
import Search from "lucide-react/dist/esm/icons/search";

type PromptPanelProps = {
  prompts: CustomPromptOption[];
  workspacePath: string | null;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  onSendPrompt: (text: string) => void | Promise<void>;
  onSendPromptToNewAgent: (text: string) => void | Promise<void>;
  onCreatePrompt: (data: {
    scope: "workspace" | "global";
    name: string;
    description?: string | null;
    argumentHint?: string | null;
    content: string;
  }) => void | Promise<void>;
  onUpdatePrompt: (data: {
    path: string;
    name: string;
    description?: string | null;
    argumentHint?: string | null;
    content: string;
  }) => void | Promise<void>;
  onDeletePrompt: (path: string) => void | Promise<void>;
  onMovePrompt: (data: { path: string; scope: "workspace" | "global" }) => void | Promise<void>;
  onRevealWorkspacePrompts: () => void | Promise<void>;
  onRevealGeneralPrompts: () => void | Promise<void>;
  canRevealGeneralPrompts: boolean;
};

const PROMPTS_PREFIX = "prompts:";

type PromptEditorState = {
  mode: "create" | "edit";
  scope: "workspace" | "global";
  name: string;
  description: string;
  argumentHint: string;
  content: string;
  path?: string;
};

function buildPromptCommand(name: string, args: string) {
  const trimmedArgs = args.trim();
  return `/${PROMPTS_PREFIX}${name}${trimmedArgs ? ` ${trimmedArgs}` : ""}`;
}

function isWorkspacePrompt(prompt: CustomPromptOption) {
  return prompt.scope === "workspace";
}

export function PromptPanel({
  prompts,
  workspacePath,
  filePanelMode: _filePanelMode,
  onFilePanelModeChange: _onFilePanelModeChange,
  onSendPrompt,
  onSendPromptToNewAgent,
  onCreatePrompt,
  onUpdatePrompt,
  onDeletePrompt,
  onMovePrompt,
  onRevealWorkspacePrompts,
  onRevealGeneralPrompts,
  canRevealGeneralPrompts,
}: PromptPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [argsByPrompt, setArgsByPrompt] = useState<Record<string, string>>({});
  const [editor, setEditor] = useState<PromptEditorState | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDeletePath, setPendingDeletePath] = useState<string | null>(null);
  const [highlightKey, setHighlightKey] = useState<string | null>(null);
  const [promptMenu, setPromptMenu] = useState<RendererContextMenuState | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const normalizedQuery = query.trim().toLowerCase();

  const showError = (error: unknown) => {
    window.alert(error instanceof Error ? error.message : String(error));
  };

  const resetEditorState = () => {
    setEditorError(null);
    setPendingDeletePath(null);
  };

  const updateEditor = (patch: Partial<PromptEditorState>) => {
    setEditor((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  useEffect(() => {
    return () => {
      if (highlightTimer.current) {
        window.clearTimeout(highlightTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!pendingDeletePath) {
      return;
    }
    const stillExists = prompts.some((prompt) => prompt.path === pendingDeletePath);
    if (!stillExists) {
      setPendingDeletePath(null);
    }
  }, [pendingDeletePath, prompts]);

  const triggerHighlight = (key: string) => {
    if (!key) {
      return;
    }
    if (highlightTimer.current) {
      window.clearTimeout(highlightTimer.current);
    }
    setHighlightKey(key);
    highlightTimer.current = window.setTimeout(() => {
      setHighlightKey(null);
    }, 650);
  };

  const buildPromptText = (prompt: CustomPromptOption, args: string) => {
    const command = buildPromptCommand(prompt.name, args);
    const expansion = expandCustomPromptText(command, [prompt]);
    if (expansion && "error" in expansion) {
      showError(expansion.error);
      return null;
    }
    if (expansion && "expanded" in expansion) {
      return expansion.expanded;
    }
    return prompt.content;
  };

  const filteredPrompts = useMemo(() => {
    if (!normalizedQuery) {
      return prompts;
    }
    return prompts.filter((prompt) => {
      const haystack = `${prompt.name} ${prompt.description ?? ""} ${prompt.path}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, prompts]);

  const { workspacePrompts, globalPrompts } = useMemo(() => {
    const workspaceEntries: CustomPromptOption[] = [];
    const globalEntries: CustomPromptOption[] = [];
    filteredPrompts.forEach((prompt) => {
      if (isWorkspacePrompt(prompt)) {
        workspaceEntries.push(prompt);
      } else {
        globalEntries.push(prompt);
      }
    });
    return { workspacePrompts: workspaceEntries, globalPrompts: globalEntries };
  }, [filteredPrompts]);

  const totalCount = filteredPrompts.length;
  const hasPrompts = totalCount > 0;

  const handleArgsChange = (key: string, value: string) => {
    setArgsByPrompt((prev) => ({ ...prev, [key]: value }));
  };

  const startCreate = (scope: "workspace" | "global") => {
    resetEditorState();
    setEditor({
      mode: "create",
      scope,
      name: "",
      description: "",
      argumentHint: "",
      content: "",
    });
  };

  const startEdit = (prompt: CustomPromptOption) => {
    const scope = isWorkspacePrompt(prompt) ? "workspace" : "global";
    resetEditorState();
    setEditor({
      mode: "edit",
      scope,
      name: prompt.name,
      description: prompt.description ?? "",
      argumentHint: prompt.argumentHint ?? "",
      content: prompt.content ?? "",
      path: prompt.path,
    });
  };

  const handleSave = async () => {
    if (!editor || isSaving) {
      return;
    }
    const name = editor.name.trim();
    if (!name) {
      setEditorError(t("common.error"));
      return;
    }
    if (/\s/.test(name)) {
      setEditorError(t("common.error"));
      return;
    }
    setEditorError(null);
    setIsSaving(true);
    const description = editor.description.trim() || null;
    const argumentHint = editor.argumentHint.trim() || null;
    const content = editor.content;
    try {
      if (editor.mode === "create") {
        await onCreatePrompt({
          scope: editor.scope,
          name,
          description,
          argumentHint,
          content,
        });
        triggerHighlight(name);
      } else if (editor.path) {
        await onUpdatePrompt({
          path: editor.path,
          name,
          description,
          argumentHint,
          content,
        });
        triggerHighlight(editor.path ?? name);
      }
      setEditor(null);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteRequest = (prompt: CustomPromptOption) => {
    if (!prompt.path) {
      return;
    }
    setPendingDeletePath(prompt.path);
  };

  const handleDeleteConfirm = async (prompt: CustomPromptOption) => {
    if (!prompt.path) {
      return;
    }
    try {
      await onDeletePrompt(prompt.path);
      setPendingDeletePath((current) =>
        current === prompt.path ? null : current,
      );
    } catch (error) {
      showError(error);
    }
  };

  const handleMove = async (prompt: CustomPromptOption, scope: "workspace" | "global") => {
    if (!prompt.path) {
      return;
    }
    try {
      await onMovePrompt({ path: prompt.path, scope });
      triggerHighlight(prompt.name);
    } catch (error) {
      showError(error);
    }
  };

  const showPromptMenu = (
    event: ReactMouseEvent<HTMLButtonElement>,
    prompt: CustomPromptOption,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const scope = isWorkspacePrompt(prompt) ? "workspace" : "global";
    const nextScope = scope === "workspace" ? "global" : "workspace";
    const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
      width: 260,
      height: 160,
    });
    setPromptMenu({
      ...position,
      label: t("prompts.promptActions"),
      items: [
        {
          type: "item",
          id: "edit",
          label: t("prompts.edit"),
          onSelect: () => {
            setPromptMenu(null);
            startEdit(prompt);
          },
        },
        {
          type: "item",
          id: "move",
          label: t("prompts.moveTo", {
            scope: nextScope === "workspace" ? t("prompts.workspace") : t("prompts.general"),
          }),
          onSelect: () => {
            setPromptMenu(null);
            void handleMove(prompt, nextScope);
          },
        },
        {
          type: "item",
          id: "delete",
          label: t("prompts.delete"),
          tone: "danger",
          onSelect: () => {
            setPromptMenu(null);
            handleDeleteRequest(prompt);
          },
        },
      ],
    });
  };

  const renderPromptRow = (prompt: CustomPromptOption) => {
    const hint = getPromptArgumentHint(prompt);
    const showArgsInput = Boolean(hint);
    const key = prompt.path || prompt.name;
    const argsValue = argsByPrompt[key] ?? "";
    const effectiveArgs = showArgsInput ? argsValue : "";
    const isHighlighted = highlightKey === prompt.path || highlightKey === prompt.name;
    return (
      <div
        className={`prompt-row flex flex-col gap-2 p-2.5 rounded-xl bg-[color:var(--surface-control)] border border-[color:var(--border-subtle)] transition-[background,border-color,box-shadow,transform] duration-[180ms] ease-out${
          isHighlighted ? " is-highlight" : ""
        }`}
        key={key}
      >
        <div className="prompt-row-header flex flex-col gap-1">
          <div className="prompt-name text-[13px] font-semibold text-[color:var(--text-emphasis)]">
            {prompt.name}
          </div>
          {prompt.description && (
            <div className="prompt-description text-xs text-[color:var(--text-subtle)]">
              {prompt.description}
            </div>
          )}
        </div>
        {hint && (
          <div className="prompt-hint text-[11px] text-[color:var(--text-faint)]">{hint}</div>
        )}
        <div className="prompt-actions flex items-center gap-2 flex-wrap">
          {showArgsInput ? (
            <input
              className="prompt-args-input flex-1 min-w-[160px] rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-emphasis)] py-1.5 px-2 text-xs placeholder:text-[color:var(--text-dim)]"
              type="text"
              placeholder={hint ?? t("prompts.arguments")}
              value={argsValue}
              onChange={(event) => handleArgsChange(key, event.target.value)}
              aria-label={t("prompts.argumentsFor", { name: prompt.name })}
            />
          ) : null}
          <button
            type="button"
            className="ghost prompt-action py-1.5 px-2.5 text-[11px] tracking-[0.04em] uppercase"
            onClick={() => {
              const text = buildPromptText(prompt, effectiveArgs);
              if (!text) {
                return;
              }
              void onSendPrompt(text);
            }}
            title={t("prompts.sendToCurrentAgent")}
          >
            {t("prompts.send")}
          </button>
          <button
            type="button"
            className="ghost prompt-action py-1.5 px-2.5 text-[11px] tracking-[0.04em] uppercase"
            onClick={() => {
              const text = buildPromptText(prompt, effectiveArgs);
              if (!text) {
                return;
              }
              void onSendPromptToNewAgent(text);
            }}
            title={t("prompts.sendToNewAgent")}
          >
            {t("prompts.newAgent")}
          </button>
          <button
            type="button"
            className="ghost icon-button prompt-action-menu"
            onClick={(event) => showPromptMenu(event, prompt)}
            aria-label={t("prompts.promptActions")}
            title={t("prompts.promptActions")}
          >
            <MoreHorizontal aria-hidden />
          </button>
        </div>
        {pendingDeletePath === prompt.path && (
          <div className="prompt-delete-confirm flex items-center gap-2 text-[11px] text-[color:var(--text-subtle)] pt-0.5">
            <span className="flex-1">{t("prompts.deletePrompt")}</span>
            <button
              type="button"
              className="ghost prompt-action py-1.5 px-2.5 text-[11px] tracking-[0.04em] uppercase"
              onClick={() => void handleDeleteConfirm(prompt)}
            >
              {t("prompts.delete")}
            </button>
            <button
              type="button"
              className="ghost prompt-action py-1.5 px-2.5 text-[11px] tracking-[0.04em] uppercase"
              onClick={() => setPendingDeletePath(null)}
            >
              {t("common.cancel")}
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="diff-panel prompt-panel [&]:gap-3">
      <div className="git-panel-header">
        <div className="prompt-panel-meta text-[11px] text-[color:var(--text-faint)]">
          {hasPrompts ? t("prompts.promptCount", { count: totalCount }) : t("prompts.noPrompts")}
        </div>
      </div>
      <div className="file-tree-search">
        <Search className="file-tree-search-icon" aria-hidden />
        <input
          className="file-tree-search-input"
          type="search"
          placeholder={t("prompts.filterPrompts")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label={t("prompts.filterPrompts")}
        />
      </div>
      <div className="prompt-panel-scroll flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto pr-0.5 pb-3">
        {editor && (
          <div className="prompt-editor flex flex-col gap-2.5 p-3 rounded-xl bg-[color:var(--surface-card)] border border-[color:var(--border-subtle)]">
            <div className="prompt-editor-row flex gap-3 flex-wrap">
              <label className="prompt-editor-label flex flex-col gap-1.5 text-[11px] text-[color:var(--text-faint)] flex-1 min-w-[160px]">
                {t("prompts.name")}
                <input
                  className="prompt-args-input rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-emphasis)] py-1.5 px-2 text-xs placeholder:text-[color:var(--text-dim)]"
                  type="text"
                  value={editor.name}
                  onChange={(event) => updateEditor({ name: event.target.value })}
                  placeholder={t("prompts.promptName")}
                />
              </label>
              <label className="prompt-editor-label flex flex-col gap-1.5 text-[11px] text-[color:var(--text-faint)] flex-1 min-w-[160px]">
                {t("prompts.scope")}
                <select
                  className="prompt-scope-select border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-emphasis)] text-xs rounded-lg py-1.5 px-2"
                  value={editor.scope}
                  onChange={(event) =>
                    updateEditor({
                      scope: event.target.value as PromptEditorState["scope"],
                    })
                  }
                  disabled={editor.mode === "edit"}
                >
                  <option value="workspace">{t("prompts.workspace")}</option>
                  <option value="global">{t("prompts.general")}</option>
                </select>
              </label>
            </div>
            <div className="prompt-editor-row flex gap-3 flex-wrap">
              <label className="prompt-editor-label flex flex-col gap-1.5 text-[11px] text-[color:var(--text-faint)] flex-1 min-w-[160px]">
                {t("prompts.description")}
                <input
                  className="prompt-args-input rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-emphasis)] py-1.5 px-2 text-xs placeholder:text-[color:var(--text-dim)]"
                  type="text"
                  value={editor.description}
                  onChange={(event) => updateEditor({ description: event.target.value })}
                  placeholder={t("prompts.optionalDescription")}
                />
              </label>
              <label className="prompt-editor-label flex flex-col gap-1.5 text-[11px] text-[color:var(--text-faint)] flex-1 min-w-[160px]">
                {t("prompts.argumentHint")}
                <input
                  className="prompt-args-input rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-emphasis)] py-1.5 px-2 text-xs placeholder:text-[color:var(--text-dim)]"
                  type="text"
                  value={editor.argumentHint}
                  onChange={(event) => updateEditor({ argumentHint: event.target.value })}
                  placeholder={t("prompts.optionalArgumentHint")}
                />
              </label>
            </div>
            <label className="prompt-editor-label flex flex-col gap-1.5 text-[11px] text-[color:var(--text-faint)] flex-1 min-w-[160px]">
              {t("prompts.content")}
              <textarea
                className="prompt-editor-textarea w-full rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-emphasis)] p-2 text-xs resize-y min-h-[120px]"
                value={editor.content}
                onChange={(event) => updateEditor({ content: event.target.value })}
                placeholder={t("prompts.promptContent")}
                rows={6}
              />
            </label>
            {editorError && (
              <div className="prompt-editor-error text-xs text-[color:var(--status-error)]">
                {editorError}
              </div>
            )}
            <div className="prompt-editor-actions flex gap-2 justify-end">
              <button
                type="button"
                className="ghost prompt-action py-1.5 px-2.5 text-[11px] tracking-[0.04em] uppercase"
                onClick={() => setEditor(null)}
                disabled={isSaving}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="ghost prompt-action py-1.5 px-2.5 text-[11px] tracking-[0.04em] uppercase"
                onClick={() => void handleSave()}
                disabled={isSaving}
              >
                {editor.mode === "create" ? t("common.create") : t("common.save")}
              </button>
            </div>
          </div>
        )}
        <div className="prompt-section flex flex-col gap-2">
          <div className="prompt-section-header flex items-center justify-between gap-2">
            <div className="prompt-section-title text-[11px] tracking-[0.08em] uppercase text-[color:var(--text-muted)]">
              {t("prompts.workspacePrompts")}
            </div>
            <button
              type="button"
              className="ghost icon-button prompt-section-add"
              onClick={() => startCreate("workspace")}
              aria-label={t("prompts.addWorkspacePrompt")}
              title={t("prompts.addWorkspacePrompt")}
            >
              <Plus aria-hidden />
            </button>
          </div>
          {workspacePrompts.length > 0 ? (
            <div className="prompt-list flex flex-col gap-2.5">
              {workspacePrompts.map((prompt) => renderPromptRow(prompt))}
            </div>
          ) : (
            <div className="prompt-empty-card flex items-center gap-3 p-3 rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-faint)]">
              <ScrollText className="prompt-empty-icon w-6 h-6 opacity-60" aria-hidden />
              <div className="prompt-empty-text">
                <div className="prompt-empty-title text-xs text-[color:var(--text-subtle)] font-semibold">
                  {t("prompts.noWorkspacePrompts")}
                </div>
                <div className="prompt-empty-subtitle text-xs text-[color:var(--text-faint)]">
                  {t("prompts.createOrDropWorkspace")}{" "}
                  {workspacePath ? (
                    <button
                      type="button"
                      className="prompt-empty-link border-0 bg-transparent p-0 m-0 font-inherit text-[color:var(--text-accent)] cursor-pointer underline underline-offset-2 hover:text-[color:var(--text-emphasis)]"
                      onClick={() => void onRevealWorkspacePrompts()}
                    >
                      {t("prompts.workspacePromptsFolder")}
                    </button>
                  ) : (
                    <span className="prompt-empty-link is-disabled text-[color:var(--text-faint)] cursor-default no-underline">
                      {t("prompts.workspacePromptsFolder")}
                    </span>
                  )}
                  .
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="prompt-section flex flex-col gap-2">
          <div className="prompt-section-header flex items-center justify-between gap-2">
            <div className="prompt-section-title text-[11px] tracking-[0.08em] uppercase text-[color:var(--text-muted)]">
              {t("prompts.globalPrompts")}
            </div>
            <button
              type="button"
              className="ghost icon-button prompt-section-add"
              onClick={() => startCreate("global")}
              aria-label={t("prompts.addGeneralPrompt")}
              title={t("prompts.addGeneralPrompt")}
            >
              <Plus aria-hidden />
            </button>
          </div>
          {globalPrompts.length > 0 ? (
            <div className="prompt-list flex flex-col gap-2.5">
              {globalPrompts.map((prompt) => renderPromptRow(prompt))}
            </div>
          ) : (
            <div className="prompt-empty-card flex items-center gap-3 p-3 rounded-xl border border-dashed border-[color:var(--border-subtle)] bg-[color:var(--surface-card)] text-[color:var(--text-faint)]">
              <ScrollText className="prompt-empty-icon w-6 h-6 opacity-60" aria-hidden />
              <div className="prompt-empty-text">
                <div className="prompt-empty-title text-xs text-[color:var(--text-subtle)] font-semibold">
                  {t("prompts.noGeneralPrompts")}
                </div>
                <div className="prompt-empty-subtitle text-xs text-[color:var(--text-faint)]">
                  {t("prompts.createOrDropGeneral")}{" "}
                  {canRevealGeneralPrompts ? (
                    <button
                      type="button"
                      className="prompt-empty-link border-0 bg-transparent p-0 m-0 font-inherit text-[color:var(--text-accent)] cursor-pointer underline underline-offset-2 hover:text-[color:var(--text-emphasis)]"
                      onClick={() => void onRevealGeneralPrompts()}
                    >
                      {t("prompts.codexHomePrompts")}
                    </button>
                  ) : (
                    <span className="prompt-empty-link is-disabled text-[color:var(--text-faint)] cursor-default no-underline">
                      {t("prompts.codexHomePrompts")}
                    </span>
                  )}
                  .
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {promptMenu ? (
        <RendererContextMenu
          menu={promptMenu}
          onClose={() => setPromptMenu(null)}
          className="renderer-context-menu prompt-panel-context-menu"
        />
      ) : null}
    </aside>
  );
}
