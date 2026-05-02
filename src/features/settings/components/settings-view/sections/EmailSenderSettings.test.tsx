// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, EmailSenderSettingsView } from "@/types";
import { EmailSenderSettings } from "./EmailSenderSettings";

const getEmailSenderSettingsMock = vi.fn();
const updateEmailSenderSettingsMock = vi.fn();
const sendTestEmailMock = vi.fn();

vi.mock("@/services/tauri", () => ({
  getEmailSenderSettings: (...args: unknown[]) => getEmailSenderSettingsMock(...args),
  updateEmailSenderSettings: (...args: unknown[]) => updateEmailSenderSettingsMock(...args),
  sendTestEmail: (...args: unknown[]) => sendTestEmailMock(...args),
}));

const emailSender = {
  enabled: false,
  provider: "custom",
  senderEmail: "",
  senderName: "",
  smtpHost: "",
  smtpPort: 465,
  security: "ssl_tls",
  username: "",
  recipientEmail: "",
} as const;

const baseSettings = {
  emailSender,
} as AppSettings;

const enabledEmailSender = {
  ...emailSender,
  enabled: true,
  senderEmail: "sender@example.com",
  smtpHost: "smtp.example.com",
  username: "sender@example.com",
  recipientEmail: "to@example.com",
} as const;

function t(key: string): string {
  return key;
}

function emailView(overrides?: Partial<EmailSenderSettingsView>): EmailSenderSettingsView {
  return {
    settings: { ...emailSender },
    secretConfigured: false,
    secret: null,
    ...overrides,
  };
}

describe("EmailSenderSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEmailSenderSettingsMock.mockResolvedValue(emailView());
    updateEmailSenderSettingsMock.mockImplementation(async (request) => ({
      settings: request.settings,
      secretConfigured: Boolean(request.secret) && !request.clearSecret,
      secret: request.clearSecret ? null : request.secret ?? null,
    }));
    sendTestEmailMock.mockResolvedValue({
      provider: "custom",
      acceptedRecipients: ["to@example.com"],
      durationMs: 12,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("saves provider selection and refreshes backend preset defaults", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    updateEmailSenderSettingsMock.mockImplementationOnce(async (request) => ({
      settings: {
        ...request.settings,
        smtpHost: "smtp.126.com",
        smtpPort: 465,
        security: "ssl_tls",
      },
      secretConfigured: false,
      secret: null,
    }));

    render(
      <EmailSenderSettings
        t={t}
        appSettings={baseSettings}
        onUpdateAppSettings={onUpdateAppSettings}
      />,
    );

    const provider = await screen.findByLabelText("settings.emailProvider");
    fireEvent.change(provider, { target: { value: "126" } });
    expect((screen.getByLabelText("settings.emailSmtpHost") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("settings.emailSenderAddress"), {
      target: { value: "sender@example.com" },
    });
    fireEvent.change(screen.getByLabelText("settings.emailUsername"), {
      target: { value: "sender@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateEmailSenderSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({
            provider: "126",
            smtpHost: "",
            smtpPort: 465,
            security: "ssl_tls",
          }),
        }),
      );
    });
    await waitFor(() => {
      expect((screen.getByLabelText("settings.emailSmtpHost") as HTMLInputElement).value).toBe(
        "smtp.126.com",
      );
    });
    expect(onUpdateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        emailSender: expect.objectContaining({
          provider: "126",
          smtpHost: "smtp.126.com",
        }),
      }),
    );
  });

  it("loads a saved secret into the settings input", async () => {
    getEmailSenderSettingsMock.mockResolvedValue(
      emailView({ secretConfigured: true, secret: "stored-secret" }),
    );

    render(
      <EmailSenderSettings
        t={t}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const secretInput = await screen.findByLabelText("settings.emailSecret");
    expect((secretInput as HTMLInputElement).value).toBe("stored-secret");
  });

  it("saves the recipient inbox as part of email settings", async () => {
    render(
      <EmailSenderSettings
        t={t}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.change(await screen.findByLabelText("settings.emailTestRecipient"), {
      target: { value: "to@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateEmailSenderSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ recipientEmail: "to@example.com" }),
        }),
      );
    });
  });

  it("shows the recipient inbox field and blocks test send until email is enabled", async () => {
    render(
      <EmailSenderSettings
        t={t}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await screen.findByLabelText("settings.emailTestRecipient");
    expect(await screen.findByText("settings.emailTestEnableFirst")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("settings.emailTestRecipient"), {
      target: { value: "to@example.com" },
    });
    const sendButton = screen.getByRole("button", { name: "settings.emailSendTest" });
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sendButton);

    expect(sendTestEmailMock).not.toHaveBeenCalled();
  });

  it("offers an inline enable-and-save action for test sending", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);

    render(
      <EmailSenderSettings
        t={t}
        appSettings={baseSettings}
        onUpdateAppSettings={onUpdateAppSettings}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "settings.emailEnableAndSave" }));

    await waitFor(() => {
      expect(updateEmailSenderSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ enabled: true }),
        }),
      );
    });
    expect(onUpdateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        emailSender: expect.objectContaining({ enabled: true }),
      }),
    );
    await screen.findByText("settings.emailEnabledSaved");
  });

  it("saves a new secret and keeps it visible", async () => {
    render(
      <EmailSenderSettings
        t={t}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const secretInput = await screen.findByLabelText("settings.emailSecret");
    fireEvent.change(secretInput, { target: { value: "super-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() => {
      expect(updateEmailSenderSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ secret: "super-secret" }),
      );
    });
    await waitFor(() => {
      expect((secretInput as HTMLInputElement).value).toBe("super-secret");
    });
  });

  it("clears a configured secret", async () => {
    getEmailSenderSettingsMock.mockResolvedValue(
      emailView({ secretConfigured: true, secret: "stored-secret" }),
    );
    updateEmailSenderSettingsMock.mockResolvedValue({
      settings: emailSender,
      secretConfigured: false,
      secret: null,
    });

    render(
      <EmailSenderSettings
        t={t}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const clearButton = await screen.findByRole("button", {
      name: "settings.emailClearSecret",
    });
    await waitFor(() => {
      expect((clearButton as HTMLButtonElement).disabled).toBe(false);
    });
    fireEvent.click(clearButton);

    await waitFor(() => {
      expect(updateEmailSenderSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ clearSecret: true }),
      );
    });
    expect((screen.getByLabelText("settings.emailSecret") as HTMLInputElement).value).toBe("");
  });

  it("shows structured test-send errors", async () => {
    getEmailSenderSettingsMock.mockResolvedValue(
      emailView({
        settings: { ...enabledEmailSender },
        secretConfigured: true,
        secret: "stored-secret",
      }),
    );
    sendTestEmailMock.mockRejectedValue({
      code: "invalid_recipient",
      retryable: false,
      userMessage: "bad recipient",
    });

    render(
      <EmailSenderSettings
        t={t}
        appSettings={baseSettings}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await screen.findByText("settings.emailTestReady");
    fireEvent.click(screen.getByRole("button", { name: "settings.emailSendTest" }));

    await waitFor(() => {
      expect(sendTestEmailMock).toHaveBeenCalledWith({});
    });
    await screen.findByText("bad recipient");
  });
});
