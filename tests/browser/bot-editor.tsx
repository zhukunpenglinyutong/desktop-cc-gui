// Open /tests/browser/bot-editor.html with the Vite dev server running.
//
// The real 智能体 pane and the real bot editor, driven by in-memory fixtures:
// the list shows identity + runtime + skill counts, pin/hide and the filters
// work, a row opens the editor, the avatar studio repaints the generated
// avatar, and 拼装预览 lists the blocks the model would receive. Every
// `bot_*` invoke is answered from the objects below — nothing is written to
// disk and no model is called.
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { BotsPane } from "../../src/features/settings/agents-prompts/BotsPane";
import type { BotConfig } from "../../src/lib/ipc";

const bot = (overrides: Partial<BotConfig>): BotConfig => ({
  id: "bot-1",
  slug: "tainai",
  name: "太奶",
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

const bots: BotConfig[] = [
  bot({
    pinned: true,
    title: "耐心的讲解员",
    description: "把复杂的东西讲成家常话，先讲结论再讲道理。",
    soul: "你是「太奶」，家里最会讲道理的人。\n\n- 说话像唠家常，先给结论，再讲为什么。\n- 不确定就直说「这块我没把握」，然后给出判断依据。",
    instructions: "# 职责\n- 解释概念、对比方案、复习知识点。\n\n# 输出格式\n- 不超过 300 字。",
    capabilities: { skills: ["pdf-translate", "sql-explain"], tools: [], mcpServers: [] },
  }),
  bot({
    id: "bot-2",
    slug: "reviewer",
    name: "代码评审员",
    title: "严格的代码守门员",
    description: "只挑真正会影响运行的毛病，按严重程度排序。",
    avatar: { type: "generated", foldShape: "shield", hue: 321, saturation: 74, eyes: "focused" },
    runtime: { kind: "claude-code", model: null, cwd: "/tmp/ws", extraArgs: [], permissionMode: "ask" },
    capabilities: { skills: ["*"], tools: [], mcpServers: [] },
  }),
  bot({
    id: "bot-3",
    slug: "notes",
    name: "会议纪要员",
    title: "从录音到行动项",
    description: "提取决议、负责人与截止时间。",
    avatar: { type: "emoji", value: "📝" },
    runtime: { kind: "codex", model: null, cwd: "/tmp/ws", extraArgs: [], permissionMode: "ask" },
    hidden: true,
  }),
];

const skills = [
  { id: "s1", key: "pdf-translate", name: "pdf-translate", description: "翻译 PDF 或长文档并保留中英对照时使用", directory: "pdf-translate", readmeUrl: null, repoOwner: null, repoName: null, repoBranch: null, installedAt: null, managed: true, sourceKind: "managed" as const, readonly: false, targets: [], targetStates: {} },
  { id: "s2", key: "sql-explain", name: "sql-explain", description: "解释一条 SQL 的执行计划与索引命中情况", directory: "sql-explain", readmeUrl: null, repoOwner: null, repoName: null, repoBranch: null, installedAt: null, managed: true, sourceKind: "builtin" as const, readonly: true, targets: [], targetStates: {} },
];

let state = bots;

window.__TAURI_INTERNALS__.invoke = async (cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case "bot_list":
      return state;
    case "list_built_in_agents":
      return {
        provider: { id: "p", displayName: "agency-agents", sourceUrl: "https://example.com", sourceRevision: "0123456789ab", license: "MIT" },
        divisions: [{ id: "eng", order: 0, icon: "wrench", color: "#3b82f6", label: "工程", count: 1, enabledCount: 1 }],
        agents: [{ id: "a1", divisionId: "eng", name: "系统架构师", description: "从边界条件开始设计", icon: "🏛", enabled: true }],
      };
    case "bot_update": {
      const id = args?.id as string;
      const patch = (args?.patch ?? {}) as Partial<BotConfig>;
      state = state.map((item) =>
        item.id === id ? { ...item, ...patch, title: patch.title || null, description: patch.description || null } : item,
      );
      return state.find((item) => item.id === id) ?? null;
    }
    case "bot_create": {
      const input = (args?.input ?? {}) as Partial<BotConfig> & { name: string };
      const created = bot({ ...input, id: `bot-${state.length + 1}`, slug: "new-bot" });
      state = [...state, created];
      return created;
    }
    case "bot_delete": {
      state = state.filter((item) => item.id !== args?.id);
      return true;
    }
    case "bot_duplicate":
      return null;
    case "skills_hub_query":
      return { targets: [], skills, generatedAt: Date.now() };
    default:
      return null;
  }
};

/** Query-param driver for screenshots and quick manual checks:
 *  `?open=1` opens the first row, `&tab=能力` clicks a section tab,
 *  `&preview=1` opens 拼装预览, `&theme=dark` flips the theme class. */
function Fixture() {
  const [ready, setReady] = useState(false);
  const params = new URLSearchParams(window.location.search);

  useEffect(() => {
    if (params.get("theme") === "dark") {
      document.documentElement.classList.add("dark");
      document.body.style.background = "#0d0d0d";
    }
    setReady(true);
  }, [params]);

  useEffect(() => {
    if (!ready) return;
    const clicks: Array<() => Element | null | undefined> = [];
    if (params.get("open") === "1") {
      clicks.push(() => document.querySelector('[data-testid="bot-row"]'));
    }
    if (params.get("preview") === "1") {
      clicks.push(() =>
        [...document.querySelectorAll("button")].find((el) =>
          el.textContent?.includes("拼装预览"),
        ),
      );
    }
    const tab = params.get("tab");
    if (tab) {
      clicks.push(() =>
        [...document.querySelectorAll("button")].find((el) =>
          el.textContent?.startsWith(tab),
        ),
      );
    }
    const timers = clicks.map((find, index) =>
      window.setTimeout(() => (find() as HTMLElement | null)?.click(), 200 + index * 250),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [ready, params]);

  if (!ready) return null;
  return (
    <div className="min-h-screen bg-background-full p-8 text-text-primary">
      <div className="mx-auto w-full max-w-[820px] rounded-2xl border border-border-button-default bg-background-primary-default p-6">
        <BotsPane />
      </div>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
