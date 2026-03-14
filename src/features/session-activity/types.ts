import type { GitLineMarkers } from "../files/utils/gitLineMarkers";

export type SessionActivityRelationshipSource = "directParent" | "fallbackLinking";

export type SessionActivityKind = "command" | "task" | "fileChange" | "explore" | "reasoning";

export type SessionActivityEventStatus =
  | "running"
  | "completed"
  | "failed"
  | "pending";

export type SessionActivityJumpTarget =
  | { type: "thread"; threadId: string }
  | { type: "diff"; path: string }
  | {
      type: "file";
      path: string;
      line?: number;
      markers?: GitLineMarkers;
    };

export type SessionActivityEvent = {
  eventId: string;
  threadId: string;
  threadName: string;
  turnId?: string;
  turnIndex?: number;
  sessionRole: "root" | "child";
  relationshipSource: SessionActivityRelationshipSource;
  kind: SessionActivityKind;
  occurredAt: number;
  summary: string;
  status: SessionActivityEventStatus;
  jumpTarget?: SessionActivityJumpTarget;
  additions?: number;
  deletions?: number;
  filePath?: string;
  fileCount?: number;
  commandText?: string;
  commandDescription?: string;
  commandWorkingDirectory?: string;
  commandPreview?: string;
  explorePreview?: string;
  reasoningPreview?: string;
};

export type SessionActivitySessionSummary = {
  threadId: string;
  threadName: string;
  sessionRole: "root" | "child";
  relationshipSource: SessionActivityRelationshipSource;
  eventCount: number;
  isProcessing: boolean;
};

export type WorkspaceSessionActivityViewModel = {
  rootThreadId: string | null;
  rootThreadName: string | null;
  relevantThreadIds: string[];
  timeline: SessionActivityEvent[];
  sessionSummaries: SessionActivitySessionSummary[];
  isProcessing: boolean;
  emptyState: "idle" | "running" | "completed";
};
