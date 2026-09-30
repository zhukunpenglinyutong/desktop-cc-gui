import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hideModalDialog,
  installEngineCompatPolyfills,
  isModalDialogOpen,
  showModalDialog,
} from "./engine-compat";

type Mutable = Record<string, unknown>;

/** Natives replaced or removed by a test, restored in afterEach. */
const originals: Array<{ target: object; key: string; value: unknown }> = [];

function remove(target: object, key: string): void {
  originals.push({ target, key, value: (target as Mutable)[key] });
  delete (target as Mutable)[key];
}

function replace(target: object, key: string, value: unknown): void {
  originals.push({ target, key, value: (target as Mutable)[key] });
  Object.defineProperty(target, key, { value, configurable: true, writable: true });
}

afterEach(() => {
  for (const { target, key, value } of originals.splice(0)) {
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  }
});

describe("engine-compat polyfills", () => {
  it("installs every built-in the build target predates", async () => {
    remove(Object, "hasOwn");
    remove(Promise, "withResolvers");
    remove(Array.prototype, "at");
    remove(String.prototype, "at");
    remove(URL, "canParse");
    remove(globalThis, "structuredClone");

    installEngineCompatPolyfills();

    expect(Object.hasOwn({ a: 1 }, "a")).toBe(true);
    expect(Object.hasOwn({ a: 1 }, "b")).toBe(false);
    expect([1, 2, 3].at(-1)).toBe(3);
    expect("abc".at(-1)).toBe("c");
    expect(URL.canParse("https://example.com/x")).toBe(true);
    expect(URL.canParse(":: not a url")).toBe(false);

    const resolveMe = Promise.withResolvers<number>();
    resolveMe.resolve(7);
    await expect(resolveMe.promise).resolves.toBe(7);
    const rejectMe = Promise.withResolvers<number>();
    rejectMe.reject(new Error("nope"));
    await expect(rejectMe.promise).rejects.toThrow("nope");
  });

  it("keeps a native implementation instead of overriding it", () => {
    const sentinel = vi.fn(() => true);
    replace(Object, "hasOwn", sentinel);

    installEngineCompatPolyfills();

    expect(Object.hasOwn).toBe(sentinel);
  });

  it("matches native edge semantics", () => {
    remove(Object, "hasOwn");
    remove(Array.prototype, "at");
    remove(String.prototype, "at");
    remove(globalThis, "structuredClone");
    installEngineCompatPolyfills();

    // A nullish target throws like the native method.
    expect(() => Object.hasOwn(null as unknown as object, "x")).toThrow(TypeError);

    // Out-of-range and fractional indexes.
    expect([1, 2, 3].at(3)).toBeUndefined();
    expect([1, 2, 3].at(-4)).toBeUndefined();
    expect([1, 2, 3].at(1.8)).toBe(2);
    // Astral characters stay whole when the index lands on the lead surrogate.
    expect("a😀b".at(1)).toBe("😀");

    // structuredClone fallback keeps cycles, Dates, Maps and Sets.
    type Source = { list: unknown[]; when: Date; map: Map<string, unknown>; set: Set<unknown>; self?: unknown };
    const source: Source = {
      list: [1, { deep: true }],
      when: new Date(123),
      map: new Map([["k", { v: 1 }]]),
      set: new Set([1]),
    };
    source.self = source;
    const clone = structuredClone(source) as Source;
    expect(clone).not.toBe(source);
    expect(clone.list).not.toBe(source.list);
    expect(clone.list).toEqual(source.list);
    expect(clone.when).toBeInstanceOf(Date);
    expect(clone.when.getTime()).toBe(123);
    expect(clone.map.get("k")).toEqual({ v: 1 });
    expect(clone.set.has(1)).toBe(true);
    expect(clone.self).toBe(clone);
  });

  it("installs before the app module is imported", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    const compat = main.indexOf("./lib/engine-compat");
    expect(compat).toBeGreaterThanOrEqual(0);
    // Static side-effect import must precede the dynamic ./bootstrap import.
    expect(compat).toBeLessThan(main.indexOf("./bootstrap"));
  });
});

describe("modal dialog helpers", () => {
  function fakeDialog(native: boolean) {
    let open = false;
    return {
      showModal: native ? vi.fn(() => { open = true; }) : undefined,
      close: native ? vi.fn(() => { open = false; }) : undefined,
      setAttribute: vi.fn((name: string) => { if (name === "open") open = true; }),
      removeAttribute: vi.fn((name: string) => { if (name === "open") open = false; }),
      hasAttribute: vi.fn((name: string) => name === "open" && open),
    } as unknown as HTMLDialogElement & {
      showModal?: ReturnType<typeof vi.fn>;
      close?: ReturnType<typeof vi.fn>;
      setAttribute: ReturnType<typeof vi.fn>;
      removeAttribute: ReturnType<typeof vi.fn>;
    };
  }

  it("uses showModal/close when the engine has them", () => {
    const dialog = fakeDialog(true);
    showModalDialog(dialog);
    expect(dialog.showModal).toHaveBeenCalledTimes(1);
    expect(isModalDialogOpen(dialog)).toBe(true);
    hideModalDialog(dialog);
    expect(dialog.close).toHaveBeenCalledTimes(1);
    expect(isModalDialogOpen(dialog)).toBe(false);
  });

  it("falls back to the open attribute on old engines", () => {
    const dialog = fakeDialog(false);
    showModalDialog(dialog);
    expect(dialog.setAttribute).toHaveBeenCalledWith("open", "");
    expect(isModalDialogOpen(dialog)).toBe(true);
    hideModalDialog(dialog);
    expect(dialog.removeAttribute).toHaveBeenCalledWith("open");
    expect(isModalDialogOpen(dialog)).toBe(false);
  });
});
