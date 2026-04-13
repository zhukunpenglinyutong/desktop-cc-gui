import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  addWorkspace,
  forkClaudeSession,
  forkClaudeSessionFromMessage,
  forkThread,
  generateThreadTitle,
  getGitHubIssues,
  getGitLog,
  getGitPushPreview,
  getGitStatus,
  getOpenAppIcon,
  listThreadTitles,
  listMcpServerStatus,
  listGlobalMcpServers,
  readGlobalAgentsMd,
  readGlobalCodexConfigToml,
  pushGit,
  pullGit,
  runWorkspaceCommand,
  runSpecCommand,
  resetGitCommit,
  listWorkspaces,
  reloadCodexRuntimeConfig,
  openWorkspaceIn,
  openNewWindow,
  readAgentMd,
  renameThreadTitleKey,
  setThreadTitle,
  stageGitAll,
  respondToServerRequest,
  respondToUserInputRequest,
  sendUserMessage,
  startReview,
  writeGlobalAgentsMd,
  writeGlobalCodexConfigToml,
  writeAgentMd,
  connectOpenCodeProvider,
  getOpenCodeProviderHealth,
  getCodeIntelDefinition,
  getCodeIntelReferences,
  getOpenCodeLspDefinition,
  getOpenCodeLspReferences,
  getOpenCodeStatusSnapshot,
  detectEngines,
  engineSendMessage,
  exportRewindFiles,
  listExternalSpecTree,
  setOpenCodeMcpToggle,
  readExternalSpecFile,
  readExternalAbsoluteFile,
  resolveFilePreviewHandle,
  writeExternalSpecFile,
  writeExternalAbsoluteFile,
  engineSendMessageSync,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function setWebRuntimeFlag(value: boolean) {
  const globalRef = globalThis as any;
  if (!globalRef.window) {
    globalRef.window = {};
  }
  globalRef.window.__MOSSX_WEB_SERVICE__ = value;
}

function clearWebRuntimeFlag() {
  const globalRef = globalThis as any;
  if (!globalRef.window) {
    return;
  }
  delete globalRef.window.__MOSSX_WEB_SERVICE__;
}

