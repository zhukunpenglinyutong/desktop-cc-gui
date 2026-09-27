import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPluginState,
  loadPlugin,
  reloadPlugin,
  reportPluginCrash,
  unloadPlugin,
  type LoaderBackend,
} from "./loader";
import { commandRegistry, settingsRegistry } from "@ccgui/plugin-sdk";
import type { PluginInfo } from "@/lib/ipc";

function fakeBackend(files: Record<string, string> = {}) {
  const quarantined: string[] = [];
  const quarantineErrors: string[] = [];
  const backend: LoaderBackend & {
    quarantined: string[];
    quarantineErrors: string[];
  } = {
    quarantined,
    quarantineErrors,
    list: async () => [],
    readFile: async (id, name) => {
      const content = files[`${id}/${name}`];
      if (content === undefined) throw new Error(`no such file ${id}/${name}`);
      return content;
    },
    quarantine: async (id, error) => {
      quarantined.push(id);
      quarantineErrors.push(error);
    },
    setEnabled: async () => {},
    appVersion: async () => "1.0.0",
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    bridgeInvoke: async () => null,
    workspaceMetadata: async () => ({ id: "workspace-id", path: "C:/work" }),
    workspaceList: async () => [],
    pickDirectory: async () => null,
    documentStorageGetLocation: async () => ({
      kind: "data",
      displayPath: "C:/data/plugin",
      writable: true,
    }),
    documentStorageSelectLocation: async (_id, kind, customPath) => ({
      kind,
      displayPath: customPath ?? "C:/data/plugin",
      writable: true,
    }),
    documentStorageReadText: async () => null,
    documentStorageWriteTextAtomic: async () => ({ status: "written", version: "v1" }),
    documentStorageRemove: async () => ({ status: "removed" }),
    documentStorageList: async () => [],
  };
  return backend;
}

function info(id: string, over: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "",
    author: "",
    tier: "js",
    source: "local",
    enabled: true,
    quarantined: false,
    lastError: null,
    permissions: [],
    installedAt: 0,
    minAppVersion: null,
    icon: null,
    screenshots: [],
    ...over,
  };
}

function builtinManifest(id: string, permissions: string[] = []) {
  return { id, name: id, version: "1.0.0", tier: "js" as const, permissions };
}

