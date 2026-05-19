import type { ConversationItem } from "../../../types";
import type { GovernanceEvidenceSnapshot } from "../../governance/evidence";
import type {
  CheckpointAction,
  CheckpointKeyChange,
  CheckpointMessageToken,
  CheckpointRisk,
  CheckpointValidationEvidence,
  CheckpointValidationKind,
  CheckpointValidationStatus,
  CheckpointViewModel,
  CommandSummary,
  FileChangeSummary,
  SubagentInfo,
  TodoItem,
} from "../types";
import { evaluatePolicyChain } from "./policies";

const DISPLAY_VALIDATION_KINDS = ["lint", "typecheck", "tests", "build"] as const;
const CHECKPOINT_ACTION_LIMIT = 3;
const CHECKPOINT_SUMMARY_MAX_LENGTH = 180;
const POSITIVE_SUMMARY_HINT =
  /\b(all checks passed|checks passed|verified|ready to commit|safe to commit|successfully verified)\b|全部通过|已验证|验证通过|可提交|准备好提交/i;

type CheckpointValidationProjectKind =
  | "javascript"
  | "java_maven"
  | "java_gradle"
  | "java"
  | "python"
  | "go"
  | "rust"
  | "dotnet"
  | "generic";

export interface CheckpointValidationProfile {
  visibleKinds: readonly CheckpointValidationKind[];
  requiredKinds: readonly CheckpointValidationKind[];
  commands: Partial<Record<CheckpointValidationKind, string>>;
}

const CHECKPOINT_VALIDATION_PROFILES: Record<
  CheckpointValidationProjectKind,
  CheckpointValidationProfile
> = {
  javascript: {
    visibleKinds: ["lint", "typecheck", "tests", "build"],
    requiredKinds: ["lint", "typecheck", "tests"],
    commands: {
      lint: "npm run lint",
      typecheck: "npm run typecheck",
      tests: "npm run test",
      build: "npm run build",
    },
  },
  java_maven: {
    visibleKinds: ["tests", "build"],
    requiredKinds: ["tests", "build"],
    commands: {
      tests: "mvn test",
      build: "mvn package",
    },
  },
  java_gradle: {
    visibleKinds: ["tests", "build"],
    requiredKinds: ["tests", "build"],
    commands: {
      tests: "gradle test",
      build: "gradle build",
    },
  },
  java: {
    visibleKinds: ["tests", "build"],
    requiredKinds: ["tests"],
    commands: {
      tests: "mvn test",
    },
  },
  python: {
    visibleKinds: ["lint", "tests"],
    requiredKinds: ["tests"],
    commands: {
      tests: "pytest",
    },
  },
  go: {
    visibleKinds: ["tests", "build"],
    requiredKinds: ["tests"],
    commands: {
      tests: "go test ./...",
      build: "go build ./...",
    },
  },
  rust: {
    visibleKinds: ["tests", "build"],
    requiredKinds: ["tests"],
    commands: {
      tests: "cargo test",
      build: "cargo build",
    },
  },
  dotnet: {
    visibleKinds: ["tests", "build"],
    requiredKinds: ["tests"],
    commands: {
      tests: "dotnet test",
      build: "dotnet build",
    },
  },
  generic: {
    visibleKinds: ["tests"],
    requiredKinds: ["tests"],
    commands: {},
  },
};

type BuildCheckpointViewModelInput = {
  todos: TodoItem[];
  subagents: SubagentInfo[];
  fileChanges: FileChangeSummary[];
  commands: CommandSummary[];
  isProcessing: boolean;
  generatedSummary?: CheckpointGeneratedSummary | null;
  canonicalFileFacts?: FileChangeSummary[] | null;
  governanceSnapshot?: GovernanceEvidenceSnapshot | null;
};

export interface CheckpointGeneratedSummary {
  text: string;
  sourceId: string;
}