describe("tauri invoke wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWebRuntimeFlag();
  });

  it("uses codex_bin for addWorkspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ id: "ws-1" });

    await addWorkspace("/tmp/project", null);

    expect(invokeMock).toHaveBeenCalledWith("add_workspace", {
      path: "/tmp/project",
      codex_bin: null,
    });
  });

  it("maps workspace_id to workspaceId for git status", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
    });

    await getGitStatus("ws-1");

    expect(invokeMock).toHaveBeenCalledWith("get_git_status", {
      workspaceId: "ws-1",
    });
  });

  it("invokes codex runtime reload command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      status: "applied",
      stage: "swapped",
      restartedSessions: 2,
      message: null,
    });

    await reloadCodexRuntimeConfig();

    expect(invokeMock).toHaveBeenCalledWith("reload_codex_runtime_config");
  });

  it("maps rewind export params to export_rewind_files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34/manifest.json",
      exportId: "export-20260413T000000Z-ab12cd34",
      fileCount: 2,
    });

    await exportRewindFiles({
      workspaceId: "ws-1",
      engine: "claude",
      sessionId: "session-1",
      targetMessageId: "user-1",
      conversationLabel: "test",
      files: [{ path: "src/App.tsx" }, { path: "/tmp/demo.ts" }],
    });

    expect(invokeMock).toHaveBeenCalledWith("export_rewind_files", {
      workspaceId: "ws-1",
      engine: "claude",
      sessionId: "session-1",
      targetMessageId: "user-1",
      conversationLabel: "test",
      files: [{ path: "src/App.tsx" }, { path: "/tmp/demo.ts" }],
    });
  });

  it("maps workspace_id to workspaceId for GitHub issues", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ total: 0, issues: [] });

    await getGitHubIssues("ws-2");

    expect(invokeMock).toHaveBeenCalledWith("get_github_issues", {
      workspaceId: "ws-2",
    });
  });

  it("returns an empty list when the Tauri invoke bridge is missing", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(
      new TypeError("Cannot read properties of undefined (reading 'invoke')"),
    );

    await expect(listWorkspaces()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("list_workspaces");
  });

  it("applies default limit for git log", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      total: 0,
      entries: [],
      ahead: 0,
      behind: 0,
      aheadEntries: [],
      behindEntries: [],
      upstream: null,
    });

    await getGitLog("ws-3");

    expect(invokeMock).toHaveBeenCalledWith("get_git_log", {
      workspaceId: "ws-3",
      limit: 40,
    });
  });

  it("maps workspaceId and threadId for fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkThread("ws-9", "thread-9");

    expect(invokeMock).toHaveBeenCalledWith("fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
    });
  });

  it("maps workspacePath and sessionId for fork_claude_session", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkClaudeSession("/tmp/project", "claude-session-1");

    expect(invokeMock).toHaveBeenCalledWith("fork_claude_session", {
      workspacePath: "/tmp/project",
      sessionId: "claude-session-1",
    });
  });

  it("maps workspacePath/sessionId/messageId for fork_claude_session_from_message", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkClaudeSessionFromMessage(
      "/tmp/project",
      "claude-session-1",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "fork_claude_session_from_message",
      {
        workspacePath: "/tmp/project",
        sessionId: "claude-session-1",
        messageId: "550e8400-e29b-41d4-a716-446655440000",
      },
    );
  });

  it("maps workspaceId/cursor/limit for list_mcp_server_status", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await listMcpServerStatus("ws-10", "cursor-1", 25);

    expect(invokeMock).toHaveBeenCalledWith("list_mcp_server_status", {
      workspaceId: "ws-10",
      cursor: "cursor-1",
      limit: 25,
    });
  });

  it("invokes list_global_mcp_servers", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    await listGlobalMcpServers();

    expect(invokeMock).toHaveBeenCalledWith("list_global_mcp_servers");
  });

  it("invokes stage_git_all", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await stageGitAll("ws-6");

    expect(invokeMock).toHaveBeenCalledWith("stage_git_all", {
      workspaceId: "ws-6",
    });
  });

  it("maps reset git commit payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await resetGitCommit("ws-20", "abcdef1234567890", "mixed");

    expect(invokeMock).toHaveBeenCalledWith("reset_git_commit", {
      workspaceId: "ws-20",
      commitHash: "abcdef1234567890",
      mode: "mixed",
    });
  });

  it("maps push git payload with options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await pushGit("ws-30", {
      remote: "origin",
      branch: "main",
      forceWithLease: true,
      pushTags: true,
      runHooks: false,
      pushToGerrit: true,
      topic: "topic-1",
      reviewers: "alice,bob",
      cc: "carol",
    });

    expect(invokeMock).toHaveBeenCalledWith("push_git", {
      workspaceId: "ws-30",
      remote: "origin",
      branch: "main",
      forceWithLease: true,
      pushTags: true,
      runHooks: false,
      pushToGerrit: true,
      topic: "topic-1",
      reviewers: "alice,bob",
      cc: "carol",
    });
  });

  it("maps pull git payload with options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await pullGit("ws-32", {
      remote: "origin",
      branch: "main",
      strategy: "--rebase",
      noCommit: false,
      noVerify: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("pull_git", {
      workspaceId: "ws-32",
      remote: "origin",
      branch: "main",
      strategy: "--rebase",
      noCommit: false,
      noVerify: true,
    });
  });

  it("maps get git push preview payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      sourceBranch: "main",
      targetRemote: "origin",
      targetBranch: "main",
      targetRef: "refs/remotes/origin/main",
      targetFound: true,
      hasMore: false,
      commits: [],
    });

    await getGitPushPreview("ws-31", {
      remote: "origin",
      branch: "main",
    });

    expect(invokeMock).toHaveBeenCalledWith("get_git_push_preview", {
      workspaceId: "ws-31",
      remote: "origin",
      branch: "main",
      limit: 120,
    });
  });

  it("maps openWorkspaceIn options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await openWorkspaceIn("/tmp/project", {
      appName: "Xcode",
      args: ["--reuse-window"],
    });

    expect(invokeMock).toHaveBeenCalledWith("open_workspace_in", {
      path: "/tmp/project",
      app: "Xcode",
      command: null,
      args: ["--reuse-window"],
    });
  });

  it("maps openNewWindow payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await openNewWindow("/tmp/project");

    expect(invokeMock).toHaveBeenCalledWith("open_new_window", {
      path: "/tmp/project",
    });
  });

  it("maps run workspace command payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      command: ["echo", "hello"],
      exitCode: 0,
      success: true,
      stdout: "hello",
      stderr: "",
    });

    await runWorkspaceCommand("ws-40", ["echo", "hello"], 5000);

    expect(invokeMock).toHaveBeenCalledWith("run_workspace_command", {
      workspaceId: "ws-40",
      command: ["echo", "hello"],
      timeoutMs: 5000,
    });
  });

  it("maps run spec command payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      command: ["openspec", "--version"],
      exitCode: 0,
      success: true,
      stdout: "0.6.0",
      stderr: "",
    });

    await runSpecCommand("ws-41", ["openspec", "--version"], {
      customSpecRoot: "/tmp/external-spec-root",
      timeoutMs: 7000,
    });

    expect(invokeMock).toHaveBeenCalledWith("run_spec_command", {
      workspaceId: "ws-41",
      command: ["openspec", "--version"],
      customSpecRoot: "/tmp/external-spec-root",
      timeoutMs: 7000,
    });
  });

  it("maps list external spec tree payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      files: [],
      directories: [],
      gitignored_files: [],
      gitignored_directories: [],
    });

    await listExternalSpecTree("ws-41", "/tmp/external-spec-root");

    expect(invokeMock).toHaveBeenCalledWith("list_external_spec_tree", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
    });
  });

  it("maps read external spec file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# spec",
      truncated: false,
    });

    await readExternalSpecFile(
      "ws-41",
      "/tmp/external-spec-root",
      "openspec/project.md",
    );

    expect(invokeMock).toHaveBeenCalledWith("read_external_spec_file", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
      path: "openspec/project.md",
    });
  });

  it("maps read external absolute file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      content: "# skill",
      truncated: false,
    });

    await readExternalAbsoluteFile(
      "ws-41",
      "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
    );

    expect(invokeMock).toHaveBeenCalledWith("read_external_absolute_file", {
      workspaceId: "ws-41",
      path: "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
    });
  });

  it("maps file preview handle payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      absolutePath: "/repo/docs/report.pdf",
      byteLength: 2048,
      extension: "pdf",
    });

    await resolveFilePreviewHandle("ws-41", {
      domain: "workspace",
      path: "docs/report.pdf",
    });

    expect(invokeMock).toHaveBeenCalledWith("resolve_file_preview_handle", {
      workspaceId: "ws-41",
      domain: "workspace",
      path: "docs/report.pdf",
      specRoot: null,
    });
  });

  it("maps write external spec file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeExternalSpecFile(
      "ws-41",
      "/tmp/external-spec-root",
      "openspec/project.md",
      "# Project Context",
    );

    expect(invokeMock).toHaveBeenCalledWith("write_external_spec_file", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
      path: "openspec/project.md",
      content: "# Project Context",
    });
  });

  it("maps write external absolute file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeExternalAbsoluteFile(
      "ws-41",
      "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
      "# Updated skill",
    );

    expect(invokeMock).toHaveBeenCalledWith("write_external_absolute_file", {
      workspaceId: "ws-41",
      path: "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
      content: "# Updated skill",
    });
  });

  it("invokes get_open_app_icon", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("data:image/png;base64,abc");

    await getOpenAppIcon("Xcode");

    expect(invokeMock).toHaveBeenCalledWith("get_open_app_icon", {
      appName: "Xcode",
    });
  });

  it("reads agent.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# Agent",
      truncated: false,
    });

    await readAgentMd("ws-agent");

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "workspace",
      kind: "agents",
      workspaceId: "ws-agent",
    });
  });

  it("writes agent.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeAgentMd("ws-agent", "# Agent");

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "workspace",
      kind: "agents",
      workspaceId: "ws-agent",
      content: "# Agent",
    });
  });

  it("reads global AGENTS.md", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# Global",
      truncated: false,
    });

    await readGlobalAgentsMd();

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "global",
      kind: "agents",
      workspaceId: undefined,
    });
  });

  it("writes global AGENTS.md", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeGlobalAgentsMd("# Global");

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "global",
      kind: "agents",
      workspaceId: undefined,
      content: "# Global",
    });
  });

  it("reads global config.toml", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: 'model = "gpt-5"',
      truncated: false,
    });

    await readGlobalCodexConfigToml();

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "global",
      kind: "config",
      workspaceId: undefined,
    });
  });

  it("writes global config.toml", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeGlobalCodexConfigToml('model = "gpt-5"');

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "global",
      kind: "config",
      workspaceId: undefined,
      content: 'model = "gpt-5"',
    });
  });

  it("fills sendUserMessage defaults in payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "hello", {
      accessMode: "full-access",
      images: ["image.png"],
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "hello",
      model: null,
      effort: null,
      accessMode: "full-access",
      images: ["image.png"],
      preferredLanguage: null,
    });
  });

  it("forwards customSpecRoot in sendUserMessage payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "hello", {
      customSpecRoot: "/tmp/external-openspec",
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "hello",
      model: null,
      effort: null,
      accessMode: null,
      images: null,
      preferredLanguage: null,
      customSpecRoot: "/tmp/external-openspec",
    });
  });

  it("omits delivery when starting reviews without override", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await startReview("ws-5", "thread-2", { type: "uncommittedChanges" });

    expect(invokeMock).toHaveBeenCalledWith("start_review", {
      workspaceId: "ws-5",
      threadId: "thread-2",
      target: { type: "uncommittedChanges" },
    });
  });

  it("nests decisions for server request responses", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await respondToServerRequest("ws-6", 101, "accept");

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-6",
      requestId: 101,
      result: { decision: "accept" },
    });
  });

  it("nests answers for user input responses", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await respondToUserInputRequest("ws-7", 202, {
      confirm_path: { answers: ["Yes"] },
    });

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-7",
      requestId: 202,
      result: {
        answers: {
          confirm_path: { answers: ["Yes"] },
        },
      },
    });
  });

  it("passes through multiple user input answers", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    const answers = {
      confirm_path: { answers: ["Yes"] },
      notes: { answers: ["First line", "Second line"] },
    };

    await respondToUserInputRequest("ws-8", 303, answers);

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-8",
      requestId: 303,
      result: {
        answers,
      },
    });
  });

  it("lists thread titles for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ "thread-1": "Fix login flow" });

    await listThreadTitles("ws-12");

    expect(invokeMock).toHaveBeenCalledWith("list_thread_titles", {
      workspaceId: "ws-12",
    });
  });

  it("sets a thread title mapping", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("Fix login flow");

    await setThreadTitle("ws-13", "thread-13", "Fix login flow");

    expect(invokeMock).toHaveBeenCalledWith("set_thread_title", {
      workspaceId: "ws-13",
      threadId: "thread-13",
      title: "Fix login flow",
    });
  });

  it("generates a thread title with codex backend", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("Fix login flow");

    await generateThreadTitle(
      "ws-14",
      "thread-14",
      "Please fix login redirect loop",
      "zh",
    );

    expect(invokeMock).toHaveBeenCalledWith("generate_thread_title", {
      workspaceId: "ws-14",
      threadId: "thread-14",
      userMessage: "Please fix login redirect loop",
      preferredLanguage: "zh",
    });
  });

  it("renames a thread title key", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await renameThreadTitleKey("ws-15", "claude-pending-1", "claude:session-1");

    expect(invokeMock).toHaveBeenCalledWith("rename_thread_title_key", {
      workspaceId: "ws-15",
      oldThreadId: "claude-pending-1",
      newThreadId: "claude:session-1",
    });
  });

  it("maps opencode provider health params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      provider: "openai",
      connected: true,
      credentialCount: 1,
      matched: true,
    });

    await getOpenCodeProviderHealth("ws-16", "openai");

    expect(invokeMock).toHaveBeenCalledWith("opencode_provider_health", {
      workspaceId: "ws-16",
      provider: "openai",
    });
  });

  it("maps opencode provider connect params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ started: true });

    await connectOpenCodeProvider("ws-17", null);

    expect(invokeMock).toHaveBeenCalledWith("opencode_provider_connect", {
      workspaceId: "ws-17",
      providerId: null,
    });
  });

  it("maps opencode status snapshot params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      providerHealth: {
        provider: "openai",
        connected: true,
        credentialCount: 1,
        matched: true,
      },
      mcpEnabled: true,
      mcpServers: [],
      mcpRaw: "",
      managedToggles: true,
    });

    await getOpenCodeStatusSnapshot({
      workspaceId: "ws-18",
      threadId: "opencode:ses_18",
      model: "openai/gpt-5.3-codex",
      agent: "default",
      variant: "default",
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_status_snapshot", {
      workspaceId: "ws-18",
      threadId: "opencode:ses_18",
      model: "openai/gpt-5.3-codex",
      agent: "default",
      variant: "default",
    });
  });

  it("maps opencode MCP toggle params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      workspaceId: "ws-19",
      mcpEnabled: true,
      serverStates: {},
      managedToggles: true,
    });

    await setOpenCodeMcpToggle("ws-19", { serverName: "fs", enabled: false });

    expect(invokeMock).toHaveBeenCalledWith("opencode_mcp_toggle", {
      workspaceId: "ws-19",
      serverName: "fs",
      enabled: false,
      globalEnabled: null,
    });
  });

  it("maps opencode lsp definition params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
      result: [],
    });

    await getOpenCodeLspDefinition("ws-lsp-1", {
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_lsp_definition", {
      workspaceId: "ws-lsp-1",
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
    });
  });

  it("maps code intel definition params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "src/Main.java",
      line: 10,
      character: 4,
      result: [],
    });

    await getCodeIntelDefinition("ws-ci-1", {
      filePath: "src/Main.java",
      line: 10,
      character: 4,
    });

    expect(invokeMock).toHaveBeenCalledWith("code_intel_definition", {
      workspaceId: "ws-ci-1",
      filePath: "src/Main.java",
      line: 10,
      character: 4,
    });
  });

  it("propagates code intel definition errors", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("code intel unavailable"));

    await expect(
      getCodeIntelDefinition("ws-ci-err-1", {
        filePath: "src/Main.java",
        line: 1,
        character: 1,
      }),
    ).rejects.toThrow("code intel unavailable");
  });

  it("maps code intel references params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
      result: [],
    });

    await getCodeIntelReferences("ws-ci-2", {
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("code_intel_references", {
      workspaceId: "ws-ci-2",
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
    });
  });

  it("propagates code intel references errors", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("references unavailable"));

    await expect(
      getCodeIntelReferences("ws-ci-err-2", {
        filePath: "src/Main.java",
        line: 2,
        character: 3,
      }),
    ).rejects.toThrow("references unavailable");
  });

  it("maps opencode lsp references params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
      result: [],
    });

    await getOpenCodeLspReferences("ws-lsp-2", {
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_lsp_references", {
      workspaceId: "ws-lsp-2",
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
    });
  });

  it("maps sync engine send payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "codex",
      text: '{"projectType":"legacy"}',
    });

    await engineSendMessageSync("ws-21", {
      text: "Generate project context",
      engine: "codex",
      accessMode: "read-only",
      continueSession: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message_sync", {
      workspaceId: "ws-21",
      text: "Generate project context",
      engine: "codex",
      model: null,
      effort: null,
      images: null,
      continueSession: false,
      accessMode: "read-only",
      sessionId: null,
      agent: null,
      variant: null,
      customSpecRoot: null,
    });
  });

  it("maps sync engine send custom spec root payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "opencode",
      text: "ok",
    });

    await engineSendMessageSync("ws-22", {
      text: "check spec",
      engine: "opencode",
      customSpecRoot: "/tmp/external-openspec",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message_sync", {
      workspaceId: "ws-22",
      text: "check spec",
      engine: "opencode",
      model: null,
      effort: null,
      images: null,
      continueSession: false,
      accessMode: null,
      sessionId: null,
      agent: null,
      variant: null,
      customSpecRoot: "/tmp/external-openspec",
    });
  });

  it("falls back to codex-only engine statuses in web runtime when detect command is unavailable", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    const statuses = await detectEngines();
    const codexStatus = statuses.find((entry) => entry.engineType === "codex");
    const claudeStatus = statuses.find(
      (entry) => entry.engineType === "claude",
    );

    expect(codexStatus?.installed).toBe(true);
    expect(claudeStatus?.installed).toBe(false);
    expect(claudeStatus?.error).toContain("Codex CLI");
  });

  it("returns a friendly error when web runtime tries unsupported CLI engine", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);

    const response = await engineSendMessage("ws-web", {
      text: "hello",
      engine: "claude",
    });

    expect(invokeMock).not.toHaveBeenCalledWith(
      "engine_send_message",
      expect.anything(),
    );
    expect(response).toEqual({
      error: {
        message:
          "Web 服务当前仅支持 Codex CLI。请切换到 Codex CLI（Web service currently supports Codex CLI only）.",
      },
    });
  });
});
