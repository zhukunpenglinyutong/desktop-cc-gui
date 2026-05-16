import type { TFunction } from "i18next";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import Download from "lucide-react/dist/esm/icons/download";
import Info from "lucide-react/dist/esm/icons/info";
import Save from "lucide-react/dist/esm/icons/save";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import Wifi from "lucide-react/dist/esm/icons/wifi";
import Check from "lucide-react/dist/esm/icons/check";
import { ProxyStatusBadge } from "@/components/ProxyStatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/types";

type DiagnosticsBundleExportState = {
  status: "idle" | "exporting" | "exported" | "failed";
  message: string | null;
};

type InlineNoticeState =
  | {
      kind: "success" | "error";
      message: string;
    }
  | null;

type NotificationSoundOption = {
  value: string;
  label: string;
};

type BasicBehaviorSectionProps = {
  active: boolean;
  t: TFunction;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  handleComposerSendShortcutChange: (
    shortcut: AppSettings["composerSendShortcut"],
  ) => void;
  handleExportDiagnosticsBundle: () => Promise<void>;
  diagnosticsBundleExportState: DiagnosticsBundleExportState;
  terminalShellPathDraft: string;
  setTerminalShellPathDraft: (value: string) => void;
  terminalShellPathDirty: boolean;
  handleSaveTerminalShellPath: () => Promise<void>;
  handleClearTerminalShellPath: () => Promise<void>;
  systemProxyEnabledDraft: boolean;
  systemProxyUrlDraft: string;
  handleToggleSystemProxy: (checked: boolean) => void;
  handleSystemProxyUrlChange: (value: string) => void;
  handleSaveSystemProxy: () => Promise<void>;
  systemProxySaving: boolean;
  systemProxyDirty: boolean;
  systemProxyNotice: InlineNoticeState;
  systemProxyError: string | null;
  selectedNotificationSound: string;
  soundOptions: ReadonlyArray<NotificationSoundOption>;
  handleNotificationSoundOptionChange: (nextSound: string | null) => void;
  onTestNotificationSound: (soundId?: string, customSoundPath?: string) => void;
  notificationSoundPathDraft: string;
  setNotificationSoundPathDraft: (value: string) => void;
  handleBrowseNotificationSoundPath: () => Promise<void>;
  handleSaveNotificationSoundPath: () => void;
};