export function buildCheckpointViewModel(
  input: BuildCheckpointViewModelInput,
): CheckpointViewModel {
  const {
    canonicalFileFacts = null,
    commands,
    fileChanges: rawFileChanges,
    generatedSummary = null,
    governanceSnapshot = null,
    isProcessing,
    subagents,
    todos,
  } = input;
  const fileChanges = canonicalFileFacts ?? rawFileChanges;

  const totalAdditions = fileChanges.reduce((total, item) => total + item.additions, 0);
  const totalDeletions = fileChanges.reduce((total, item) => total + item.deletions, 0);
  const validationProfile = resolveCheckpointValidationProfile({ commands, fileChanges });
  const validations = buildValidationEvidence({
    commands,
    hasFileChanges: fileChanges.length > 0,
    profile: validationProfile,
  });
  const latestCommand = commands.at(-1) ?? null;
  const failedCommand = [...commands].reverse().find((entry) => entry.status === "error") ?? null;
  const failedValidation = validations.find((entry) => entry.status === "fail") ?? null;
  const runningValidation = validations.find((entry) => entry.status === "running") ?? null;
  const hasMissingCoreValidation = validations.some(
    (entry) =>
      validationProfile.requiredKinds.includes(entry.kind) &&
      entry.status === "not_run",
  );
  const todoCompleted = todos.filter((item) => item.status === "completed").length;
  const hasInProgressTodo = todos.some((item) => item.status === "in_progress");
  const hasPendingTodo = todos.some((item) => item.status === "pending");
  const subagentCompleted = subagents.filter((item) => item.status === "completed").length;
  const hasRunningSubagent = subagents.some((item) => item.status === "running");
  const failedSubagent = subagents.find((item) => item.status === "error") ?? null;
  const hasRunningCommand = commands.some((item) => item.status === "running");
  const hasEvidence =
    fileChanges.length > 0 || commands.length > 0 || todos.length > 0 || subagents.length > 0;
  const hasCompletedTodoSet = todos.length > 0 && !hasInProgressTodo && !hasPendingTodo;
  const hasCompletedSubagentSet =
    subagents.length > 0 && !hasRunningSubagent && subagentCompleted === subagents.length;
  const hasSuccessfulCommand = commands.some((item) => item.status === "completed");
  const hasReadyValidations =
    fileChanges.length > 0 &&
    validations
      .filter((entry) =>
        validationProfile.requiredKinds.includes(entry.kind),
      )
      .every((entry) => entry.status === "pass");

  const risks = buildRisks({
    failedCommand,
    failedSubagent,
    failedValidation,
    fileChanges,
    hasEvidence,
    hasMissingCoreValidation,
  });

  const failedCommandKind = failedCommand
    ? classifyValidationKind(failedCommand.command)
    : null;
  const policyEvidence = {
    failedCommand,
    failedCommandKind,
    failedSubagent,
    failedValidation,
    fileChanges,
    governanceSnapshot,
    hasCompletedSubagentSet,
    hasCompletedTodoSet,
    hasEvidence,
    hasReadyValidations,
    hasRunningCommand,
    hasRunningSubagent,
    hasSuccessfulCommand,
    hasInProgressTodo,
    isProcessing,
    requiredKinds: validationProfile.requiredKinds,
    validations,
  };
  const policyResult = evaluatePolicyChain(policyEvidence);
  const verdict = policyResult.verdict;

  const headline = buildHeadline(verdict, hasEvidence);
  const fallbackSummary = buildDeterministicSummary({
    verdict,
    failedCommand,
    failedSubagent,
    failedValidation,
    fileChanges,
    hasEvidence,
    hasInProgressTodo,
    hasMissingCoreValidation,
    hasRunningCommand,
    hasRunningSubagent,
    isProcessing,
    latestCommand,
    runningValidation,
  });
  const summaryResolution = resolveSummary({
    generatedSummary,
    risks,
    verdict,
    fallbackSummary,
  });
  const keyChanges = buildKeyChanges({
    commands,
    fileChanges,
    subagentCompleted,
    subagents,
    todoCompleted,
    todos,
    totalAdditions,
    totalDeletions,
  });
  const nextActions = buildNextActions({
    fileChanges,
    latestCommand,
    risks,
    verdict,
  });

  return {
    verdict,
    headline,
    summary: summaryResolution.summary,
    policyAudit: policyResult.decisions,
    evidence: {
      changedFiles: fileChanges.length,
      additions: totalAdditions,
      deletions: totalDeletions,
      validations,
      commands,
      todos:
        todos.length > 0
          ? {
              completed: todoCompleted,
              total: todos.length,
              hasInProgress: hasInProgressTodo,
            }
          : null,
      subagents:
        subagents.length > 0
          ? {
              completed: subagentCompleted,
              total: subagents.length,
              hasRunning: hasRunningSubagent,
            }
          : null,
    },
    keyChanges,
    risks,
    nextActions,
    sources: buildSources({
      commands,
      fileChanges,
      generatedSummarySourceId: summaryResolution.sourceId,
      subagents,
      todos,
      validations,
    }),
  };
}

