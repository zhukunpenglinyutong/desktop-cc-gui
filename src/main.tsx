import "./index.css";
import { installCryptoRandomUUIDPolyfill } from "./lib/id";
import {
  installReactScanHook,
  isReactScanEnabled,
  startReactScanOverlay,
} from "./lib/react-scan";

// Ensure crypto.randomUUID is available in non-secure HTTP contexts (e.g. LAN web bridge).
installCryptoRandomUUIDPolyfill();

/**
 * react-scan must instrument React before the first `react` import runs —
 * afterwards it can no longer hook the renderer. This entry therefore imports
 * nothing that pulls React in: the app body lives in ./bootstrap and is loaded
 * dynamically once the overlay (when enabled) is up.
 */
async function boot() {
  // Hook first, react-dom second: see installReactScanHook for why this runs
  // even when the overlay is off.
  await installReactScanHook();
  if (isReactScanEnabled()) {
    await startReactScanOverlay();
  }
  const { startApp } = await import("./bootstrap");
  startApp();
}

void boot();
