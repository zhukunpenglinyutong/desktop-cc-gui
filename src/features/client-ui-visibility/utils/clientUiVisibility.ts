export const CLIENT_UI_VISIBILITY_STORE = "app";
export const CLIENT_UI_VISIBILITY_KEY = "clientUiVisibility";
export const CLIENT_UI_VISIBILITY_CHANGED_EVENT =
  "mossx:client-ui-visibility-changed";

export const CLIENT_UI_PANEL_IDS = [
  "topSessionTabs",
  "topRunControls",
  "topToolControls",
  "rightActivityToolbar",
  "bottomActivityPanel",
  "cornerStatusIndicator",
] as const;

export type ClientUiPanelId = (typeof CLIENT_UI_PANEL_IDS)[number];

export const CLIENT_UI_CONTROL_IDS = [
  "topRun.start",
  "topTool.openWorkspace",
  "topTool.runtimeConsole",
  "topTool.terminal",
  "topTool.focus",
  "topTool.rightPanel",
  "rightToolbar.activity",
  "rightToolbar.radar",
  "rightToolbar.git",
  "rightToolbar.files",
  "rightToolbar.search",
  "bottomActivity.tasks",
  "bottomActivity.agents",
  "bottomActivity.edits",
  "bottomActivity.latestConversation",
  "curtain.stickyUserBubble",
  "cornerStatus.messageAnchors",
] as const;

export type ClientUiControlId = (typeof CLIENT_UI_CONTROL_IDS)[number];

export type ClientUiVisibilityPreference = {
  panels: Partial<Record<ClientUiPanelId, boolean>>;
  controls: Partial<Record<ClientUiControlId, boolean>>;
};

export type ClientUiVisibilityIconKey =
  | "activity"
  | "appWindow"
  | "bot"
  | "construction"
  | "fileEdit"
  | "focus"
  | "folder"
  | "gitBranch"
  | "layoutList"
  | "listChecks"
  | "messageSquareQuote"
  | "messageSquareText"
  | "panelBottom"
  | "panelRightOpen"
  | "panelTop"
  | "play"
  | "search"
  | "terminal";

export type ClientUiPanelDefinition = {
  id: ClientUiPanelId;
  labelKey: string;
  descriptionKey: string;
  iconKey: ClientUiVisibilityIconKey;
  controls: readonly ClientUiControlId[];
};

export type ClientUiControlDefinition = {
  id: ClientUiControlId;
  parentPanelId: ClientUiPanelId;
  labelKey: string;
  descriptionKey: string;
  iconKey: ClientUiVisibilityIconKey;
};

export type ClientUiVisibilityQueries = {
  preference: ClientUiVisibilityPreference;
  isPanelVisible: (panelId: ClientUiPanelId) => boolean;
  isControlVisible: (controlId: ClientUiControlId) => boolean;
  isControlPreferenceVisible: (controlId: ClientUiControlId) => boolean;
};

export const DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE: ClientUiVisibilityPreference = {
  panels: {},
  controls: {},
};

export const CLIENT_UI_CONTROL_REGISTRY: readonly ClientUiControlDefinition[] = [
  {
    id: "topRun.start",
    parentPanelId: "topRunControls",
    labelKey: "settings.clientUiVisibility.controls.topRunStart",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topRunStart",
    iconKey: "play",
  },
  {
    id: "topTool.openWorkspace",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolOpenWorkspace",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolOpenWorkspace",
    iconKey: "appWindow",
  },
  {
    id: "topTool.runtimeConsole",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolRuntimeConsole",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolRuntimeConsole",
    iconKey: "construction",
  },
  {
    id: "topTool.terminal",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolTerminal",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolTerminal",
    iconKey: "terminal",
  },
  {
    id: "topTool.focus",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolFocus",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolFocus",
    iconKey: "focus",
  },
  {
    id: "topTool.rightPanel",
    parentPanelId: "topToolControls",
    labelKey: "settings.clientUiVisibility.controls.topToolRightPanel",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.topToolRightPanel",
    iconKey: "panelRightOpen",
  },
  {
    id: "rightToolbar.activity",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarActivity",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarActivity",
    iconKey: "activity",
  },
  {
    id: "rightToolbar.radar",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarRadar",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarRadar",
    iconKey: "layoutList",
  },
  {
    id: "rightToolbar.git",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarGit",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarGit",
    iconKey: "gitBranch",
  },
  {
    id: "rightToolbar.files",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarFiles",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarFiles",
    iconKey: "folder",
  },
  {
    id: "rightToolbar.search",
    parentPanelId: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.controls.rightToolbarSearch",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.rightToolbarSearch",
    iconKey: "search",
  },
  {
    id: "bottomActivity.tasks",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityTasks",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityTasks",
    iconKey: "listChecks",
  },
  {
    id: "bottomActivity.agents",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityAgents",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityAgents",
    iconKey: "bot",
  },
  {
    id: "bottomActivity.edits",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityEdits",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityEdits",
    iconKey: "fileEdit",
  },
  {
    id: "bottomActivity.latestConversation",
    parentPanelId: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.controls.bottomActivityLatestConversation",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.bottomActivityLatestConversation",
    iconKey: "messageSquareQuote",
  },
  {
    id: "curtain.stickyUserBubble",
    parentPanelId: "cornerStatusIndicator",
    labelKey: "settings.clientUiVisibility.controls.curtainStickyUserBubble",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.curtainStickyUserBubble",
    iconKey: "messageSquareText",
  },
  {
    id: "cornerStatus.messageAnchors",
    parentPanelId: "cornerStatusIndicator",
    labelKey: "settings.clientUiVisibility.controls.cornerStatusMessageAnchors",
    descriptionKey: "settings.clientUiVisibility.controlDescriptions.cornerStatusMessageAnchors",
    iconKey: "messageSquareQuote",
  },
] as const;