const SUMMARY_HEADING_PATTERN = /^##\s*(Summary|总结|摘要)\s*$/im;

export function resolveCheckpointGeneratedSummary(
  items: ConversationItem[],
): CheckpointGeneratedSummary | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }

    if (item.kind === "review" && item.state === "completed") {
      const text = normalizeGeneratedSummaryText(item.text);
      if (text) {
        return {
          text,
          sourceId: item.id,
        };
      }
    }
  }

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }

    if (
      item.kind === "message" &&
      item.role === "assistant"
    ) {
      const match = SUMMARY_HEADING_PATTERN.exec(item.text);
      if (match) {
        const afterHeading = item.text.slice(
          match.index + match[0].length,
        );
        const paragraph = afterHeading.split(/\n\n|$/)[0];
        const text = normalizeGeneratedSummaryText(paragraph);
        if (text) {
          return {
            text,
            sourceId: item.id,
          };
        }
      }
    }
  }

  return null;
}

export function resolveCheckpointValidationProfile(input: {
  commands: CommandSummary[];
  fileChanges: FileChangeSummary[];
}) {
  const projectKind = inferValidationProjectKind(input);
  return CHECKPOINT_VALIDATION_PROFILES[projectKind];
}

function buildValidationEvidence(input: {
  commands: CommandSummary[];
  hasFileChanges: boolean;
  profile: CheckpointValidationProfile;
}): CheckpointValidationEvidence[] {
  return DISPLAY_VALIDATION_KINDS.map((kind) => {
    const matchingCommands = input.commands.filter(
      (entry) => classifyValidationKind(entry.command) === kind,
    );
    const latest = matchingCommands.at(-1) ?? null;
    const status = deriveValidationStatus({
      command: latest,
      hasFileChanges: input.hasFileChanges,
      kind,
      profile: input.profile,
    });
    return {
      kind,
      status,
      sourceId: latest?.id ?? null,
    };
  });
}

function deriveValidationStatus(input: {
  kind: CheckpointValidationKind;
  command: CommandSummary | null;
  hasFileChanges: boolean;
  profile: CheckpointValidationProfile;
}): CheckpointValidationStatus {
  if (!input.command) {
    if (!input.hasFileChanges || !input.profile.visibleKinds.includes(input.kind)) {
      return "not_observed";
    }
    return input.profile.requiredKinds.includes(input.kind) ? "not_run" : "not_observed";
  }
  if (input.command.status === "error") {
    return "fail";
  }
  if (input.command.status === "running") {
    return "running";
  }
  return "pass";
}

