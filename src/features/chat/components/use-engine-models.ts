import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ModelOption } from "@/components/application/ai-chat/cli-menu";
import { ipc, type CliConfig, type EngineCatalog, type EngineInfo } from "@/lib/ipc";
import {
  CLI_CONFIG_CHANGED_EVENT,
  isPseudoProvider,
  providerModel,
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
  refresh: () => Promise<void>;
  pendingEngines: Record<string, true>;
}

/** Provider configs and per-engine model catalogs feeding the CLI menu's
 * per-engine model flyouts, plus the pin effect that repairs unset or stale
 * stored model picks. */
export function useEngineModels(
  engines: EngineInfo[],
  models: Record<string, string>,
  pinModels: (updates: Record<string, string>, persist?: boolean) => Promise<void>,
  workspacePath?: string,
): EngineModelsState {
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
  // plus, for channel-driven engines, the current provider channel's
  // configured model (both describe the channel the engine would actually
  // launch with), with the current override appended so the selection never
  // vanishes. Claude is exempt: it runs on the CLI's own configuration
  // (~/.claude/settings.json), so app channels contribute nothing.
  const modelsByEngine = useMemo(() => {
    const result: Record<string, ModelOption[]> = {};
    for (const engine of engines) {
      const section = cliConfig?.[engine.id as EngineId];
      const currentId = section?.current ?? "";
      const currentRaw =
        engine.id !== "claude" && currentId && !isPseudoProvider(currentId)
          ? section?.providers?.[currentId]
          : undefined;
      const configured = currentRaw
        ? providerModel(engine.id as EngineId, currentRaw).trim()
        : "";

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
      const providerModels = configured ? [configured] : [];
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
        return {
          id: m,
          label: entry?.name || m,
          description: entry?.description ?? undefined,
          // Channel/override ids keep the "provider/model" shape, so the
          // prefix stands in when the catalog doesn't name the provider.
          provider: entry?.provider ?? (m.includes("/") ? m.slice(0, m.indexOf("/")) : undefined),
        };
      });
    }
    return result;
  }, [engines, cliConfig, catalogs, wsKey, models, customModels]);
  // Selectable ids WITHOUT the current-override append: what the channel,
  // the backend catalog, and the custom model list can actually serve.
  const knownIdsByEngine = useMemo(() => {
    const result: Record<string, Set<string>> = {};
    for (const engine of engines) {
      const section = cliConfig?.[engine.id as EngineId];
      const currentId = section?.current ?? "";
      const currentRaw =
        engine.id !== "claude" && currentId && !isPseudoProvider(currentId)
          ? section?.providers?.[currentId]
          : undefined;
      const configured = currentRaw
        ? providerModel(engine.id as EngineId, currentRaw).trim()
        : "";
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
      const first = modelsByEngine[engine.id]?.[0];
      if (!first) continue;
      const stored = models[engine.id]?.trim();
      if (!stored) {
        updates[engine.id] = first.id;
        continue;
      }
      const catalog = catalogs[engine.id];
      if (
        catalog?.authoritative &&
        catalog.models.length > 0 &&
        !knownIdsByEngine[engine.id]?.has(stored)
      ) {
        updates[engine.id] = first.id;
      }
    }
    if (Object.keys(updates).length > 0) void pinModels(updates);
  }, [engines, models, modelsByEngine, catalogs, wsKey, knownIdsByEngine, pinModels]);
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

  return { catalogs, modelsByEngine, refresh, pendingEngines: pending };
}
