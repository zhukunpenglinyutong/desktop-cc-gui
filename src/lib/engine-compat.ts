/**
 * Runtime polyfills for JavaScript built-ins newer than the bundle's build
 * target. Vite's default target is `es2020` + chrome87 / edge88 / firefox78 /
 * safari14 (see ESBUILD_MODULES_TARGET in vite/dist/node/constants.js), and it
 * transpiles syntax but never polyfills built-ins. A missing method therefore
 * throws a TypeError deep inside a third-party dependency — for example
 * react-markdown's `Object.hasOwn`, marked's `Array.prototype.at`, DOMPurify's
 * `URL.canParse` — which the global crash handler turns into the full-screen
 * crash page on the first Markdown render.
 *
 * Everything here is a no-op when the native implementation exists, so this
 * list is only about the declared engine floor. Keep it in step with that
 * floor instead of feature-detecting at every call site.
 *
 * Installed from main.tsx before the first React import; the module also
 * installs on import so an earlier entry point cannot miss it.
 */

type Dict = Record<string, unknown>;

/** Define `key` on `target` unless a function is already there. */
function defineMethod(target: object, key: string, value: unknown): void {
  try {
    if (typeof (target as Dict)[key] === "function") return;
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
  } catch {
    try {
      (target as Dict)[key] = value;
    } catch {
      // A frozen global (rare webview hardening): leave it alone.
    }
  }
}

/** `Object.prototype.hasOwnProperty` with the ES2022 `Object.hasOwn` shape. */
function hasOwnPolyfill(object: unknown, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Resolve a possibly negative array index like the native `.at`. */
function normalizeIndex(rawIndex: number, length: number): number | null {
  let index = Number(rawIndex);
  if (Number.isNaN(index)) index = 0;
  index = Math.trunc(index);
  if (index < 0) index += length;
  return index < 0 || index >= length ? null : index;
}

function atPolyfill(this: ArrayLike<unknown>, index: number): unknown {
  const position = normalizeIndex(index, this.length);
  return position === null ? undefined : this[position];
}

function stringAtPolyfill(this: string, index: number): string | undefined {
  const value = String(this);
  const position = normalizeIndex(index, value.length);
  if (position === null) return undefined;
  const code = value.charCodeAt(position);
  // Keep astral characters whole, matching the native implementation.
  if (code >= 0xd800 && code <= 0xdbff && position + 1 < value.length) {
    const next = value.charCodeAt(position + 1);
    if (next >= 0xdc00 && next <= 0xdfff) return value.slice(position, position + 2);
  }
  return value[position];
}

function withResolversPolyfill<T>(): PromiseWithResolvers<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function canParsePolyfill(url: string | URL, base?: string | URL): boolean {
  try {
    new URL(url as string, base as string | undefined);
    return true;
  } catch {
    return false;
  }
}

/** Deep clone for the values this app passes to `structuredClone`: persisted
 *  plain JSON (mission drafts / runs) and mermaid's layout arrays. Dates,
 *  RegExps, Maps, Sets and cycles are preserved; class instances keep their
 *  prototype but only own enumerable properties are copied (native
 *  structuredClone would reject exotic values instead of cloning them). */
function cloneValue(value: unknown, seen: Map<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  if (value instanceof Date) return new Date(value.getTime());
  if (value instanceof RegExp) return new RegExp(value.source, value.flags);
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>();
    seen.set(value, copy);
    for (const [key, item] of value) copy.set(cloneValue(key, seen), cloneValue(item, seen));
    return copy;
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>();
    seen.set(value, copy);
    for (const item of value) copy.add(cloneValue(item, seen));
    return copy;
  }
  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(value, copy);
    for (const item of value) copy.push(cloneValue(item, seen));
    return copy;
  }
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    const buffer = view.buffer.slice(0) as ArrayBuffer;
    return new (view.constructor as new (b: ArrayBuffer) => ArrayBufferView)(buffer);
  }

  const copy = Object.create(Object.getPrototypeOf(value)) as Dict;
  seen.set(value, copy);
  for (const key of Object.keys(value)) copy[key] = cloneValue((value as Dict)[key], seen);
  return copy;
}

function structuredClonePolyfill<T>(value: T): T {
  return cloneValue(value, new Map()) as T;
}

/** Install every fallback that is missing on the current engine. */
export function installEngineCompatPolyfills(): void {
  defineMethod(Object, "hasOwn", hasOwnPolyfill);
  defineMethod(Promise, "withResolvers", withResolversPolyfill);
  defineMethod(Array.prototype, "at", atPolyfill);
  defineMethod(String.prototype, "at", stringAtPolyfill);
  defineMethod(URL, "canParse", canParsePolyfill);
  defineMethod(globalThis as unknown as object, "structuredClone", structuredClonePolyfill);
}

/** `<dialog>` shipped in Safari 15.4 / Firefox 98. Before that the element is
 *  unknown and `showModal`/`close` are absent. The callers already drive
 *  visibility through their own classes, so a plain `open` attribute keeps the
 *  surfaces usable; only the top layer, focus trap, Esc handling and
 *  `::backdrop` degrade on those engines. Native opens also set `open`, so
 *  `isModalDialogOpen` is implementation-agnostic. */
export function showModalDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

export function hideModalDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

export function isModalDialogOpen(dialog: HTMLDialogElement): boolean {
  return dialog.hasAttribute("open");
}

installEngineCompatPolyfills();
