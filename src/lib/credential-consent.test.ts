import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isWeb: false }));
vi.mock("./transport", () => ({
  invoke: mocks.invoke,
  get isWeb() {
    return mocks.isWeb;
  },
}));

type ConsentModule = typeof import("./credential-consent");

const REQUIRED = "CredentialConsentRequired: CC GUI has not been allowed to read local CLI logins";
const SOURCES = [
  { provider: "claude", kind: "file", location: "/home/u/.claude/.credentials.json", host: "api.anthropic.com" },
  { provider: "codex", kind: "file", location: "/home/u/.codex/auth.json", host: "chatgpt.com" },
];

let consent: ConsentModule;
let unsubscribe: (() => void) | null = null;
let granted = false;

/** Answer every prompt the dialog host would show with `answer`. */
function autoAnswer(answer: boolean, seen: unknown[] = []) {
  unsubscribe = consent.subscribeCredentialConsent(() => {
    const request = consent.currentCredentialConsent();
    if (!request) return;
    seen.push(request.sources);
    queueMicrotask(() => consent.answerCredentialConsent(answer));
  });
  return seen;
}

beforeEach(async () => {
  vi.resetModules();
  consent = await import("./credential-consent");
  granted = false;
  mocks.isWeb = false;
  mocks.invoke.mockReset().mockImplementation(async (command: string, args?: { granted?: boolean }) => {
    if (command === "cli_credential_consent_get") return granted;
    if (command === "cli_credential_sources") return SOURCES;
    if (command === "cli_credential_consent_set") {
      granted = args?.granted === true;
      return undefined;
    }
    throw new Error(`unexpected ${command}`);
  });
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
});

/** An op that fails with the consent error until consent is granted. */
function limitsOp() {
  return vi.fn(async () => {
    if (!granted) throw REQUIRED;
    return "limits";
  });
}

describe("withCredentialConsent", () => {
  it("passes a successful op through without prompting", async () => {
    granted = true;
    const seen = autoAnswer(true);
    await expect(consent.withCredentialConsent(limitsOp())).resolves.toBe("limits");
    expect(seen).toEqual([]);
  });

  it("rethrows unrelated errors untouched", async () => {
    const seen = autoAnswer(true);
    const op = vi.fn().mockRejectedValue("HTTP 500");
    await expect(consent.withCredentialConsent(op)).rejects.toBe("HTTP 500");
    expect(seen).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("shows the exact stores, persists the grant and retries once", async () => {
    const seen = autoAnswer(true);
    const op = limitsOp();
    await expect(consent.withCredentialConsent(op)).resolves.toBe("limits");
    expect(seen).toEqual([SOURCES]);
    expect(mocks.invoke).toHaveBeenCalledWith("cli_credential_consent_set", { granted: true });
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("keeps the original error on decline and does not ask again this session", async () => {
    const seen = autoAnswer(false);
    await expect(consent.withCredentialConsent(limitsOp())).rejects.toBe(REQUIRED);
    await expect(consent.withCredentialConsent(limitsOp())).rejects.toBe(REQUIRED);
    expect(seen).toHaveLength(1);
    expect(mocks.invoke).not.toHaveBeenCalledWith("cli_credential_consent_set", expect.anything());
  });

  it("asks once for a burst of concurrent lookups", async () => {
    const seen = autoAnswer(true);
    const results = await Promise.all([
      consent.withCredentialConsent(limitsOp()),
      consent.withCredentialConsent(limitsOp()),
      consent.withCredentialConsent(limitsOp()),
    ]);
    expect(results).toEqual(["limits", "limits", "limits"]);
    expect(seen).toHaveLength(1);
  });

  it("never prompts a web-access client", async () => {
    mocks.isWeb = true;
    const seen = autoAnswer(true);
    await expect(consent.withCredentialConsent(limitsOp())).rejects.toBe(REQUIRED);
    expect(seen).toEqual([]);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("an explicit request shows the stores even after a decline", async () => {
    const seen = autoAnswer(false);
    await expect(consent.withCredentialConsent(limitsOp())).rejects.toBe(REQUIRED);
    unsubscribe?.();
    autoAnswer(true, seen);
    await expect(consent.requestCredentialConsent()).resolves.toBe(true);
    expect(seen).toEqual([SOURCES, SOURCES]);
    await expect(consent.withCredentialConsent(limitsOp())).resolves.toBe("limits");
  });

  it("an explicit request queued behind a granted plugin prompt does not prompt again", async () => {
    const seen: unknown[] = [];
    let explicit: Promise<boolean> | null = null;
    unsubscribe = consent.subscribeCredentialConsent(() => {
      const request = consent.currentCredentialConsent();
      if (!request) return;
      seen.push(request.sources);
      // The plugin's prompt is already open when the detail page asks.
      explicit ??= consent.requestCredentialConsent();
      queueMicrotask(() => consent.answerCredentialConsent(true));
    });
    await expect(consent.withCredentialConsent(limitsOp())).resolves.toBe("limits");
    await expect(explicit).resolves.toBe(true);
    expect(seen).toHaveLength(1);
  });

  it("tells change listeners about grants and revokes", async () => {
    autoAnswer(true);
    const changes: boolean[] = [];
    const stop = consent.subscribeCredentialConsentChange((granted) => changes.push(granted));
    await consent.withCredentialConsent(limitsOp());
    await consent.setCredentialConsent(false);
    stop();
    await consent.setCredentialConsent(true);
    expect(changes).toEqual([true, false]);
  });

  it("revoking from settings stops further prompts this session", async () => {
    const seen = autoAnswer(true);
    await consent.setCredentialConsent(false);
    await expect(consent.withCredentialConsent(limitsOp())).rejects.toBe(REQUIRED);
    expect(seen).toEqual([]);

    await consent.setCredentialConsent(true);
    await expect(consent.withCredentialConsent(limitsOp())).resolves.toBe("limits");
  });
});
