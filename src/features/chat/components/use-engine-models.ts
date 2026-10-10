import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelOption } from "@/components/application/ai-chat/cli-menu";
import { bareOneM, hasOneM } from "@/components/application/ai-chat/one-m-context";
import type { ChannelOption } from "@/components/application/ai-chat/engine-model-panel";
import { ipc, type CliConfig, type EngineCatalog, type EngineInfo } from "@/lib/ipc";
import {
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

/** Catalog ids can be `provider/model` composites (DSH's session/modelCatalog
 *  flattens to them) while the channel's configured model is stored bare —
 *  the same model then listed twice: once raw, once catalogued. Resolve a
 *  bare id to its unique composite catalog entry so the two collapse into
 *  one row. */
function resolveCompositeId(id: string, catalogIds: string[]): string {
  if (!id || id.includes("/")) return id;
  const matches = catalogIds.filter((cid) => cid.endsWith(`/${id}`));
  return matches.length === 1 ? matches[0] : id;
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
  // A catalog is a property of the *context*, not of every workspace: the
  // backend answers from the local CLIs unless the workspace is a remote one
  // (a WSL distro's CLIs answer differently), so all local workspaces share
  // one catalog while each remote workspace carries its own. Caching per
  // workspace instead made refresh act on the active workspace alone — every
  // other (already cached) workspace kept serving its stale list until the
  // user refreshed it there too.
  const [localCatalogs, setLocalCatalogs] = useState<Record<string, EngineCatalog>>(
    {},
  );
  const [remoteCatalogsByWs, setRemoteCatalogsByWs] = useState<
    Record<string, Record<string, EngineCatalog>>
  >({});
  // Which context a workspace's probes answered from. Until a workspace has
  // answered once it stays unresolved and gets probed (its context cannot be
  // guessed from the shared local bucket).
  const [contextByWs, setContextByWs] = useState<Record<string, "local" | "remote">>(
    {},
  );
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
  // Catalog for the active workspace. Until the workspace's context is known
  // the shared local catalog proves nothing about it (it may be a remote one),
  // so the picker starts empty there and fills as the workspace's probes land.
  const context = wsKey === "" ? "local" : contextByWs[wsKey];
  const catalogs =
    context === "remote"
      ? (remoteCatalogsByWs[wsKey] ?? EMPTY_CATALOGS)
      : context === "local"
        ? localCatalogs
        : EMPTY_CATALOGS;
  const pending = pendingByWs[wsKey] ?? EMPTY_PENDING;
  // File one probe answer. A `remote` flag means the answer came from a distro
  // CLI: that workspace is a remote context and keeps its own bucket — which is
  // exactly what stops a distro list from leaking into the shared local one.
  // Everything else is local data for the one catalog every local workspace
  // shares, flag cleared (an engine-derived catalog is blank for a remote
  // workspace by contract, so its flag is local information).
  const applyCatalog = useCallback(
    (engineId: string, ws: string, list: EngineCatalog) => {
      if (list.remote === true && ws !== "") {
        setContextByWs((prev) => (prev[ws] === "remote" ? prev : { ...prev, [ws]: "remote" }));
        setRemoteCatalogsByWs((prev) => ({
          ...prev,
          [ws]: { ...(prev[ws] ?? {}), [engineId]: list },
        }));
        return;
      }
      if (ws !== "") {
        setContextByWs((prev) => (prev[ws] === "local" ? prev : { ...prev, [ws]: "local" }));
      }
      setLocalCatalogs((prev) => ({
        ...prev,
        [engineId]: list.remote ? { ...list, remote: false } : list,
      }));
    },
    [],
  );
  // Live pending flags, keyed by workspace: the picker shows what it already
  // knows (usually just the configured model) until a probe lands, so the panel
  // says "still loading" instead of looking truncated. Both directions go
  // through here so a probe's start and settle can never disagree (a set flag
  // replaced rather than merged would outlive its probe).
  const markPending = useCallback(
    (ws: string, engineId: string, running: boolean) =>
      setPendingByWs((prev) => {
        const bucket = prev[ws] ?? {};
        if (running === (engineId in bucket)) return prev;
        const next = { ...bucket };
        if (running) next[engineId] = true;
        else delete next[engineId];
        return { ...prev, [ws]: next };
      }),
    [],
  );
  // Model catalogs for every engine (pi/omp probe their CLI; others return
  // empty and fall back to provider-config models below). The CLI menu's
  // per-engine model flyouts all read from this map.
  const probeCatalog = useCallback(
    (engineId: string) => {
      markPending(wsKey, engineId, true);
      return ipc
        .listEngineModels(engineId, workspacePath)
        .then((list) => applyCatalog(engineId, wsKey, list))
        .catch(() => {})
        .finally(() => markPending(wsKey, engineId, false));
    },
    [wsKey, workspacePath, applyCatalog, markPending],
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
      const catalog = catalogs[engine.id]?.models ?? [];
      const catalogIds = catalog.map((m) => m.id);
      const configured = resolveCompositeId(
        configuredModel(engine.id, cliConfig, providers[engine.id]),
        catalogIds,
      );
      const families = providerFamilyModels(
        engine.id,
        channelRaw(engine.id, cliConfig, providers[engine.id]),
      );
      const providerModels = configured ? [configured] : [];
      const current = resolveCompositeId(models[engine.id]?.trim() ?? "", catalogIds);
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
      // backend catalog follows, then engine-level custom models. The session
      // pick is appended last so it never vanishes — but a `[1m]` pick is the
      // same model as its bare form, which the model panel marks 1M in place,
      // so only the bare id is added here (never a duplicate "[1m]" row).
      const known = [
        ...new Set([
          ...providerModels,
          ...catalog.map((m) => m.id),
          ...(customModels[engine.id] ?? []),
        ]),
      ];
      if (current && !known.includes(bareOneM(current))) {
        known.push(bareOneM(current));
      }
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
            ? // The CLI menu's own row shape ("Custom Opus model"): family is
              // the alias id, capitalized the way the CLI displays it.
              t("chat.customFamilyModel", {
                family: m.charAt(0).toUpperCase() + m.slice(1),
              })
            : entry?.description ?? undefined,
          // Channel/override ids keep the "provider/model" shape, so the
          // prefix stands in when the catalog doesn't name the provider.
          provider:
            entry?.provider ??
            (m.includes("/") ? m.slice(0, m.indexOf("/")) : undefined),
        };
      });
    }
    return result;
  }, [engines, cliConfig, catalogs, wsKey, models, customModels, providers, t]);
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
      const knownStored = knownIdsByEngine[engine.id];
      // A `[1m]`-tagged pick is a known model plus the 1M switch, not a stale
      // id: authorize it through its bare form, or a Claude tab that turned
      // 1M on would be silently reset back to the untagged model.
      const known =
        knownStored?.has(stored) ||
        (hasOneM(stored) && knownStored?.has(bareOneM(stored)));
      if (catalog?.authoritative && catalog.models.length > 0 && !known) {
        updates[engine.id] = fallback;
      }
    }
    if (Object.keys(updates).length > 0) void pinModels(updates);
  }, [engines, models, cliConfig, catalogs, wsKey, customModels, knownIdsByEngine, pinModels]);

  // Manual refresh from the flyout: re-read provider configs and re-probe the
  // catalogs. The probe effect skips engines already probed, so settings edits
  // otherwise only land after an app restart. Scope = the active workspace's
  // context plus every remote context already cached: all local workspaces
  // share one catalog, so refreshing any of them covers the rest, while each
  // remote (distro) workspace keeps its own and would otherwise stay stale.
  const refresh = useCallback(async () => {
    await ipc.getCliConfig().then(setCliConfig).catch(() => {});
    // Local context first — probed with the active workspace when that one is
    // local, so the spinner lands in the bucket the picker reads — then every
    // cached remote context, each of which owns its own catalog.
    const targets = [
      context === "remote" ? "" : wsKey,
      ...Object.keys(contextByWs).filter((ws) => contextByWs[ws] === "remote"),
    ];
    // Collect every probe before awaiting: the requests must all be in flight
    // at once. (An await inside the building loops would serialize them.)
    const probes: Promise<void>[] = [];
    for (const ws of targets) {
      for (const engine of engines) {
        markPending(ws, engine.id, true);
        probes.push(
          ipc
            .listEngineModels(engine.id, ws || undefined)
            .then((list) => applyCatalog(engine.id, ws, list))
            .catch(() => {
              // A failed probe keeps the stale catalog rather than blanking the
              // flyout.
            })
            .finally(() => markPending(ws, engine.id, false)),
        );
      }
    }
    await Promise.all(probes);
  }, [engines, wsKey, context, applyCatalog, markPending, contextByWs]);

  return {
    catalogs,
    modelsByEngine,
    channelsByEngine,
    refresh,
    pendingEngines: pending,
  };
}