const controlDefinitionById = new Map<ClientUiControlId, ClientUiControlDefinition>(
  CLIENT_UI_CONTROL_REGISTRY.map((definition) => [definition.id, definition]),
);

export const CLIENT_UI_PANEL_REGISTRY: readonly ClientUiPanelDefinition[] = [
  {
    id: "topSessionTabs",
    labelKey: "settings.clientUiVisibility.panels.topSessionTabs",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.topSessionTabs",
    iconKey: "panelTop",
    controls: [],
  },
  {
    id: "topRunControls",
    labelKey: "settings.clientUiVisibility.panels.topRunControls",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.topRunControls",
    iconKey: "play",
    controls: ["topRun.start"],
  },
  {
    id: "topToolControls",
    labelKey: "settings.clientUiVisibility.panels.topToolControls",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.topToolControls",
    iconKey: "terminal",
    controls: [
      "topTool.openWorkspace",
      "topTool.runtimeConsole",
      "topTool.terminal",
      "topTool.focus",
      "topTool.rightPanel",
    ],
  },
  {
    id: "rightActivityToolbar",
    labelKey: "settings.clientUiVisibility.panels.rightActivityToolbar",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.rightActivityToolbar",
    iconKey: "activity",
    controls: [
      "rightToolbar.activity",
      "rightToolbar.radar",
      "rightToolbar.git",
      "rightToolbar.files",
      "rightToolbar.search",
    ],
  },
  {
    id: "bottomActivityPanel",
    labelKey: "settings.clientUiVisibility.panels.bottomActivityPanel",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.bottomActivityPanel",
    iconKey: "panelBottom",
    controls: [
      "bottomActivity.tasks",
      "bottomActivity.agents",
      "bottomActivity.edits",
      "bottomActivity.latestConversation",
    ],
  },
  {
    id: "cornerStatusIndicator",
    labelKey: "settings.clientUiVisibility.panels.cornerStatusIndicator",
    descriptionKey: "settings.clientUiVisibility.panelDescriptions.cornerStatusIndicator",
    iconKey: "messageSquareText",
    controls: ["curtain.stickyUserBubble", "cornerStatus.messageAnchors"],
  },
] as const;

const panelIdSet = new Set<string>(CLIENT_UI_PANEL_IDS);
const controlIdSet = new Set<string>(CLIENT_UI_CONTROL_IDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeBooleanMap<TId extends string>(
  value: unknown,
  knownIds: ReadonlySet<string>,
): Partial<Record<TId, boolean>> {
  if (!isRecord(value)) {
    return {};
  }
  const normalized: Partial<Record<TId, boolean>> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!knownIds.has(key) || typeof rawValue !== "boolean") {
      continue;
    }
    normalized[key as TId] = rawValue;
  }
  return normalized;
}

export function normalizeClientUiVisibilityPreference(
  value: unknown,
): ClientUiVisibilityPreference {
  if (!isRecord(value)) {
    return { ...DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE };
  }
  return {
    panels: normalizeBooleanMap<ClientUiPanelId>(value.panels, panelIdSet),
    controls: normalizeBooleanMap<ClientUiControlId>(value.controls, controlIdSet),
  };
}

export function isClientUiPanelVisible(
  preference: ClientUiVisibilityPreference,
  panelId: ClientUiPanelId,
): boolean {
  return preference.panels[panelId] !== false;
}

export function isClientUiControlPreferenceVisible(
  preference: ClientUiVisibilityPreference,
  controlId: ClientUiControlId,
): boolean {
  return preference.controls[controlId] !== false;
}

export function isClientUiControlVisible(
  preference: ClientUiVisibilityPreference,
  controlId: ClientUiControlId,
): boolean {
  const definition = controlDefinitionById.get(controlId);
  if (!definition) {
    return true;
  }
  return (
    isClientUiPanelVisible(preference, definition.parentPanelId) &&
    isClientUiControlPreferenceVisible(preference, controlId)
  );
}

export function setClientUiPanelVisibility(
  preference: ClientUiVisibilityPreference,
  panelId: ClientUiPanelId,
  visible: boolean,
): ClientUiVisibilityPreference {
  return normalizeClientUiVisibilityPreference({
    ...preference,
    panels: {
      ...preference.panels,
      [panelId]: visible,
    },
  });
}

export function setClientUiControlVisibility(
  preference: ClientUiVisibilityPreference,
  controlId: ClientUiControlId,
  visible: boolean,
): ClientUiVisibilityPreference {
  return normalizeClientUiVisibilityPreference({
    ...preference,
    controls: {
      ...preference.controls,
      [controlId]: visible,
    },
  });
}

export function createClientUiVisibilityQueries(
  preference: ClientUiVisibilityPreference,
): ClientUiVisibilityQueries {
  const normalizedPreference = normalizeClientUiVisibilityPreference(preference);
  return {
    preference: normalizedPreference,
    isPanelVisible: (panelId) =>
      isClientUiPanelVisible(normalizedPreference, panelId),
    isControlVisible: (controlId) =>
      isClientUiControlVisible(normalizedPreference, controlId),
    isControlPreferenceVisible: (controlId) =>
      isClientUiControlPreferenceVisible(normalizedPreference, controlId),
  };
}

export const DEFAULT_CLIENT_UI_VISIBILITY_QUERIES =
  createClientUiVisibilityQueries(DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE);

export function getClientUiControlDefinition(
  controlId: ClientUiControlId,
): ClientUiControlDefinition {
  return controlDefinitionById.get(controlId)!;
}
