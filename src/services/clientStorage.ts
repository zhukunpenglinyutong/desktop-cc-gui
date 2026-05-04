import { invoke } from "@tauri-apps/api/core";
import {
  ALL_CLIENT_STORES,
  normalizeClientStoreSnapshot,
  serializeClientStoreSnapshot,
  type ClientStoreName,
} from "./clientStorageSchema";

const cache: Partial<Record<ClientStoreName, Record<string, unknown>>> = {};

let preloaded = false;

const WRITE_DEBOUNCE_MS = 300;
const pendingTimers: Partial<Record<ClientStoreName, ReturnType<typeof setTimeout>>> = {};
const dirtyKeys: Partial<Record<ClientStoreName, Set<string>>> = {};
const pendingFullReplace: Partial<Record<ClientStoreName, boolean>> = {};
const writeChainByStore: Partial<Record<ClientStoreName, Promise<void>>> = {};

export async function preloadClientStores(): Promise<void> {
  if (preloaded) {
    return;
  }
  const results = await Promise.all(
    ALL_CLIENT_STORES.map(async (store) => {
      try {
        const raw = await invoke<unknown>(
          "client_store_read",
          { store },
        );
        const normalized = normalizeClientStoreSnapshot(raw);
        if (normalized.recoveryReason) {
          queueMicrotask(() => {
            writeClientStoreData(store, normalized.data, { immediate: true });
          });
        }
        return [store, normalized.data] as const;
      } catch {
        return [store, {}] as const;
      }
    }),
  );
  for (const [store, data] of results) {
    cache[store] = data;
  }
  preloaded = true;
}

export function isPreloaded(): boolean {
  return preloaded;
}

export function resetClientStorageForTests(): void {
  preloaded = false;
  for (const store of ALL_CLIENT_STORES) {
    delete cache[store];
    if (pendingTimers[store] != null) {
      clearTimeout(pendingTimers[store]);
      delete pendingTimers[store];
    }
    delete dirtyKeys[store];
    delete pendingFullReplace[store];
    delete writeChainByStore[store];
  }
}

export function getClientStoreSync<T = unknown>(
  store: ClientStoreName,
  key: string,
): T | undefined {
  const storeData = cache[store];
  if (!storeData) {
    return undefined;
  }
  return storeData[key] as T | undefined;
}

export function getClientStoreFullSync<T = Record<string, unknown>>(
  store: ClientStoreName,
): T | undefined {
  return cache[store] as T | undefined;
}

export function writeClientStoreValue(
  store: ClientStoreName,
  key: string,
  value: unknown,
  options?: { immediate?: boolean },
): void {
  if (!cache[store]) {
    cache[store] = {};
  }
  cache[store]![key] = value;
  if (!dirtyKeys[store]) {
    dirtyKeys[store] = new Set();
  }
  dirtyKeys[store]!.add(key);
  if (options?.immediate) {
    flushStoreWrite(store);
    return;
  }
  scheduleDiskWrite(store);
}

export function writeClientStoreData(
  store: ClientStoreName,
  data: Record<string, unknown>,
  options?: { immediate?: boolean },
): void {
  cache[store] = data;
  pendingFullReplace[store] = true;
  dirtyKeys[store] = new Set(Object.keys(data));
  if (options?.immediate) {
    flushStoreWrite(store);
    return;
  }
  scheduleDiskWrite(store);
}

function scheduleDiskWrite(store: ClientStoreName): void {
  if (pendingTimers[store] != null) {
    clearTimeout(pendingTimers[store]);
  }
  pendingTimers[store] = setTimeout(() => {
    delete pendingTimers[store];
    flushStoreWrite(store);
  }, WRITE_DEBOUNCE_MS);
}

function flushStoreWrite(store: ClientStoreName): void {
  if (pendingTimers[store] != null) {
    clearTimeout(pendingTimers[store]);
    delete pendingTimers[store];
  }

  const shouldFullReplace = pendingFullReplace[store] === true;
  pendingFullReplace[store] = false;
  const dirtySnapshot = new Set(dirtyKeys[store] ?? []);
  if (dirtyKeys[store]) {
    for (const key of dirtySnapshot) {
      dirtyKeys[store]!.delete(key);
    }
  }
  const cacheSnapshot = cache[store] ?? {};
  const valueSnapshot: Record<string, unknown> = {};
  for (const key of dirtySnapshot) {
    valueSnapshot[key] = cacheSnapshot[key];
  }
  const fullDataSnapshot = shouldFullReplace ? { ...cacheSnapshot } : null;

  const nextWrite = async () => {
    if (shouldFullReplace && fullDataSnapshot) {
      await invoke("client_store_write", {
        store,
        data: serializeClientStoreSnapshot(fullDataSnapshot),
      });
    } else {
      await invoke("client_store_patch", {
        store,
        patch: serializeClientStoreSnapshot(valueSnapshot),
      });
    }
  };

  writeChainByStore[store] = (writeChainByStore[store] ?? Promise.resolve())
    .then(nextWrite)
    .catch((error) => {
      if (!dirtyKeys[store]) {
        dirtyKeys[store] = new Set();
      }
      for (const key of dirtySnapshot) {
        dirtyKeys[store]!.add(key);
      }
      if (shouldFullReplace) {
        pendingFullReplace[store] = true;
      }
      scheduleDiskWrite(store);
      if (typeof console !== "undefined") {
        console.error(`Failed to write client store "${store}":`, error);
      }
    });
}
