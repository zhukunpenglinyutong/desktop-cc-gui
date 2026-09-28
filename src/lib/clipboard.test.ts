import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copyText,
  copyTextWithExecCommand,
  installClipboardPolyfill,
} from "./clipboard";

describe("clipboard utilities", () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    document.execCommand = originalExecCommand;
  });

  describe("copyText", () => {
    it("uses navigator.clipboard.writeText when available and resolves true", async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });

      const result = await copyText("hello world");
      expect(result).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith("hello world");
    });

    it("falls back to execCommand when navigator.clipboard is undefined (insecure context)", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      const execCommandMock = vi.fn().mockReturnValue(true);
      document.execCommand = execCommandMock;

      const result = await copyText("insecure context content");
      expect(result).toBe(true);
      expect(execCommandMock).toHaveBeenCalledWith("copy");
    });

    it("falls back to execCommand when navigator.clipboard.writeText throws or rejects", async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });

      const execCommandMock = vi.fn().mockReturnValue(true);
      document.execCommand = execCommandMock;

      const result = await copyText("permission denied fallback");
      expect(result).toBe(true);
      expect(writeTextMock).toHaveBeenCalledWith("permission denied fallback");
      expect(execCommandMock).toHaveBeenCalledWith("copy");
    });

    it("returns false if both writeText and execCommand fail without throwing", async () => {
      const writeTextMock = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: writeTextMock },
        configurable: true,
        writable: true,
      });

      const execCommandMock = vi.fn().mockReturnValue(false);
      document.execCommand = execCommandMock;

      const result = await copyText("all failed content");
      expect(result).toBe(false);
    });
  });

  describe("copyTextWithExecCommand", () => {
    it("creates textarea, executes copy, and cleans up textarea", () => {
      const execCommandMock = vi.fn().mockImplementation(() => {
        const textarea = document.querySelector("textarea");
        expect(textarea).not.toBeNull();
        expect(textarea?.value).toBe("textarea test content");
        return true;
      });
      document.execCommand = execCommandMock;

      const result = copyTextWithExecCommand("textarea test content");
      expect(result).toBe(true);
      expect(execCommandMock).toHaveBeenCalledWith("copy");
      // Textarea must be removed from document.body
      expect(document.querySelector("textarea")).toBeNull();
    });

    it("restores activeElement focus after copying", () => {
      const button = document.createElement("button");
      document.body.appendChild(button);
      button.focus();
      expect(document.activeElement).toBe(button);

      document.execCommand = vi.fn().mockReturnValue(true);

      copyTextWithExecCommand("focus test");
      expect(document.activeElement).toBe(button);
      button.remove();
    });

    it("handles execCommand exception gracefully and cleans up", () => {
      document.execCommand = vi.fn().mockImplementation(() => {
        throw new Error("execCommand disabled");
      });

      const result = copyTextWithExecCommand("error test");
      expect(result).toBe(false);
      expect(document.querySelector("textarea")).toBeNull();
    });
  });

  describe("installClipboardPolyfill", () => {
    it("polyfills navigator.clipboard when undefined", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      installClipboardPolyfill();

      expect(navigator.clipboard).toBeDefined();
      expect(typeof navigator.clipboard.writeText).toBe("function");

      const execCommandMock = vi.fn().mockReturnValue(true);
      document.execCommand = execCommandMock;

      await expect(navigator.clipboard.writeText("polyfill test")).resolves.toBeUndefined();
      expect(execCommandMock).toHaveBeenCalledWith("copy");
    });

    it("polyfilled writeText rejects when execCommand fails", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      installClipboardPolyfill();

      document.execCommand = vi.fn().mockReturnValue(false);

      await expect(navigator.clipboard.writeText("fail test")).rejects.toThrow(
        "Clipboard copy failed",
      );
    });

    it("polyfilled readText rejects gracefully in insecure contexts", async () => {
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
        writable: true,
      });

      installClipboardPolyfill();

      await expect(navigator.clipboard.readText()).rejects.toThrow(
        "Clipboard readText is not supported in insecure contexts",
      );
    });
  });
});
