const store = new Map<string, string>();

const mockStorage: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  get length() {
    return store.size;
  },
  key: (index: number) => Array.from(store.keys())[index] ?? null,
};

let needsPolyfill = false;
try {
  if (typeof globalThis.localStorage === "undefined" || typeof globalThis.localStorage.getItem !== "function") {
    needsPolyfill = true;
  } else {
    globalThis.localStorage.getItem("test");
  }
} catch {
  needsPolyfill = true;
}

if (needsPolyfill) {
  Object.defineProperty(globalThis, "localStorage", {
    value: mockStorage,
    writable: true,
    configurable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: mockStorage,
      writable: true,
      configurable: true,
    });
  }
}