function classifyValidationKind(command: string): CheckpointValidationKind {
  const normalized = command.trim().toLowerCase();
  if (
    normalized.includes("typecheck") ||
    normalized.includes("type-check") ||
    normalized === "tsc" ||
    normalized.includes("tsc --noemit")
  ) {
    return "typecheck";
  }
  if (
    normalized.includes("vitest") ||
    normalized.includes("jest") ||
    normalized.includes("pytest") ||
    normalized.includes("cargo test") ||
    normalized.includes("go test") ||
    normalized.includes("mvn test") ||
    normalized.includes("gradle test") ||
    normalized.includes("dotnet test") ||
    normalized.includes("test") ||
    normalized.includes("spec")
  ) {
    return "tests";
  }
  if (
    normalized.includes("eslint") ||
    normalized.includes("stylelint") ||
    normalized.includes("lint")
  ) {
    return "lint";
  }
  if (
    normalized.includes("build") ||
    normalized.includes("mvn package") ||
    normalized.includes("mvn verify") ||
    normalized.includes("mvn install") ||
    normalized.includes("gradle assemble") ||
    normalized.includes("cargo build") ||
    normalized.includes("go build") ||
    normalized.includes("dotnet build") ||
    normalized.includes("rollup") ||
    normalized.includes("webpack") ||
    normalized.includes("vite")
  ) {
    return "build";
  }
  return "custom";
}

function inferValidationProjectKind(input: {
  commands: CommandSummary[];
  fileChanges: FileChangeSummary[];
}): CheckpointValidationProjectKind {
  const evidenceText = [
    ...input.fileChanges.map((entry) => entry.filePath),
    ...input.commands.map((entry) => entry.command),
  ]
    .join("\n")
    .toLowerCase();

  if (/\b(pom\.xml|mvnw?|maven)\b/.test(evidenceText)) {
    return "java_maven";
  }
  if (/\b(build\.gradle|settings\.gradle|gradlew?|gradle)\b/.test(evidenceText)) {
    return "java_gradle";
  }
  if (/\.(java|kt)\b/.test(evidenceText)) {
    return "java";
  }
  if (/\b(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|tsconfig\.json|vite\.config|webpack\.config)\b/.test(evidenceText) || /\.(tsx?|jsx?)\b/.test(evidenceText)) {
    return "javascript";
  }
  if (/\b(pyproject\.toml|requirements\.txt|poetry\.lock|pytest\.ini)\b/.test(evidenceText) || /\.py\b/.test(evidenceText)) {
    return "python";
  }
  if (/\bgo\.mod\b/.test(evidenceText) || /\.go\b/.test(evidenceText)) {
    return "go";
  }
  if (/\bcargo\.toml\b/.test(evidenceText) || /\.rs\b/.test(evidenceText)) {
    return "rust";
  }
  if (/\.(csproj|sln|cs)\b/.test(evidenceText)) {
    return "dotnet";
  }
  return "generic";
}

function buildRisks(input: {
  failedCommand: CommandSummary | null;
  failedSubagent: SubagentInfo | null;
  failedValidation: CheckpointValidationEvidence | null;
  fileChanges: FileChangeSummary[];
  hasEvidence: boolean;
  hasMissingCoreValidation: boolean;
}): CheckpointRisk[] {
  const risks: CheckpointRisk[] = [];

  if (input.failedValidation) {
    risks.push({
      code: "validation_failed",
      severity: "high",
      message: {
        key: "statusPanel.checkpoint.risks.validationFailed",
      },
      sourceId: input.failedValidation.sourceId,
    });
  }

  if (input.failedCommand) {
    risks.push({
      code: "command_failed",
      severity: "high",
      message: {
        key: "statusPanel.checkpoint.risks.commandFailed",
        params: { command: truncateCommand(input.failedCommand.command) },
      },
      sourceId: input.failedCommand.id,
    });
  }

  if (input.failedSubagent) {
    risks.push({
      code: "subagent_error",
      severity: "high",
      message: {
        key: "statusPanel.checkpoint.risks.subagentError",
        params: { agent: input.failedSubagent.type },
      },
      sourceId: input.failedSubagent.id,
    });
  }

  if (input.fileChanges.length > 0 && input.hasMissingCoreValidation) {
    risks.push({
      code: "validation_missing",
      severity: "medium",
      message: {
        key: "statusPanel.checkpoint.risks.validationMissing",
      },
      sourceId: input.fileChanges[0]?.filePath ?? null,
    });
  }

  if (!input.hasEvidence) {
    risks.push({
      code: "manual_review",
      severity: "low",
      message: {
        key: "statusPanel.checkpoint.risks.manualReview",
      },
      sourceId: null,
    });
  }

  return risks;
}

