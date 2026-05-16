import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { AgentIcon } from "../../../components/AgentIcon";
import {
  AGENT_ICON_GROUPS,
  DEFAULT_AGENT_ICON,
  resolveAgentIcon,
} from "../../../utils/agentIcons";
import { useAgentManagement } from "../hooks/useAgentManagement";

export type AgentSettingsSectionProps = {
  active: boolean;
};

export function AgentSettingsSection({ active }: AgentSettingsSectionProps) {
  const { t } = useTranslation();
  const {
    agentList,
    agentLoading,
    agentError,
    agentNotice,
    agentDialog,
    setAgentDialog,
    agentDelete,
    setAgentDelete,
    agentExport,
    setAgentExport,
    agentImport,
    setAgentImport,
    loadAgents,
    handleOpenCreateAgent,
    handleOpenEditAgent,
    closeAgentDialog,
    handleSaveAgent,
    handleOpenDeleteAgent,
    handleConfirmDeleteAgent,
    handleOpenExportAgents,
    handleConfirmExportAgents,
    handleOpenImportAgents,
    hasImportConflicts,
    handleConfirmImportAgents,
  } = useAgentManagement();
  const agentIconGroupRef = useRef<HTMLDivElement | null>(null);
  const flatAgentIcons = useMemo(
    () => AGENT_ICON_GROUPS.flatMap((group) => group.icons),
    [],
  );
  const selectedDialogIcon = resolveAgentIcon(agentDialog.icon, DEFAULT_AGENT_ICON);
  const updateDialogIcon = useCallback(
    (icon: string) => {
      setAgentDialog((prev) => ({
        ...prev,
        icon,
      }));
    },
    [setAgentDialog],
  );
  const focusAgentIcon = useCallback((icon: string) => {
    const target = agentIconGroupRef.current?.querySelector<HTMLButtonElement>(
      `[data-agent-icon="${icon}"]`,
    );
    target?.focus();
  }, []);
  const handleAgentIconOptionKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, iconClass: string) => {
      const currentIndex = flatAgentIcons.findIndex((icon) => icon === iconClass);
      if (currentIndex < 0) {
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        updateDialogIcon(iconClass);
        return;
      }
      let nextIndex = currentIndex;
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (currentIndex + 1) % flatAgentIcons.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (currentIndex - 1 + flatAgentIcons.length) % flatAgentIcons.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = flatAgentIcons.length - 1;
      } else {
        return;
      }
      event.preventDefault();
      const nextIcon = flatAgentIcons[nextIndex];
      if (!nextIcon) {
        return;
      }
      updateDialogIcon(nextIcon);
      focusAgentIcon(nextIcon);
    },
    [flatAgentIcons, focusAgentIcon, updateDialogIcon],
  );

  useEffect(() => {
    if (active) {
      void loadAgents();
    }
  }, [active, loadAgents]);

  return (
    <>
      {active && (
        <section className="settings-section">
          <div className="settings-section-title">{t("settings.agent.title")}</div>
          <div className="settings-section-subtitle">
            {t("settings.agent.description")}
          </div>

          {agentNotice && (
            <div
              className={`settings-agent-notice ${
                agentNotice.kind === "error" ? "is-error" : "is-success"
              }`}
            >
              {agentNotice.message}
            </div>
          )}

          <div className="settings-agent-toolbar">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void loadAgents();
              }}
              disabled={agentLoading}
            >
              {t("common.refresh")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenExportAgents}
              disabled={agentLoading || agentList.length === 0}
            >
              {t("settings.agent.export")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void handleOpenImportAgents();
              }}
              disabled={agentLoading}
            >
              {t("settings.agent.import")}
            </Button>
            <Button size="sm" onClick={handleOpenCreateAgent} disabled={agentLoading}>
              {t("settings.agent.create")}
            </Button>
          </div>

          <div className="settings-subsection-title">
            {t("settings.agent.customAgents")}
          </div>
          {agentLoading ? (
            <div className="settings-agent-empty">
              <span className="codicon codicon-loading codicon-modifier-spin" />
              <span>{t("settings.agent.loading")}</span>
            </div>
          ) : agentError ? (
            <div className="settings-agent-empty is-error">
              <span className="codicon codicon-error" />
              <span>{agentError}</span>
            </div>
          ) : agentList.length === 0 ? (
            <div className="settings-agent-empty">
              <span>{t("settings.agent.noAgents")}</span>
            </div>
          ) : (
            <div className="settings-agent-list">
              {agentList.map((agent) => (
                <div key={agent.id} className="settings-agent-card">
                  <div className="settings-agent-card-main">
                    <div className="settings-agent-card-title">
                      <AgentIcon
                        icon={agent.icon}
                        seed={agent.id || agent.name}
                        fallback={DEFAULT_AGENT_ICON}
                        size={20}
                      />
                      <span>{agent.name}</span>
                    </div>
                    {agent.prompt && (
                      <div
                        className="settings-agent-card-prompt"
                        title={agent.prompt}
                      >
                        {agent.prompt.length > 140
                          ? `${agent.prompt.slice(0, 140)}...`
                          : agent.prompt}
                      </div>
                    )}
                  </div>
                  <div className="settings-agent-card-actions">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleOpenEditAgent(agent)}
                      title={t("common.edit")}
                    >
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="hover:text-destructive"
                      onClick={() => handleOpenDeleteAgent(agent)}
                      title={t("common.delete")}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {agentDialog.open && (
        <div className="vendor-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]" onClick={closeAgentDialog}>
          <div className="vendor-dialog vendor-dialog-wide w-[min(600px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0">
              <h3>
                {agentDialog.mode === "create"
                  ? t("settings.agent.dialog.addTitle")
                  : t("settings.agent.dialog.editTitle")}
              </h3>
              <button type="button" className="vendor-dialog-close bg-transparent border-0 text-[var(--text-secondary)] text-xl cursor-pointer px-1 leading-none hover:text-[var(--text-primary)]" onClick={closeAgentDialog}>
                <span className="codicon codicon-close" />
              </button>
            </div>
            <div className="vendor-dialog-body px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4">
              <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
                <label htmlFor="agent-name-input">{t("settings.agent.dialog.name")}</label>
                <input
                  id="agent-name-input"
                  className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  value={agentDialog.name}
                  placeholder={t("settings.agent.dialog.namePlaceholder")}
                  maxLength={20}
                  onChange={(event) =>
                    setAgentDialog((prev) => ({
                      ...prev,
                      name: event.target.value,
                      nameError: null,
                    }))
                  }
                />
                <div className="settings-agent-counter">{agentDialog.name.length}/20</div>
              </div>
              <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
                <label>{t("settings.agent.dialog.icon")}</label>
                <div
                  className="settings-agent-icon-groups"
                  role="radiogroup"
                  aria-label={t("settings.agent.dialog.icon")}
                  ref={agentIconGroupRef}
                >
                  {AGENT_ICON_GROUPS.map((group) => (
                    <div key={group.id} className="settings-agent-icon-group">
                      <div className="settings-agent-icon-group-label">
                        {t(group.labelI18nKey)}
                      </div>
                      <div className="settings-agent-icon-grid">
                        {group.icons.map((iconClass) => {
                          const isSelected = selectedDialogIcon === iconClass;
                          const iconTitle = iconClass.replace("codicon-", "");
                          const iconAriaLabel = `${t(group.labelI18nKey)} ${iconTitle}`;
                          return (
                            <button
                              key={iconClass}
                              type="button"
                              className={`settings-agent-icon-option${isSelected ? " is-selected" : ""}`}
                              role="radio"
                              onClick={() => updateDialogIcon(iconClass)}
                              onKeyDown={(event) =>
                                handleAgentIconOptionKeyDown(event, iconClass)
                              }
                              aria-checked={isSelected}
                              aria-label={iconAriaLabel}
                              tabIndex={isSelected ? 0 : -1}
                              title={iconTitle}
                              data-agent-icon={iconClass}
                            >
                              <AgentIcon icon={iconClass} size={27} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
                <label htmlFor="agent-prompt-input">{t("settings.agent.dialog.prompt")}</label>
                <textarea
                  id="agent-prompt-input"
                  className="vendor-code-editor settings-agent-prompt-editor w-full px-2.5 py-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] font-[var(--font-code)] text-xs leading-[1.5] resize-y outline-none box-border focus:border-[var(--text-accent)]"
                  rows={8}
                  maxLength={100000}
                  value={agentDialog.prompt}
                  placeholder={t("settings.agent.dialog.promptPlaceholder")}
                  onChange={(event) =>
                    setAgentDialog((prev) => ({
                      ...prev,
                      prompt: event.target.value,
                      nameError: null,
                    }))
                  }
                />
                <div className="settings-agent-counter">
                  {agentDialog.prompt.length}/100000
                </div>
                <div className="vendor-hint text-[11px] text-[var(--text-secondary)] mt-0.5">{t("settings.agent.dialog.promptHint")}</div>
              </div>
              {agentDialog.nameError && (
                <div className="vendor-json-error text-[#e55] text-[11px] mt-1">{agentDialog.nameError}</div>
              )}
            </div>
            <div className="vendor-dialog-footer flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]">
              <button
                type="button"
                className="vendor-btn-cancel px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150"
                onClick={closeAgentDialog}
                disabled={agentDialog.saving}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="vendor-btn-save"
                onClick={() => {
                  void handleSaveAgent();
                }}
                disabled={agentDialog.saving}
              >
                {agentDialog.saving
                  ? t("common.saving")
                  : agentDialog.mode === "create"
                    ? t("settings.agent.dialog.confirmAdd")
                    : t("settings.agent.dialog.saveChanges")}
              </button>
            </div>
          </div>
        </div>
      )}

      {agentDelete.open && agentDelete.target && (
        <div
          className="vendor-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]"
          onClick={() => setAgentDelete({ open: false, target: null, deleting: false })}
        >
          <div className="vendor-dialog vendor-dialog-sm w-[min(400px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0">
              <h3>{t("settings.agent.deleteConfirmTitle")}</h3>
            </div>
            <div className="vendor-dialog-body px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4">
              <div>{t("settings.agent.deleteConfirmMessage", { name: agentDelete.target.name })}</div>
            </div>
            <div className="vendor-dialog-footer flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]">
              <button
                type="button"
                className="vendor-btn-cancel px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150"
                onClick={() => setAgentDelete({ open: false, target: null, deleting: false })}
                disabled={agentDelete.deleting}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="vendor-btn-danger-solid"
                onClick={() => {
                  void handleConfirmDeleteAgent();
                }}
                disabled={agentDelete.deleting}
              >
                {agentDelete.deleting ? t("common.loading") : t("common.delete")}
              </button>
            </div>
          </div>
        </div>
      )}

      {agentExport.open && (
        <div
          className="vendor-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]"
          onClick={() => setAgentExport({ open: false, saving: false, selectedIds: new Set<string>() })}
        >
          <div className="vendor-dialog vendor-dialog-wide w-[min(600px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0">
              <h3>{t("settings.agent.exportDialog.title")}</h3>
              <button
                type="button"
                className="vendor-dialog-close bg-transparent border-0 text-[var(--text-secondary)] text-xl cursor-pointer px-1 leading-none hover:text-[var(--text-primary)]"
                onClick={() =>
                  setAgentExport({ open: false, saving: false, selectedIds: new Set<string>() })
                }
              >
                <span className="codicon codicon-close" />
              </button>
            </div>
            <div className="vendor-dialog-body px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4">
              <div className="settings-agent-dialog-summary">
                {t("settings.agent.exportDialog.selectHint")}
              </div>
              <div className="settings-agent-table-head">
                <label className="settings-agent-table-checkbox">
                  <input
                    type="checkbox"
                    checked={
                      agentList.length > 0 &&
                      agentExport.selectedIds.size === agentList.length
                    }
                    onChange={() =>
                      setAgentExport((prev) => ({
                        ...prev,
                        selectedIds:
                          prev.selectedIds.size === agentList.length
                            ? new Set<string>()
                            : new Set(agentList.map((agent) => agent.id)),
                      }))
                    }
                  />
                </label>
                <div>{t("settings.agent.importDialog.columnName")}</div>
                <div>{t("settings.agent.importDialog.columnId")}</div>
              </div>
              <div className="settings-agent-table-body">
                {agentList.map((agent) => {
                  const checked = agentExport.selectedIds.has(agent.id);
                  return (
                    <label key={agent.id} className="settings-agent-table-row">
                      <span className="settings-agent-table-checkbox">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setAgentExport((prev) => {
                              const nextIds = new Set(prev.selectedIds);
                              if (nextIds.has(agent.id)) {
                                nextIds.delete(agent.id);
                              } else {
                                nextIds.add(agent.id);
                              }
                              return { ...prev, selectedIds: nextIds };
                            })
                          }
                        />
                      </span>
                      <span>{agent.name}</span>
                      <span className="settings-agent-row-id">{agent.id}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="vendor-dialog-footer settings-agent-dialog-footer flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]">
              <div className="settings-help">
                {t("settings.agent.importDialog.selectedCount", {
                  count: agentExport.selectedIds.size,
                })}
              </div>
              <button
                type="button"
                className="vendor-btn-cancel px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150"
                onClick={() =>
                  setAgentExport({ open: false, saving: false, selectedIds: new Set<string>() })
                }
                disabled={agentExport.saving}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="vendor-btn-save"
                onClick={() => {
                  void handleConfirmExportAgents();
                }}
                disabled={agentExport.saving || agentExport.selectedIds.size === 0}
              >
                {agentExport.saving
                  ? t("common.saving")
                  : t("settings.agent.exportDialog.confirmExport")}
              </button>
            </div>
          </div>
        </div>
      )}

      {agentImport.open && (
        <div
          className="vendor-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]"
          onClick={() =>
            setAgentImport({
              open: false,
              loading: false,
              applying: false,
              preview: null,
              selectedIds: new Set<string>(),
              strategy: "skip",
            })
          }
        >
          <div className="vendor-dialog vendor-dialog-wide w-[min(600px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
            <div className="vendor-dialog-header flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0">
              <h3>{t("settings.agent.importDialog.title")}</h3>
              <button
                type="button"
                className="vendor-dialog-close bg-transparent border-0 text-[var(--text-secondary)] text-xl cursor-pointer px-1 leading-none hover:text-[var(--text-primary)]"
                onClick={() =>
                  setAgentImport({
                    open: false,
                    loading: false,
                    applying: false,
                    preview: null,
                    selectedIds: new Set<string>(),
                    strategy: "skip",
                  })
                }
              >
                <span className="codicon codicon-close" />
              </button>
            </div>
            <div className="vendor-dialog-body px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4">
              {agentImport.loading ? (
                <div className="settings-agent-empty">
                  <span className="codicon codicon-loading codicon-modifier-spin" />
                  <span>{t("settings.loading")}</span>
                </div>
              ) : agentImport.preview ? (
                <>
                  <div className="settings-agent-dialog-summary">
                    {t("settings.agent.importDialog.summary", {
                      total: agentImport.preview.summary.total,
                    })}
                    <span className="settings-agent-tag is-new">
                      {t("settings.agent.importDialog.newCount", {
                        count: agentImport.preview.summary.newCount,
                      })}
                    </span>
                    <span className="settings-agent-tag is-update">
                      {t("settings.agent.importDialog.updateCount", {
                        count: agentImport.preview.summary.updateCount,
                      })}
                    </span>
                  </div>
                  {hasImportConflicts && (
                    <div className="settings-agent-strategy">
                      <div className="settings-field-label">
                        {t("settings.agent.importDialog.conflictStrategy")}
                      </div>
                      <label className="settings-agent-strategy-option">
                        <input
                          type="radio"
                          name="agent-import-strategy"
                          value="skip"
                          checked={agentImport.strategy === "skip"}
                          onChange={() =>
                            setAgentImport((prev) => ({ ...prev, strategy: "skip" }))
                          }
                        />
                        <span>{t("settings.agent.importDialog.strategySkip")}</span>
                      </label>
                      <label className="settings-agent-strategy-option">
                        <input
                          type="radio"
                          name="agent-import-strategy"
                          value="overwrite"
                          checked={agentImport.strategy === "overwrite"}
                          onChange={() =>
                            setAgentImport((prev) => ({ ...prev, strategy: "overwrite" }))
                          }
                        />
                        <span>{t("settings.agent.importDialog.strategyOverwrite")}</span>
                      </label>
                      <label className="settings-agent-strategy-option">
                        <input
                          type="radio"
                          name="agent-import-strategy"
                          value="duplicate"
                          checked={agentImport.strategy === "duplicate"}
                          onChange={() =>
                            setAgentImport((prev) => ({ ...prev, strategy: "duplicate" }))
                          }
                        />
                        <span>{t("settings.agent.importDialog.strategyDuplicate")}</span>
                      </label>
                    </div>
                  )}
                  <div className="settings-agent-table-head is-import">
                    <label className="settings-agent-table-checkbox">
                      <input
                        type="checkbox"
                        checked={
                          agentImport.preview.items.length > 0 &&
                          agentImport.selectedIds.size === agentImport.preview.items.length
                        }
                        onChange={() =>
                          setAgentImport((prev) => ({
                            ...prev,
                            selectedIds:
                              prev.selectedIds.size === (prev.preview?.items.length ?? 0)
                                ? new Set<string>()
                                : new Set((prev.preview?.items ?? []).map((item) => item.data.id)),
                          }))
                        }
                      />
                    </label>
                    <div>{t("settings.agent.importDialog.columnName")}</div>
                    <div>{t("settings.agent.importDialog.columnId")}</div>
                    <div>{t("settings.agent.importDialog.columnStatus")}</div>
                  </div>
                  <div className="settings-agent-table-body">
                    {agentImport.preview.items.map((item) => {
                      const agent = item.data;
                      const checked = agentImport.selectedIds.has(agent.id);
                      return (
                        <label key={agent.id} className="settings-agent-table-row is-import">
                          <span className="settings-agent-table-checkbox">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setAgentImport((prev) => {
                                  const next = new Set(prev.selectedIds);
                                  if (next.has(agent.id)) {
                                    next.delete(agent.id);
                                  } else {
                                    next.add(agent.id);
                                  }
                                  return { ...prev, selectedIds: next };
                                })
                              }
                            />
                          </span>
                          <span>{agent.name}</span>
                          <span className="settings-agent-row-id">{agent.id}</span>
                          <span>
                            <span className={`settings-agent-tag ${item.status === "new" ? "is-new" : "is-update"}`}>
                              {item.status === "new"
                                ? t("settings.agent.importDialog.statusNew")
                                : t("settings.agent.importDialog.statusUpdate")}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
            {!agentImport.loading && agentImport.preview && (
              <div className="vendor-dialog-footer settings-agent-dialog-footer flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]">
                <div className="settings-help">
                  {t("settings.agent.importDialog.selectedCount", {
                    count: agentImport.selectedIds.size,
                  })}
                </div>
                <button
                  type="button"
                  className="vendor-btn-cancel px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150"
                  onClick={() =>
                    setAgentImport({
                      open: false,
                      loading: false,
                      applying: false,
                      preview: null,
                      selectedIds: new Set<string>(),
                      strategy: "skip",
                    })
                  }
                  disabled={agentImport.applying}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="vendor-btn-save"
                  onClick={() => {
                    void handleConfirmImportAgents();
                  }}
                  disabled={agentImport.applying || agentImport.selectedIds.size === 0}
                >
                  {agentImport.applying
                    ? t("common.saving")
                    : t("settings.agent.importDialog.confirmImport")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
