import { describe, expect, it } from "vitest";
import { installCryptoRandomUUIDPolyfill, newId, safeRandomUUID } from "./id";
import { ConversationModeState } from "@/features/plugins/conversation/state";
import { missionId } from "@/features/mission/ids";

describe("id and crypto.randomUUID fallback", () => {
  const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function withMockCrypto<T>(mockCrypto: unknown, fn: () => T): T {
    const originalDesc =
      Object.getOwnPropertyDescriptor(globalThis, "crypto") ||
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis), "crypto");

    try {
      if (mockCrypto === undefined) {
        delete (globalThis as Record<string, unknown>).crypto;
      } else {
        Object.defineProperty(globalThis, "crypto", {
          value: mockCrypto,
          configurable: true,
          writable: true,
        });
      }
      return fn();
    } finally {
      if (originalDesc) {
        Object.defineProperty(globalThis, "crypto", originalDesc);
      }
    }
  }

  it("safeRandomUUID produces valid RFC 4122 v4 UUID in current environment", () => {
    const id = safeRandomUUID();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("safeRandomUUID falls back to crypto.getRandomValues when randomUUID is missing", () => {
    const getRandomValuesSpy = (arr: Uint8Array) => {
      for (let i = 0; i < arr.length; i++) arr[i] = (i * 17) % 256;
      return arr;
    };

    withMockCrypto({ getRandomValues: getRandomValuesSpy }, () => {
      const id = safeRandomUUID();
      expect(id).toMatch(UUID_V4_REGEX);
    });
  });

  it("safeRandomUUID falls back to Math.random when crypto is completely absent", () => {
    withMockCrypto(undefined, () => {
      const id = safeRandomUUID();
      expect(id).toMatch(UUID_V4_REGEX);
    });
  });

  it("installCryptoRandomUUIDPolyfill polyfills globalThis.crypto.randomUUID when missing", () => {
    const mockCrypto = {
      getRandomValues: (arr: Uint8Array) => arr,
    };

    withMockCrypto(mockCrypto, () => {
      expect(typeof (globalThis.crypto as unknown as { randomUUID?: unknown }).randomUUID).toBe("undefined");

      installCryptoRandomUUIDPolyfill();

      expect(typeof (globalThis.crypto as unknown as { randomUUID: () => string }).randomUUID).toBe("function");
      const id = (globalThis.crypto as unknown as { randomUUID: () => string }).randomUUID();
      expect(id).toMatch(UUID_V4_REGEX);
    });
  });

  it("installCryptoRandomUUIDPolyfill creates crypto object if globalThis.crypto is undefined", () => {
    withMockCrypto(undefined, () => {
      installCryptoRandomUUIDPolyfill();

      expect(typeof globalThis.crypto).toBe("object");
      expect(typeof (globalThis.crypto as unknown as { randomUUID: () => string }).randomUUID).toBe("function");
      const id = (globalThis.crypto as unknown as { randomUUID: () => string }).randomUUID();
      expect(id).toMatch(UUID_V4_REGEX);
    });
  });

  it("newId produces valid UUID", () => {
    const id = newId();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it("ConversationModeState.identity works cleanly in draft sessions when randomUUID is deleted", () => {
    withMockCrypto({ getRandomValues: (arr: Uint8Array) => arr }, () => {
      const state = new ConversationModeState();
      const identity = state.identity("new:pi:/workspace", "/workspace", true);
      expect(identity).toBeTruthy();
      const parsed = JSON.parse(identity);
      expect(parsed[0]).toBe("/workspace");
      expect(parsed[1]).toBe("new:pi:/workspace");
      expect(parsed[2]).toMatch(UUID_V4_REGEX);
    });
  });

  it("missionId produces safe formatted id when randomUUID is missing", () => {
    withMockCrypto({ getRandomValues: (arr: Uint8Array) => arr }, () => {
      const id = missionId("flow");
      expect(id).toMatch(/^flow-[0-9a-f]{12}$/i);
    });
  });
});
