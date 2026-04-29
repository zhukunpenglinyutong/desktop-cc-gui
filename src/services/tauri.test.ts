import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  addWorkspace,
  forkClaudeSession,
  forkClaudeSessionFromMessage,
  forkThread,
  rewindCodexThread,
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
  updateGitBranch,
  runWorkspaceCommand,
  runSpecCommand,
  resetGitCommit,
  listWorkspaces,
  reloadCodexRuntimeConfig,
  openWorkspaceIn,
  openNewWindow,
  readAgentMd,
  setCodexUnifiedExecOfficialOverride,
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
  getActiveEngine,
  getEngineModels,
  getEngineStatus,
  engineSendMessage,
  engineInterrupt,
  exportRewindFiles,
  getComputerUseBridgeStatus,
  runComputerUseActivationProbe,
  runComputerUseCodexBroker,
  runComputerUseHostContractDiagnostics,
  getWorkspaceSessionProjectionSummary,
  listGlobalCodexSessions,
  listProjectRelatedCodexSessions,
  listExternalSpecTree,
  listWorkspaceSessions,
  archiveWorkspaceSessions,
  unarchiveWorkspaceSessions,
  deleteWorkspaceSessions,
  runCodexDoctor,
  runClaudeDoctor,
  setOpenCodeMcpToggle,
  switchEngine,
  readExternalSpecFile,
  readExternalAbsoluteFile,
  resolveFilePreviewHandle,
  writeExternalSpecFile,
  writeExternalAbsoluteFile,
  engineSendMessageSync,
  deleteClaudeSession,
  deleteGeminiSession,
  sendConversationCompletionEmail,
} from "./tauri";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function authorizationContinuity() {
  return {
    kind: "matching_host",
    diagnosticMessage:
      "current host matches the last successful authorization host",
    currentHost: {
      displayName: "ccgui.app",
      executablePath: "/Applications/ccgui.app/Contents/MacOS/cc-gui",
      identifier: "com.codex.ccgui",
      teamIdentifier: "TEAM123",
      backendMode: "local",
      hostRole: "foreground_app",
      launchMode: "packaged_app",
      signingSummary: "Authority=Developer ID Application: Demo",
    },
    lastSuccessfulHost: {
      displayName: "ccgui.app",
      executablePath: "/Applications/ccgui.app/Contents/MacOS/cc-gui",
      identifier: "com.codex.ccgui",
      teamIdentifier: "TEAM123",
      backendMode: "local",
      hostRole: "foreground_app",
      launchMode: "packaged_app",
      signingSummary: "Authority=Developer ID Application: Demo",
    },
    driftFields: [],
  };
}

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

  it("invokes codex_doctor with the provided CLI inputs", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await runCodexDoctor("/bin/codex", "--profile demo");

    expect(invokeMock).toHaveBeenCalledWith("codex_doctor", {
      codexBin: "/bin/codex",
      codexArgs: "--profile demo",
    });
  });

  it("invokes claude_doctor with the provided CLI input", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await runClaudeDoctor("/bin/claude");

    expect(invokeMock).toHaveBeenCalledWith("claude_doctor", {
      claudeBin: "/bin/claude",
    });
  });

  it("invokes unified_exec official override command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      configPath: "/tmp/codex/config.toml",
      hasExplicitUnifiedExec: true,
      explicitUnifiedExecValue: true,
      officialDefaultEnabled: true,
    });

    await setCodexUnifiedExecOfficialOverride(true);

    expect(invokeMock).toHaveBeenCalledWith("set_codex_unified_exec_official_override", { enabled: true });
  });

  it("invokes conversation completion email command through the typed bridge", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      provider: "custom",
      acceptedRecipients: ["saved-recipient@example.com"],
      durationMs: 12,
    });

    await sendConversationCompletionEmail({
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      subject: "Moss conversation completed",
      textBody: "User: hi\nAssistant: done",
    });

    expect(invokeMock).toHaveBeenCalledWith("send_conversation_completion_email", {
      request: {
        workspaceId: "ws-1",
        threadId: "thread-1",
        turnId: "turn-1",
        subject: "Moss conversation completed",
        textBody: "User: hi\nAssistant: done",
      },
    });
  });

  it("invokes computer use bridge status command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      featureEnabled: true,
      activationEnabled: true,
      status: "blocked",
      platform: "macos",
      codexAppDetected: true,
      pluginDetected: true,
      pluginEnabled: true,
      blockedReasons: ["helper_bridge_unverified"],
      guidanceCodes: ["verify_helper_bridge"],
      codexConfigPath: "/Users/demo/.codex/config.toml",
      pluginManifestPath: "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
      helperPath: null,
      helperDescriptorPath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
      marketplacePath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
      diagnosticMessage: null,
      authorizationContinuity: authorizationContinuity(),
    });

    await getComputerUseBridgeStatus();

    expect(invokeMock).toHaveBeenCalledWith("get_computer_use_bridge_status");
  });

  it("invokes computer use activation probe command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outcome: "blocked",
      failureKind: "host_incompatible",
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["permission_required", "approval_required"],
        guidanceCodes: ["grant_system_permissions", "review_allowed_apps"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath: "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        marketplacePath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      durationMs: 312,
      diagnosticMessage: "helper bridge verified",
      stderrSnippet: null,
      exitCode: 0,
    });

    await runComputerUseActivationProbe();

    expect(invokeMock).toHaveBeenCalledWith("run_computer_use_activation_probe");
  });

  it("invokes computer use host-contract diagnostics command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      kind: "requires_official_parent",
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["helper_bridge_unverified"],
        guidanceCodes: ["verify_helper_bridge"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath: "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        marketplacePath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      evidence: {
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        currentHostPath: "/Applications/ThirdPartyHost.app/Contents/MacOS/third-party-host",
        handoffMethod: "direct_exec_skipped_nested_app_bundle",
        codesignSummary: "codesign exited with status 0",
        spctlSummary: "spctl exited with status 0",
        durationMs: 4,
        stdoutSnippet: null,
        stderrSnippet: "Authority=Developer ID Application",
        officialParentHandoff: {
          kind: "requires_official_parent",
          methods: [],
          evidence: {
            codexInfoPlistPath: "/Applications/Codex.app/Contents/Info.plist",
            serviceInfoPlistPath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/Info.plist",
            helperInfoPlistPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/Info.plist",
            parentCodeRequirementPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/Resources/SkyComputerUseClient_Parent.coderequirement",
            pluginManifestPath: "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
            mcpDescriptorPath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
            codexUrlSchemes: ["codex"],
            serviceBundleIdentifier: "com.openai.sky.CUAService",
            helperBundleIdentifier: "com.openai.sky.CUAService.cli",
            parentTeamIdentifier: "2DC432GLL2",
            applicationGroups: ["2DC432GLL2.com.openai.sky.CUAService"],
            xpcServiceIdentifiers: [],
            durationMs: 3,
            stdoutSnippet: null,
            stderrSnippet: null,
          },
          durationMs: 3,
          diagnosticMessage: "Readable metadata points to an official OpenAI parent/team contract.",
        },
      },
      durationMs: 4,
      diagnosticMessage: "Computer Use helper appears to require the official Codex parent contract.",
    });

    await runComputerUseHostContractDiagnostics();

    expect(invokeMock).toHaveBeenCalledWith("run_computer_use_host_contract_diagnostics");
  });

  it("invokes computer use Codex broker command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outcome: "completed",
      failureKind: null,
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["permission_required", "approval_required"],
        guidanceCodes: ["grant_system_permissions", "review_allowed_apps"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath: "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath: "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath: "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.mcp.json",
        marketplacePath: "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      text: "done",
      diagnosticMessage: "Computer Use task completed through the official Codex runtime.",
      durationMs: 1200,
    });

    await runComputerUseCodexBroker({
      workspaceId: "workspace-1",
      instruction: "inspect Chrome",
    });

    expect(invokeMock).toHaveBeenCalledWith("run_computer_use_codex_broker", {
      request: {
        workspaceId: "workspace-1",
        instruction: "inspect Chrome",
      },
    });
  });

  it("maps rewind export params to export_rewind_files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath: "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34",
      filesPath: "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34/files",
      manifestPath: "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34/manifest.json",
      exportId: "export-20260413T000000Z-ab12cd34",
      fileCount: 2,
    });

    await exportRewindFiles({
      workspaceId: "ws-1",
      engine: "claude",
      sessionId: "session-1",
      targetMessageId: "user-1",
      conversationLabel: "test",
      files: [
        { path: "src/App.tsx", status: "M" },
        { path: "/tmp/demo.ts", status: "D" },
      ],
    });

    expect(invokeMock).toHaveBeenCalledWith("export_rewind_files", {
      workspaceId: "ws-1",
      engine: "claude",
      sessionId: "session-1",
      targetMessageId: "user-1",
      conversationLabel: "test",
      files: [
        { path: "src/App.tsx", status: "M" },
        { path: "/tmp/demo.ts", status: "D" },
      ],
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

  it("maps workspace session list options to list_workspace_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:20",
      partialSource: null,
    });

    await listWorkspaceSessions("ws-2", {
      query: { keyword: "bugfix", engine: "codex", status: "archived" },
      cursor: "offset:0",
      limit: 20,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_workspace_sessions", {
      workspaceId: "ws-2",
      query: { keyword: "bugfix", engine: "codex", status: "archived" },
      cursor: "offset:0",
      limit: 20,
    });
  });

  it("maps global codex session list options to list_global_codex_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:10",
      partialSource: null,
    });

    await listGlobalCodexSessions({
      query: { keyword: "archive", engine: "codex", status: "all" },
      cursor: "offset:0",
      limit: 10,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_global_codex_sessions", {
      query: { keyword: "archive", engine: "codex", status: "all" },
      cursor: "offset:0",
      limit: 10,
    });
  });

  it("maps related codex session list options to list_project_related_codex_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:5",
      partialSource: null,
    });

    await listProjectRelatedCodexSessions("ws-2", {
      query: { keyword: "feature", engine: "codex", status: "active" },
      cursor: "offset:0",
      limit: 5,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_project_related_codex_sessions", {
      workspaceId: "ws-2",
      query: { keyword: "feature", engine: "codex", status: "active" },
      cursor: "offset:0",
      limit: 5,
    });
  });

  it("maps workspace projection summary requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-2", "ws-3"],
      activeTotal: 8,
      archivedTotal: 2,
      allTotal: 10,
      filteredTotal: 8,
      partialSources: [],
    });

    await getWorkspaceSessionProjectionSummary("ws-2", {
      query: { keyword: "feature", engine: "codex", status: "active" },
    });

    expect(invokeMock).toHaveBeenCalledWith("get_workspace_session_projection_summary", {
      workspaceId: "ws-2",
      query: { keyword: "feature", engine: "codex", status: "active" },
    });
  });

  it("maps workspace session batch mutations", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({});

    await archiveWorkspaceSessions("ws-2", ["claude:1", "codex-1"]);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "archive_workspace_sessions", {
      workspaceId: "ws-2",
      sessionIds: ["claude:1", "codex-1"],
    });

    await unarchiveWorkspaceSessions("ws-2", ["claude:1"]);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "unarchive_workspace_sessions", {
      workspaceId: "ws-2",
      sessionIds: ["claude:1"],
    });

    await deleteWorkspaceSessions("ws-2", ["opencode:1"]);
    expect(invokeMock).toHaveBeenNthCalledWith(3, "delete_workspace_sessions", {
      workspaceId: "ws-2",
      sessionIds: ["opencode:1"],
    });
  });

  it("returns an empty list when the Tauri invoke bridge is missing", async () => {
    const invokeMock = vi.mocked(invoke);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(new TypeError("Cannot read properties of undefined (reading 'invoke')"));

    await expect(listWorkspaces()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("list_workspaces");
    expect(consoleWarnSpy).toHaveBeenCalledWith("Tauri invoke bridge unavailable; returning empty workspaces list.");
    consoleWarnSpy.mockRestore();
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
      messageId: null,
    });
  });

  it("maps codex rewind params to rewind_codex_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await rewindCodexThread("ws-9", "thread-9", 2, "user-2", {
      targetUserMessageText: "1+1",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });

    expect(invokeMock).toHaveBeenCalledWith("rewind_codex_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "user-2",
      targetUserTurnIndex: 2,
      targetUserMessageText: "1+1",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });
  });

  it("normalizes codex rewind index/messageId payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await rewindCodexThread("ws-9", "thread-9", 2.8, "  user-2  ", {
      targetUserMessageText: " 1+1 ",
      targetUserMessageOccurrence: Number.POSITIVE_INFINITY,
      localUserMessageCount: Number.POSITIVE_INFINITY,
    });

    expect(invokeMock).toHaveBeenCalledWith("rewind_codex_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "user-2",
      targetUserTurnIndex: 2,
      targetUserMessageText: "1+1",
    });
  });

  it("rejects codex rewind when targetUserTurnIndex is invalid", async () => {
    const invokeMock = vi.mocked(invoke);

    await expect(rewindCodexThread("ws-9", "thread-9", 0, "user-2")).rejects.toThrow("targetUserTurnIndex must be >= 1 for codex rewind");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps optional messageId for fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkThread("ws-9", "thread-9", "msg-9");

    expect(invokeMock).toHaveBeenCalledWith("fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "msg-9",
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

    await forkClaudeSessionFromMessage("/tmp/project", "claude-session-1", "550e8400-e29b-41d4-a716-446655440000");

    expect(invokeMock).toHaveBeenCalledWith("fork_claude_session_from_message", {
      workspacePath: "/tmp/project",
      sessionId: "claude-session-1",
      messageId: "550e8400-e29b-41d4-a716-446655440000",
    });
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

  it("maps update git branch payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      branch: "feature/demo",
      status: "success",
      reason: null,
      message: "updated",
      worktreePath: null,
    });

    await updateGitBranch("ws-33", "feature/demo");

    expect(invokeMock).toHaveBeenCalledWith("update_git_branch", {
      workspaceId: "ws-33",
      branchName: "feature/demo",
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

    await readExternalSpecFile("ws-41", "/tmp/external-spec-root", "openspec/project.md");

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

    await readExternalAbsoluteFile("ws-41", "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md");

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

    await writeExternalSpecFile("ws-41", "/tmp/external-spec-root", "openspec/project.md", "# Project Context");

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

    await writeExternalAbsoluteFile("ws-41", "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md", "# Updated skill");

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
      resumeSource: null,
      resumeTurnId: null,
    });
  });

  it("forwards read-only access mode for claude plan flows", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "plan first", {
      accessMode: "read-only",
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "plan first",
      model: null,
      effort: null,
      accessMode: "read-only",
      images: null,
      preferredLanguage: null,
      resumeSource: null,
      resumeTurnId: null,
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
      resumeSource: null,
      resumeTurnId: null,
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
      threadId: null,
      turnId: null,
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
      threadId: null,
      turnId: null,
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

    await generateThreadTitle("ws-14", "thread-14", "Please fix login redirect loop", "zh");

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
    invokeMock.mockRejectedValueOnce(new Error("unknown method: detect_engines"));

    const statuses = await detectEngines();
    const codexStatus = statuses.find((entry) => entry.engineType === "codex");
    const claudeStatus = statuses.find((entry) => entry.engineType === "claude");

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

    expect(invokeMock).not.toHaveBeenCalledWith("engine_send_message", expect.anything());
    expect(response).toEqual({
      error: {
        message: "Web 服务当前仅支持 Codex CLI。请切换到 Codex CLI（Web service currently supports Codex CLI only）.",
      },
    });
  });

  it("invokes get_active_engine", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("claude");

    const engine = await getActiveEngine();

    expect(engine).toBe("claude");
    expect(invokeMock).toHaveBeenCalledWith("get_active_engine");
  });

  it("maps switch_engine params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await switchEngine("claude");

    expect(invokeMock).toHaveBeenCalledWith("switch_engine", {
      engineType: "claude",
    });
  });

  it("maps get_engine_status params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(null);

    const status = await getEngineStatus("claude");

    expect(status).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("get_engine_status", {
      engineType: "claude",
    });
  });

  it("maps get_engine_models params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    const models = await getEngineModels("claude");

    expect(models).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("get_engine_models", {
      engineType: "claude",
    });
  });

  it("maps get_engine_models force refresh params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    const models = await getEngineModels("claude", { forceRefresh: true });

    expect(models).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("get_engine_models", {
      engineType: "claude",
      forceRefresh: true,
    });
  });

  it("maps engine_interrupt params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await engineInterrupt("ws-interrupt");

    expect(invokeMock).toHaveBeenCalledWith("engine_interrupt", {
      workspaceId: "ws-interrupt",
    });
  });

  it("maps delete_claude_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteClaudeSession("/tmp/workspace", "claude-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_claude_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "claude-session-1",
    });
  });

  it("maps delete_gemini_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteGeminiSession("/tmp/workspace", "gemini-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_gemini_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "gemini-session-1",
    });
  });
});