describe("loader", () => {
  it("marks a plugin incompatible when its sdkVersion range excludes the host SDK", async () => {
    const backend = fakeBackend();
    let ran = false;
    await loadPlugin(
      {
        info: info("lp-sdk", { source: "builtin" }),
        manifest: { ...builtinManifest("lp-sdk"), sdkVersion: "^0.1" },
        builtinActivate: () => {
          ran = true;
        },
      },
      backend,
    );
    expect(ran).toBe(false);
    expect(getPluginState("lp-sdk")).toBe("incompatible");

    // Absent sdkVersion = "*" — legacy plugins keep loading.
    await loadPlugin(
      {
        info: info("lp-legacy", { source: "builtin" }),
        manifest: builtinManifest("lp-legacy"),
        builtinActivate: () => {
          ran = true;
        },
      },
      backend,
    );
    expect(ran).toBe(true);
    expect(getPluginState("lp-legacy")).toBe("active");
    unloadPlugin("lp-legacy");
  });

  it("activates a builtin plugin through the context pipeline and unloads cleanly", async () => {
    const backend = fakeBackend();
    let cleaned = false;
    await loadPlugin(
      {
        info: info("lp-builtin", { source: "builtin", permissions: ["ui:settings-section"] }),
        manifest: builtinManifest("lp-builtin", ["ui:settings-section"]),
        builtinActivate: (ctx) => {
          ctx.ui.registerSettingsSection({ label: () => "L", component: () => null });
          return () => {
            cleaned = true;
          };
        },
      },
      backend,
    );
    expect(getPluginState("lp-builtin")).toBe("active");
    expect(settingsRegistry.get("plugin:lp-builtin")).toBeDefined();

    unloadPlugin("lp-builtin");
    expect(cleaned).toBe(true);
    expect(settingsRegistry.get("plugin:lp-builtin")).toBeUndefined();
    expect(getPluginState("lp-builtin")).toBe("installed");
  });

  it("unwinds partial registrations when activate throws after registering", async () => {
    // Regression: a plugin that registered capabilities and THEN threw used
    // to leave its disposers unrun — registry entries (and CSS/listeners)
    // leaked while the plugin showed quarantined.
    const backend = fakeBackend();
    await loadPlugin(
      {
        info: info("lp-leak"),
        manifest: builtinManifest("lp-leak", ["ui:command"]),
        builtinActivate: (ctx) => {
          ctx.ui.registerCommand({ key: "leaked", title: () => "Leaked", run: () => {} });
          throw new Error("boom after register");
        },
      },
      backend,
    );
    expect(getPluginState("lp-leak")).toBe("quarantined");
    expect(commandRegistry.get("plugin:lp-leak:leaked")).toBeUndefined();
  });

  it("quarantines a plugin whose activate throws; next load is skipped", async () => {
    const backend = fakeBackend();
    await loadPlugin(
      {
        info: info("lp-thrower"),
        manifest: builtinManifest("lp-thrower"),
        builtinActivate: () => {
          throw new Error("boom");
        },
      },
      backend,
    );
    expect(getPluginState("lp-thrower")).toBe("quarantined");
    expect(backend.quarantined).toEqual(["lp-thrower"]);

    // A quarantined record is never activated again until re-enabled.
    let ran = false;
    await loadPlugin(
      {
        info: info("lp-thrower", { quarantined: true, lastError: "boom" }),
        manifest: builtinManifest("lp-thrower"),
        builtinActivate: () => {
          ran = true;
        },
      },
      backend,
    );
    expect(ran).toBe(false);
    expect(getPluginState("lp-thrower")).toBe("quarantined");
  });

  it("refuses plugins whose minAppVersion exceeds the host version", async () => {
    const backend = fakeBackend();
    let ran = false;
    await loadPlugin(
      {
        info: info("lp-future", { minAppVersion: "9.9.9" }),
        manifest: builtinManifest("lp-future"),
        builtinActivate: () => {
          ran = true;
        },
      },
      backend,
    );
    expect(ran).toBe(false);
    expect(getPluginState("lp-future")).toBe("incompatible");
  });

  it("loads a declarative plugin from directory files and unloads its CSS", async () => {
    const backend = fakeBackend({
      "lp-css/manifest.json": JSON.stringify({
        id: "lp-css",
        name: "CSS",
        version: "1.0.0",
        tier: "declarative",
        // styles.css is the install-reviewed bundle artifact, injected via
        // injectBundleCss — no theme permission needed.
        permissions: [],
      }),
      "lp-css/styles.css": ".composer-x { border-radius: 12px; }",
    });
    await loadPlugin({ info: info("lp-css", { tier: "declarative" }) }, backend);
    expect(getPluginState("lp-css")).toBe("active");
    expect(
      document.head.querySelector('style[data-plugin="lp-css"]')?.textContent,
    ).toContain("border-radius: 12px");

    unloadPlugin("lp-css");
    expect(document.head.querySelector('style[data-plugin="lp-css"]')).toBeNull();
  });

  it("reloadPlugin swaps the running instance onto the freshly read bundle", async () => {
    // Update hot-swap contract: reload must read the files again and leave
    // exactly one live registration (old disposers run, new CSS applied),
    // instead of stacking a second <style> or keeping the old bytes.
    const files: Record<string, string> = {
      "lp-swap/manifest.json": JSON.stringify({
        id: "lp-swap",
        name: "Swap",
        version: "1.0.0",
        tier: "declarative",
        permissions: [],
      }),
      "lp-swap/styles.css": ".v1 { color: red; }",
    };
    const backend = fakeBackend(files);
    await loadPlugin({ info: info("lp-swap", { tier: "declarative" }) }, backend);
    expect(
      document.head.querySelector('style[data-plugin="lp-swap"]')?.textContent,
    ).toContain(".v1");

    // The update transaction landed new bytes on disk under the same id.
    files["lp-swap/styles.css"] = ".v2 { color: blue; }";
    files["lp-swap/manifest.json"] = JSON.stringify({
      id: "lp-swap",
      name: "Swap",
      version: "2.0.0",
      tier: "declarative",
      permissions: [],
    });
    await reloadPlugin(
      { info: info("lp-swap", { tier: "declarative", version: "2.0.0" }) },
      backend,
    );

    expect(getPluginState("lp-swap")).toBe("active");
    const tags = document.head.querySelectorAll('style[data-plugin="lp-swap"]');
    expect(tags).toHaveLength(1);
    expect(tags[0].textContent).toContain(".v2");
    unloadPlugin("lp-swap");
  });

  it("reloadPlugin re-activates an already-active plugin, where loadPlugin alone no-ops", async () => {
    // The reported bug's mechanism, pinned down: an update targets an id
    // that is already active, and a second loadPlugin is a silent no-op —
    // so the old bytes kept running until disable/enable or app restart.
    const backend = fakeBackend();
    let activations = 0;
    let cleanups = 0;
    const plugin = () => ({
      info: info("lp-swap-active"),
      manifest: builtinManifest("lp-swap-active"),
      builtinActivate: () => {
        activations += 1;
        return () => {
          cleanups += 1;
        };
      },
    });

    await loadPlugin(plugin(), backend);
    await loadPlugin(plugin(), backend); // no-op: still the first instance
    expect(activations).toBe(1);

    await reloadPlugin(plugin(), backend);
    expect(activations).toBe(2);
    expect(cleanups).toBe(1); // the old instance unwound before the swap
    unloadPlugin("lp-swap-active");
    expect(cleanups).toBe(2);
  });

  it("rejects an invalid manifest and quarantines the plugin", async () => {
    const backend = fakeBackend({
      "lp-bad/manifest.json": JSON.stringify({
        id: "BAD ID",
        name: "x",
        version: "1.0.0",
        tier: "declarative",
        permissions: [],
      }),
    });
    await loadPlugin({ info: info("lp-bad", { tier: "declarative" }) }, backend);
    expect(getPluginState("lp-bad")).toBe("quarantined");
    expect(backend.quarantined).toEqual(["lp-bad"]);
  });

  it("accepts a safe dotted plugin id", async () => {
    const id = "ccgui.client-context-bridge";
    const backend = fakeBackend({
      [`${id}/manifest.json`]: JSON.stringify({
        id,
        name: "Client Context Bridge",
        version: "1.0.0",
        tier: "declarative",
        permissions: [],
      }),
    });

    await loadPlugin({ info: info(id, { tier: "declarative" }) }, backend);
    expect(getPluginState(id)).toBe("active");
    expect(backend.quarantined).toEqual([]);
    unloadPlugin(id);
  });

  it("activates a builtin whose backend record has empty manifest fields (quarantine-upsert regression)", async () => {
    // Rust upserts a state record for builtin ids on quarantine/enable; that
    // record's PluginInfo has version "" / tier "". The loader must trust the
    // builtin's own manifest, not the record.
    const backend = fakeBackend();
    let ran = false;
    await loadPlugin(
      {
        info: info("lp-record", {
          source: "builtin",
          version: "",
          tier: "" as PluginInfo["tier"],
        }),
        manifest: builtinManifest("lp-record"),
        builtinActivate: () => {
          ran = true;
        },
      },
      backend,
    );
    expect(ran).toBe(true);
    expect(getPluginState("lp-record")).toBe("active");
  });

  it("quarantines after the render-crash threshold and unloads the plugin", async () => {
    const backend = fakeBackend();
    await loadPlugin(
      {
        info: info("lp-crasher"),
        manifest: builtinManifest("lp-crasher"),
        builtinActivate: () => {},
      },
      backend,
    );
    expect(getPluginState("lp-crasher")).toBe("active");
    reportPluginCrash("lp-crasher", new Error("1"), backend);
    reportPluginCrash("lp-crasher", new Error("2"), backend);
    expect(getPluginState("lp-crasher")).toBe("active");
    reportPluginCrash("lp-crasher", new Error("3"), backend);
    expect(getPluginState("lp-crasher")).toBe("quarantined");
    expect(backend.quarantined).toEqual(["lp-crasher"]);
  });
});

