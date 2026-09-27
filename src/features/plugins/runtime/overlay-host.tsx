import { useMemo } from "react";
import {
  compareByOrder,
  overlayRegistry,
  pluginIdFromRegistryKey,
  useRegistry,
} from "@ccgui/plugin-sdk";
import { PluginBoundary } from "../boundary/PluginBoundary";

/** Non-modal viewport mounts. Empty space never intercepts host input;
 * interactive plugin elements opt into pointer-events themselves. */
export function PluginOverlayHost() {
  const entries = useRegistry(overlayRegistry);
  const ordered = useMemo(() => [...entries].sort(compareByOrder), [entries]);
  if (!ordered.length) return null;

  return (
    <div data-plugin-overlay-host className="pointer-events-none fixed inset-0">
      {ordered.map(({ id, component: Overlay }) => (
        <PluginBoundary key={id} pluginId={pluginIdFromRegistryKey(id)} fallback={null}>
          <Overlay />
        </PluginBoundary>
      ))}
    </div>
  );
}
