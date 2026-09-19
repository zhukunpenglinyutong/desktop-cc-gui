// Open /tests/browser/side-panel-overlay.html with the Vite dev server
// running. Mounts the real ChatSidePanel in overlay mode inside a narrow
// remote-width parent and reports whether its right edge stays within the
// row — the bug was the panel spilling past the viewport ("only half
// visible"). A stub panel tab stands in for files/changes so nothing calls
// IPC. No app, no backend, no saved state.
import { createRoot } from "react-dom/client";
import { useRef } from "react";
import { panelTabRegistry } from "@ccgui/plugin-sdk";
import "../../src/index.css";
import "../../src/lib/i18n";
import { ChatSidePanel } from "../../src/features/chat/ChatSidePanel";
import type { ActiveSession } from "../../src/features/chat/store";

panelTabRegistry.register({
  id: "files",
  label: () => "Files",
  component: () => (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-sm text-white">
      <div>desktop-cc-gui</div>
      <div>.github</div>
      <div>src-tauri</div>
    </div>
  ),
});

const active: ActiveSession = {
  engine: "omp",
  sessionId: null,
  workspacePath: "/tmp/ws",
};

function Fixture() {
  const panelRef = useRef<HTMLDivElement>(null);
  // 412px: a phone viewport. The overlay panel must not exceed this row.
  return (
    <div
      id="row"
      className="relative mx-auto mt-8 flex h-[720px] w-[412px] overflow-hidden bg-background-primary-default"
    >
      <div className="min-w-0 flex-1 p-3 text-white">chat</div>
      <ChatSidePanel
        active={active}
        panelRef={panelRef}
        panelWidth={412}
        panelCollapsed={false}
        dragging={null}
        panelTab="files"
        onResizeStart={() => {}}
        overlay
      />
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
