import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

/**
 * Copy-to-clipboard with a timed "copied" flag for the button's success
 * state. The reset timer is restarted on a second copy and cleared on
 * unmount, so no setState lands after the component is gone.
 * Uses safe copyText() with document.execCommand fallback to prevent crashes
 * in insecure HTTP contexts (e.g. LAN web bridge).
 */
export const COPY_FEEDBACK_MS = 1500;

export function useCopied(resetMs = COPY_FEEDBACK_MS): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const mounted = useRef(true);

  const copy = useCallback(
    (text: string) => {
      void copyText(text).then((ok) => {
        if (!ok || !mounted.current) return;
        clearTimeout(timer.current);
        setCopied(true);
        timer.current = window.setTimeout(() => {
          if (mounted.current) setCopied(false);
        }, resetMs);
      });
    },
    [resetMs],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);

  return { copied, copy };
}
