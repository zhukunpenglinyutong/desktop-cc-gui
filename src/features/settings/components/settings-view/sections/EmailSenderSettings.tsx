import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Mail from "lucide-react/dist/esm/icons/mail";
import Send from "lucide-react/dist/esm/icons/send";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { AppSettings, EmailSendError, EmailSenderSettings as EmailSenderSettingsModel, EmailSenderProvider } from "@/types";
import {
  getEmailSenderSettings,
  sendTestEmail,
  updateEmailSenderSettings,
} from "@/services/tauri";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type EmailSenderSettingsProps = {
  t: (key: string) => string;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

type ActionState = "load" | "save" | "clear" | "test" | null;

function defaultEmailSenderSettings(): EmailSenderSettingsModel {
  return {
    enabled: false,
    provider: "custom",
    senderEmail: "",
    senderName: "",
    smtpHost: "",
    smtpPort: 465,
    security: "ssl_tls",
    username: "",
    recipientEmail: "",
  };
}

function areEmailSenderSettingsEqual(
  left: EmailSenderSettingsModel,
  right: EmailSenderSettingsModel,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.provider === right.provider &&
    left.senderEmail === right.senderEmail &&
    left.senderName === right.senderName &&
    left.smtpHost === right.smtpHost &&
    left.smtpPort === right.smtpPort &&
    left.security === right.security &&
    left.username === right.username &&
    left.recipientEmail === right.recipientEmail
  );
}

function isEmailSendError(value: unknown): value is EmailSendError {
  return Boolean(
    value &&
      typeof value === "object" &&
      "code" in value &&
      "userMessage" in value,
  );
}

function humanizeEmailError(t: (key: string) => string, error: unknown): string {
  if (isEmailSendError(error)) {
    const key = `settings.emailError.${error.code}`;
    const translated = t(key);
    return translated === key ? error.userMessage : translated;
  }
  return error instanceof Error ? error.message : String(error);
}

