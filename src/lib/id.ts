/**
 * crypto.randomUUID needs a secure context; the LAN web bridge serves plain
 * HTTP (e.g. http://100.66.0.1:7316), where crypto.randomUUID does not exist.
 *
 * This module provides:
 * 1. `safeRandomUUID()`: generates an RFC 4122 v4 UUID using crypto.randomUUID if available,
 *    crypto.getRandomValues if available, or Math.random as a fallback.
 * 2. `installCryptoRandomUUIDPolyfill()`: ensures `globalThis.crypto.randomUUID` is defined
 *    so external libraries or unpatched code paths don't crash with
 *    "TypeError: crypto.randomUUID is not a function".
 * 3. `newId()`: backwards-compatible unique ID generator.
 */

export function safeRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    try {
      return globalThis.crypto.randomUUID();
    } catch {
      // Fall through to getRandomValues / Math.random
    }
  }

  if (typeof globalThis.crypto?.getRandomValues === "function") {
    try {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // RFC 4122 version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } catch {
      // Fall through to Math.random
    }
  }

  // Fallback if crypto is unavailable or throws
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function installCryptoRandomUUIDPolyfill(): void {
  try {
    const cryptoObj = globalThis.crypto as Crypto | undefined;
    if (!cryptoObj) {
      Object.defineProperty(globalThis, "crypto", {
        value: {
          randomUUID: safeRandomUUID,
          getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
            if (array && "length" in array) {
              const u8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
              for (let i = 0; i < u8.length; i++) {
                u8[i] = Math.floor(Math.random() * 256);
              }
            }
            return array;
          },
        },
        configurable: true,
        writable: true,
      });
      return;
    }

    if (typeof cryptoObj.randomUUID !== "function") {
      try {
        Object.defineProperty(cryptoObj, "randomUUID", {
          value: safeRandomUUID,
          configurable: true,
          writable: true,
        });
      } catch {
        try {
          (cryptoObj as unknown as Record<string, unknown>).randomUUID = safeRandomUUID;
        } catch {
          if (typeof globalThis.Crypto !== "undefined" && globalThis.Crypto.prototype) {
            try {
              Object.defineProperty(globalThis.Crypto.prototype, "randomUUID", {
                value: safeRandomUUID,
                configurable: true,
                writable: true,
              });
            } catch {
              // ignore
            }
          }
        }
      }
    }
  } catch {
    // Ignore environments where globals cannot be modified
  }
}

// Auto-install polyfill on module evaluation
installCryptoRandomUUIDPolyfill();

export function newId(): string {
  return safeRandomUUID();
}
