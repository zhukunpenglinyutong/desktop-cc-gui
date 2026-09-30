import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import FileText from "lucide-react/dist/esm/icons/file-text";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderInput from "lucide-react/dist/esm/icons/folder-input";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import Search from "lucide-react/dist/esm/icons/search";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import {
  SettingsCard,
  SettingsSectionLabel,
} from "@/components/application/settings/settings-rows";
import { Button } from "@/components/base/buttons/button";
import {
  Dropdown,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { EmptyState } from "@/components/base/empty-state";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { ConfirmDialog } from "@/components/dialogs";
import { useChatStore } from "@/features/chat/store";
import {
  createPrompt,
  deletePrompt,
  matchPrompts,
  movePrompt,
  updatePrompt,
  usePromptStore,
} from "@/features/prompts/prompt-store";
import { ipc, type CustomPromptEntry, type PromptScope } from "@/lib/ipc";
import { Badge, ROW } from "../CliChannelRow";
import { PromptEditorDialog, type PromptEditorValue } from "./PromptEditorDialog";

type ScopeFilter = "all" | PromptScope;

/** Same affordance the message rows use: bare icon, hover-revealed chrome. */
const ICON_BUTTON =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary";

/** Compact select trigger (h 32, radius/lg), matching the settings pages'
 *  (外观 / 对话与输入) rows. */
const SELECT_TRIGGER = "w-32";

function PromptRow({
  entry,
  onEdit,
  onMove,
  onDelete,
}: {
  entry: CustomPromptEntry;
  onEdit: () => void;
  onMove: (scope: PromptScope) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={ROW}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-2lg bg-background-tertiary-default text-foreground-icon-primary">
        <FileText className="size-4" aria-hidden />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="flex items-center gap-1.5 text-body-regular text-text-primary">
          <span className="truncate">{entry.name}</span>
          <Badge>
            {entry.scope === "workspace"
              ? t("settings.promptScopeWorkspace")
              : t("settings.promptScopeGlobal")}
          </Badge>
        </p>
        {(entry.description || entry.argumentHint) && (
          <p className="truncate text-body-2-regular text-text-secondary">
            {[entry.description, entry.argumentHint].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label={t("settings.promptEdit")}
        title={t("settings.promptEdit")}
        onClick={onEdit}
        className={ICON_BUTTON}
      >
        <Pencil className="size-4" aria-hidden />
      </button>
      <Dropdown>
        <DropdownTrigger
          aria-label={t("settings.promptMove")}
          className={ICON_BUTTON}
        >
          <FolderInput className="size-4" aria-hidden />
        </DropdownTrigger>
        <DropdownPopover aria-label={t("settings.promptMove")} className="w-44">
          <DropdownItem
            selected={entry.scope === "workspace"}
            onSelect={() => entry.scope !== "workspace" && onMove("workspace")}
          >
            {t("settings.promptMoveToWorkspace")}
          </DropdownItem>
          <DropdownItem
            selected={entry.scope === "global"}
            onSelect={() => entry.scope !== "global" && onMove("global")}
          >
            {t("settings.promptMoveToGlobal")}
          </DropdownItem>
        </DropdownPopover>
      </Dropdown>
      <button
        type="button"
        aria-label={t("settings.promptDelete")}
        title={t("settings.promptDelete")}
        onClick={onDelete}
        className={ICON_BUTTON}
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/**
 * Custom-prompt library pane for the active workspace: scope filter + search
 * + create/open-folder toolbar over a card list. The store is per-root
 * (stale-while-revalidate); the standalone CRUD exports refresh the root and
 * dispatch the changed event themselves, so the pane never calls refresh.
 * Without an active workspace the IPC needs no root path, so the pane gates
 * on one (workspace prompts live under <root>/.ccgui/prompts).
 */
export function PromptsPane() {
  const { t } = useTranslation();
  const root = useChatStore((s) => s.active?.workspacePath) ?? "";
  const cache = usePromptStore((s) => (root ? s.byRoot[root] : undefined));

  const [query, setQuery] = useState("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<CustomPromptEntry | "new" | null>(null);
  const [deleting, setDeleting] = useState<CustomPromptEntry | null>(null);

  useEffect(() => {
    if (root) usePromptStore.getState().ensure(root);
  }, [root]);

  const reportFailure = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const entries = useMemo(() => {
    const matched = matchPrompts(cache?.entries ?? [], query);
    return scopeFilter === "all"
      ? matched
      : matched.filter((entry) => entry.scope === scopeFilter);
  }, [cache?.entries, query, scopeFilter]);

  const submitEditor = (value: PromptEditorValue) => {
    const target = editing;
    setEditing(null);
    setError(null);
    if (target === "new") {
      void createPrompt(root, value.scope, value).catch(reportFailure);
    } else if (target) {
      void updatePrompt(root, target.path, {
        name: value.name,
        description: value.description,
        argumentHint: value.argumentHint,
        content: value.content,
      }).catch(reportFailure);
    }
  };

  const confirmDelete = () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    setError(null);
    void deletePrompt(root, target.path).catch(reportFailure);
  };

  const openDir = () => {
    setError(null);
    void ipc
      .promptsDirs(root)
      .then((dirs) =>
        ipc.revealInFileManager(scopeFilter === "global" ? dirs.global : dirs.workspace),
      )
      .catch(reportFailure);
  };

  if (!root) {
    return (
      <EmptyState className="rounded-2xl border border-dashed border-border-button-default px-4 py-8">
        <p className="text-body-2-regular text-text-secondary">
          {t("settings.promptWorkspaceRequired")}
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="flex w-full flex-col gap-2">
      {error && (
        <p role="alert" className="text-body-regular text-text-error-primary">
          {t("common.error")}: {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <SettingsSectionLabel>
          {t("settings.prompts")}
          <span className="ml-2 text-body-2-regular font-normal text-text-tertiary">
            {t("settings.promptSectionDesc")}
          </span>
        </SettingsSectionLabel>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="small"
            leadingIcon={FolderOpen}
            onClick={openDir}
          >
            {t("settings.promptOpenDir")}
          </Button>
          <Button size="small" leadingIcon={Plus} onClick={() => setEditing("new")}>
            {t("settings.promptNew")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select
          aria-label={t("settings.promptScope")}
          selectedKey={scopeFilter}
          onSelectionChange={(key) =>
            setScopeFilter(key === "workspace" || key === "global" ? key : "all")
          }
          size="sm"
          triggerClassName={SELECT_TRIGGER}
        >
          <SelectItem id="all">{t("settings.promptScopeAll")}</SelectItem>
          <SelectItem id="workspace">{t("settings.promptScopeWorkspace")}</SelectItem>
          <SelectItem id="global">{t("settings.promptScopeGlobal")}</SelectItem>
        </Select>
        <Input
          aria-label={t("common.search")}
          placeholder={t("settings.promptSearch")}
          value={query}
          onChange={setQuery}
          leadingIcon={Search}
          size="small"
          className="flex-1"
        />
      </div>

      {cache?.status === "ready" && entries.length === 0 ? (
        <EmptyState className="flex-col gap-1 rounded-2xl border border-dashed border-border-button-default px-4 py-8">
          <p className="text-body-medium text-text-primary">
            {query || scopeFilter !== "all"
              ? t("settings.promptNoMatches")
              : t("settings.promptEmptyTitle")}
          </p>
          {!query && scopeFilter === "all" && (
            <p className="text-body-2-regular text-text-secondary">
              {t("settings.promptEmptyDesc")}
            </p>
          )}
        </EmptyState>
      ) : (
        <SettingsCard>
          {entries.map((entry) => (
            <PromptRow
              key={entry.path}
              entry={entry}
              onEdit={() => setEditing(entry)}
              onMove={(scope) => {
                setError(null);
                void movePrompt(root, entry.path, scope).catch(reportFailure);
              }}
              onDelete={() => setDeleting(entry)}
            />
          ))}
        </SettingsCard>
      )}

      {editing && (
        <PromptEditorDialog
          initial={editing === "new" ? undefined : editing}
          initialScope={scopeFilter === "all" ? "workspace" : scopeFilter}
          onSubmit={submitEditor}
          onCancel={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          danger
          message={t("settings.promptDeleteConfirm", { name: deleting.name })}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
