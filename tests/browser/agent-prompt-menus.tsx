// Open /tests/browser/agent-prompt-menus.html with the Vite dev server
// running. Renders the real `#` bot menu (grouped: 置顶 / 我的智能体 /
// division sections, each row carrying its avatar and runtime badge) and the
// real `!` prompt menu against seeded stores — no backend, no session. Also
// renders a filtered `#` query to check flat mode.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { useBotStore } from "../../src/features/bots/bot-store";
import { usePromptStore } from "../../src/features/prompts/prompt-store";
import type { BotConfig } from "../../src/lib/ipc";
import { BotMenu } from "../../src/components/application/ai-chat/bot-menu";
import { PromptMenu } from "../../src/components/application/ai-chat/prompt-menu";

const ROOT = "/fixture-ws";

const makeBot = (
  overrides: Partial<BotConfig> & Pick<BotConfig, "id" | "name">,
): BotConfig => ({
  slug: overrides.id,
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
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

useBotStore.setState({
  bots: [
    makeBot({
      id: "a1",
      name: "太奶",
      title: "耐心的讲解员",
      description: "先给结论再讲道理。",
      pinned: true,
      capabilities: { skills: ["pdf-translate", "sql-explain"], tools: [], mcpServers: [] },
    }),
    makeBot({
      id: "a2",
      name: "代码审查员",
      title: "严格的守门员",
      avatar: { type: "generated", foldShape: "shield", hue: 321, saturation: 74, eyes: "focused" },
      runtime: { kind: "claude-code", model: null, cwd: "/ws", extraArgs: [], permissionMode: "ask" },
      capabilities: { skills: ["*"], tools: [], mcpServers: [] },
    }),
    makeBot({ id: "a3", name: "隐藏的写手", hidden: true }),
  ],
  builtInAgents: [
    { id: "agency-agents:eng-1", divisionId: "engineering", name: "Backend Architect", description: "Designs reliable backend systems.", icon: "🏗️", enabled: true },
    { id: "agency-agents:test-1", divisionId: "testing", name: "Test Engineer", description: "Writes exhaustive test plans.", icon: "🧪", enabled: true },
  ],
  builtInDivisions: [
    { id: "engineering", order: 0, icon: "Code", color: "#3B82F6", label: "工程研发", count: 54, enabledCount: 1 },
    { id: "testing", order: 1, icon: "FlaskConical", color: "#F59E0B", label: "测试与质量", count: 9, enabledCount: 1 },
  ],
  loaded: true,
  // Keep the seeded catalog: the real refresh talks IPC, absent here.
  refresh: async () => {},
});

usePromptStore.setState({
  byRoot: {
    [ROOT]: {
      entries: [
        { name: "review", path: "/ws/.ccgui/prompts/review.md", description: "逐行审查当前改动", argumentHint: "<文件路径>", content: "请审查 $ARGUMENTS …", scope: "workspace" },
        { name: "standup", path: "/home/.ccgui-next/prompts/standup.md", description: "生成站会日报", content: "总结今天的进展…", scope: "global" },
      ],
      status: "ready",
      fetchedAt: Date.now(),
    },
  },
  ensure: () => {},
  refresh: async () => {},
});

function Fixture() {
  return (
    <div className="min-h-dvh bg-background-primary-default px-4 py-8">
      <div className="mx-auto flex max-w-[750px] flex-col gap-6">
        <section>
          <p className="mb-2 text-caption-1-medium text-text-tertiary"># 菜单（空查询：置顶 / 我的智能体 / 内置分组）</p>
          <div className="relative h-[480px] rounded-xl border border-separator-border bg-background-secondary-default p-2">
            <BotMenu query="" left={8} onSelect={() => {}} onClose={() => {}} />
          </div>
        </section>
        <section>
          <p className="mb-2 text-caption-1-medium text-text-tertiary"># 菜单（查询 “test”，平铺过滤）</p>
          <div className="relative h-[280px] rounded-xl border border-separator-border bg-background-secondary-default p-2">
            <BotMenu query="test" left={8} onSelect={() => {}} onClose={() => {}} />
          </div>
        </section>
        <section>
          <p className="mb-2 text-caption-1-medium text-text-tertiary">! 菜单</p>
          <div className="relative h-[200px] rounded-xl border border-separator-border bg-background-secondary-default p-2">
            <PromptMenu root={ROOT} query="" left={8} onSelect={() => {}} onClose={() => {}} />
          </div>
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
