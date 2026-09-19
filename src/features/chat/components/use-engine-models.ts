import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelOption } from "@/components/application/ai-chat/cli-menu";
import type { ChannelOption } from "@/components/application/ai-chat/engine-model-panel";
import { ipc, type CliConfig, type EngineCatalog, type EngineInfo } from "@/lib/ipc";
import {
  CLAUDE_FAMILY_ALIASES,
  CLI_CONFIG_CHANGED_EVENT,
  isPseudoProvider,
  providerEntries,
  providerFamilyModels,
  providerModel,
  PSEUDO_LOCAL,
  type EngineId,
} from "@/features/settings/providers";

// Stable fallbacks: a fresh `{}` per render would re-run every effect and
// memo keyed on `catalogs`/`pending` below.
const EMPTY_CATALOGS: Record<string, EngineCatalog> = {};
const EMPTY_PENDING: Record<string, true> = {};

/** Probe identity: an engine whose availability flips (CLI installed or
 *  removed) is worth one fresh probe even in the same workspace. */
const probeKey = (engine: EngineInfo) => `${engine.id}:${engine.available ? 1 : 0}`;

/** What the composer's model picker consumes from [`useEngineModels`]. */
export interface EngineModelsState {
  catalogs: Record<string, EngineCatalog>;
  modelsByEngine: Record<string, ModelOption[]>;
  channelsByEngine: Record<string, ChannelOption[]>;
  refresh: () => Promise<void>;
  pendingEngines: Record<string, true>;
}

/** Provider configs and per-engine model catalogs feeding the CLI menu's
 * per-engine model flyouts, plus the pin effect that repairs unset or stale
 * stored model picks. */

/** Raw record of a channel. `channelId` empty → engine `section.current`. */
function channelRaw(
  engineId: string,
  cliConfig: CliConfig | null,
  channelId?: string,
): unknown {
  const section = cliConfig?.[engineId as EngineId];
  const id = (channelId || section?.current || "").trim();
  if (!id || isPseudoProvider(id)) return undefined;
  return section?.providers?.[id];
}

function configuredModel(
  engineId: string,
  cliConfig: CliConfig | null,
  channelId?: string,
): string {
  const raw = channelRaw(engineId, cliConfig, channelId);
  return raw ? providerModel(engineId as EngineId, raw).trim() : "";
}