function buildHeadline(
  verdict: CheckpointViewModel["verdict"],
  hasEvidence: boolean,
): CheckpointMessageToken {
  if (verdict === "needs_review" && !hasEvidence) {
    return { key: "statusPanel.checkpoint.headline.idle" };
  }
  return {
    key: `statusPanel.checkpoint.headline.${verdict}`,
  };
}

function buildDeterministicSummary(input: {
  verdict: CheckpointViewModel["verdict"];
  failedCommand: CommandSummary | null;
  failedSubagent: SubagentInfo | null;
  failedValidation: CheckpointValidationEvidence | null;
  fileChanges: FileChangeSummary[];
  hasEvidence: boolean;
  hasInProgressTodo: boolean;
  hasMissingCoreValidation: boolean;
  hasRunningCommand: boolean;
  hasRunningSubagent: boolean;
  isProcessing: boolean;
  latestCommand: CommandSummary | null;
  runningValidation: CheckpointValidationEvidence | null;
}): CheckpointMessageToken | null {
  switch (input.verdict) {
    case "blocked":
      if (input.failedValidation) {
        return { key: "statusPanel.checkpoint.summary.blockedValidation" };
      }
      if (input.failedCommand) {
        return {
          key: "statusPanel.checkpoint.summary.blockedCommand",
          params: { command: truncateCommand(input.failedCommand.command) },
        };
      }
      if (input.failedSubagent) {
        return { key: "statusPanel.checkpoint.summary.blockedSubagent" };
      }
      return { key: "statusPanel.checkpoint.summary.manual" };
    case "running":
      if (input.runningValidation) {
        return { key: "statusPanel.checkpoint.summary.runningValidation" };
      }
      if (input.hasRunningCommand && input.latestCommand) {
        return {
          key: "statusPanel.checkpoint.summary.runningCommand",
          params: { command: truncateCommand(input.latestCommand.command) },
        };
      }
      if (input.hasRunningSubagent) {
        return { key: "statusPanel.checkpoint.summary.runningAgent" };
      }
      if (input.hasInProgressTodo) {
        return { key: "statusPanel.checkpoint.summary.runningTodo" };
      }
      if (input.isProcessing) {
        return { key: "statusPanel.checkpoint.summary.runningProcessing" };
      }
      return { key: "statusPanel.checkpoint.summary.runningProcessing" };
    case "ready":
      if (input.fileChanges.length > 0) {
        return {
          key: "statusPanel.checkpoint.summary.readyWithFiles",
          params: { count: input.fileChanges.length },
        };
      }
      return { key: "statusPanel.checkpoint.summary.ready" };
    case "needs_review":
      if (!input.hasEvidence) {
        return { key: "statusPanel.checkpoint.summary.idle" };
      }
      if (input.fileChanges.length > 0 && input.hasMissingCoreValidation) {
        return { key: "statusPanel.checkpoint.summary.needsValidation" };
      }
      return { key: "statusPanel.checkpoint.summary.manual" };
    default:
      return null;
  }
}

