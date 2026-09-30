// Open /tests/browser/composer-triggers.html with the Vite dev server
// running. Mounts the REAL chat Composer with seeded agent/prompt catalogs
// (no backend) so the `#` agent picker and `!` prompt picker can be
// exercised end to end: click the field, type `#` or `!` at line start,
// and the picker must appear above the composer. Probe: window.__probe()
// returns { text, agentOpen, promptOpen }.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "../../src/index.css";
import "../../src/lib/i18n";
import { Composer } from "../../src/components/application/ai-chat/ai-chat-composer";
import { useBotStore } from "../../src/features/bots/bot-store";
import type { BotConfig } from "../../src/lib/ipc";
import { usePromptStore } from "../../src/features/prompts/prompt-store";

const ROOT = "/fixture-ws";

const makeBot = (
  overrides: Partial<BotConfig> & Pick<BotConfig, "id" | "name">,
): BotConfig => ({
  slug: overrides.id,
  title: null,
  description: null,
  avatar: { type: "emoji", value: "🔍" },
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
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

useBotStore.setState({
  bots: [
    makeBot({
      id: "a1",
      name: "代码审查员",
      title: "严格的守门员",
      description: "只挑会影响运行的毛病。",
    }),
    makeBot({
      id: "a2",
      name: "文档写手",
      description: "把代码改动能讲清楚。",
      avatar: { type: "emoji", value: "📝" },
    }),
  ],
  builtInAgents: [
    { id: "agency-agents:test-1", divisionId: "testing", name: "Test Engineer", description: "Writes exhaustive test plans.", icon: "🧪", enabled: true },
  ],
  builtInDivisions: [
    { id: "testing", order: 0, icon: "FlaskConical", color: "#F59E0B", label: "测试与质量", count: 9, enabledCount: 1 },
  ],
  loaded: true,
  refresh: async () => {},
});

usePromptStore.setState({
  byRoot: {
    [ROOT]: {
      entries: [
        { name: "review", path: "/fixture-ws/.ccgui/prompts/review.md", description: "逐行审查当前改动", content: "请审查…", scope: "workspace" },
      ],
      status: "ready",
      fetchedAt: Date.now(),
    },
  },
  ensure: () => {},
  refresh: async () => {},
});

function Fixture() {
  const [value, setValue] = useState("");
  return (
    <div className="min-h-dvh bg-background-primary-default px-4 py-8">
      <div className="mx-auto max-w-[750px]">
        <Composer
          value={value}
          onValueChange={setValue}
          workspacePath={ROOT}
          onSubmit={() => {}}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<HashRouter><Fixture /></HashRouter>);
