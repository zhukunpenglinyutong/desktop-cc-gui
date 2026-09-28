/**
 * Permission id → readable label for the plugin detail dialog. The mapping
 * is display-only: enforcement lives in the SDK/back-end (see
 * packages/plugin-sdk/spec/permissions.json). Unknown or plugin-defined
 * entries fall back to the raw string so the dialog never hides a grant.
 */

export interface PermissionDescription {
  /** i18n key under `plugins.hub.permissions`. */
  key: string;
  /** Interpolation values (CLI name / network host). */
  params?: Record<string, string>;
}

/** Exact ids worth naming individually. */
const BASE_LABELS: Record<string, string> = {
  storage: "storage",
  events: "events",
  theme: "theme",
  i18n: "i18n",
  agent: "agent",
  "composer:draft": "composerDraft",
  "host:session": "hostSession",
  "host:workspace": "hostWorkspace",
  "host:workspace:remote": "hostWorkspaceRemote",
  "host:window": "hostWindow",
  "host:models": "hostModels",
  "network:none": "networkNone",
};

/** ui:* capabilities, named so a user can tell what the plugin adds. */
const UI_LABELS: Record<string, string> = {
  "ui:settings-section": "uiSettingsSection",
  "ui:add-menu": "uiAddMenu",
  "ui:composer-status": "uiComposerStatus",
  "ui:panel-tab": "uiPanelTab",
  "ui:status-bar": "uiStatusBar",
  "ui:command": "uiCommand",
  "ui:markdown": "uiMarkdown",
  "ui:page": "uiPage",
  "ui:timeline-row": "uiTimelineRow",
  "ui:session-menu": "uiSessionMenu",
  "ui:sidebar-entry": "uiSidebarEntry",
  "ui:center-tab": "uiCenterTab",
  "ui:conversation-mode": "uiConversationMode",
};

export function describePermission(permission: string): PermissionDescription {
  const base = BASE_LABELS[permission];
  if (base) return { key: `plugins.hub.permissions.${base}` };

  const ui = UI_LABELS[permission];
  if (ui) return { key: `plugins.hub.permissions.${ui}` };
  if (permission.startsWith("ui:")) return { key: "plugins.hub.permissions.ui" };

  if (permission.startsWith("exec:")) {
    return {
      key: "plugins.hub.permissions.exec",
      params: { name: permission.slice("exec:".length) },
    };
  }
  if (permission.startsWith("network:")) {
    return {
      key: "plugins.hub.permissions.network",
      params: { host: permission.slice("network:".length) },
    };
  }
  return { key: "plugins.hub.permissions.unknown", params: { name: permission } };
}
