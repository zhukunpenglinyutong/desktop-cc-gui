// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, TurnPlan } from "../../../types";
import type { GovernanceEvidenceState } from "../../governance/evidence/useGovernanceEvidence";
import { StatusPanel } from "./StatusPanel";

const EMPTY_GOVERNANCE_EVIDENCE_STATE: GovernanceEvidenceState = {
  evidence: [],
  isLoading: false,
  error: null,
};

const mockUseGovernanceEvidence = vi.fn(
  (_workspaceId: string | null, _enabled: boolean): GovernanceEvidenceState =>
    EMPTY_GOVERNANCE_EVIDENCE_STATE,
);

const mockEditableDiffReviewSurface = vi.fn((props: Record<string, unknown>) => (
  <div data-testid="checkpoint-diff-viewer">
    {JSON.stringify({
      selectedPath: props.selectedPath,
      workspaceId: props.workspaceId,
      diffStyle: props.diffStyle,
    })}
  </div>
));

vi.mock("../../git/components/WorkspaceEditableDiffReviewSurface", () => ({
  WorkspaceEditableDiffReviewSurface: (props: Record<string, unknown>) =>
    mockEditableDiffReviewSurface(props),
}));
vi.mock("../../governance/evidence/useGovernanceEvidence", () => ({
  useGovernanceEvidence: (workspaceId: string | null, enabled: boolean) =>
    mockUseGovernanceEvidence(workspaceId, enabled),
}));

const editToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-edit-1",
  kind: "tool",
  turnId: "turn-1",
  toolType: "edit",
  title: "Edit file",
  detail: '{"path":"README.md"}',
  status: "completed",
  changes: [
    { path: "README.md", kind: "modify" },
    { path: "docs/EXECUTION_PLAN.md", kind: "modify" },
  ],
};

const rootScopedEditToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-edit-root",
  kind: "tool",
  turnId: "turn-1",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  changes: [
    { path: "root/README.md", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
  ],
};

const childScopedEditToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-edit-child",
  kind: "tool",
  turnId: "turn-1",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  changes: [
    { path: "child/App.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
  ],
};

const multiStatusEditToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-edit-statuses",
  kind: "tool",
  turnId: "turn-1",
  toolType: "fileChange",
  title: "File changes",
  detail: "{}",
  status: "completed",
  changes: [
    { path: "src/Added.tsx", kind: "added", diff: "@@ -0,0 +1 @@\n+const added = true;" },
    { path: "src/Removed.tsx", kind: "deleted", diff: "@@ -1 +0,0 @@\n-const removed = true;" },
    { path: "src/Renamed.tsx", kind: "renamed", diff: "@@ -1 +1 @@\n-oldName\n+newName" },
    { path: "src/Modified.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
  ],
};

const taskToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-task-1",
  kind: "tool",
  turnId: "turn-1",
  toolType: "task",
  title: "Tool: task",
  detail: '{"description":"review plan"}',
  status: "completed",
  output: "done",
};

const todoWriteToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-todo-1",
  kind: "tool",
  turnId: "turn-1",
  toolType: "unknown",
  title: "Tool: TodoWrite",
  detail: JSON.stringify({
    todos: [{ content: "review plan", status: "completed" }],
  }),
  status: "completed",
};

const claudeAgentToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "call_fa8bd06e774141c4a7f29a79",
  kind: "tool",
  turnId: "turn-1",
  toolType: "agent",
  title: "Tool: Agent",
  detail: '{"description":"Bug诊断与性能安全审查","subagent_type":"java-performance-engineer","taskId":"af452b1b615f93a9e"}',
  status: "completed",
  output: "done",
};

const collabSpawnToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "spawn-1",
  kind: "tool",
  turnId: "turn-1",
  toolType: "collabToolCall",
  title: "Collab: spawn_agent",
  detail: "From thread-root → agent-7",
  status: "completed",
  output: "Audit current panel",
  receiverThreadIds: ["agent-7"],
};

const collabWaitToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "wait-1",
  kind: "tool",
  turnId: "turn-1",
  toolType: "collabToolCall",
  title: "Collab: wait",
  detail: "From thread-root → agent-7",
  status: "completed",
  output: "Audit current panel\n\nagent-7: completed",
  receiverThreadIds: ["agent-7"],
  agentStatus: {
    "agent-7": { status: "completed" },
  },
};

const planSample: TurnPlan = {
  turnId: "turn-1",
  explanation: "plan",
  steps: [
    { step: "step 1", status: "completed" },
    { step: "step 2", status: "pending" },
  ],
};

const inProgressPlan: TurnPlan = {
  turnId: "turn-2",
  explanation: "plan",
  steps: [{ step: "step in progress", status: "inProgress" }],
};

const latestUserMessageItems: ConversationItem[] = [
  {
    id: "u1",
    kind: "message",
    role: "user",
    text: "第一条消息\n第二行\n第三行\n第四行\n第五行",
    images: ["diagram.png", "bug.png"],
  },
  {
    id: "a1",
    kind: "message",
    role: "assistant",
    text: "assistant",
  },
  {
    id: "u2",
    kind: "message",
    role: "user",
    text: "第二条用户消息",
  },
];

