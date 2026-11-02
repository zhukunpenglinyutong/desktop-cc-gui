import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getCredentialConsent,
  requestCredentialConsent,
  setCredentialConsent,
  subscribeCredentialConsentChange,
} from "@/lib/credential-consent";
import { isWeb } from "@/lib/transport";

/**
 * State + toggle for the host-wide "read local CLI logins" consent, shown
 * under a plugin's `limits.read` permission. Granting goes through the same
 * disclosure prompt as the first lookup (the user sees every store read);
 * revoking is immediate. Desktop only: the web bridge has no consent route.
 */
export function CredentialConsentControl() {
  const { t } = useTranslation();
  const [granted, setGranted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isWeb) return;
    let alive = true;
    getCredentialConsent()
      .then((value) => {
        if (alive) setGranted(value);
      })
      .catch(() => {
        if (alive) setGranted(null);
      });
    // A grant through the plugin-triggered prompt lands elsewhere; follow it.
    const stop = subscribeCredentialConsentChange((value) => {
      if (alive) setGranted(value);
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (isWeb || granted === null) return null;

  const toggle = async () => {
    setBusy(true);
    setFailed(false);
    try {
      if (granted) {
        await setCredentialConsent(false);
        setGranted(false);
      } else {
        setGranted(await requestCredentialConsent());
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-2 text-body-2-regular text-text-tertiary">
      <span>
        {t(granted ? "plugins.credentialConsent.granted" : "plugins.credentialConsent.notGranted")}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void toggle()}
        className="cursor-pointer text-text-brand-secondary hover:underline disabled:cursor-default disabled:opacity-50"
      >
        {t(granted ? "plugins.credentialConsent.revoke" : "plugins.credentialConsent.grant")}
      </button>
      {failed && (
        <span role="alert" className="text-text-error-primary">
          {t("plugins.credentialConsent.failed")}
        </span>
      )}
    </div>
  );
}
