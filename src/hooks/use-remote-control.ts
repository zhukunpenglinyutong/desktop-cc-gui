import { useEffect, useState } from "react";

import { listenRemoteControl } from "@/lib/events";
import { ipc } from "@/lib/ipc";
import { useTauriEvent } from "@/hooks/use-tauri-event";

/**
 * True while some browser is driving this machine through the relay — a live
 * relayed `/ws` socket, not merely a connected relay (the tunnel idles open).
 * The first read matters: the phone may have been connected since before this
 * window opened, and then no event would ever arrive.
 */
export function useRemoteControl(): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    void ipc
      .remoteControlActive()
      .then(setActive)
      .catch(() => {});
  }, []);

  useTauriEvent(() => listenRemoteControl(setActive));

  return active;
}