function resolveSummary(input: {
  generatedSummary: CheckpointGeneratedSummary | null;
  risks: CheckpointRisk[];
  verdict: CheckpointViewModel["verdict"];
  fallbackSummary: CheckpointMessageToken | null;
}): {
  summary: CheckpointMessageToken | null;
  sourceId: string | null;
} {
  if (shouldUseGeneratedSummary(input.generatedSummary, input.verdict, input.risks)) {
    return {
      summary: {
        text: input.generatedSummary.text,
      },
      sourceId: input.generatedSummary.sourceId,
    };
  }

  return {
    summary: input.fallbackSummary,
    sourceId: null,
  };
}

function shouldUseGeneratedSummary(
  generatedSummary: CheckpointGeneratedSummary | null,
  verdict: CheckpointViewModel["verdict"],
  risks: CheckpointRisk[],
): generatedSummary is CheckpointGeneratedSummary {
  if (!generatedSummary) {
    return false;
  }
  if (verdict === "blocked") {
    return false;
  }
  if (risks.some((entry) => entry.severity === "high")) {
    return false;
  }
  if (hasUnsettledEvidence(verdict, risks) && POSITIVE_SUMMARY_HINT.test(generatedSummary.text)) {
    return false;
  }
  return true;
}

function hasUnsettledEvidence(
  verdict: CheckpointViewModel["verdict"],
  risks: CheckpointRisk[],
) {
  return verdict !== "ready" || risks.some((entry) => entry.severity !== "low");
}

function buildKeyChanges(input: {
  commands: CommandSummary[];
  fileChanges: FileChangeSummary[];
  subagentCompleted: number;
  subagents: SubagentInfo[];
  todoCompleted: number;
  todos: TodoItem[];
  totalAdditions: number;
  totalDeletions: number;
}): CheckpointKeyChange[] {
  const result: CheckpointKeyChange[] = [];

  if (input.fileChanges.length > 0) {
    result.push({
      id: "files",
      label: { key: "statusPanel.checkpoint.keyChanges.files" },
      summary: {
        key: "statusPanel.checkpoint.keyChanges.filesSummary",
        params: {
          count: input.fileChanges.length,
          additions: input.totalAdditions,
          deletions: input.totalDeletions,
        },
      },
      fileCount: input.fileChanges.length,
    });
  }

  if (input.todos.length > 0) {
    result.push({
      id: "tasks",
      label: { key: "statusPanel.checkpoint.keyChanges.tasks" },
      summary: {
        key: "statusPanel.checkpoint.keyChanges.tasksSummary",
        params: { completed: input.todoCompleted, total: input.todos.length },
      },
      fileCount: null,
    });
  }

  if (input.subagents.length > 0) {
    result.push({
      id: "agents",
      label: { key: "statusPanel.checkpoint.keyChanges.agents" },
      summary: {
        key: "statusPanel.checkpoint.keyChanges.agentsSummary",
        params: { completed: input.subagentCompleted, total: input.subagents.length },
      },
      fileCount: null,
    });
  }

  return result;
}

function buildNextActions(input: {
  fileChanges: FileChangeSummary[];
  latestCommand: CommandSummary | null;
  risks: CheckpointRisk[];
  verdict: CheckpointViewModel["verdict"];
}): CheckpointAction[] {
  const actions = new Map<CheckpointAction["type"], CheckpointAction>([
    [
      "review_diff",
      {
        type: "review_diff",
        label: { key: "statusPanel.checkpoint.actions.reviewDiff" },
        enabled: input.fileChanges.length > 0,
      },
    ],
    [
      "commit",
      {
        type: "commit",
        label: { key: "statusPanel.checkpoint.actions.commit" },
        enabled: input.fileChanges.length > 0,
      },
    ],
  ]);

  const orderedTypes = resolveNextActionOrder(input.verdict, input.risks);
  return orderedTypes
    .map((type) => actions.get(type) ?? null)
    .filter((action): action is CheckpointAction => Boolean(action?.enabled))
    .slice(0, CHECKPOINT_ACTION_LIMIT);
}

