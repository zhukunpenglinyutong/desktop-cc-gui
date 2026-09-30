// Open /tests/browser/settings-dialog-dismissal.html with the Vite dev server
// running. Mounts the real settings shell (SettingsPage → 智能体) over
// in-memory bots: the rail, the bot list and the bot editor are the production
// components, so a press on the blank area outside the editor exercises the
// real dismissal path (react-aria `isDismissable` on the ModalOverlay) with
// the settings `<dialog>` shell underneath.
//   `?open=1` opens the editor on the only row. Then click or press the grey
//   area outside it (top strip, rail, or the margins beside it): the editor
//   must close, exactly as the ✕ does.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "../../src/index.css";
import "../../src/lib/i18n";
import "../../src/features/settings/sections";
import SettingsPage from "../../src/features/settings/SettingsPage";
import type { BotConfig } from "../../src/lib/ipc";

const bot = (overrides: Partial<BotConfig>): BotConfig => ({
  id: "bot-1",
  slug: "tainai",
  name: "太奶智能体",
  title: null,
  description: null,
  avatar: { type: "generated", foldShape: "flower", hue: 181, saturation: 49, eyes: "happy" },
  soul: "",
  instructions: "",
  capabilities: { skills: [], tools: [], mcpServers: [] },
  runtime: { kind: "direct", model: null, cwd: null, extraArgs: [], permissionMode: "ask" },
  memory: {
    enabled: true,
    writeApproval: false,
    memoryCharLimit: 2200,
    reviewEnabled: true,
    reviewEveryNTurns: 5,
  },
  source: "custom",
  builtinId: null,
  pinned: false,
  hidden: false,
  schemaVersion: 1,
  createdAt: Date.UTC(2026, 8, 1),
  updatedAt: Date.UTC(2026, 8, 29),
  ...overrides,
});

let state: BotConfig[] = [bot({ pinned: true })];

window.__TAURI_INTERNALS__.invoke = async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case "bot_list":
      return state;
    case "bot_update": {
      const id = args?.id as string;
      const patch = (args?.patch ?? {}) as Partial<BotConfig>;
      state = state.map((item) => (item.id === id ? { ...item, ...patch } : item));
      return state.find((item) => item.id === id) ?? null;
    }
    case "list_built_in_agents":
      return { provider: null, divisions: [], agents: [] };
    case "skills_hub_query":
      return { targets: [], skills: [], generatedAt: Date.now() };
    default:
      return null;
  }
};

function Fixture() {
  const params = new URLSearchParams(window.location.search);
  const [ready, setReady] = useState(false);

  useEffect(() => setReady(true), []);

  useEffect(() => {
    if (!ready || params.get("open") !== "1") return;
    const timer = window.setTimeout(
      () => document.querySelector<HTMLElement>('[data-testid="bot-row"]')?.click(),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [ready, params]);

  if (!ready) return null;
  return (
    <MemoryRouter initialEntries={["/settings?page=agents"]}>
      <SettingsPage />
    </MemoryRouter>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
