export const CHAT_MIN_WIDTH = 320;

export interface PanelLayoutInput {
  storedWidth: number;
  centerRowWidth: number;
  narrowPanel: boolean;
  isWeb: boolean;
}

export interface PanelLayout {
  panelWidth: number;
  overlay: boolean;
}

/**
 * A narrow remote browser gets the panel as an overlay: reserving a chat
 * column would make the panel itself narrower than its persisted width.
 * Native windows and wide web views keep the split layout and its chat floor.
 */
export function resolvePanelLayout({
  storedWidth,
  centerRowWidth,
  narrowPanel,
  isWeb,
}: PanelLayoutInput): PanelLayout {
  const overlay = isWeb && narrowPanel;
  if (centerRowWidth <= 0) return { panelWidth: storedWidth, overlay };

  const available = overlay
    ? centerRowWidth
    : Math.max(0, centerRowWidth - CHAT_MIN_WIDTH);
  return { panelWidth: Math.min(storedWidth, available), overlay };
}