export function BasicBehaviorSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
  handleComposerSendShortcutChange,
  handleExportDiagnosticsBundle,
  diagnosticsBundleExportState,
  terminalShellPathDraft,
  setTerminalShellPathDraft,
  terminalShellPathDirty,
  handleSaveTerminalShellPath,
  handleClearTerminalShellPath,
  systemProxyEnabledDraft,
  systemProxyUrlDraft,
  handleToggleSystemProxy,
  handleSystemProxyUrlChange,
  handleSaveSystemProxy,
  systemProxySaving,
  systemProxyDirty,
  systemProxyNotice,
  systemProxyError,
  selectedNotificationSound,
  soundOptions,
  handleNotificationSoundOptionChange,
  onTestNotificationSound,
  notificationSoundPathDraft,
  setNotificationSoundPathDraft,
  handleBrowseNotificationSoundPath,
  handleSaveNotificationSoundPath,
}: BasicBehaviorSectionProps) {
  if (!active) {
    return null;
  }

  return (
    <div className="settings-basic-behavior settings-basic-surface flex flex-col gap-2.5">
      <div className="settings-basic-group-card">
        <div className="settings-subsection-title">{t("settings.sendShortcutSubtitle")}</div>
        <div className="settings-subsection-subtitle">
          {t("settings.sendShortcutSubDescription")}
        </div>
        <div className="settings-shortcut-cards">
          <button
            type="button"
            className={`settings-shortcut-card ${
              appSettings.composerSendShortcut === "enter" ? "active" : ""
            }`}
            onClick={() => {
              handleComposerSendShortcutChange("enter");
            }}
          >
            {appSettings.composerSendShortcut === "enter" ? (
              <div className="settings-shortcut-card-check" aria-hidden>
                <Check size={12} />
              </div>
            ) : null}
            <div className="settings-shortcut-card-title">
              {t("settings.sendShortcutEnterTitle")}
            </div>
            <div className="settings-shortcut-card-desc">
              {t("settings.sendShortcutEnterDesc")}
            </div>
          </button>
          <button
            type="button"
            className={`settings-shortcut-card ${
              appSettings.composerSendShortcut === "cmdEnter" ? "active" : ""
            }`}
            onClick={() => {
              handleComposerSendShortcutChange("cmdEnter");
            }}
          >
            {appSettings.composerSendShortcut === "cmdEnter" ? (
              <div className="settings-shortcut-card-check" aria-hidden>
                <Check size={12} />
              </div>
            ) : null}
            <div className="settings-shortcut-card-title">
              {t("settings.sendShortcutCmdEnterTitle")}
            </div>
            <div className="settings-shortcut-card-desc">
              {t("settings.sendShortcutCmdEnterDesc")}
            </div>
          </button>
        </div>
      </div>
      <Card className="settings-basic-group-card settings-basic-shadcn-card settings-basic-streaming-card">
        <CardHeader className="settings-card-switch-header">
          <div className="settings-card-switch-meta">
            <CardTitle className="settings-toggle-title">
              {t("settings.behaviorStreaming")}
            </CardTitle>
            <CardDescription className="settings-toggle-subtitle">
              {t("settings.behaviorStreamingDesc")}
            </CardDescription>
          </div>
          <CardAction className="settings-card-switch-action">
            <Switch
              checked={appSettings.streamingEnabled ?? true}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  streamingEnabled: checked,
                })
              }
            />
          </CardAction>
        </CardHeader>
      </Card>
      <Card
        className={`settings-basic-group-card settings-basic-shadcn-card settings-basic-performance-card${
          appSettings.performanceCompatibilityModeEnabled ? " is-enabled" : ""
        }`}
      >
        <CardHeader className="settings-card-switch-header">
          <div className="settings-card-switch-meta">
            <CardTitle className="settings-toggle-title">
              {t("settings.performanceCompatibilityTitle")}
            </CardTitle>
            <CardDescription className="settings-toggle-subtitle">
              {t("settings.performanceCompatibilityDesc")}
            </CardDescription>
          </div>
          <CardAction className="settings-card-switch-action">
            <Switch
              checked={appSettings.performanceCompatibilityModeEnabled}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  performanceCompatibilityModeEnabled: checked,
                })
              }
              aria-label={t("settings.performanceCompatibilityEnabled")}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="settings-basic-sounds-card-content">
          <div className="settings-help settings-sound-hint settings-sound-hint-shadcn">
            <Badge variant="outline" className="settings-sound-status-badge">
              <Info size={12} aria-hidden />
              <span>
                {appSettings.performanceCompatibilityModeEnabled
                  ? t("settings.performanceCompatibilityStatusEnabled")
                  : t("settings.performanceCompatibilityStatusDisabled")}
              </span>
            </Badge>
            <span className="settings-sound-hint-copy">
              {t("settings.performanceCompatibilityHint")}
            </span>
          </div>
        </CardContent>
      </Card>
      <Card className="settings-basic-group-card settings-basic-shadcn-card settings-basic-diagnostics-card">
        <CardHeader className="settings-card-switch-header">
          <div className="settings-card-switch-meta">
            <CardTitle className="settings-toggle-title">
              {t("settings.diagnosticsBundleTitle")}
            </CardTitle>
            <CardDescription className="settings-toggle-subtitle">
              {t("settings.diagnosticsBundleDesc")}
            </CardDescription>
          </div>
          <CardAction className="settings-card-switch-action">
            <Button
              type="button"
              variant="outline"
              className="settings-button-compact"
              onClick={() => void handleExportDiagnosticsBundle()}
              disabled={diagnosticsBundleExportState.status === "exporting"}
              aria-label={t("settings.diagnosticsBundleExport")}
            >
              <Download size={14} aria-hidden />
              {diagnosticsBundleExportState.status === "exporting"
                ? t("settings.diagnosticsBundleExporting")
                : t("settings.diagnosticsBundleExport")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="settings-basic-sounds-card-content">
          <div className="settings-help settings-sound-hint settings-sound-hint-shadcn">
            <Badge variant="outline" className="settings-sound-status-badge">
              <Info size={12} aria-hidden />
              <span>{t("settings.diagnosticsBundleLocalOnly")}</span>
            </Badge>
            <span className="settings-sound-hint-copy">
              {t("settings.diagnosticsBundleHint")}
            </span>
          </div>
          {diagnosticsBundleExportState.message ? (
            <div
              className={
                diagnosticsBundleExportState.status === "failed"
                  ? "settings-inline-error"
                  : "settings-inline-success"
              }
              role={diagnosticsBundleExportState.status === "failed" ? "alert" : "status"}
            >
              {diagnosticsBundleExportState.message}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="settings-basic-group-card settings-basic-shadcn-card settings-basic-terminal-card">
        <CardHeader className="settings-basic-sounds-card-header settings-proxy-card-header">
          <div className="settings-card-switch-meta">
            <CardTitle className="settings-subsection-title">
              <span className="settings-proxy-card-title">
                <TerminalSquare size={16} aria-hidden />
                {t("settings.terminalShellPathTitle")}
              </span>
            </CardTitle>
            <CardDescription className="settings-subsection-subtitle">
              {t("settings.terminalShellPathDesc")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="settings-basic-sounds-card-content settings-proxy-card-content">
          <div className="settings-proxy-input-row">
            <Label className="settings-visually-hidden" htmlFor="terminal-shell-path">
              {t("settings.terminalShellPathLabel")}
            </Label>
            <div className="settings-proxy-input-shell">
              <Input
                id="terminal-shell-path"
                className="settings-proxy-input"
                value={terminalShellPathDraft}
                onChange={(event) => setTerminalShellPathDraft(event.target.value)}
                placeholder={t("settings.terminalShellPathPlaceholder")}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="settings-proxy-save-btn"
              onClick={() => void handleSaveTerminalShellPath()}
              disabled={!terminalShellPathDirty}
              aria-label={t("settings.terminalShellPathSave")}
            >
              <Save size={14} aria-hidden />
              {t("settings.terminalShellPathSave")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="settings-button-compact"
              onClick={() => void handleClearTerminalShellPath()}
              disabled={!terminalShellPathDraft && appSettings.terminalShellPath == null}
              aria-label={t("settings.terminalShellPathClear")}
            >
              {t("settings.clear")}
            </Button>
          </div>
          <div className="settings-help settings-sound-hint settings-sound-hint-shadcn settings-proxy-hint">
            <span className="settings-sound-hint-copy">
              {t("settings.terminalShellPathHint")}
            </span>
          </div>
        </CardContent>
      </Card>
      <Card
        className={`settings-basic-group-card settings-basic-shadcn-card settings-basic-proxy-card${
          systemProxyEnabledDraft ? " is-enabled" : ""
        }`}
      >
        <CardHeader className="settings-basic-sounds-card-header settings-proxy-card-header">
          <div className="settings-card-switch-meta">
            <CardTitle className="settings-subsection-title">
              <span className="settings-proxy-card-title">
                <Wifi size={16} aria-hidden />
                {t("settings.behaviorProxyTitle")}
                {systemProxyEnabledDraft ? (
                  <ProxyStatusBadge
                    proxyUrl={systemProxyUrlDraft}
                    label={t("messages.proxyBadge")}
                    variant="compact"
                    className="settings-proxy-header-badge"
                  />
                ) : null}
              </span>
            </CardTitle>
            <CardDescription className="settings-subsection-subtitle">
              {t("settings.behaviorProxyDesc")}
            </CardDescription>
          </div>
          <CardAction className="settings-proxy-card-action">
            <Switch
              checked={systemProxyEnabledDraft}
              onCheckedChange={handleToggleSystemProxy}
              aria-label={t("settings.behaviorProxyEnabled")}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="settings-basic-sounds-card-content settings-proxy-card-content">
          <div className="settings-proxy-input-row">
            <Label className="settings-visually-hidden" htmlFor="system-proxy-url">
              {t("settings.behaviorProxyAddress")}
            </Label>
            <div className="settings-proxy-input-shell">
              <Input
                id="system-proxy-url"
                className="settings-proxy-input"
                value={systemProxyUrlDraft}
                onChange={(event) => {
                  handleSystemProxyUrlChange(event.target.value);
                }}
                placeholder={t("settings.behaviorProxyAddressPlaceholder")}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              className="settings-proxy-save-btn"
              onClick={() => void handleSaveSystemProxy()}
              disabled={systemProxySaving || !systemProxyDirty}
            >
              <Save size={14} aria-hidden />
              {t("settings.behaviorProxySave")}
            </Button>
          </div>
          <div className="settings-help settings-sound-hint settings-sound-hint-shadcn settings-proxy-hint">
            <span className="settings-sound-hint-copy">
              {t("settings.behaviorProxyHint")}
            </span>
          </div>
          {systemProxyNotice ? (
            <div
              className={
                systemProxyNotice.kind === "error"
                  ? "settings-inline-error"
                  : "settings-inline-success"
              }
              role={systemProxyNotice.kind === "error" ? "alert" : "status"}
            >
              {systemProxyNotice.message}
            </div>
          ) : null}
          {systemProxyError ? (
            <div className="settings-toggle-subtitle" role="alert">
              {systemProxyError}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card
        className={`settings-basic-group-card settings-basic-shadcn-card settings-basic-sounds-card${
          appSettings.notificationSoundsEnabled ? " is-enabled" : ""
        }`}
      >
        <CardHeader className="settings-basic-sounds-card-header">
          <CardTitle className="settings-subsection-title">
            {t("settings.soundsSubtitle")}
          </CardTitle>
          <CardDescription className="settings-subsection-subtitle">
            {t("settings.soundsSubDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="settings-basic-sounds-card-content">
          <div className="settings-sound-toggle-row">
            <div>
              <div className="settings-toggle-title">{t("settings.notificationSounds")}</div>
              <div className="settings-toggle-subtitle">
                {t("settings.notificationSoundsDesc")}
              </div>
            </div>
            <Switch
              checked={appSettings.notificationSoundsEnabled}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  notificationSoundsEnabled: checked,
                })
              }
            />
          </div>
          <div className="settings-help settings-sound-hint settings-sound-hint-shadcn">
            <Badge variant="outline" className="settings-sound-status-badge">
              <Info size={12} aria-hidden />
              <span>
                {appSettings.notificationSoundsEnabled
                  ? t("settings.notificationSoundsEnabled")
                  : t("settings.notificationSoundsDisabled")}
              </span>
            </Badge>
            <span className="settings-sound-hint-copy">
              {t("settings.notificationSoundsHint")}
            </span>
          </div>
          {appSettings.notificationSoundsEnabled ? (
            <div className="settings-sound-config settings-sound-config-shadcn">
              <div className="settings-sound-control-item">
                <Label className="settings-field-label" htmlFor="notification-sound-select-native">
                  {t("settings.soundSelectLabel")}
                </Label>
                <div className="settings-sound-select-row settings-sound-select-row-shadcn">
                  <select
                    id="notification-sound-select-native"
                    className="settings-sound-native-select-sr"
                    value={selectedNotificationSound}
                    onChange={(event) => handleNotificationSoundOptionChange(event.target.value)}
                  >
                    {soundOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Select
                    value={selectedNotificationSound}
                    onValueChange={handleNotificationSoundOptionChange}
                  >
                    <SelectTrigger
                      id="notification-sound-select"
                      className="settings-sound-select-trigger"
                      aria-label={t("settings.soundSelectLabel")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {soundOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="settings-sound-test-btn"
                    onClick={() =>
                      onTestNotificationSound(
                        selectedNotificationSound,
                        notificationSoundPathDraft,
                      )
                    }
                  >
                    {t("settings.test")}
                  </Button>
                </div>
              </div>
              {selectedNotificationSound === "custom" ? (
                <div className="settings-sound-control-item settings-sound-control-item-custom">
                  <Label className="settings-field-label" htmlFor="notification-sound-custom-path">
                    {t("settings.soundCustomFileLabel")}
                  </Label>
                  <div className="settings-sound-custom-path-row settings-sound-custom-path-row-shadcn">
                    <Input
                      id="notification-sound-custom-path"
                      type="text"
                      className="settings-sound-custom-input"
                      value={notificationSoundPathDraft}
                      placeholder={t("settings.soundCustomPlaceholder")}
                      onChange={(event) => setNotificationSoundPathDraft(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="settings-button-compact"
                      onClick={() => {
                        void handleBrowseNotificationSoundPath();
                      }}
                      aria-label={t("settings.browse")}
                    >
                      <FolderOpen size={14} aria-hidden />
                      {t("settings.browse")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="settings-button-compact"
                      onClick={handleSaveNotificationSoundPath}
                    >
                      {t("common.save")}
                    </Button>
                  </div>
                  <div className="settings-help settings-sound-custom-hint">
                    {t("settings.soundCustomHint")}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
