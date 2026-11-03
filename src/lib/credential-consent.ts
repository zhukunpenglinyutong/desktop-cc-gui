import { invoke, isWeb } from "./transport";
import { errorText } from "./errors";

/**
 * Consent before CC GUI reads local CLI logins for the usage-limits lookup.
 * The backend (src-tauri/src/usage_limits/consent.rs) refuses every lookup
 * until the user agreed; `withCredentialConsent` turns that refusal into a
 * one-time desktop prompt (CredentialConsentDialogHost) that lists exactly
 * which stores are read and where each credential is sent, persists the
 * answer and retries. Same shape as lib/grant.ts.
 *
 * Web-access clients never see the prompt: the bridge has no consent route
 * (a remote client must not widen what the host reads), so the original
 * error propagates there.
 */

/** Mirrors `CONSENT_REQUIRED` in src-tauri/src/usage_limits/consent.rs. */
const CONSENT_PREFIX = "CredentialConsentRequired: ";

export interface CredentialSource {
  provider: "claude" | "codex";
  /** "keychain": macOS Keychain item by service name; "file": a path. */
  kind: "keychain" | "file";
  location: string;
  /** The only host the credential is sent to. */
  host: string;
}

let pending: ((ok: boolean) => void) | null = null;
/** Stable snapshot for useSyncExternalStore (a new object only on change). */
let snapshot: { sources: CredentialSource[] } | null = null;
const listeners = new Set<() => void>();
/** Grant/revoke observers (the detail page's state line). */
const changeListeners = new Set<(granted: boolean) => void>();
/** Declined (or revoked) this session: plugins poll limits, and a refusal
 *  must not turn into a prompt loop. Settings can still grant explicitly. */
let declined = false;
/** Serializes prompts so a burst of lookups asks once. */
let chain: Promise<boolean> = Promise.resolve(false);

function emit() {
  for (const cb of listeners) cb();
}

/** useSyncExternalStore wiring for CredentialConsentDialogHost. */
export function subscribeCredentialConsent(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Notified after every persisted grant or revoke, whichever path made it. */
export function subscribeCredentialConsentChange(cb: (granted: boolean) => void): () => void {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

export function currentCredentialConsent(): { sources: CredentialSource[] } | null {
  return snapshot;
}

export function answerCredentialConsent(ok: boolean) {
  const resolve = pending;
  pending = null;
  snapshot = null;
  emit();
  resolve?.(ok);
}

export function getCredentialConsent(): Promise<boolean> {
  return invoke<boolean>("cli_credential_consent_get");
}

export function getCredentialSources(): Promise<CredentialSource[]> {
  return invoke<CredentialSource[]>("cli_credential_sources");
}

/** Explicit grant/revoke from the plugin detail page. Revoking also stops
 *  prompts for the rest of the session. */
export async function setCredentialConsent(granted: boolean): Promise<void> {
  await invoke("cli_credential_consent_set", { granted });
  declined = !granted;
  for (const cb of changeListeners) cb(granted);
}

async function askAndGrant(): Promise<boolean> {
  if (declined) return false;
  // An earlier prompt in the chain may have granted already.
  if (await getCredentialConsent()) return true;
  return promptAndGrant();
}

/** Explicit "allow" from the plugin detail page: the same prompt, so the
 *  user always sees which stores are read before granting. */
export function requestCredentialConsent(): Promise<boolean> {
  // A prompt queued ahead of this one may already have granted.
  const asked = chain
    .catch(() => false)
    .then(async () => (await getCredentialConsent()) || promptAndGrant());
  chain = asked;
  return asked;
}

async function promptAndGrant(): Promise<boolean> {
  const sources = await getCredentialSources();
  const ok = await new Promise<boolean>((resolve) => {
    pending = resolve;
    snapshot = { sources };
    emit();
  });
  if (!ok) {
    declined = true;
    return false;
  }
  await setCredentialConsent(true);
  return true;
}

/** Run `op`; when the backend refuses for missing consent, ask the desktop
 *  user once and retry. Any other error, a declined prompt or a failed
 *  persist rethrows the original error unchanged. */
export function withCredentialConsent<T>(op: () => Promise<T>): Promise<T> {
  return op().catch(async (e) => {
    if (isWeb || !errorText(e).startsWith(CONSENT_PREFIX)) throw e;
    const asked = chain.catch(() => false).then(askAndGrant);
    chain = asked;
    const granted = await asked.catch(() => false);
    if (!granted) throw e;
    return op();
  });
}
