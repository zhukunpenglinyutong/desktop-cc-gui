/**
 * git-tasks 插件的真宿主冒烟测试：把兄弟仓库 ccgui-plugin/git-tasks/main.js
 * 挂到真实的 createPluginContext 上跑一遍（多选 → 弹窗选 CLI/模型 → 建/复用
 * worktree → 聊天会话轮次 → 任务条收敛）。插件是仓库外的文件，CI / 其它机器
 * 上没有这个兄弟目录时整组跳过（跳过原因打印在 stderr，不假装跑过）。
 *
 * 覆盖的是插件 × host 能力面的契约：权限声明、worktrees.create 的入参/
 * errorKind、sessions.startRun 的 per-run 覆盖、plugin-run:// 回执、会话
 * 打开/停止；插件自身的 UI 细节不在这里断言。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { centerTabRegistry } from "@ccgui/plugin-sdk";
import { createPluginContext, type PluginContextBackend } from "./context";
import { useWorktreeStore } from "@/features/worktree/store";
import type { EngineEventPayload } from "@/lib/events";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLUGIN_MAIN = path.resolve(process.cwd(), "../ccgui-plugin/git-tasks/main.js");
const PLUGIN_MANIFEST = path.resolve(process.cwd(), "../ccgui-plugin/git-tasks/manifest.json");
const PLUGIN_AVAILABLE = existsSync(PLUGIN_MAIN) && existsSync(PLUGIN_MANIFEST);
if (!PLUGIN_AVAILABLE) {
  console.warn(`[git-tasks-smoke] sibling plugin repo not found (${PLUGIN_MAIN}) — group skipped`);
}

type WorktreeCreateArgsLike = { branch?: string; prNumber?: number; repoPath?: string; parentWorkspaceId?: string; worktreePath?: string };
const gitWorktreeCreate = vi.fn<(id: string, args: WorktreeCreateArgsLike) => Promise<void>>(async () => undefined);
const gitWorktreeRemove = vi.fn(async () => ({ orphanDirectory: false, branchDeleted: true }));
vi.mock("@/lib/ipc", () => ({
  ipc: {
    gitWorktreeCreate: (id: string, args: WorktreeCreateArgsLike) => gitWorktreeCreate(id, args),
    gitWorktreeCreateCancel: vi.fn(async () => undefined),
    gitWorktreeRemove: (...args: unknown[]) => gitWorktreeRemove(...(args as [])),
  },
  worktreeMetaOf: (workspace: { meta?: Record<string, unknown> } | null | undefined) => {
    const meta = workspace?.meta?.worktree as { branch?: unknown; prNumber?: unknown } | undefined;
    if (!meta || typeof meta.branch !== "string" || !meta.branch) return null;
    return { branch: meta.branch, ...(typeof meta.prNumber === "number" ? { prNumber: meta.prNumber } : {}) };
  },
}));

const listenMock = vi.fn(async (_topic: string, _cb: unknown) => () => {});
vi.mock("@/lib/transport", () => ({
  listen: (topic: string, cb: unknown) => listenMock(topic, cb),
  isWeb: false,
}));

// 引擎事件流：session-run-bridge 在这里订阅，测试用它驱动 done/error。
let emitEngineEvents: ((events: EngineEventPayload[]) => void) | null = null;
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async (cb: (events: EngineEventPayload[]) => void) => {
    emitEngineEvents = cb;
    return () => {};
  }),
}));

const sendMock = vi.fn();
const interruptMock = vi.fn(async () => undefined);
const chatState = {
  workspaces: [] as Record<string, unknown>[],
  sessions: [] as Record<string, unknown>[],
  refreshWorkspaces: vi.fn(async () => {}),
  refreshSessions: vi.fn(async () => {}),
  selectSession: vi.fn(),
  startNewChat: vi.fn(),
  removeWorkspace: vi.fn(async () => {}),
  setState: vi.fn(),
};
vi.mock("@/features/chat/store", () => ({
  useChatStore: {
    getState: () => ({
      ...chatState,
      send: sendMock,
      interrupt: interruptMock,
      selectSession: (...args: unknown[]) => chatState.selectSession(...args),
    }),
    setState: (patch: Record<string, unknown>) => Object.assign(chatState, patch),
  },
}));
vi.mock("@/features/chat/center-surfaces", () => ({ dismissCenterSurfaces: vi.fn() }));
vi.mock("./composer-draft", () => ({ setActiveComposerDraft: vi.fn() }));
vi.mock("@/features/terminal/store", () => ({
  useTerminalStore: { getState: () => ({ removeWorkspace: vi.fn() }) },
}));
vi.mock("@/lib/i18n", () => ({ default: { t: (key: string) => key } }));

const PRS = [
  { number: 7, title: "fix: bound worktree", state: "OPEN", url: "https://github.com/acme/app/pull/7", labels: [], updatedAt: "2026-10-06T00:00:00.000Z", author: { login: "alice", avatarUrl: "" }, isDraft: false, headRefName: "fix/bound", baseRefName: "main", headRefOid: "abc", headRepositoryOwner: { login: "alice" }, reviewRequests: [] },
  { number: 8, title: "feat: new panel", state: "OPEN", url: "https://github.com/acme/app/pull/8", labels: [], updatedAt: "2026-10-06T00:00:00.000Z", author: { login: "bob", avatarUrl: "" }, isDraft: false, headRefName: "feat/panel", baseRefName: "main", headRefOid: "def", headRepositoryOwner: { login: "bob" }, reviewRequests: [] },
];

const ISSUES = [
  { number: 31, title: "bug: crash", state: "open", html_url: "https://github.com/acme/app/issues/31", updated_at: "2026-10-06T00:00:00.000Z", comments: 0, labels: ["bug"], author: { login: "carol", avatar_url: "" }, assignees: [], isPr: false },
];

const CATALOG = [
  {
    engine: "claude",
    label: "Claude Code",
    available: true,
    readOnly: false,
    providers: [
      { id: "__local_settings_json__", label: "官方" },
      { id: "deepseek", label: "DeepSeek" },
    ],
    models: [
      { id: "deepseek/deepseek-v4-pro", label: "deepseek-v4-pro", provider: "deepseek" },
      { id: "deepseek/deepseek-flash", label: "deepseek-flash", provider: "deepseek" },
    ],
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
  },
  { engine: "kimi", label: "Kimi", available: false, readOnly: false, providers: [], models: [], efforts: [] },
];

let sendSeq = 0;
const startedRuns: string[] = [];
const EXEC_LOG: { bin: string; args: string[] }[] = [];

/** 详情弹窗的 Markdown 样例：覆盖 GitHub 常用的块级与行内语法。 */
const MD_BODY = [
  "# 问题：在启用局域网 webui 后崩溃",
  "",
  "## 日志：",
  "",
  "> CC GUI crash report",
  "> time: 2026-10-03T07:35:19.172Z",
  "",
  "**加粗** 与 `edge` 最新版，~~删除线~~，@alice 提到 #123",
  "",
  "| 列 A | 列 B |",
  "| --- | ---: |",
  "| 1 | 2 |",
  "",
  "- [x] 已复现",
  "- [ ] 待确认",
  "",
  "```diff",
  "-    old();",
  "+    new();",
  "```",
  "",
  "[文档](./docs/a.md)",
  "",
  "<script>alert(1)</script>",
].join("\n");