export function useEngineModels(
  engines: EngineInfo[],
  models: Record<string, string>,
  pinModels: (updates: Record<string, string>, persist?: boolean) => Promise<void>,
  /** Session-resolved channel per engine; falls back to `section.current`. */
  providers: Record<string, string> = {},
  workspacePath?: string,
): EngineModelsState {
  const { t } = useTranslation();
  const [cliConfig, setCliConfig] = useState<CliConfig | null>(null);
  // Catalogs are workspace-scoped (a WSL distro's CLIs answer differently
  // than local ones), so the cache is keyed by workspace path: switching
  // workspaces reads the other context's entries (repopulated on demand)
  // instead of reacting to the prop with a state reset.
  const [catalogsByWs, setCatalogsByWs] = useState<
    Record<string, Record<string, EngineCatalog>>
  >({});
  const wsKey = workspacePath ?? "";
  // Engine-level custom models (设置 → CLI → 自定义模型): user-added ids
  // merged into the picker next to the CLI's catalog.
  const [customModels, setCustomModels] = useState<Record<string, string[]>>({});
  // Engines whose catalog probe is still in flight: the picker shows whatever
  // it already knows (usually just the configured model) until it lands, so
  // the panel needs to say "still loading" instead of looking truncated.
  const [pendingByWs, setPendingByWs] = useState<Record<string, Record<string, true>>>({});
  // Probes already dispatched, keyed by workspace — see the probe effect.
  const probedByWs = useRef<Record<string, Set<string>>>({});

  // Provider configs feed the model picker's per-engine model lists.
  useEffect(() => {
    ipc.getCliConfig().then(setCliConfig).catch(() => {});
  }, []);
  // The settings CLI page mutates provider config and custom models outside
  // this tree; refetch so the picker tracks both immediately.
  useEffect(() => {
    const reload = () => {
      ipc.getCliConfig().then(setCliConfig).catch(() => {});
      ipc
        .getAppSettings()
        .then((s) => setCustomModels(s.customModels ?? {}))
        .catch(() => {});
    };
    reload();
    window.addEventListener(CLI_CONFIG_CHANGED_EVENT, reload);
    return () => window.removeEventListener(CLI_CONFIG_CHANGED_EVENT, reload);
  }, []);
  const catalogs = catalogsByWs[wsKey] ?? EMPTY_CATALOGS;
  const pending = pendingByWs[wsKey] ?? EMPTY_PENDING;
  // Model catalogs for every engine (pi/omp probe their CLI; others return
  // empty and fall back to provider-config models below). The CLI menu's
  // per-engine model flyouts all read from this map.
  const probeCatalog = useCallback(
    (engineId: string) => {
      setPendingByWs((prev) => ({
        ...prev,
        [wsKey]: { ...(prev[wsKey] ?? {}), [engineId]: true },
      }));
      ipc
        .listEngineModels(engineId, workspacePath)
        .then((list) => {
          setCatalogsByWs((prev) => ({
            ...prev,
            [wsKey]: { ...(prev[wsKey] ?? {}), [engineId]: list },
          }));
        })
        .catch(() => {})
        .finally(() => {
          setPendingByWs((prev) => {
            const ws = prev[wsKey];
            if (!ws?.[engineId]) return prev;
            const next = { ...ws };
            delete next[engineId];
            return { ...prev, [wsKey]: next };
          });
        });
    },
    [wsKey, workspacePath],
  );
  useEffect(() => {
    // One probe per engine (per workspace, per availability state). A probe
    // that resolves without a catalog — a down DSH host, for instance —
    // must not be re-dispatched by a re-render: with `pending` in the deps
    // the flag leaving the map re-ran this effect and refired the probe, so
    // a dead host got one `session/modelCatalog` call per render (~200/s).
    // Retrying is explicit (`refresh`) or follows an availability flip.
    const probed = (probedByWs.current[wsKey] ??= new Set<string>());
    engines
      .filter((engine) => !(engine.id in catalogs) && !probed.has(probeKey(engine)))
      .forEach((engine) => {
        probed.add(probeKey(engine));
        probeCatalog(engine.id);
      });
  }, [engines, catalogs, wsKey, probeCatalog]);

  // Per-engine model lists for the CLI menu flyouts: the backend catalog
  // plus the session (or engine-default) channel's configured model — spawn
  // injects that channel's env, including claude; native files stay official.
  const modelsByEngine = useMemo(() => {
    const result: Record<string, ModelOption[]> = {};
    for (const engine of engines) {
      const configured = configuredModel(engine.id, cliConfig, providers[engine.id]);
      const families = providerFamilyModels(
        engine.id,
        channelRaw(engine.id, cliConfig, providers[engine.id]),
      );
      const providerModels = configured ? [configured] : [];
      const current = models[engine.id]?.trim();
      const catalog = catalogs[engine.id]?.models ?? [];
      // Remote workspace (WSL distro): local channel/custom models cannot
      // run there — the distro CLI's own list is the entire menu.
      if (catalogs[engine.id]?.remote) {
        result[engine.id] = catalog.map((m) => ({
          id: m.id,
          label: m.name || m.id,
          description: m.description ?? undefined,
          provider: m.provider,
        }));
        continue;
      }
      // Channel model leads (it is what the CLI would run unprompted), the
      // backend catalog follows, then engine-level custom models, and the
      // current-override append last so the selection never vanishes.
      const known = [
        ...new Set([
          ...providerModels,
          ...catalog.map((m) => m.id),
          ...(customModels[engine.id] ?? []),
          ...(current ? [current] : []),
        ]),
      ];
      const byId = new Map(catalog.map((m) => [m.id, m]));
      result[engine.id] = known.map((m) => {
        const entry = byId.get(m);
        // The CLI's alias rows (Default/Opus/…) describe the CLI's OWN
        // settings — the official channel's. Under another channel the alias
        // runs that channel's mapped id (spawn injects its env), so the row
        // has to name it; without this the list kept showing the official
        // mapping after a channel switch.
        const mapped = families[m];
        return {
          id: m,
          label: mapped ?? (entry?.name || m),
          description: mapped
            ? `Custom ${CLAUDE_FAMILY_ALIASES[m]?.label ?? m} model`
            : entry?.description ?? undefined,
          // Channel/override ids keep the "provider/model" shape, so the
          // prefix stands in when the catalog doesn't name the provider.
          provider: entry?.provider ?? (m.includes("/") ? m.slice(0, m.indexOf("/")) : undefined),
        };
      });
    }
    return result;
  }, [engines, cliConfig, catalogs, wsKey, models, customModels, providers]);
  // Selectable ids WITHOUT the current-override append: what the channel,
  // the backend catalog, and the custom model list can actually serve.
  const knownIdsByEngine = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const engine of engines) {
      // Pin/invalidation follows the engine default, not the session channel —
      // opening a session on another channel must not rewrite defaultModels.
      const configured = configuredModel(engine.id, cliConfig);
      const ids = new Set((catalogs[engine.id]?.models ?? []).map((m) => m.id));
      // Remote workspace: only the distro CLI's list is selectable — no
      // local channel/custom ids. Custom ids stay selectable past the
      // authoritative-catalog reset on local workspaces only.
      if (!catalogs[engine.id]?.remote) {
        if (configured) ids.add(configured);
        for (const id of customModels[engine.id] ?? []) ids.add(id);
      }
      result[engine.id] = ids;
    }
    return result;
  }, [engines, cliConfig, catalogs, wsKey, customModels]);
  // Official + custom channels for the flyout. Skip the list when the engine
  // has no in-app channels — a lone 官方配置 row is noise.
  const channelsByEngine = useMemo(() => {
    const result: Record<string, ChannelOption[]> = {};
    const official: ChannelOption = {
      id: PSEUDO_LOCAL,
      label: t("settings.cliOfficial"),
    };
    for (const engine of engines) {
      const customs = providerEntries(
        engine.id as EngineId,
        cliConfig?.[engine.id as EngineId],
      ).map((entry) => ({ id: entry.id, label: entry.name }));
      result[engine.id] = customs.length > 0 ? [official, ...customs] : [];
    }
    return result;
  }, [engines, cliConfig, t]);
  // No "default" pseudo entry: an unset selection would hide which model
  // actually runs. Pin it to the first entry — the CLI's effective default.
  // An authoritative catalog also invalidates stale stored picks (leftovers
  // from older, broader catalogs) that the CLI's model flag cannot resolve.
  // All engines' pins are computed first and written in ONE store action:
  useEffect(() => {
    const updates: Record<string, string> = {};
    for (const engine of engines) {
      // Remote catalogs (WSL 发行版) are display-only: `models` is a single
      // global record, so a pin from a distro catalog would (a) put a
      // distro-only id into every local tab's picker and (b) on returning
      // to a local workspace, trip the authoritative-catalog reset below
      // and persist that id over the user's saved default. 远端 catalog
      // 永不触发 pin;用户在远端的模型选择走引擎端 resume,不落地。
      if (catalogs[engine.id]?.remote === true) continue;
      const stored = models[engine.id]?.trim();
      const fallback =
        configuredModel(engine.id, cliConfig) ||
        catalogs[engine.id]?.models[0]?.id ||
        customModels[engine.id]?.[0];
      if (!fallback) continue;
      if (!stored) {
        updates[engine.id] = fallback;
        continue;
      }
      const catalog = catalogs[engine.id];
      if (
        catalog?.authoritative &&
        catalog.models.length > 0 &&
        !knownIdsByEngine[engine.id]?.has(stored)
      ) {
        updates[engine.id] = fallback;
      }
    }
    if (Object.keys(updates).length > 0) void pinModels(updates);
  }, [engines, models, cliConfig, catalogs, wsKey, customModels, knownIdsByEngine, pinModels]);

  // Manual refresh from the flyout: re-read provider configs and re-probe
  // every engine's catalog (the mount effect skips engines already probed,
  const refresh = useCallback(async () => {
    await ipc.getCliConfig().then(setCliConfig).catch(() => {});
    await Promise.all(
      engines.map(async (engine) => {
        try {
          const list = await ipc.listEngineModels(engine.id, workspacePath);
          setCatalogsByWs((prev) => ({
            ...prev,
            [wsKey]: { ...(prev[wsKey] ?? {}), [engine.id]: list },
          }));
        } catch {
          // A failed probe keeps the stale catalog rather than blanking the
          // flyout.
        }
      }),
    );
  }, [engines, wsKey, workspacePath, setCatalogsByWs]);

  return {
    catalogs,
    modelsByEngine,
    channelsByEngine,
    refresh,
    pendingEngines: pending,
  };
}