describe("js bundle loading", () => {
  // jsdom has no blob-URL module loader, so each import attempt is driven by
  // the URL it mints: the scripted URL is imported for real (a data: module),
  // which keeps the loader's createObjectURL → import → revoke path intact.
  function scriptBlobUrls(urls: string[]) {
    const create = URL.createObjectURL;
    const revoke = URL.revokeObjectURL;
    const used: string[] = [];
    URL.createObjectURL = (() => {
      const next = urls.shift();
      if (next === undefined) throw new Error("no scripted blob URL left");
      used.push(next);
      return next;
    }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    return {
      used,
      restore() {
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
      },
    };
  }

  const GOOD = `data:text/javascript,${
    encodeURIComponent(
      'globalThis.__pluginActivations = (globalThis.__pluginActivations ?? 0) + 1;' +
        'export default function activate() {' +
        ' globalThis.__pluginActivations = (globalThis.__pluginActivations ?? 0) + 10; }',
    )
  }`;
  // What WebKit rejects with when the module script itself cannot be fetched.
  const FETCH_FAILED = `data:text/javascript,${encodeURIComponent(
    'throw new TypeError("Importing a module script failed.");',
  )}`;
  // A bundle that does not even parse: its own fault, never re-evaluated.
  const SYNTAX_ERROR = `data:text/javascript,${encodeURIComponent(
    'throw new SyntaxError("Unexpected end of script");',
  )}`;

  function jsFiles(id: string) {
    return {
      [`${id}/manifest.json`]: JSON.stringify({
        id,
        name: id,
        version: "1.0.0",
        tier: "js",
        permissions: [],
      }),
      [`${id}/main.js`]: "// served through the scripted blob URLs",
    };
  }

  beforeEach(() => {
    delete (globalThis as { __pluginActivations?: number }).__pluginActivations;
  });

  it("retries a module-script fetch failure once and activates on the fresh URL", async () => {
    const backend = fakeBackend(jsFiles("js-retry"));
    const blobUrls = scriptBlobUrls([FETCH_FAILED, GOOD]);
    try {
      await loadPlugin({ info: info("js-retry") }, backend);
    } finally {
      blobUrls.restore();
    }

    expect(blobUrls.used).toHaveLength(2);
    expect(getPluginState("js-retry")).toBe("active");
    expect(backend.quarantined).toEqual([]);
    // The retry re-runs the whole bundle: activation happened exactly once.
    expect((globalThis as { __pluginActivations?: number }).__pluginActivations).toBe(11);
    unloadPlugin("js-retry");
  });

  it("does not retry a bundle that throws, and quarantines with its message", async () => {
    const backend = fakeBackend(jsFiles("js-broken"));
    const blobUrls = scriptBlobUrls([SYNTAX_ERROR, GOOD]);
    try {
      await loadPlugin({ info: info("js-broken") }, backend);
    } finally {
      blobUrls.restore();
    }

    expect(blobUrls.used).toHaveLength(1);
    expect(getPluginState("js-broken")).toBe("quarantined");
    expect(backend.quarantined).toEqual(["js-broken"]);
    expect(backend.quarantineErrors[0]).toContain("Unexpected end of script");
  });

  it("reports but never persists a quarantine while the page is going away", async () => {
    const loader = await freshLoader();
    const backend = fakeBackend(jsFiles("js-unload"));
    const blobUrls = scriptBlobUrls([FETCH_FAILED, FETCH_FAILED]);
    window.dispatchEvent(new Event("pagehide"));
    try {
      await loader.loadPlugin({ info: info("js-unload") }, backend);
    } finally {
      blobUrls.restore();
      // Restore for the rest of the file (a real pagehide without a teardown
      // only happens through the page cache, which fires pageshow on return).
      window.dispatchEvent(new Event("pageshow"));
    }

    expect(loader.getPluginState("js-unload")).toBe("failed");
    expect(backend.quarantined).toEqual([]);
  });
});

// Bootstrap flags are module-global; each test gets a fresh loader instance.
async function freshLoader() {
  vi.resetModules();
  return import("./loader");
}

function builtin(id: string, activate?: () => void) {
  return {
    info: info(id, { source: "builtin" as const }),
    manifest: builtinManifest(id),
    builtinActivate: activate ?? (() => {}),
  };
}

describe("bootstrapPlugins", () => {
  it("rejects on backend list failure, still loads builtins, and retries cleanly", async () => {
    const loader = await freshLoader();
    const backend = fakeBackend();
    let listCalls = 0;
    backend.list = async () => {
      listCalls += 1;
      if (listCalls === 1) throw new Error("backend not ready");
      return [];
    };

    await expect(loader.bootstrapPlugins(backend, [builtin("bp-a")])).rejects.toThrow(
      "backend not ready",
    );
    // A failed list is transient: builtins still loaded, bootstrap stays
    // re-callable instead of latching "done" with nothing activated.
    expect(loader.getPluginState("bp-a")).toBe("active");
    expect(loader.pluginsBootstrapped()).toBe(false);

    await loader.bootstrapPlugins(backend, [builtin("bp-a")]);
    expect(listCalls).toBe(2);
    expect(loader.pluginsBootstrapped()).toBe(true);
    expect(loader.getPluginState("bp-a")).toBe("active");
  });

  it("keeps loading the remaining plugins when one load rejects", async () => {
    const loader = await freshLoader();
    const backend = fakeBackend();
    // loadPlugin probes the app version before its own error handling; a
    // rejecting probe must not strand the rest of the bootstrap loop.
    let versionCalls = 0;
    backend.appVersion = async () => {
      versionCalls += 1;
      if (versionCalls === 1) throw new Error("version probe failed");
      return "1.0.0";
    };

    await loader.bootstrapPlugins(backend, [builtin("bp-first"), builtin("bp-second")]);
    expect(loader.getPluginState("bp-first")).toBeUndefined();
    expect(loader.getPluginState("bp-second")).toBe("active");
    expect(loader.pluginsBootstrapped()).toBe(true);
  });

  it("shares one in-flight pass between concurrent callers", async () => {
    const loader = await freshLoader();
    const backend = fakeBackend();
    let listCalls = 0;
    const { promise: listResult, resolve: resolveList } =
      Promise.withResolvers<PluginInfo[]>();
    backend.list = async () => {
      listCalls += 1;
      return listResult;
    };

    // Both callers enter before the list resolves: they must share one pass.
    const first = loader.bootstrapPlugins(backend, [builtin("bp-c")]);
    const second = loader.bootstrapPlugins(backend, [builtin("bp-c")]);
    resolveList([]);
    const [a, b] = await Promise.all([first, second]);
    expect(listCalls).toBe(1);
    expect(a).toBe(b);
    expect(loader.getPluginState("bp-c")).toBe("active");
  });
});
