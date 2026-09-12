import { createElement, lazy, Suspense } from "react";
import Puzzle from "lucide-react/dist/esm/icons/puzzle";
import Store from "lucide-react/dist/esm/icons/store";
import i18n from "@/lib/i18n";
import { settingsRegistry } from "@ccgui/plugin-sdk";
import { bootstrapPlugins, ipcBackend } from "./runtime/loader";
import { BUILTIN_PLUGINS } from "./builtin";
import { usePluginsStore } from "./manager/usePlugins";
import { useMarketplaceStore } from "./marketplace/store";

const PluginsSection = lazy(() => import("./manager/PluginsSection"));
const MarketplaceSection = lazy(() => import("./marketplace/MarketplaceSection"));

let started = false;

/**
 * Plugin system entry (plan §4.1): registers the 插件管理 settings section
 * through the same registry plugins use (dogfood), then bootstraps the
 * loader — hardening, usage-event bridge, builtin + installed plugins.
 * Called once from App on mount; idempotent.
 */
export function startPluginSystem(): void {
  if (started) return;
  started = true;
  settingsRegistry.register({
    id: "plugins",
    key: "plugins",
    label: () => i18n.t("plugins.managerTitle"),
    icon: Puzzle,
    group: "settings",
    order: 5,
    component: function PluginsManagerPage() {
      return createElement(Suspense, { fallback: null }, createElement(PluginsSection));
    },
  });
  settingsRegistry.register({
    id: "marketplace",
    key: "marketplace",
    label: () => i18n.t("plugins.marketTitle"),
    icon: Store,
    group: "settings",
    order: 6,
    component: function MarketplacePage() {
      return createElement(Suspense, { fallback: null }, createElement(MarketplaceSection));
    },
  });
  void bootstrapWithRetry()
    .then(() => usePluginsStore.getState().refresh())
    // Update hints (plan ADR-4): check at startup and once every 24h.
    .then(() => {
      const check = () => void useMarketplaceStore.getState().checkUpdates();
      check();
      setInterval(check, 24 * 3600 * 1000);
    })
    .catch((error) => console.error("[plugins] bootstrap failed", error));
}

/** Backend list can lose the startup race (DB/bridge not ready when App
 *  mounts). Retry with backoff; if every attempt fails the manager store
 *  re-kicks bootstrap when 插件管理 is opened (pluginsBootstrapped gate). */
const BOOTSTRAP_RETRY_DELAYS_MS = [2000, 5000, 10_000];

async function bootstrapWithRetry(): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await bootstrapPlugins(ipcBackend, BUILTIN_PLUGINS);
      return;
    } catch (error) {
      const delay = BOOTSTRAP_RETRY_DELAYS_MS[attempt];
      if (delay === undefined) throw error;
      console.warn(
        `[plugins] bootstrap attempt ${attempt + 1} failed; retrying in ${delay}ms`,
        error,
      );
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, delay);
      await promise;
    }
  }
}