/** GitHub 报告的合并状态：#7 与 base 冲突（当前无法合并），#8 干净。 */
const MERGE_CONFLICT = { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" };
const MERGE_CLEAN = { mergeable: "MERGEABLE", mergeStateStatus: "CLEAN" };
const mergeOf = (number: number) => (number === 7 ? MERGE_CONFLICT : MERGE_CLEAN);

const MD_COMMENTS = [
  {
    id: "c1",
    url: "https://github.com/acme/app/issues/7#issuecomment-1",
    author: { login: "bob", avatarUrl: "" },
    createdAt: "2026-10-06T01:00:00.000Z",
    body: "评论里的 **重点** 与 `code`",
  },
];

/** 审查报告契约（.ccgui-review/report.json）的样例：一条阻断 + 一条建议。 */
const REPORT_JSON = {
  verdict: "changes_requested",
  summary: "压缩超时分支缺少状态回滚，会让会话卡在 Compacting。",
  findings: [
    { severity: "blocker", title: "超时分支没有回滚会话状态", file: "src/compact.rs", line: 118, detail: "超时后直接 return，状态仍停在 Compacting。", suggestion: "统一走 finish_compaction(Idle)。" },
    { severity: "nit", title: "日志前缀重复", file: "src/omp.rs", line: 47 },
  ],
  passed: ["锁顺序没有变化"],
  tests: ["cargo test compact — 12 passed"],
};

function backend(opts: { engines?: unknown[]; mode?: "prs" | "issues"; report?: boolean | "md" } = {}): PluginContextBackend {
  const mode = opts.mode ?? "prs";
  const withReport = !!opts.report;
  return {
    get: async () =>
      ({ mode, preset: mode, query: mode === "prs" ? "is:pr is:open" : "is:issue is:open", repos: ["acme/app"], manualRepos: [] }) as never,
    set: async () => {},
    delete: async () => {},
    agentCatalog: async () => (opts.engines ?? CATALOG) as never,
    // 插件上下文后端里这条用例用不到的宿主能力：给最小桩，保持类型完整。
    workspaceMetadata: async () => ({ id: "ws", path: "/repo" }) as never,
    pickDirectory: async () => null,
    pickFile: async () => null,
    documentStorageGetLocation: async () => ({ kind: "data" as const, displayPath: "/data", writable: true }),
    documentStorageSelectLocation: async (_id, kind) => ({ kind, displayPath: "/data", writable: true }),
    documentStorageReadText: async () => null,
    documentStorageWriteTextAtomic: async () => ({ status: "written" as const, version: "v1" }),
    documentStorageRemove: async () => ({ status: "removed" as const }),
    documentStorageList: async () => [],
    bridgeInvoke: async (command, args) => {
      if (command !== "plugin_exec_run") return null;
      const argv = (args.args as string[]) || [];
      EXEC_LOG.push({ bin: String(args.bin), args: argv });
      if (args.bin === "cat") {
        const target = argv[0] || "";
        if (!withReport) return { code: 1, stdout: "", stderr: "no such file" };
        if (target.endsWith(".ccgui-review/report.json")) {
          if (opts.report === "md") return { code: 1, stdout: "", stderr: "no such file" };
          return { code: 0, stdout: JSON.stringify(REPORT_JSON), stderr: "" };
        }
        if (target.endsWith(".ccgui-review/report.md")) return { code: 0, stdout: "# 评审\n\n压缩超时分支缺少状态回滚。", stderr: "" };
        return { code: 1, stdout: "", stderr: "no such file" };
      }
      if (args.bin === "git") {
        const at = argv.indexOf("-C");
        const sub = at >= 0 ? argv[at + 2] : argv[0];
        if (sub === "status") return { code: 0, stdout: " M src/compact.rs\n?? src/new-note.txt", stderr: "" };
        if (sub === "diff") return { code: 0, stdout: "12\t3\tsrc/compact.rs\n6\t6\tsrc/new-note.txt", stderr: "" };
        if (sub === "commit" || sub === "push") return { code: 0, stdout: "", stderr: "" };
        if (sub === "rev-parse") return { code: 0, stdout: "abc1234\n", stderr: "" };
        return { code: 0, stdout: "https://github.com/acme/app.git", stderr: "" };
      }
      if (args.bin === "gh") {
        if (argv[0] === "repo" && argv[1] === "view") return { code: 0, stdout: JSON.stringify({ viewerPermission: "WRITE" }), stderr: "" };
        // 精确匹配 --json 后的字段名：详情请求的字段列表里也有 headRefOid，
        // 用 includes 会把它截走。
        const jsonFields = argv[argv.indexOf("--json") + 1] || "";
        if (argv[0] === "pr" && argv[1] === "view" && jsonFields === "mergeable,mergeStateStatus") {
          return { code: 0, stdout: JSON.stringify(mergeOf(Number(argv[2]))), stderr: "" };
        }
        if (argv[0] === "pr" && argv[1] === "view" && jsonFields === "headRefOid,mergeable,mergeStateStatus") {
          return { code: 0, stdout: JSON.stringify({ headRefOid: "zzz9999", ...mergeOf(Number(argv[2])) }), stderr: "" };
        }
        if (argv[0] === "pr" && argv[1] === "view" && jsonFields === "headRefOid") {
          return { code: 0, stdout: JSON.stringify({ headRefOid: "zzz9999" }), stderr: "" };
        }
        if (argv[0] === "pr" && argv[1] === "view" && jsonFields === "maintainerCanModify") {
          return { code: 0, stdout: JSON.stringify({ maintainerCanModify: true }), stderr: "" };
        }
        if (argv[0] === "pr" && argv[1] === "list") return { code: 0, stdout: JSON.stringify(PRS), stderr: "" };
        if (argv[0] === "pr" && argv[1] === "view") {
          return {
            code: 0,
            stderr: "",
            stdout: JSON.stringify({
              number: 7,
              title: "x",
              body: MD_BODY,
              labels: [],
              comments: MD_COMMENTS,
              ...mergeOf(Number(argv[2])),
            }),
          };
        }
        if (argv[0] === "api") {
          const jq = argv[argv.length - 1] || "";
          if (jq.startsWith("{total:")) return { code: 0, stdout: JSON.stringify({ total: ISSUES.length, items: ISSUES }), stderr: "" };
          return { code: 0, stdout: "2", stderr: "" };
        }
        if (argv[0] === "repo") return { code: 0, stdout: JSON.stringify([{ nameWithOwner: "acme/app", description: "", isPrivate: true, pushedAt: "", isFork: false, isArchived: false }]), stderr: "" };
        return { code: 0, stdout: "[]", stderr: "" };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

/** 轮询条件（跨动态 import 的异步链，固定帧数在并行满载时会抖）。 */
async function waitFor(check: () => boolean, label = "condition") {
  for (let i = 0; i < 60; i += 1) {
    if (check()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  throw new Error(`waitFor timeout: ${label}`);
}

describe.skipIf(!PLUGIN_AVAILABLE)("git-tasks smoke", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    chatState.sessions = [
      { engine: "claude", sessionId: "sess-1", workspacePath: "/tmp/app-worktrees/pr-7-fix-bound" },
      { engine: "claude", sessionId: "sess-2", workspacePath: "/tmp/app-worktrees/pr-8-feat-new-panel" },
    ];
    chatState.workspaces = [
      { id: "ws-app", path: "/tmp/app", name: "app", lastOpenedAt: 5, sortOrder: null, groupId: null },
      { id: "ws-wt", path: "/tmp/app-worktrees/pr-7-fix-bound", name: "pr-7-fix-bound", lastOpenedAt: null, sortOrder: null, groupId: null, kind: "worktree", parentId: "ws-app", meta: { worktree: { branch: "pr-7-fix-bound", prNumber: 7 } } },
    ];
    useWorktreeStore.setState({ pending: [], prefs: { location: null, openSessionAfter: true } });
    gitWorktreeCreate.mockClear();
    startedRuns.length = 0;
    sendSeq = 0;
    sendMock.mockReset();
    // 宿主聊天管线的发送：立刻回报轮次身份（真实实现里是 spawn 成功后回调）。
    sendMock.mockImplementation(async (_prompt, _images, options) => {
      sendSeq += 1;
      const runId = `run-${sendSeq}`;
      startedRuns.push(runId);
      // 与真引擎一致：spawn 返回里没有 session id，稍后才 announce。
      options.onStarted({ runId, sessionId: null });
    });
    interruptMock.mockClear();
    chatState.refreshSessions.mockClear();
    chatState.selectSession.mockClear();
    EXEC_LOG.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function mount(opts: { engines?: unknown[]; mode?: "prs" | "issues"; report?: boolean | "md" } = {}) {
    const fs = await import("node:fs/promises");
    const manifest = JSON.parse(await fs.readFile(PLUGIN_MANIFEST, "utf8"));
    const source = await fs.readFile(PLUGIN_MAIN, "utf8");
    const mod = await import("data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64"));
    const { ctx, disposers } = createPluginContext(manifest, backend(opts), { appVersion: "1.1.1" });
    mod.default(ctx);
    const board = centerTabRegistry.get("plugin:git-tasks:board");
    await act(async () => { root.render(createElement(board!.component as ComponentType)); });
    await flush(10);
    return disposers;
  }

  /** 按可见文案找按钮（插件按钮都带图标，textContent 直接匹配原文不稳）。 */
  const buttonByText = (text: string, root: HTMLElement = container) =>
    Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      (b.textContent || "").replace(/\s+/g, "").includes(text.replace(/\s+/g, "")),
    );

  /** 引擎 announce 原生 session id（spawn 返回里没有）。 */
  function announceSession(runId: string) {
    emitEngineEvents?.([
      { runId, sessionId: `sess-${runId.slice(4)}`, engine: "claude", seq: 1, kind: "session", data: {}, ts: Date.now() } as EngineEventPayload,
    ]);
  }

  function finishRun(runId: string, kind: "done" | "error" = "done", error: string | null = null) {
    emitEngineEvents?.([
      { runId, sessionId: `sess-${runId.slice(4)}`, engine: "claude", seq: 9, kind, data: error ? { message: error } : {}, ts: Date.now() } as EngineEventPayload,
    ]);
  }

  it("完整链路：多选 → 选模型 → 建/复用 worktree → 聊天会话轮次 → 任务条收敛", async () => {
    const disposers = await mount();
    expect(container.querySelectorAll(".gt-wt-chip").length).toBe(1);

    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[0].click(); checks[1].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(3);

    // 弹窗：CLI + 模型/渠道/强度三行
    const modal = container.querySelector(".gt-modal.is-ai")!;
    expect(modal.textContent).toContain("Claude Code");
    const pickLabels = Array.from(modal.querySelectorAll(".gt-ai-pick-label")).map((el) => el.textContent);
    expect(pickLabels).toEqual(["渠道", "模型", "推理强度"]);
    // 选模型（deepseek-flash）+ xhigh
    await act(async () => { modal.querySelector<HTMLButtonElement>(".gt-ai-select")!.click(); });
    await flush(1);
    const modelItem = Array.from(container.querySelectorAll<HTMLButtonElement>(".gt-pop .gt-menu-item")).find((b) => b.textContent!.includes("deepseek-flash"));
    expect(modelItem).toBeTruthy();
    await act(async () => { modelItem!.click(); });
    const effortChip = Array.from(modal.querySelectorAll<HTMLButtonElement>(".gt-ai-chip")).find((b) => b.textContent === "xhigh");
    await act(async () => { effortChip!.click(); });
    await flush(1);
    expect(modal.textContent).toContain("deepseek-flash");

    // 弹窗里预览的分支名（含三位随机后缀）就是实际创建的名字
    const previewText = Array.from(modal.querySelectorAll<HTMLElement>(".gt-ai-pr-sub"))
      .map((el) => el.textContent || "")
      .join(" ");
    const previewBranch = /pr-8-feat-new-panel-\d{3}/.exec(previewText)?.[0];
    expect(previewBranch).toBeTruthy();

    // 开始：新 PR 走宿主管线，已有绑定的直接复用
    await act(async () => { modal.querySelector<HTMLButtonElement>(".gt-modal-foot .gt-btn.is-primary")!.click(); });
    await flush(2);
    expect(gitWorktreeCreate).toHaveBeenCalledTimes(1);
    const firstCreate = gitWorktreeCreate.mock.calls[0][1];
    expect(firstCreate).toMatchObject({ prNumber: 8 });
    expect(firstCreate.branch).toBe(previewBranch);
    await waitFor(() => sendMock.mock.calls.length === 1, "reuse run started");
    // 复用那条：直接以 worktree 为工作区起轮次，带 per-run 覆盖
    expect(sendMock.mock.calls[0][3]).toEqual({
      engine: "claude",
      sessionId: null,
      workspacePath: "/tmp/app-worktrees/pr-7-fix-bound",
      model: "deepseek/deepseek-flash",
      effort: "xhigh",
    });
    expect(String(sendMock.mock.calls[0][0])).toContain("PR #7");

    // 创建 done → 第二条轮次
    const [creationId] = gitWorktreeCreate.mock.calls[0];
    await act(async () => { useWorktreeStore.getState().applyProgress({ creationId, stage: "done" }); });
    await waitFor(() => sendMock.mock.calls.length === 2, "created run started");
    // 目录随（带随机后缀的）分支名走，与创建的 branch 一致
    expect(sendMock.mock.calls[1][3]).toMatchObject({
      workspacePath: `/tmp/app-worktrees/${firstCreate.branch}`,
    });
    expect(String(sendMock.mock.calls[1][0])).toContain("PR #8");

    // 汇总在子页签状态行，逐条状态在行徽标（不再有独立任务条）
    expect(container.querySelector(".gt-ai-strip")).toBeNull();
    expect(container.querySelector(".gt-runstat")!.textContent).toContain("审查中 2");
    expect(container.querySelectorAll(".gt-wt-chip.is-busy").length).toBe(2);

    // 引擎 announce session id → 任务表学到 id（否则完成后「打开会话」一直禁用）
    await act(async () => { startedRuns.forEach((runId) => announceSession(runId)); });
    await flush(2);
    expect(startedRuns).toHaveLength(2);

    // 两个轮次收尾 → 已审查（任务条 + 徽标 + 可打开会话）
    await act(async () => { startedRuns.forEach((runId) => finishRun(runId)); });
    await waitFor(() => container.querySelector(".gt-runstat")!.textContent!.includes("已完成 2"), "both runs settled");
    // #7 与 base 冲突（徽标必须是冲突，不能被「已审查」盖住），#8 已审查
    expect(container.querySelectorAll(".gt-wt-chip.is-failed").length).toBe(1);
    expect(container.querySelectorAll(".gt-wt-chip.is-done").length).toBe(1);
    expect(container.textContent).toContain("有冲突");

    // 行徽标点开 → 「打开审查会话」走宿主会话选择
    const chipFor = (branch: string) =>
      Array.from(container.querySelectorAll<HTMLElement>(".gt-wt-chip")).find((el) => (el.textContent || "").includes(branch))!;
    await act(async () => { chipFor("pr-7-fix-bound").click(); });
    await flush(1);
    const openItem = Array.from(container.querySelectorAll<HTMLButtonElement>(".gt-menu-item"))
      .find((b) => (b.textContent || "").includes("打开审查会话"))!;
    expect(openItem.disabled).toBe(false);
    await act(async () => { openItem.click(); });
    await flush(1);
    expect(chatState.selectSession).toHaveBeenCalledWith("claude", "sess-1", "/tmp/app-worktrees/pr-7-fix-bound");

    act(() => disposers.forEach((dispose) => dispose()));
  });

  it("运行失败：错误写进任务条，可重试且不再走创建", async () => {
    const disposers = await mount();
    // 绑定快照是异步到的（工作区 → 仓库解析 → worktree 子行）；没等到就选，
    // #7 会被当成「新建」而不是「复用」。
    await waitFor(() => container.querySelectorAll(".gt-wt-chip").length === 1, "binding loaded");
    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[0].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(6);
    const startButton = container.querySelector<HTMLButtonElement>(".gt-modal.is-ai .gt-modal-foot .gt-btn.is-primary")!;
    expect(startButton.disabled).toBe(false);
    await act(async () => { startButton.click(); });
    await waitFor(() => sendMock.mock.calls.length === 1, "restartable run started");

    const runId = startedRuns[0];
    finishRun(runId, "error", "model rejected");
    await flush(3);
    // 行徽标转「审查失败」；失败原因与重试在弹层里
    await waitFor(() => container.textContent!.includes("审查失败"), "failed chip");
    await act(async () => { container.querySelector<HTMLElement>(".gt-wt-chip.is-failed")!.click(); });
    await flush(1);
    const popText = container.querySelector(".gt-pop")!.textContent!;
    expect(popText).toContain("model rejected");
    expect(popText).toContain("重试");
    const retry = Array.from(container.querySelectorAll<HTMLButtonElement>(".gt-menu-item"))
      .find((b) => (b.textContent || "").includes("重试"))!;
    await act(async () => { retry.click(); });
    await waitFor(() => sendMock.mock.calls.length === 2, "retry run started");
    expect(gitWorktreeCreate).not.toHaveBeenCalled();
    act(() => disposers.forEach((dispose) => dispose()));
  });

  it("引擎目录为空时不允许开始；issues 模式不受新列影响", async () => {
    const disposers = await mount({ engines: [] });
    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[1].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(3);
    expect(container.querySelector(".gt-modal.is-ai")!.textContent).toContain("没有可用的 CLI");
    expect(container.querySelector<HTMLButtonElement>(".gt-modal.is-ai .gt-modal-foot .gt-btn.is-primary")!.disabled).toBe(true);
    act(() => disposers.forEach((dispose) => dispose()));

    const disposers2 = await mount({ mode: "issues" });
    const rows = container.querySelectorAll(".gt-row");
    expect(rows.length).toBe(1);
    expect(container.querySelectorAll(".gt-row-check").length).toBe(0);
    expect(container.textContent).not.toContain("WORKTREE");
    expect(rows[0].querySelectorAll(".gt-cell").length).toBe(6);
    act(() => disposers2.forEach((dispose) => dispose()));
  });

  it("审查结果：报告回读 → 反馈作者 → AI 修复 → 提交到 PR 分支（不合并）", async () => {
    const disposers = await mount({ report: true });
    await waitFor(() => container.querySelectorAll(".gt-wt-chip").length === 1, "binding loaded");

    // 只选 #7：复用已绑定的 worktree，直接跑审查轮次
    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[0].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(4);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-modal.is-ai .gt-modal-foot .gt-btn.is-primary")!.click(); });
    await waitFor(() => sendMock.mock.calls.length === 1, "review run started");

    const runId = startedRuns[0];
    announceSession(runId);
    finishRun(runId);

    // 任务条上的「查看结果」把页内视图切到审查结果，回读报告
    await waitFor(() => !!buttonByText("查看结果"), "view result button");
    await act(async () => { buttonByText("查看结果")!.click(); });
    await waitFor(() => container.textContent!.includes("超时分支没有回滚会话状态"), "structured findings rendered");
    expect(container.textContent).toContain("请求修改");
    expect(container.textContent).toContain("压缩超时分支缺少状态回滚");
    const reportReads = EXEC_LOG.filter((entry) => entry.bin === "cat");
    expect(reportReads.some((entry) => entry.args[0]!.endsWith(".ccgui-review/report.json"))).toBe(true);

    // 反馈作者：Request changes + 正文带上勾选的问题
    await act(async () => { buttonByText("反馈作者并请求修改")!.click(); });
    await flush(2);
    const feedbackModal = container.querySelector<HTMLElement>(".gt-modal.is-review")!;
    expect(feedbackModal.textContent).toContain("反馈给 PR 作者");
    expect(feedbackModal.querySelector<HTMLTextAreaElement>(".gt-rv-textarea")!.value).toContain("超时分支没有回滚会话状态");
    await act(async () => { buttonByText("发送请求修改", feedbackModal)!.click(); });
    await waitFor(
      () => EXEC_LOG.some((entry) => entry.bin === "gh" && entry.args[0] === "pr" && entry.args[1] === "review" && entry.args.includes("--request-changes")),
      "gh pr review issued",
    );
    await waitFor(() => container.textContent!.includes("已反馈作者"), "feedback recorded");

    // 我来修复 → 修复轮次（宿主聊天管线）→ 本地 diff 统计
    await act(async () => { buttonByText("我来修复")!.click(); });
    await flush(3);
    const fixModal = container.querySelector<HTMLElement>(".gt-modal.is-review")!;
    await act(async () => { buttonByText("开始修复", fixModal)!.click(); });
    await waitFor(() => sendMock.mock.calls.length === 2, "fix run started");
    finishRun(startedRuns[1]);
    await waitFor(() => container.textContent!.includes("修复完成"), "fix finalized");
    expect(container.textContent).toContain("+18");

    // 提交到 PR 分支：非 force、不合并
    await act(async () => { buttonByText("提交到 PR 分支")!.click(); });
    await waitFor(() => !!container.querySelector(".gt-modal.is-review"), "push dialog");
    const pushModal = container.querySelector<HTMLElement>(".gt-modal.is-review")!;
    expect(pushModal.textContent).toContain("不会合并 PR");
    // PR #7 的 head 属于 fork：#7 来自 alice，上游是 acme/app → 需要先确认推送目标
    expect(pushModal.textContent).toContain("PR 来自 fork");
    const forkConfirm = pushModal.querySelector<HTMLInputElement>(".gt-rv-check input")!;
    await act(async () => { forkConfirm.click(); });
    await act(async () => { buttonByText("提交并推送", pushModal)!.click(); });
    await waitFor(() => EXEC_LOG.some((entry) => entry.bin === "git" && entry.args.includes("push")), "git push issued");
    expect(EXEC_LOG.some((entry) => entry.bin === "git" && entry.args.includes("commit"))).toBe(true);
    const pushCall = EXEC_LOG.find((entry) => entry.bin === "git" && entry.args.includes("push"))!;
    expect(pushCall.args.join(" ")).toContain("HEAD:refs/heads/fix/bound");
    expect(pushCall.args.join(" ")).toContain("github.com/alice/app.git");
    expect(pushCall.args.join(" ")).not.toContain("--force");
    await waitFor(() => container.textContent!.includes("已推送修复"), "push recorded");

    act(() => disposers.forEach((dispose) => dispose()));
  });

  it("PR 有合并冲突：审查按阻塞处理，结果页不给批准/合并，改给冲突修复", async () => {
    const disposers = await mount({ report: true });
    await waitFor(() => container.querySelectorAll(".gt-wt-chip").length === 1, "binding loaded");
    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[0].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(4);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-modal.is-ai .gt-modal-foot .gt-btn.is-primary")!.click(); });
    await waitFor(() => sendMock.mock.calls.length === 1, "review run started");

    // 审查提示词：带上合并状态，并把冲突写成硬阻塞规则
    const reviewPrompt = String(sendMock.mock.calls[0][0]);
    expect(reviewPrompt).toContain("合并状态：");
    expect(reviewPrompt).toContain("CONFLICTING");
    expect(reviewPrompt).toContain("有冲突");
    expect(reviewPrompt).toContain("冲突是硬阻塞");
    expect(reviewPrompt).toContain("不许给 approve");

    finishRun(startedRuns[0]);
    await waitFor(() => !!buttonByText("查看结果"), "view result button");
    await act(async () => { buttonByText("查看结果")!.click(); });
    await waitFor(() => container.textContent!.includes("GitHub 现在无法合并"), "conflict banner");
    await waitFor(() => container.textContent!.includes("超时分支没有回滚会话状态"), "report rendered");

    // 批准与合并都收起（合并项在「更多」里被禁用）
    expect(buttonByText("批准 PR")).toBeFalsy();
    expect(buttonByText("批准")).toBeFalsy();
    expect(buttonByText("合并 PR…")).toBeFalsy();
    // 反馈/评论仍然可用，主按钮变成修复冲突
    expect(buttonByText("反馈作者并请求修改")).toBeTruthy();
    const fixConflict = buttonByText("AI 修复冲突")!;
    expect(fixConflict).toBeTruthy();
    await act(async () => { fixConflict.click(); });
    await flush(2);

    // 冲突专项提示词：merge base、手工解冲突、不改写历史
    const dialog = container.querySelector<HTMLElement>(".gt-modal.is-review")!;
    expect(dialog.textContent).toContain("解决合并冲突");
    const textarea = dialog.querySelector<HTMLTextAreaElement>(".gt-rv-textarea")!;
    expect(textarea.value).toContain("git fetch origin main");
    expect(textarea.value).toContain("<<<<<<<");
    await act(async () => { buttonByText("开始修复", dialog)!.click(); });
    await waitFor(() => sendMock.mock.calls.length === 2, "conflict fix run started");
    expect(String(sendMock.mock.calls[1][0])).toContain("解决冲突");

    act(() => disposers.forEach((dispose) => dispose()));
  });

  it("正文与评论按 GitHub 的 GFM 规则渲染，原始 HTML 只当文本", async () => {
    const disposers = await mount();
    await waitFor(() => container.querySelectorAll(".gt-row").length > 0, "rows");
    await act(async () => { container.querySelector<HTMLElement>(".gt-row")!.click(); });
    await waitFor(() => !!container.querySelector(".gt-md-root h1"), "markdown body rendered");

    const md = container.querySelector<HTMLElement>(".gt-md-root")!;
    expect(md.querySelector("h1")!.textContent).toContain("问题");
    expect(md.querySelector("h2")!.textContent).toContain("日志");
    expect(md.querySelector("blockquote")!.textContent).toContain("CC GUI crash report");
    expect(md.querySelector("strong")!.textContent).toBe("加粗");
    expect(md.querySelector("code.gt-md-inline-code")!.textContent).toBe("edge");
    expect(md.querySelector("del")!.textContent).toBe("删除线");
    // 表格（含对齐）
    expect(md.querySelector(".gt-md-table th")!.textContent).toBe("列 A");
    expect(md.querySelectorAll(".gt-md-table tbody td").length).toBe(2);
    // 任务列表
    const tasks = md.querySelectorAll<HTMLInputElement>(".gt-md-task input");
    expect(tasks.length).toBe(2);
    expect(tasks[0].checked).toBe(true);
    expect(tasks[1].checked).toBe(false);
    // 代码块 + diff 高亮
    expect(md.querySelector(".gt-md-pre .gt-md-lang")!.textContent).toBe("diff");
    expect(md.querySelectorAll(".gt-md-diffrow.is-add").length).toBe(1);
    expect(md.querySelectorAll(".gt-md-diffrow.is-del").length).toBe(1);
    // 链接：绝对 / 相对 / @提及 / #引用
    const links = Array.from(md.querySelectorAll<HTMLAnchorElement>("a.gt-md-link")).map((a) => a.getAttribute("href"));
    // 相对链接按 PR 的 head 分支解析（GitHub 同款规则）
    expect(links).toContain("https://github.com/acme/app/blob/fix/bound/docs/a.md");
    expect(links).toContain("https://github.com/alice");
    expect(links).toContain("https://github.com/acme/app/issues/123");
    // 原始 HTML 不落地成元素，只当文本（等价于 GitHub 的 sanitize）
    expect(md.querySelector("script")).toBeNull();
    expect(md.textContent).toContain("<script>alert(1)</script>");
    // 评论同样渲染
    expect(container.querySelector(".gt-comment .gt-md-root strong")!.textContent).toBe("重点");

    act(() => disposers.forEach((dispose) => dispose()));
  });

  it("只有 report.md 时按原文兜底展示，并且不出勾选类操作", async () => {
    const disposers = await mount({ report: "md" });
    await waitFor(() => container.querySelectorAll(".gt-wt-chip").length === 1, "binding loaded");
    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[0].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(4);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-modal.is-ai .gt-modal-foot .gt-btn.is-primary")!.click(); });
    await waitFor(() => sendMock.mock.calls.length === 1, "review run started");
    finishRun(startedRuns[0]);

    await waitFor(() => !!buttonByText("查看结果"), "view result button");
    await act(async () => { buttonByText("查看结果")!.click(); });
    await waitFor(() => container.textContent!.includes("report.md 原文展示"), "raw report rendered");
    expect(container.textContent).toContain("原始报告");
    expect(container.textContent).toContain("压缩超时分支缺少状态回滚");
    // 未结构化：不提供逐条勾选，但保留重新审查入口
    expect(container.querySelector(".gt-rv-raw")).toBeTruthy();
    expect(buttonByText("重新审查（结构化）")).toBeTruthy();
    expect(buttonByText("反馈作者并请求修改")).toBeFalsy();

    act(() => disposers.forEach((dispose) => dispose()));
  });

  it("列表项 ×：可以只关闭结果，不动 worktree", async () => {
    const disposers = await mount({ report: true });
    await waitFor(() => container.querySelectorAll(".gt-wt-chip").length === 1, "binding loaded");
    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[0].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(4);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-modal.is-ai .gt-modal-foot .gt-btn.is-primary")!.click(); });
    await waitFor(() => sendMock.mock.calls.length === 1, "review run started");
    finishRun(startedRuns[0]);
    await act(async () => { buttonByText("查看结果")!.click(); });
    await waitFor(() => container.querySelectorAll(".gt-rv-item").length === 1, "result listed");

    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-rv-item-close")!.click(); });
    await flush(1);
    const dialog = container.querySelector<HTMLElement>(".gt-modal.is-review")!;
    expect(dialog.textContent).toContain("关闭审查结果 #7");
    await act(async () => { buttonByText("只关闭结果", dialog)!.click(); });
    await waitFor(() => container.querySelectorAll(".gt-rv-item").length === 0, "record closed");
    expect(gitWorktreeRemove).not.toHaveBeenCalled();
    expect(container.textContent).toContain("已关闭结果");

    act(() => disposers.forEach((dispose) => dispose()));
  });

  it("列表项 ×：选择删除 worktree 时走宿主删除流程（可带删分支）", async () => {
    const disposers = await mount({ report: true });
    await waitFor(() => container.querySelectorAll(".gt-wt-chip").length === 1, "binding loaded");
    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[0].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(4);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-modal.is-ai .gt-modal-foot .gt-btn.is-primary")!.click(); });
    await waitFor(() => sendMock.mock.calls.length === 1, "review run started");
    finishRun(startedRuns[0]);
    await act(async () => { buttonByText("查看结果")!.click(); });
    await waitFor(() => container.querySelectorAll(".gt-rv-item").length === 1, "result listed");

    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-rv-item-close")!.click(); });
    await flush(1);
    const dialog = container.querySelector<HTMLElement>(".gt-modal.is-review")!;
    const branchCheck = dialog.querySelector<HTMLInputElement>(".gt-rv-check input")!;
    await act(async () => { branchCheck.click(); });
    await act(async () => { buttonByText("删除 worktree 并关闭", dialog)!.click(); });
    await waitFor(() => gitWorktreeRemove.mock.calls.length === 1, "worktree removed");
    expect(gitWorktreeRemove).toHaveBeenCalledWith("/tmp/app", "/tmp/app-worktrees/pr-7-fix-bound", "pr-7-fix-bound", true);
    await waitFor(() => container.querySelectorAll(".gt-rv-item").length === 0, "record closed");
    expect(container.textContent).toContain("已关闭结果并删除 worktree");

    act(() => disposers.forEach((dispose) => dispose()));
  });

  it("作者推了新提交：结论标为过期，动作收起只剩重新审查", async () => {
    const disposers = await mount({ report: true });
    await waitFor(() => container.querySelectorAll(".gt-wt-chip").length === 1, "binding loaded");
    const checks = container.querySelectorAll<HTMLInputElement>(".gt-table .gt-row .gt-row-check");
    await act(async () => { checks[0].click(); });
    await flush(2);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-bulk-primary")!.click(); });
    await flush(4);
    await act(async () => { container.querySelector<HTMLButtonElement>(".gt-modal.is-ai .gt-modal-foot .gt-btn.is-primary")!.click(); });
    await waitFor(() => sendMock.mock.calls.length === 1, "review run started");
    finishRun(startedRuns[0]);

    await waitFor(() => !!buttonByText("查看结果"), "view result button");
    await act(async () => { buttonByText("查看结果")!.click(); });
    // 结果页挂载后核对远端 head：zzz9999 ≠ abc → 过期（进页面有 400ms 节流）
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
    await waitFor(() => container.textContent!.includes("审查结论已过期"), "stale banner");
    expect(container.textContent).toContain("仍然使用旧结论");
    expect(buttonByText("反馈作者并请求修改")).toBeFalsy();
    expect(buttonByText("我来修复")).toBeFalsy();

    act(() => disposers.forEach((dispose) => dispose()));
  });
});