describe("StatusPanel", () => {
  afterEach(() => {
    cleanup();
    mockEditableDiffReviewSurface.mockClear();
    mockUseGovernanceEvidence.mockClear();
    mockUseGovernanceEvidence.mockReturnValue(EMPTY_GOVERNANCE_EVIDENCE_STATE);
  });

  it("opens editor when clicking file in checkpoint result panel", () => {
    const onOpenDiffPath = vi.fn();
    const onOpenFilePath = vi.fn();
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        onOpenDiffPath={onOpenDiffPath}
        onOpenFilePath={onOpenFilePath}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByText("README.md"));

    expect(onOpenFilePath).toHaveBeenCalledWith("README.md");
    expect(onOpenDiffPath).not.toHaveBeenCalled();
  });

  it("prefers current workspace git file changes over historical tool file changes", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        variant="dock"
        workspaceGitFiles={[
          { path: "src/WorkspaceOnly.tsx", status: "M", additions: 3, deletions: 1 },
        ]}
        workspaceGitTotals={{ additions: 3, deletions: 1 }}
        workspaceGitDiffs={[
          { path: "src/WorkspaceOnly.tsx", status: "M", diff: "@@ -1 +1 @@\n-old\n+new" },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.queryByText("README.md")).toBeNull();
    expect(screen.queryByText("docs/EXECUTION_PLAN.md")).toBeNull();
    expect(screen.getByText("WorkspaceOnly.tsx")).toBeTruthy();
  });

  it("clears historical file changes after workspace git changes are committed", () => {
    const { rerender } = render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        variant="dock"
        workspaceGitFiles={[
          { path: "src/WorkspaceOnly.tsx", status: "M", additions: 3, deletions: 1 },
        ]}
        workspaceGitTotals={{ additions: 3, deletions: 1 }}
        workspaceGitDiffs={[
          { path: "src/WorkspaceOnly.tsx", status: "M", diff: "@@ -1 +1 @@\n-old\n+new" },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.getByText("WorkspaceOnly.tsx")).toBeTruthy();

    rerender(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        variant="dock"
        workspaceGitFiles={[]}
        workspaceGitTotals={{ additions: 0, deletions: 0 }}
        workspaceGitDiffs={[]}
      />,
    );

    expect(screen.queryByText("WorkspaceOnly.tsx")).toBeNull();
    expect(screen.queryByText("README.md")).toBeNull();
    expect(screen.getByText("statusPanel.emptyFileChanges")).toBeTruthy();
  });

  it("keeps checkpoint diff modal available when workspace git files include diff bodies", async () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        variant="dock"
        workspaceId="ws-git"
        workspaceGitFiles={[
          { path: "src/WorkspaceOnly.tsx", status: "M", additions: 3, deletions: 1 },
        ]}
        workspaceGitTotals={{ additions: 3, deletions: 1 }}
        workspaceGitDiffs={[
          { path: "src/WorkspaceOnly.tsx", status: "M", diff: "@@ -1 +1 @@\n-old\n+new" },
        ]}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByLabelText("statusPanel.checkpoint.actions.reviewDiff"));

    await waitFor(() => {
      expect(screen.getByText("statusPanel.checkpoint.fileDetailsTitle")).toBeTruthy();
    });
  });

  it("filters checkpoint evidence to the active turn while processing", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-old-turn-change",
            kind: "tool",
            turnId: "turn-old",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [
              { path: "src/OldTurn.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+old" },
            ],
          },
          {
            id: "tool-running-turn-command",
            kind: "tool",
            turnId: "turn-new",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run lint",
            status: "running",
          },
        ]}
        isProcessing
        activeTurnId="turn-new"
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.queryByText("OldTurn.tsx")).toBeNull();
    expect(screen.getByText("statusPanel.checkpoint.headline.running")).toBeTruthy();
    expect(screen.getByText("statusPanel.checkpoint.summary.runningValidation")).toBeTruthy();
    expect(screen.getByText("statusPanel.checkpoint.validations.status.running")).toBeTruthy();
  });

  it("does not let old-turn command failures block the current checkpoint", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-old-turn-command-error",
            kind: "tool",
            turnId: "turn-old",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run test",
            status: "error",
          },
          {
            id: "tool-new-turn-command-running",
            kind: "tool",
            turnId: "turn-new",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run lint",
            status: "running",
          },
        ]}
        isProcessing
        activeTurnId="turn-new"
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.queryByText("statusPanel.checkpoint.headline.blocked")).toBeNull();
    expect(screen.getByText("statusPanel.checkpoint.headline.running")).toBeTruthy();
    expect(screen.getByText("statusPanel.checkpoint.summary.runningValidation")).toBeTruthy();
  });

  it("opens commit dialog from ready checkpoint and commits selected files", () => {
    const onCommit = vi.fn();
    const onCommitMessageChange = vi.fn();
    render(
      <StatusPanel
        items={[
          editToolItem,
          {
            id: "tool-lint-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run lint",
            status: "completed",
          },
          {
            id: "tool-typecheck-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run typecheck",
            status: "completed",
          },
          {
            id: "tool-test-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run test",
            status: "completed",
          },
        ]}
        isProcessing={false}
        variant="dock"
        workspacePath="/tmp/workspace"
        workspaceGitFiles={[
          { path: "README.md", status: "M", additions: 2, deletions: 1 },
          { path: "src/App.tsx", status: "M", additions: 5, deletions: 0 },
        ]}
        workspaceGitStagedFiles={[{ path: "README.md", status: "M", additions: 2, deletions: 1 }]}
        workspaceGitUnstagedFiles={[{ path: "src/App.tsx", status: "M", additions: 5, deletions: 0 }]}
        workspaceGitTotals={{ additions: 7, deletions: 1 }}
        commitMessage="feat: ready commit"
        onCommit={onCommit}
        onCommitMessageChange={onCommitMessageChange}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByText("statusPanel.checkpoint.actions.commit"));

    expect(screen.getByRole("dialog", { name: "statusPanel.checkpoint.commitDialog.title" })).toBeTruthy();
    expect(screen.getByText("/tmp/workspace")).toBeTruthy();
    expect(screen.getByDisplayValue("feat: ready commit")).toBeTruthy();
    fireEvent.change(screen.getByDisplayValue("feat: ready commit"), {
      target: { value: "feat: updated commit" },
    });
    expect(onCommitMessageChange).toHaveBeenCalledWith("feat: updated commit");
    fireEvent.click(screen.getAllByRole("checkbox", { name: "git.commitSelectionToggleFile" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "git.commit" }));

    expect(onCommit).toHaveBeenCalledWith(["README.md", "src/App.tsx"]);
  });

  it("toggles all selectable checkpoint commit files from the commit dialog header", () => {
    const onCommit = vi.fn();
    render(
      <StatusPanel
        items={[
          editToolItem,
          {
            id: "tool-lint-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run lint",
            status: "completed",
          },
          {
            id: "tool-typecheck-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run typecheck",
            status: "completed",
          },
          {
            id: "tool-test-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run test",
            status: "completed",
          },
        ]}
        isProcessing={false}
        variant="dock"
        workspaceGitFiles={[
          { path: "README.md", status: "M", additions: 2, deletions: 1 },
          { path: "src/App.tsx", status: "M", additions: 5, deletions: 0 },
        ]}
        workspaceGitStagedFiles={[{ path: "README.md", status: "M", additions: 2, deletions: 1 }]}
        workspaceGitUnstagedFiles={[{ path: "src/App.tsx", status: "M", additions: 5, deletions: 0 }]}
        workspaceGitTotals={{ additions: 7, deletions: 1 }}
        commitMessage="feat: ready commit"
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByText("statusPanel.checkpoint.actions.commit"));

    const toggleAllFiles = screen.getByRole("checkbox", {
      name: "statusPanel.checkpoint.commitDialog.toggleAllFiles",
    }) as HTMLInputElement;
    expect(toggleAllFiles.checked).toBe(false);
    expect(toggleAllFiles.indeterminate).toBe(true);

    fireEvent.click(toggleAllFiles);
    expect(toggleAllFiles.checked).toBe(true);
    expect(toggleAllFiles.indeterminate).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "git.commit" }));
    expect(onCommit).toHaveBeenLastCalledWith(["README.md", "src/App.tsx"]);
  });

  it("clears all selectable checkpoint commit files when the header checkbox is already checked", () => {
    const onCommit = vi.fn();
    render(
      <StatusPanel
        items={[
          editToolItem,
          {
            id: "tool-lint-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run lint",
            status: "completed",
          },
          {
            id: "tool-typecheck-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run typecheck",
            status: "completed",
          },
          {
            id: "tool-test-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run test",
            status: "completed",
          },
        ]}
        isProcessing={false}
        variant="dock"
        workspaceGitFiles={[
          { path: "README.md", status: "M", additions: 2, deletions: 1 },
          { path: "src/App.tsx", status: "M", additions: 5, deletions: 0 },
        ]}
        workspaceGitStagedFiles={[
          { path: "README.md", status: "M", additions: 2, deletions: 1 },
          { path: "src/App.tsx", status: "M", additions: 5, deletions: 0 },
        ]}
        workspaceGitUnstagedFiles={[]}
        workspaceGitTotals={{ additions: 7, deletions: 1 }}
        commitMessage="feat: ready commit"
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByText("statusPanel.checkpoint.actions.commit"));

    const toggleAllFiles = screen.getByRole("checkbox", {
      name: "statusPanel.checkpoint.commitDialog.toggleAllFiles",
    }) as HTMLInputElement;
    expect(toggleAllFiles.checked).toBe(true);

    fireEvent.click(toggleAllFiles);
    expect(toggleAllFiles.checked).toBe(false);
    expect((screen.getByRole("button", { name: "git.commit" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("generates commit message from selected checkpoint commit files", async () => {
    const onGenerateCommitMessage = vi.fn();
    render(
      <StatusPanel
        items={[
          editToolItem,
          {
            id: "tool-lint-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run lint",
            status: "completed",
          },
          {
            id: "tool-typecheck-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run typecheck",
            status: "completed",
          },
          {
            id: "tool-test-pass",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run test",
            status: "completed",
          },
        ]}
        isProcessing={false}
        variant="dock"
        workspaceGitFiles={[{ path: "README.md", status: "M", additions: 2, deletions: 1 }]}
        workspaceGitStagedFiles={[{ path: "README.md", status: "M", additions: 2, deletions: 1 }]}
        workspaceGitUnstagedFiles={[]}
        workspaceGitTotals={{ additions: 2, deletions: 1 }}
        onCommit={vi.fn()}
        onGenerateCommitMessage={onGenerateCommitMessage}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByText("statusPanel.checkpoint.actions.commit"));
    fireEvent.click(screen.getByRole("button", { name: "git.generateCommitMessage" }));
    const claudeGroup = screen
      .getByText("git.generateCommitMessageEngineClaude")
      .closest(".commit-message-generate-menu-group");
    expect(claudeGroup).toBeTruthy();
    fireEvent.click(
      within(claudeGroup as HTMLElement).getByRole("menuitem", {
        name: "git.generateCommitMessageChinese",
      }),
    );

    expect(onGenerateCommitMessage).not.toHaveBeenCalledWith("zh", "codex", ["README.md"]);
    await waitFor(() => {
      expect(onGenerateCommitMessage).toHaveBeenCalledWith("zh", "claude", ["README.md"]);
    });
  });

  it("keeps review diff visible when commit action is available before checkpoint is ready", () => {
    const onCommit = vi.fn();
    render(
      <StatusPanel
        items={[
          editToolItem,
          {
            id: "tool-lint-not-run",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run lint",
            status: "error",
          },
        ]}
        isProcessing={false}
        variant="dock"
        workspacePath="/tmp/workspace"
        workspaceGitFiles={[{ path: "README.md", status: "M", additions: 2, deletions: 1 }]}
        workspaceGitStagedFiles={[]}
        workspaceGitUnstagedFiles={[{ path: "README.md", status: "M", additions: 2, deletions: 1 }]}
        workspaceGitTotals={{ additions: 2, deletions: 1 }}
        commitMessage="fix: checkpoint commit"
        onCommit={onCommit}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    const nextActionSection = screen.getByText("statusPanel.checkpoint.nextActionTitle").closest("section");
    expect(nextActionSection?.textContent).toContain("statusPanel.checkpoint.actions.reviewDiff");
    const commitAction = screen.getByRole("button", {
      name: "statusPanel.checkpoint.actions.commit",
    }) as HTMLButtonElement;
    expect(commitAction.disabled).toBe(false);
    fireEvent.click(commitAction);

    expect(screen.getByRole("dialog", { name: "statusPanel.checkpoint.commitDialog.title" })).toBeTruthy();
  });

  it("downgrades custom command failures to needs_review instead of blocked", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-blocked-command",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: 'sed -n "1,220p" missing-file.ts',
            status: "error",
          },
        ]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.getByText("statusPanel.checkpoint.headline.needs_review")).toBeTruthy();
    expect(screen.getByText("statusPanel.checkpoint.summary.manual")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a wait-oriented hint for needs review once validations are no longer the primary follow-up", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-needs-review-files",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            turnId: "turn-1",
            changes: [
              { path: "src/App.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
            ],
          },
          {
            id: "tool-needs-review-command",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "echo changed files",
            status: "completed",
            turnId: "turn-1",
          },
        ]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.getByText("statusPanel.checkpoint.actions.hint.needs_review")).toBeTruthy();
  });

  it("renders inline policy audit rationale in the dock checkpoint panel", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-policy-audit",
            kind: "tool",
            toolType: "commandExecution",
            title: "Tool: Bash",
            detail: "npm run typecheck",
            status: "running",
            turnId: "turn-1",
          },
        ]}
        isProcessing
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    const auditDetails = screen.getByText("statusPanel.audit.title").closest("details");
    expect(auditDetails?.open).toBe(false);

    fireEvent.click(screen.getByText("statusPanel.audit.title"));

    expect(screen.getByText("corePolicy")).toBeTruthy();
    expect(screen.getByText("statusPanel.policy.verdict.running")).toBeTruthy();
    expect(screen.getByText("statusPanel.policy.corePolicy.running")).toBeTruthy();
  });

  it("renders read-only governance evidence in the dock checkpoint panel", () => {
    mockUseGovernanceEvidence.mockReturnValue({
      evidence: [
        {
          id: "openspec:tasks",
          source: "openspec",
          status: "warn",
          degraded: false,
          updatedAt: "1970-01-01T00:00:00.000Z",
          title: "OpenSpec tasks",
          summary: "1/2 task(s) complete.",
        },
      ],
      isLoading: false,
      error: null,
    });

    render(
      <StatusPanel
        workspaceId="ws-1"
        items={[editToolItem]}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(mockUseGovernanceEvidence).toHaveBeenCalledWith("ws-1", true);
    expect(screen.getByText("statusPanel.governance.title")).toBeTruthy();
    expect(screen.getByText("OpenSpec tasks")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /OpenSpec tasks/ })).toBeNull();
  });

  it("opens the original diff panel when clicking file row diff action", () => {
    const onOpenDiffPath = vi.fn();
    render(
      <StatusPanel
        items={[
          {
            id: "tool-checkpoint-row-diff",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [
              { path: "src/One.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
            ],
          },
        ]}
        isProcessing={false}
        variant="dock"
        workspaceId="ws-row-diff"
        onOpenDiffPath={onOpenDiffPath}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByLabelText("git.previewModalAction"));

    expect(onOpenDiffPath).toHaveBeenCalledWith("src/One.tsx");
    expect(mockEditableDiffReviewSurface).not.toHaveBeenCalled();
  });

  it("uses the first file with a real diff for the file-list review diff action", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-file-priority",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [
              { path: "src/SearchOnly.tsx", kind: "modified" },
              { path: "src/ActualDiff.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
            ],
          },
        ]}
        isProcessing={false}
        workspaceId="ws-review"
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByLabelText("statusPanel.checkpoint.actions.reviewDiff"));

    expect(mockEditableDiffReviewSurface.mock.lastCall?.[0]).toMatchObject({
      workspaceId: "ws-review",
      selectedPath: "src/ActualDiff.tsx",
    });
  });

  it("does not render redundant changed-file count in checkpoint evidence", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-checkpoint-summary",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [
              { path: "src/One.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
              { path: "src/Two.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-before\n+after" },
            ],
          },
        ]}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    const evidenceSection = screen.getByText("statusPanel.checkpoint.evidenceTitle").closest("section");
    expect(evidenceSection).not.toBeNull();
    expect(evidenceSection?.textContent).not.toContain(
      "statusPanel.checkpoint.evidence.filesChangedValue",
    );
    expect(screen.getByText("One.tsx")).toBeTruthy();
    expect(screen.getByText("Two.tsx")).toBeTruthy();
  });

  it("does not surface read-only search style file entries in checkpoint file changes", () => {
    render(
      <StatusPanel
        variant="dock"
        items={[
          {
            id: "tool-search-noise",
            kind: "tool",
            toolType: "search_query",
            title: "Tool: codex / search_query",
            detail: '{"q":"*Login*.java"}',
            status: "completed",
            changes: [{ path: "*Login*.java\"}", kind: "modified" }],
          },
          {
            id: "tool-real-change",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [{ path: "src/SecurityConfig.java", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" }],
          },
        ]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.queryByText('*Login*.java"}')).toBeNull();
    expect(screen.getByText("SecurityConfig.java")).toBeTruthy();
  });

  it("does not surface read-only batch-read file entries in checkpoint file changes", () => {
    render(
      <StatusPanel
        variant="dock"
        items={[
          {
            id: "tool-batch-read-noise",
            kind: "tool",
            toolType: "read_file",
            title: "Tool: read_file",
            detail: '{"path":"src/LoginResponse.java"}',
            status: "completed",
            changes: [
              { path: "src/LoginResponse.java", kind: "modified" },
              { path: "src/AppLoginResponse.java", kind: "modified" },
            ],
          },
          {
            id: "tool-real-change-2",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [{ path: "src/JwtUtil.java", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" }],
          },
        ]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.queryByText("LoginResponse.java")).toBeNull();
    expect(screen.queryByText("AppLoginResponse.java")).toBeNull();
    expect(screen.getByText("JwtUtil.java")).toBeTruthy();
  });

  it("keeps stack detection available without surfacing validation commands in needs-review mode", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-java-change",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [
              { path: "pom.xml", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
              {
                path: "src/main/java/com/example/DemoApplication.java",
                kind: "modified",
                diff: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          },
        ]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.queryByText("mvn test")).toBeNull();
    expect(screen.queryByText("mvn package")).toBeNull();
    expect(screen.queryByText("npm run lint")).toBeNull();
    expect(screen.queryByText("npm run typecheck")).toBeNull();
    expect(screen.getByText("statusPanel.checkpoint.actions.hint.needs_review")).toBeTruthy();
  });

  it("gives visible feedback when opening risks from checkpoint actions", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.queryByText("statusPanel.checkpoint.actions.openRisk")).toBeNull();
  });

  it("opens checkpoint diff modal with a file list sidebar", async () => {
    const onCreateCodeAnnotation = vi.fn();
    const codeAnnotations = [
      {
        id: "annotation-checkpoint",
        path: "src/One.tsx",
        lineRange: { startLine: 2, endLine: 2 },
        body: "review checkpoint diff",
        source: "modal-diff-view" as const,
      },
    ];
    render(
      <StatusPanel
        items={[
          {
            id: "tool-checkpoint-modal",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [
              { path: "src/One.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
              { path: "src/Two.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-before\n+after" },
            ],
          },
        ]}
        isProcessing={false}
        workspaceId="ws-1"
        variant="dock"
        onCreateCodeAnnotation={onCreateCodeAnnotation}
        codeAnnotations={codeAnnotations}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByLabelText("statusPanel.checkpoint.actions.reviewDiff"));

    expect(screen.getAllByText("One.tsx").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Two.tsx").length).toBeGreaterThan(0);
    await waitFor(() => {
      expect(screen.getByTestId("checkpoint-diff-viewer")).toBeTruthy();
    });
      expect(mockEditableDiffReviewSurface.mock.lastCall?.[0]).toMatchObject({
        workspaceId: "ws-1",
        selectedPath: "src/One.tsx",
        onCreateCodeAnnotation,
        codeAnnotations,
        codeAnnotationSurface: "modal-diff-view",
      });

    const sidebarButtons = document.querySelectorAll(".checkpoint-diff-sidebar-item");
    fireEvent.click(sidebarButtons[1] as HTMLButtonElement);
    await waitFor(() => {
      expect(mockEditableDiffReviewSurface.mock.lastCall?.[0]).toMatchObject({
        selectedPath: "src/Two.tsx",
      });
    });
  });

  it("normalizes absolute checkpoint diff paths before rendering the preview modal", async () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-checkpoint-absolute-path",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [
              {
                path: "/repo/src/SecurityConfig.java",
                kind: "modified",
                diff: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          },
        ]}
        isProcessing={false}
        workspaceId="ws-absolute"
        workspacePath="/repo"
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByLabelText("statusPanel.checkpoint.actions.reviewDiff"));

    await waitFor(() => {
      expect(mockEditableDiffReviewSurface.mock.lastCall?.[0]).toMatchObject({
        workspaceId: "ws-absolute",
        selectedPath: "src/SecurityConfig.java",
      });
    });
  });

  it("sidebar keeps added files but excludes non-change read noise", async () => {
    render(
      <StatusPanel
        items={[
          {
            id: "tool-mixed-change-list",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [
              { path: "src/Modified.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
              { path: "src/Added.tsx", kind: "added" },
            ],
          },
          {
            id: "tool-read-noise-3",
            kind: "tool",
            toolType: "read_file",
            title: "Tool: read_file",
            detail: '{"path":"src/Noise.tsx"}',
            status: "completed",
            changes: [{ path: "src/Noise.tsx", kind: "modified" }],
          },
        ]}
        isProcessing={false}
        workspaceId="ws-2"
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByLabelText("statusPanel.checkpoint.actions.reviewDiff"));

    const sidebarButtons = Array.from(document.querySelectorAll(".checkpoint-diff-sidebar-item"));
    expect(sidebarButtons).toHaveLength(2);
    expect(document.body.textContent).toContain("Modified.tsx");
    expect(document.body.textContent).toContain("Added.tsx");
    expect(document.body.textContent).not.toContain("Noise.tsx");
  });

  it("opens added files directly when no diff body is available", async () => {
    const onOpenDiffPath = vi.fn();
    render(
      <StatusPanel
        items={[
          {
            id: "tool-added-file",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            status: "completed",
            changes: [{ path: "src/NewFile.ts", kind: "added" }],
          },
        ]}
        isProcessing={false}
        onOpenDiffPath={onOpenDiffPath}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByLabelText("statusPanel.checkpoint.actions.reviewDiff"));

    await waitFor(() => {
      expect(onOpenDiffPath).toHaveBeenCalledWith("src/NewFile.ts");
    });
  });

  it("aggregates file changes from the active root subtree", () => {
    render(
      <StatusPanel
        items={[childScopedEditToolItem]}
        isProcessing={false}
        variant="dock"
        activeThreadId="child"
        itemsByThread={{
          root: [rootScopedEditToolItem],
          child: [childScopedEditToolItem],
        }}
        threadParentById={{ child: "root" }}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.getByText("README.md")).toBeTruthy();
    expect(screen.getByText("App.tsx")).toBeTruthy();
    expect(document.querySelectorAll(".sp-file-item")).toHaveLength(2);
  });

  it("renders semantic badge classes for add delete rename and modify entries", () => {
    const { container } = render(
      <StatusPanel
        items={[multiStatusEditToolItem]}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(
      screen.getByText("Added.tsx").closest(".sp-file-item")?.querySelector(".sp-file-badge")
        ?.className,
    ).toContain("sp-file-added");
    expect(
      screen.getByText("Removed.tsx").closest(".sp-file-item")?.querySelector(".sp-file-badge")
        ?.className,
    ).toContain("sp-file-deleted");
    expect(
      screen.getByText("Renamed.tsx").closest(".sp-file-item")?.querySelector(".sp-file-badge")
        ?.className,
    ).toContain("sp-file-renamed");
    expect(
      screen.getByText("Modified.tsx").closest(".sp-file-item")?.querySelector(".sp-file-badge")
        ?.className,
    ).toContain("sp-file-modified");
    expect(container.querySelectorAll(".sp-file-item")).toHaveLength(4);
  });

  it("shows plan tab with progress summary", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
      />,
    );

    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("does not reuse the latest assistant answer as checkpoint summary", () => {
    render(
      <StatusPanel
        items={[
          editToolItem,
          {
            id: "assistant-summary-1",
            kind: "message",
            role: "assistant",
            text: "Implemented the requested file changes and outlined the touched areas for review.",
          },
        ]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(
      screen.queryByText(
        "Implemented the requested file changes and outlined the touched areas for review.",
      ),
    ).toBeNull();
    expect(screen.getByText("statusPanel.checkpoint.summary.needsValidation")).toBeTruthy();
    expect(screen.queryByText("npm run lint")).toBeNull();
    expect(screen.queryByText("npm run typecheck")).toBeNull();
    expect(screen.queryByText("npm run test")).toBeNull();
    expect(screen.queryByText("statusPanel.checkpoint.evidence.runMissingGeneric")).toBeNull();
    expect(screen.getByText("statusPanel.checkpoint.actions.hint.needs_review")).toBeTruthy();
  });

  it("closes opened popover by Escape key", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.getByText("statusPanel.checkpoint.headline.needs_review")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("statusPanel.checkpoint.headline.needs_review")).toBeNull();
  });

  it("expands compact checkpoint result into dock and closes the popover", () => {
    const onExpandToDock = vi.fn();
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        onExpandToDock={onExpandToDock}
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    fireEvent.click(screen.getByText("statusPanel.checkpoint.expandToDock"));

    expect(onExpandToDock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("statusPanel.checkpoint.headline.needs_review")).toBeNull();
  });

  it("keeps policy audit out of the compact checkpoint popover", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        onExpandToDock={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.queryByText("statusPanel.audit.title")).toBeNull();
    expect(screen.getByText("statusPanel.checkpoint.expandToDock")).toBeTruthy();
  });

  it("keeps governance evidence out of the compact checkpoint popover", () => {
    render(
      <StatusPanel
        workspaceId="ws-1"
        items={[editToolItem]}
        isProcessing={false}
        onExpandToDock={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(mockUseGovernanceEvidence).toHaveBeenCalledWith("ws-1", false);
    expect(screen.queryByText("statusPanel.governance.title")).toBeNull();
  });

  it("does not render when expanded is false", () => {
    const { container } = render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        expanded={false}
      />,
    );
    expect(container.querySelector(".sp-root")).toBeNull();
  });

  it("shows only edits tab when expanded without status data", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={false}
      />,
    );
    expect(screen.getByText("Result")).toBeTruthy();
    expect(screen.queryByText("statusPanel.tabTodos")).toBeNull();
    expect(screen.queryByText("statusPanel.tabSubagents")).toBeNull();
  });

  it("shows edits and plan together without half split when todo and subagent are empty", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        variant="dock"
      />,
    );
    expect(screen.queryByText("statusPanel.tabTodos")).toBeNull();
    expect(screen.queryByText("statusPanel.tabSubagents")).toBeNull();
    const editTab = screen.getByText("Result").closest("button");
    const planTab = screen.getByText("Plan").closest("button");
    expect(editTab?.className).not.toContain("sp-tab-half");
    expect(planTab?.className).not.toContain("sp-tab-half");

    fireEvent.click(screen.getByText("Result"));
    expect(screen.getByText("README.md")).toBeTruthy();
    fireEvent.click(screen.getByText("Plan"));
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("shows codex activity tabs without inline plan tab", () => {
    render(
      <StatusPanel
        items={[editToolItem, taskToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        isCodexEngine
      />,
    );

    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabAgents")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
    expect(screen.queryByText("Plan")).toBeNull();
    const allTabs = document.querySelectorAll(".sp-tab-half");
    expect(allTabs.length).toBe(0);
  });

  it("renders dock variant with plan tab selected by default", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        variant="dock"
      />,
    );

    const dockRoot = document.querySelector(".sp-root--dock");
    expect(dockRoot).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("plan")).toBeTruthy();
    expect(screen.getByText("step 1")).toBeTruthy();
  });

  it("selects preferred checkpoint tab in dock variant", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        variant="dock"
        preferredDockTab="checkpoint"
        preferredDockTabRequestKey={1}
      />,
    );

    expect(screen.getByText("README.md")).toBeTruthy();
    expect(screen.queryByText("step 1")).toBeNull();
  });

  it("shows latest user message tab only in dock variant", () => {
    const { rerender } = render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    expect(screen.getByText("User Conversation")).toBeTruthy();

    rerender(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
      />,
    );

    expect(screen.queryByText("User Conversation")).toBeNull();
  });

  it("renders latest user message tab for codex dock threads without selecting it by default", () => {
    render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
        isCodexEngine
      />,
    );

    expect(screen.getByText("User Conversation")).toBeTruthy();
    expect(screen.getByText("Images: 2")).toBeTruthy();
  });

  it("keeps latest user message tab before edits for both codex and non-codex dock layouts", () => {
    const { rerender } = render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    let labels = Array.from(document.querySelectorAll(".sp-tabs--dock .sp-tab-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      "User Conversation",
      "Result",
    ]);

    rerender(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
        isCodexEngine
      />,
    );

    labels = Array.from(document.querySelectorAll(".sp-tabs--dock .sp-tab-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      "User Conversation",
      "Result",
    ]);
  });

  it("removes hidden dock tabs without clearing available panel data", () => {
    const { container } = render(
      <StatusPanel
        items={[...latestUserMessageItems, editToolItem]}
        isProcessing={false}
        variant="dock"
        visibleDockTabs={{
          subagent: false,
          checkpoint: false,
          latestUserMessage: false,
        }}
      />,
    );

    const labels = Array.from(document.querySelectorAll(".sp-tabs--dock .sp-tab-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([]);
    expect(container.querySelector(".sp-root--dock")).toBeNull();
    expect(screen.queryByText("Result")).toBeNull();
    expect(screen.queryByText("User Conversation")).toBeNull();
  });

  it("renders cost budget section in checkpoint panel when token usage is available", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        variant="dock"
        selectedEngine="codex"
        selectedModelId="gpt-5.4"
        activeThreadId="thread-cost"
        activeTokenUsage={{
          total: {
            totalTokens: 2000,
            inputTokens: 1200,
            cachedInputTokens: 200,
            outputTokens: 800,
            reasoningOutputTokens: 100,
          },
          last: {
            totalTokens: 2000,
            inputTokens: 1200,
            cachedInputTokens: 200,
            outputTokens: 800,
            reasoningOutputTokens: 100,
          },
          modelContextWindow: 200000,
        }}
      />,
    );

    fireEvent.click(screen.getByText("Result"));

    expect(screen.getByText("statusPanel.cost.title")).toBeTruthy();
    expect(screen.getByText("statusPanel.cost.session: $0.01")).toBeTruthy();
    expect(screen.getByText("statusPanel.cost.engine: codex")).toBeTruthy();
    expect(screen.getByText("statusPanel.cost.model: gpt-5.4")).toBeTruthy();
  });

  it("shows dock todo and subagent tabs again once status data exists", () => {
    render(
      <StatusPanel
        items={[todoWriteToolItem, collabSpawnToolItem, ...latestUserMessageItems]}
        isProcessing={false}
        variant="dock"
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        threadStatusById={{ "agent-7": { isProcessing: true } }}
      />,
    );

    const labels = Array.from(document.querySelectorAll(".sp-tabs--dock .sp-tab-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      "User Conversation",
      "statusPanel.tabTodos",
      "statusPanel.tabAgents",
      "Result",
    ]);
    expect(screen.getByText("1/1")).toBeTruthy();
    expect(screen.getByText("0/1")).toBeTruthy();
  });

  it("shows user conversation timeline in reverse chronological order with image summary", () => {
    render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("User Conversation"));

    const renderedMessages = screen.getAllByText(/用户消息|第一条消息/).map((node) => node.textContent);
    expect(renderedMessages[0]).toContain("第二条用户消息");
    expect(renderedMessages[1]).toContain("第一条消息");
    expect(screen.getByText("Images: 2")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("Expand")).toBeTruthy();
  });

  it("filters pseudo-user payloads out of the dock conversation timeline while keeping image-only turns", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "u-memory-only",
            kind: "message",
            role: "user",
            text: "<project-memory>\n[项目上下文] 已记录会话摘要\n</project-memory>\n",
          },
          {
            id: "u-image-only",
            kind: "message",
            role: "user",
            text: "",
            images: ["diagram.png"],
          },
          {
            id: "u-real",
            kind: "message",
            role: "user",
            text: "真实用户问题",
          },
        ]}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("User Conversation"));

    expect(screen.getByText("真实用户问题")).toBeTruthy();
    expect(screen.getByText("Images: 1")).toBeTruthy();
    expect(screen.queryByText(/\[项目上下文\]/)).toBeNull();
  });

  it("uses Codex user-message cleanup rules inside the dock conversation timeline", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "u-codex-wrapper",
            kind: "message",
            role: "user",
            text:
              "Collaboration mode: code. Do not ask the user follow-up questions.\n\nUser request: 真正的问题",
          },
        ]}
        isProcessing={false}
        variant="dock"
        isCodexEngine
      />,
    );

    fireEvent.click(screen.getByText("User Conversation"));

    expect(screen.getByText("真正的问题")).toBeTruthy();
    expect(screen.queryByText(/Collaboration mode:/)).toBeNull();
    expect(screen.getByText("#1")).toBeTruthy();
  });

  it("shows filtered user conversation turn count in the dock tab", () => {
    render(
      <StatusPanel
        items={[
          {
            id: "u-memory-only",
            kind: "message",
            role: "user",
            text: "<project-memory>\n[项目上下文] 已记录会话摘要\n</project-memory>\n",
          },
          {
            id: "u-image-only",
            kind: "message",
            role: "user",
            text: "",
            images: ["diagram.png"],
          },
          {
            id: "u-real",
            kind: "message",
            role: "user",
            text: "真实用户问题",
          },
        ]}
        isProcessing={false}
        variant="dock"
      />,
    );

    const userConversationTab = screen.getByText("User Conversation").closest("button");
    const turnCountNode = userConversationTab?.querySelector(".sp-tab-count");
    expect(turnCountNode).toBeTruthy();
    expect(turnCountNode?.textContent).toBe("2");
  });

  it("keeps the current dock tab active when a new user message arrives", () => {
    const { rerender } = render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.getByText("Result").closest("button")?.className).toContain(
      "sp-tab-active",
    );

    rerender(
      <StatusPanel
        items={[
          ...latestUserMessageItems,
          {
            id: "u3",
            kind: "message",
            role: "user",
            text: "新的问题",
          },
        ]}
        isProcessing={false}
        variant="dock"
      />,
    );

    expect(screen.getByText("Result").closest("button")?.className).toContain(
      "sp-tab-active",
    );
    expect(screen.queryByText("新的问题")).toBeNull();
  });

  it("updates latest user message preview when thread items change", () => {
    const { rerender } = render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("User Conversation"));
    expect(screen.getByText(/第一条消息/)).toBeTruthy();
    expect(screen.getByText("第二条用户消息")).toBeTruthy();

    rerender(
      <StatusPanel
        items={[
          {
            id: "u-thread-2",
            kind: "message",
            role: "user",
            text: "thread 2 latest",
          },
        ]}
        isProcessing={false}
        variant="dock"
      />,
    );

    expect(screen.getByText("thread 2 latest")).toBeTruthy();
    expect(screen.queryByText(/第一条消息/)).toBeNull();
  });

  it("converges deferred status panel content to the latest streaming snapshot", () => {
    const { rerender } = render(
      <StatusPanel
        items={[todoWriteToolItem]}
        isProcessing={false}
        isCodexEngine
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabTodos"));
    expect(screen.getByText("review plan")).toBeTruthy();

    rerender(
      <StatusPanel
        items={[
          {
            ...todoWriteToolItem,
            id: "tool-todo-2",
            detail: JSON.stringify({
              todos: [{ content: "new streaming todo", status: "in_progress" }],
            }),
          },
        ]}
        isProcessing
        isCodexEngine
        variant="dock"
      />,
    );

    expect(screen.getByText("new streaming todo")).toBeTruthy();

    rerender(
      <StatusPanel
        items={[
          {
            ...todoWriteToolItem,
            id: "tool-todo-2",
            detail: JSON.stringify({
              todos: [{ content: "new streaming todo", status: "in_progress" }],
            }),
          },
        ]}
        isProcessing={false}
        isCodexEngine
        variant="dock"
      />,
    );

    expect(screen.getByText("new streaming todo")).toBeTruthy();
  });

  it("emits message jump when clicking a user conversation timeline item action", () => {
    const onJumpToConversationMessage = vi.fn();

    render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
        onJumpToConversationMessage={onJumpToConversationMessage}
      />,
    );

    fireEvent.click(screen.getByText("User Conversation"));
    fireEvent.click(screen.getAllByText("Jump to message")[0]);

    expect(onJumpToConversationMessage).toHaveBeenCalledWith("u2");
  });

  it("keeps dock tab content visible when clicking the active tab again", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("Result"));
    expect(screen.getByText("README.md")).toBeTruthy();
    fireEvent.click(screen.getByText("Result"));
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("hides dock plan tab for codex threads and keeps plan steps in todo", () => {
    render(
      <StatusPanel
        items={[taskToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        isCodexEngine
        variant="dock"
      />,
    );

    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabTodos"));
    expect(screen.getByText("step 1")).toBeTruthy();
    expect(screen.getByText("step 2")).toBeTruthy();
  });

  it("keeps codex status panel visible even when only plan data exists", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        plan={planSample}
        isPlanMode={false}
        isCodexEngine
      />,
    );

    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy();
    expect(screen.queryByText("statusPanel.tabAgents")).toBeNull();
    expect(screen.queryByText("Plan")).toBeNull();
  });

  it("renders plan steps inside codex todo tab", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        plan={planSample}
        isPlanMode={false}
        isCodexEngine
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabTodos"));
    expect(screen.getByText("step 1")).toBeTruthy();
    expect(screen.getByText("step 2")).toBeTruthy();
  });

  it("hides zero-state tabs when there is no status data", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        isCodexEngine
      />,
    );

    expect(screen.getByText("Result")).toBeTruthy();
    expect(screen.queryByText("statusPanel.tabTodos")).toBeNull();
    expect(screen.queryByText("statusPanel.tabAgents")).toBeNull();
    expect(screen.queryByText("0/0")).toBeNull();
  });

  it("aggregates collab agents from the current root subtree", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={true}
        isCodexEngine
        activeThreadId="agent-7"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        threadStatusById={{ "agent-7": { isProcessing: true } }}
      />,
    );

    expect(screen.getByText("0/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("agent-7")).toBeTruthy();
    expect(screen.getByText("Audit current panel")).toBeTruthy();
  });

  it("does not mark idle child threads as completed without wait facts", () => {
    const { container } = render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        threadStatusById={{ "agent-7": { isProcessing: false } }}
      />,
    );

    expect(screen.getByText("0/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("agent-7")).toBeTruthy();
    expect(container.querySelector(".sp-subagent-running")).toBeTruthy();
  });

  it("settles idle child threads with historical assistant output as completed", () => {
    const { container } = render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem],
          "agent-7": [
            {
              id: "agent-7-final",
              kind: "message",
              role: "assistant",
              text: "分析完成，已整理结论。",
              isFinal: true,
            },
          ],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        threadStatusById={{ "agent-7": { isProcessing: false } }}
      />,
    );

    expect(screen.getByText("1/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("agent-7")).toBeTruthy();
    expect(container.querySelector(".sp-subagent-completed")).toBeTruthy();
  });

  it("uses collab wait facts to mark agent completion", () => {
    const { container } = render(
      <StatusPanel
        items={[collabSpawnToolItem, collabWaitToolItem]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem, collabWaitToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
      />,
    );

    expect(screen.getByText("1/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("agent-7")).toBeTruthy();
    expect(container.querySelector(".sp-subagent-completed")).toBeTruthy();
  });

  it("parses verbose text statuses without leaking them into descriptions", () => {
    const verboseWaitToolItem: Extract<ConversationItem, { kind: "tool" }> = {
      ...collabWaitToolItem,
      id: "wait-verbose-1",
      agentStatus: undefined,
      output: "Audit current panel\n\nagent-7: completed (cached after wait)",
    };

    const { container } = render(
      <StatusPanel
        items={[collabSpawnToolItem, verboseWaitToolItem]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem, verboseWaitToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
      />,
    );

    expect(screen.getByText("1/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("Audit current panel")).toBeTruthy();
    expect(screen.queryByText("agent-7: completed (cached after wait)")).toBeNull();
    expect(container.querySelector(".sp-subagent-completed")).toBeTruthy();
  });

  it("downgrades codex in-progress plan steps when thread is idle", () => {
    const { container } = render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        plan={inProgressPlan}
        isPlanMode={false}
        isCodexEngine
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabTodos"));
    expect(screen.getByText("step in progress")).toBeTruthy();
    expect(container.querySelector(".sp-todo-in_progress")).toBeNull();
    expect(container.querySelector(".sp-todo-pending")).toBeTruthy();
  });

  it("emits codex thread navigation targets when clicking subagents", () => {
    const onSelectSubagent = vi.fn();

    render(
      <StatusPanel
        items={[collabSpawnToolItem, collabWaitToolItem]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem, collabWaitToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        onSelectSubagent={onSelectSubagent}
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    fireEvent.click(screen.getByText("Audit current panel"));

    expect(onSelectSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "agent-7",
        navigationTarget: {
          kind: "thread",
          threadId: "agent-7",
        },
      }),
    );
  });

  it("emits claude task navigation targets when clicking subagents", () => {
    const onSelectSubagent = vi.fn();

    render(
      <StatusPanel
        items={[claudeAgentToolItem]}
        isProcessing={false}
        onSelectSubagent={onSelectSubagent}
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabSubagents"));
    fireEvent.click(screen.getByText("Bug诊断与性能安全审查"));

    expect(onSelectSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "call_fa8bd06e774141c4a7f29a79",
        navigationTarget: {
          kind: "claude-task",
          taskId: "af452b1b615f93a9e",
          toolUseId: "call_fa8bd06e774141c4a7f29a79",
        },
      }),
    );
  });

  it("does not crash when restored tool items miss runtime string fields", () => {
    const malformedAgentTool = {
      id: "malformed-agent",
      kind: "tool",
      toolType: "agent",
      detail: "{}",
      status: "completed",
    } as unknown as ConversationItem;
    const malformedCommandTool = {
      id: "malformed-command",
      kind: "tool",
      toolType: "commandExecution",
      status: "completed",
    } as unknown as ConversationItem;

    expect(() =>
      render(
        <StatusPanel
          items={[malformedAgentTool, malformedCommandTool]}
          isProcessing={false}
        />,
      ),
    ).not.toThrow();
  });
});