export function EmailSenderSettings({
  t,
  appSettings,
  onUpdateAppSettings,
}: EmailSenderSettingsProps) {
  const [draft, setDraft] = useState<EmailSenderSettingsModel>(
    appSettings.emailSender ?? defaultEmailSenderSettings(),
  );
  const [savedSettings, setSavedSettings] = useState<EmailSenderSettingsModel>(
    appSettings.emailSender ?? defaultEmailSenderSettings(),
  );
  const [secretDraft, setSecretDraft] = useState("");
  const [savedSecret, setSavedSecret] = useState("");
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [action, setAction] = useState<ActionState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const didRunInitialAppSettingsSyncRef = useRef(false);

  useEffect(() => {
    let active = true;
    setAction("load");
    getEmailSenderSettings()
      .then((view) => {
        if (!active) {
          return;
        }
        setDraft(view.settings);
        setSavedSettings(view.settings);
        setSecretConfigured(view.secretConfigured);
        setSecretDraft(view.secret ?? "");
        setSavedSecret(view.secret ?? "");
        setError(null);
      })
      .catch((loadError) => {
        if (active) {
          setError(humanizeEmailError(t, loadError));
        }
      })
      .finally(() => {
        if (active) {
          setAction(null);
        }
      });
    return () => {
      active = false;
    };
  }, [t]);

  useEffect(() => {
    if (!didRunInitialAppSettingsSyncRef.current) {
      didRunInitialAppSettingsSyncRef.current = true;
      return;
    }
    const nextSettings = appSettings.emailSender ?? defaultEmailSenderSettings();
    setDraft(nextSettings);
    setSavedSettings(nextSettings);
  }, [appSettings.emailSender]);

  const smtpFieldsDisabled = draft.provider !== "custom";
  const hasUnsavedChanges =
    !areEmailSenderSettingsEqual(draft, savedSettings) || secretDraft.trim() !== savedSecret;
  const canSave = useMemo(() => {
    if (action !== null) {
      return false;
    }
    if (draft.provider !== "custom") {
      return true;
    }
    return draft.smtpPort > 0 && draft.smtpPort <= 65535;
  }, [action, draft.provider, draft.smtpPort]);

  const updateDraft = useCallback((patch: Partial<EmailSenderSettingsModel>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setNotice(null);
    setError(null);
  }, []);

  const updateSecretDraft = useCallback((secret: string) => {
    setSecretDraft(secret);
    setNotice(null);
    setError(null);
  }, []);

  const testSendDisabledReason = useMemo(() => {
    if (!draft.enabled) {
      return t("settings.emailTestEnableFirst");
    }
    if (hasUnsavedChanges) {
      return t("settings.emailTestSaveFirst");
    }
    if (!draft.recipientEmail.trim()) {
      return t("settings.emailRecipientFirst");
    }
    if (!secretConfigured) {
      return t("settings.emailTestSecretFirst");
    }
    return null;
  }, [draft.enabled, draft.recipientEmail, hasUnsavedChanges, secretConfigured, t]);
  const canSendTest = action === null && !testSendDisabledReason;

  const handleSave = useCallback(async () => {
    setAction("save");
    setError(null);
    setNotice(null);
    try {
      const view = await updateEmailSenderSettings({
        settings: draft,
        secret: secretDraft.trim() || null,
      });
      setDraft(view.settings);
      setSavedSettings(view.settings);
      setSecretDraft(view.secret ?? "");
      setSavedSecret(view.secret ?? "");
      setSecretConfigured(view.secretConfigured);
      await onUpdateAppSettings({
        ...appSettings,
        emailSender: view.settings,
      });
      setNotice(t("settings.emailSaved"));
    } catch (saveError) {
      setError(humanizeEmailError(t, saveError));
    } finally {
      setAction(null);
    }
  }, [appSettings, draft, onUpdateAppSettings, secretDraft, t]);

  const handleEnableAndSave = useCallback(async () => {
    setAction("save");
    setError(null);
    setNotice(null);
    const enabledSettings = { ...draft, enabled: true };
    try {
      const view = await updateEmailSenderSettings({
        settings: enabledSettings,
        secret: secretDraft.trim() || null,
      });
      setDraft(view.settings);
      setSavedSettings(view.settings);
      setSecretDraft(view.secret ?? "");
      setSavedSecret(view.secret ?? "");
      setSecretConfigured(view.secretConfigured);
      await onUpdateAppSettings({
        ...appSettings,
        emailSender: view.settings,
      });
      setNotice(t("settings.emailEnabledSaved"));
    } catch (saveError) {
      setError(humanizeEmailError(t, saveError));
    } finally {
      setAction(null);
    }
  }, [appSettings, draft, onUpdateAppSettings, secretDraft, t]);

  const handleClearSecret = useCallback(async () => {
    setAction("clear");
    setError(null);
    setNotice(null);
    try {
      const view = await updateEmailSenderSettings({
        settings: draft,
        clearSecret: true,
      });
      setDraft(view.settings);
      setSavedSettings(view.settings);
      setSecretDraft(view.secret ?? "");
      setSavedSecret(view.secret ?? "");
      setSecretConfigured(view.secretConfigured);
      await onUpdateAppSettings({
        ...appSettings,
        emailSender: view.settings,
      });
      setNotice(t("settings.emailSecretCleared"));
    } catch (clearError) {
      setError(humanizeEmailError(t, clearError));
    } finally {
      setAction(null);
    }
  }, [appSettings, draft, onUpdateAppSettings, t]);

  const handleTestSend = useCallback(async () => {
    setAction("test");
    setError(null);
    setNotice(null);
    try {
      await sendTestEmail({});
      setNotice(t("settings.emailTestSent"));
    } catch (testError) {
      setError(humanizeEmailError(t, testError));
    } finally {
      setAction(null);
    }
  }, [t]);

  return (
    <div className="settings-email-section">
      <div className="settings-section-title text-[30px] font-bold text-(--text-strong) tracking-tight mb-1">{t("settings.emailTitle")}</div>
      <div className="settings-section-subtitle text-[13px] text-(--text-muted) mb-1">{t("settings.emailDescription")}</div>

      <Card className={`settings-basic-group-card settings-basic-shadcn-card settings-email-card${draft.enabled ? " is-enabled" : ""}`}>
        <CardHeader className="settings-card-switch-header">
          <div className="settings-card-switch-meta">
            <CardTitle className="settings-toggle-title">
              <span className="settings-proxy-card-title">
                <Mail size={16} aria-hidden />
                {t("settings.emailEnableTitle")}
              </span>
            </CardTitle>
            <CardDescription className="settings-toggle-subtitle">
              {t("settings.emailEnableDesc")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="settings-basic-sounds-card-content">
          <div className="settings-form-grid">
            <div className="settings-field">
              <Label htmlFor="email-enabled">{t("settings.emailEnableTitle")}</Label>
              <div className="settings-proxy-input-row">
                <Switch
                  id="email-enabled"
                  checked={draft.enabled}
                  onCheckedChange={(enabled) => updateDraft({ enabled })}
                  aria-label={t("settings.emailEnableTitle")}
                />
              </div>
            </div>
            <div className="settings-field">
              <Label htmlFor="email-provider">{t("settings.emailProvider")}</Label>
              <select
                id="email-provider"
                className="settings-select"
                value={draft.provider}
                onChange={(event) => updateDraft({ provider: event.target.value as EmailSenderProvider })}
              >
                <option value="126">126</option>
                <option value="163">163</option>
                <option value="qq">QQ</option>
                <option value="custom">{t("settings.emailProviderCustom")}</option>
              </select>
            </div>
            <div className="settings-field">
              <Label htmlFor="email-sender-address">{t("settings.emailSenderAddress")}</Label>
              <Input
                id="email-sender-address"
                value={draft.senderEmail}
                onChange={(event) => updateDraft({ senderEmail: event.target.value })}
                placeholder="name@example.com"
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="email-sender-name">{t("settings.emailSenderName")}</Label>
              <Input
                id="email-sender-name"
                value={draft.senderName}
                onChange={(event) => updateDraft({ senderName: event.target.value })}
                placeholder="Moss"
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="email-username">{t("settings.emailUsername")}</Label>
              <Input
                id="email-username"
                value={draft.username}
                onChange={(event) => updateDraft({ username: event.target.value })}
                placeholder="name@example.com"
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="email-smtp-host">{t("settings.emailSmtpHost")}</Label>
              <Input
                id="email-smtp-host"
                value={draft.smtpHost}
                onChange={(event) => updateDraft({ smtpHost: event.target.value })}
                disabled={smtpFieldsDisabled}
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="email-smtp-port">{t("settings.emailSmtpPort")}</Label>
              <Input
                id="email-smtp-port"
                value={String(draft.smtpPort)}
                onChange={(event) => updateDraft({ smtpPort: Number.parseInt(event.target.value, 10) || 0 })}
                disabled={smtpFieldsDisabled}
                inputMode="numeric"
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="email-security">{t("settings.emailSecurity")}</Label>
              <select
                id="email-security"
                className="settings-select"
                value={draft.security}
                onChange={(event) => updateDraft({ security: event.target.value as EmailSenderSettingsModel["security"] })}
                disabled={smtpFieldsDisabled}
              >
                <option value="ssl_tls">SSL/TLS</option>
                <option value="start_tls">STARTTLS</option>
                <option value="none">{t("settings.emailSecurityNone")}</option>
              </select>
            </div>
            <div className="settings-field">
              <Label htmlFor="email-secret">{t("settings.emailSecret")}</Label>
              <Input
                id="email-secret"
                type="text"
                value={secretDraft}
                onChange={(event) => updateSecretDraft(event.target.value)}
                placeholder={secretConfigured ? t("settings.emailSecretConfigured") : t("settings.emailSecretPlaceholder")}
                autoComplete="off"
              />
            </div>
            <div className="settings-field">
              <Label htmlFor="email-recipient-inbox">{t("settings.emailTestRecipient")}</Label>
              <Input
                id="email-recipient-inbox"
                value={draft.recipientEmail}
                onChange={(event) => updateDraft({ recipientEmail: event.target.value })}
                placeholder="to@example.com"
                inputMode="email"
              />
            </div>
          </div>

          <div className="settings-help settings-sound-hint settings-sound-hint-shadcn">
            {secretConfigured ? t("settings.emailSecretConfigured") : t("settings.emailSecretMissing")}
          </div>

          <div className="settings-button-row">
            <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
              {action === "save" ? t("settings.emailSaving") : t("common.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleClearSecret()}
              disabled={action !== null || !secretConfigured}
            >
              <Trash2 size={14} aria-hidden />
              {t("settings.emailClearSecret")}
            </Button>
          </div>

          <div className="settings-divider" />

          <div className="settings-field">
            {!draft.enabled ? (
              <div className="settings-button-row">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleEnableAndSave()}
                  disabled={action !== null || !canSave}
                >
                  <Mail size={14} aria-hidden />
                  {action === "save" ? t("settings.emailSaving") : t("settings.emailEnableAndSave")}
                </Button>
              </div>
            ) : null}
            <div className="settings-button-row">
              <Button
                type="button"
                variant="outline"
                onClick={() => void handleTestSend()}
                disabled={!canSendTest}
                title={testSendDisabledReason ?? undefined}
              >
                <Send size={14} aria-hidden />
                {action === "test" ? t("settings.emailTesting") : t("settings.emailSendTest")}
              </Button>
            </div>
            <div className="settings-help settings-sound-hint settings-sound-hint-shadcn">
              {testSendDisabledReason ?? t("settings.emailTestReady")}
            </div>
          </div>

          {notice ? <div className="settings-inline-success" role="status">{notice}</div> : null}
          {error ? <div className="settings-inline-error" role="alert">{error}</div> : null}
        </CardContent>
      </Card>
    </div>
  );
}