function resolveNextActionOrder(
  verdict: CheckpointViewModel["verdict"],
  risks: CheckpointRisk[],
): CheckpointAction["type"][] {
  const topRisk = [...risks].sort(compareRiskPriority).at(0) ?? null;
  const primaryOrder = topRisk ? resolveRiskActionOrder(topRisk.code) : [];
  const fallbackOrder = resolveVerdictActionOrder(verdict);
  return uniqueActionTypes([...primaryOrder, ...fallbackOrder]);
}

function compareRiskPriority(left: CheckpointRisk, right: CheckpointRisk) {
  const severityOrder = {
    high: 0,
    medium: 1,
    low: 2,
  } as const;
  const severityDiff = severityOrder[left.severity] - severityOrder[right.severity];
  if (severityDiff !== 0) {
    return severityDiff;
  }

  const codeOrder = {
    validation_failed: 0,
    command_failed: 1,
    subagent_error: 2,
    validation_missing: 3,
    manual_review: 4,
  } as const;
  return codeOrder[left.code] - codeOrder[right.code];
}

function resolveRiskActionOrder(
  riskCode: CheckpointRisk["code"],
): CheckpointAction["type"][] {
  switch (riskCode) {
    case "validation_failed":
    case "command_failed":
      return ["review_diff"];
    case "subagent_error":
      return ["review_diff"];
    case "validation_missing":
      return ["review_diff"];
    case "manual_review":
      return ["review_diff"];
    default:
      return [];
  }
}

function resolveVerdictActionOrder(
  verdict: CheckpointViewModel["verdict"],
): CheckpointAction["type"][] {
  switch (verdict) {
    case "blocked":
      return ["review_diff"];
    case "running":
      return ["review_diff"];
    case "ready":
      return ["review_diff", "commit"];
    case "needs_review":
    default:
      return ["review_diff"];
  }
}

function uniqueActionTypes(
  actions: CheckpointAction["type"][],
): CheckpointAction["type"][] {
  const seen = new Set<CheckpointAction["type"]>();
  return actions.filter((action) => {
    if (seen.has(action)) {
      return false;
    }
    seen.add(action);
    return true;
  });
}

function buildSources(input: {
  commands: CommandSummary[];
  fileChanges: FileChangeSummary[];
  generatedSummarySourceId: string | null;
  subagents: SubagentInfo[];
  todos: TodoItem[];
  validations: CheckpointValidationEvidence[];
}): CheckpointViewModel["sources"] {
  return [
    ...input.fileChanges.map((entry) => ({
      kind: "file_change" as const,
      sourceId: entry.filePath,
    })),
    ...input.commands.map((entry) => ({
      kind: "command" as const,
      sourceId: entry.id,
    })),
    ...input.validations
      .filter((entry) => entry.sourceId)
      .map((entry) => ({
        kind: "validation" as const,
        sourceId: entry.sourceId as string,
      })),
    ...input.todos.map((_, index) => ({
      kind: "task" as const,
      sourceId: `todo:${index}`,
    })),
    ...input.subagents.map((entry) => ({
      kind: "task" as const,
      sourceId: entry.id,
    })),
    ...(input.generatedSummarySourceId
      ? [
          {
            kind: "summary" as const,
            sourceId: input.generatedSummarySourceId,
          },
        ]
      : []),
  ];
}

function truncateCommand(command: string) {
  const normalized = command.trim();
  if (normalized.length <= 48) {
    return normalized;
  }
  return `${normalized.slice(0, 47).trimEnd()}…`;
}

function normalizeGeneratedSummaryText(value: string): string | null {
  const collapsed = value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (!collapsed) {
    return null;
  }

  if (collapsed.length <= CHECKPOINT_SUMMARY_MAX_LENGTH) {
    return collapsed;
  }

  return `${collapsed.slice(0, CHECKPOINT_SUMMARY_MAX_LENGTH - 1).trimEnd()}…`;
}
