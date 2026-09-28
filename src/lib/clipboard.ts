/**
 * navigator.clipboard is only exposed in Secure Contexts (HTTPS or localhost).
 * When CC GUI is accessed over plain HTTP via the LAN web bridge / web access
 * (e.g. http://100.66.0.1:14200), navigator.clipboard is undefined, causing
 * "TypeError: Cannot read properties of undefined (reading 'writeText')" when
 * copy buttons or menu items are clicked.
 *
 * This module provides:
 * 1. `copyText(text: string)`: safe async copy with modern Clipboard API fallback
 *    to document.execCommand('copy'), returning Promise<boolean> and never throwing.
 * 2. `copyTextWithExecCommand(text: string)`: synchronous document.execCommand fallback
 *    with offscreen textarea and activeElement restoration.
 * 3. `installClipboardPolyfill()`: ensures `navigator.clipboard.writeText` exists on
 *    navigator (or Navigator.prototype) so third-party libraries or unpatched code paths
 *    do not crash in insecure HTTP contexts.
 */

export function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined" || !document.body) {
    return false;
  }

  const previousActiveElement = document.activeElement as HTMLElement | null;
  const textarea = document.createElement("textarea");

  try {
    textarea.value = text;
    textarea.style.fontSize = "12pt";
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.width = "2em";
    textarea.style.height = "2em";
    textarea.style.padding = "0";
    textarea.style.border = "none";
    textarea.style.outline = "none";
    textarea.style.boxShadow = "none";
    textarea.style.background = "transparent";
    textarea.setAttribute("readonly", "");

    document.body.appendChild(textarea);

    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);

    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    if (textarea.parentNode) {
      document.body.removeChild(textarea);
    }
    if (previousActiveElement && typeof previousActiveElement.focus === "function") {
      try {
        previousActiveElement.focus();
      } catch {
        // ignore
      }
    }
  }
}

export async function copyText(text: string): Promise<boolean> {
  if (
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Modern clipboard API failed (e.g. insecure context, permission denied, focus loss)
    }
  }

  return copyTextWithExecCommand(text);
}

export function installClipboardPolyfill(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return;
  }

  try {
    const nav = navigator as unknown as { clipboard?: Clipboard };
    if (!nav.clipboard) {
      const polyfillClipboard = {
        writeText: async (text: string): Promise<void> => {
          const success = copyTextWithExecCommand(text);
          if (!success) {
            throw new Error("Clipboard copy failed");
          }
        },
        readText: async (): Promise<string> => {
          throw new Error("Clipboard readText is not supported in insecure contexts");
        },
      };

      try {
        Object.defineProperty(navigator, "clipboard", {
          value: polyfillClipboard,
          configurable: true,
          writable: true,
        });
        return;
      } catch {
        try {
          nav.clipboard = polyfillClipboard as Clipboard;
          return;
        } catch {
          if (typeof Navigator !== "undefined" && Navigator.prototype) {
            try {
              Object.defineProperty(Navigator.prototype, "clipboard", {
                value: polyfillClipboard,
                configurable: true,
                writable: true,
              });
            } catch {
              // ignore
            }
          }
        }
      }
    } else if (typeof nav.clipboard.writeText !== "function") {
      try {
        Object.defineProperty(nav.clipboard, "writeText", {
          value: async (text: string): Promise<void> => {
            const success = copyTextWithExecCommand(text);
            if (!success) {
              throw new Error("Clipboard copy failed");
            }
          },
          configurable: true,
          writable: true,
        });
      } catch {
        // ignore
      }
    }
  } catch {
    // Ignore environments where globals cannot be modified
  }
}

// Auto-install polyfill on module evaluation
installClipboardPolyfill();
