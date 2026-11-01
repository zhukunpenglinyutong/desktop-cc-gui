// Open /tests/browser/run-status-strip.html with the Vite dev server running.
// Visual fixture for the chat run-status strip: seeded chat/git stores, no
// IPC, no saved conversation. Buttons replay a live turn and its settlement.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { useChatStore } from "../../src/features/chat/store";
import { useGitStore } from "../../src/features/git/store";
import { RunStatusStrip } from "../../src/features/chat/components/RunStatusStrip";
import { AGENT_STATUS_ROLE, type Message, type TodosPayload } from "../../src/lib/ipc";

const KEY = "run-status-fixture";
const WS = "/ws";

function msg(seq: number, role: string, text: string, path?: string): Message {
  return { seq, role, text, path: path ?? null, ts: null };
}
function todoMsg(seq: number, todos: TodosPayload): Message {
  return { seq, role: "tool", text: "todo", ts: null, todos };
}

/** One settled spawn (a later assistant row exists), one still running, two
 * edited files — the mid-turn shape. */
const TURN: Message[] = [
  msg(1, "user", "帮我修复这些 failing tests"),
  todoMsg(7, {
    replace: true,
    items: [
      { content: "复现失败用例", status: "complete" },
      { content: "定位根因", status: "complete" },
      { content: "派发并行修复", status: "active" },
      { content: "回归验证", status: "pending" },
      { content: "更新快照", status: "blocked" },
    ],
  }),
  {
    ...msg(2, "tool", "task · Fix auth token refresh tests"),
    args: {
      tasks: [{ name: "AuthFix", description: "Fix auth token refresh tests", agent: "task", task: "Fix auth token refresh tests" }],
    },
  },
  msg(3, "tool", "edit_file", "/ws/src/features/auth/auth.ts"),
  msg(4, "assistant", "第一个子代理已回传，继续等待其余结果。"),
  {
    ...msg(5, "tool", "task · Dispatching 10 parallel fix agents"),
    args: {
      tasks: [{ name: "RateLimiter", description: "Fix rate limiter", agent: "task", task: "Fix rate limiter" }],
    },
  },
  msg(6, "tool", "edit_file", "/ws/src/lib/rate-limiter.ts"),
];

const ASYNC_COMPLETION: Message = {
  seq: 8,
  role: AGENT_STATUS_ROLE,
  text: "",
  ts: null,
  result: { details: { jobs: [{ jobId: "RateLimiter", status: "completed" }] } },
};


function seed(streaming: boolean, includeCompletion = false) {
  useChatStore.setState({
    bySession: {
      [KEY]: {
        messages: includeCompletion ? [...TURN, ASYNC_COMPLETION] : TURN,
        streaming,
      } as never,
    },
  });
}

useGitStore.setState({
  statusByWorkspace: {
    [WS]: {
      branch: "main",
      staged: [],
      unstaged: [
        { path: "src/features/auth/auth.ts", status: "M", additions: 64, deletions: 12 },
        { path: "src/lib/rate-limiter.ts", status: "M", additions: 38, deletions: 20 },
      ],
      untracked: [],
    },
  },
  // The fixture never touches IPC.
  refresh: async () => {},
});

seed(true);

function Fixture() {
  const [streaming, setStreaming] = useState(true);
  return (
    <div style={{ maxWidth: 768, margin: "40px auto", padding: "0 16px", fontFamily: "sans-serif" }}>
      <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
        <button onClick={() => { seed(true); setStreaming(true); }}>▶ 进行中</button>
        <button onClick={() => { seed(false); setStreaming(false); }}>✓ 回合结束</button>
        <button onClick={() => { seed(true, true); setStreaming(true); }}>✓ 后台任务完成</button>
        <span style={{ color: "#a1a1aa", fontSize: 12, alignSelf: "center" }}>
          点击 pill 展开面板；Esc 收起；右侧方块收起整条（localStorage 持久化）
        </span>
      </div>
      <div style={{ background: "#fff", border: "1px solid #e4e4e7", borderRadius: 12, padding: 16 }}>
        <div style={{ height: 240, color: "#a1a1aa", fontSize: 13 }}>
          消息区（面板浮在其上方，不会把它顶下去）…
        </div>
        <RunStatusStrip sessionKey={KEY} engine="pi" workspacePath={WS} />
        <div style={{ border: "1px solid #d4d4d8", borderRadius: 12, padding: "10px 12px", color: "#a1a1aa", fontSize: 13 }}>
          发消息给 Agent…
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
