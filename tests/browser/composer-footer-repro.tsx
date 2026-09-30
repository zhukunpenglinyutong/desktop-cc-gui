// Repro fixture: the REAL ConversationFooter (same composer the session
// page uses) with an active session seeded into the real chat store, plus
// seeded agent/prompt catalogs. Type `#` / `!` in the field to exercise the
// pickers exactly as the app does. Probe: after typing, document body text
// must contain 我的智能体 / 新建智能体 (agent menu) or 新建提示词.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "../../src/index.css";
import "../../src/lib/i18n";
import { ConversationFooter } from "../../src/features/chat/components/ConversationFooter";
import { useChatStore } from "../../src/features/chat/store";
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
  ],
  builtInAgents: [],
  builtInDivisions: [],
  loaded: true,
  refresh: async () => {},
});
usePromptStore.setState({
  byRoot: {
    [ROOT]: {
      entries: [
        { name: "review", path: "/fixture-ws/.ccgui/prompts/review.md", description: "逐行审查", content: "请审查…", scope: "workspace" },
      ],
      status: "ready",
      fetchedAt: Date.now(),
    },
  },
  ensure: () => {},
  refresh: async () => {},
});

const ACTIVE = { engine: "claude", sessionId: "s-1", workspacePath: ROOT };

function Fixture() {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex min-h-dvh flex-col justify-end bg-background-primary-default">
      <ConversationFooter
        active={ACTIVE}
        workspaces={[]}
        queue={[]}
        onRemoveQueued={() => {}}
        onMoveQueued={() => {}}
        onSendQueuedNow={() => {}}
        imageError={null}
        branchError={null}
        onDismissImageError={() => {}}
        onDismissBranchError={() => {}}
        images={[]}
        previews={{}}
        onRemoveImage={() => {}}
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={() => {}}
        sendShortcut="enter"
        onStop={() => {}}
        streaming={false}
        noEnabledEngines={false}
        composerInputRef={{ current: null }}
        addMenu={null}
        cliMenu={null}
        permissionMenu={null}
        supportsImages={false}
        onPasteImages={() => {}}
        sessionUsage={null}
        contextMax={0}
        branch={undefined}
        branches={undefined}
        onBranchSelect={() => {}}
        startNewChat={() => {}}
      />
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(
  <HashRouter>
    <Fixture />
  </HashRouter>,
);
