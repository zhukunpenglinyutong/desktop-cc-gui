export type LegacyGovernanceEvidenceSource = "openspec" | "trellis" | "script" | "workflow";

export type HarnessGovernanceEvidenceSource =
  | "large-file"
  | "heavy-test-noise"
  | "realtime-harness"
  | "engine-capability-matrix"
  | "engine-runtime-contract"
  | "cost-budget";

export type GovernanceEvidenceSource =
  | LegacyGovernanceEvidenceSource
  | HarnessGovernanceEvidenceSource;

export type GovernanceEvidenceStatus = "pass" | "warn" | "fail" | "unknown";

export type GovernanceEvidencePayload =
  | { readonly kind: "legacy-workspace-evidence"; readonly sourcePath?: string }
  | {
      readonly kind: "large-file";
      readonly scope: "warn" | "fail";
      readonly sourcePath?: string;
    }
  | {
      readonly kind: "heavy-test-noise";
      readonly breachCount: number;
      readonly sourcePath?: string;
    }
  | {
      readonly kind: "realtime-harness";
      readonly profile?: string;
      readonly replayMetrics?: Record<string, number>;
      readonly sourcePath?: string;
    }
  | {
      readonly kind: "engine-capability-matrix";
      readonly engine?: string;
      readonly capability?: string;
      readonly specState?: string;
      readonly runtimeState?: string;
      readonly available?: boolean;
      readonly sourcePath?: string;
    }
  | {
      readonly kind: "engine-runtime-contract";
      readonly contractId: string;
      readonly sourcePath?: string;
    }
  | {
      readonly kind: "cost-budget";
      readonly tier: "info" | "warn" | "block";
      readonly severity: "info" | "warning" | "critical";
      readonly amountUsd: number;
      readonly thresholdUsd: number;
      readonly currency: "USD";
      readonly pricingSource?: string;
      readonly shouldInterruptRuntime: false;
    };

export type GovernanceEvidence = {
  readonly id: string;
  readonly source: GovernanceEvidenceSource;
  readonly status: GovernanceEvidenceStatus;
  readonly degraded: boolean;
  readonly degradationReason?: string;
  readonly staleAt?: string;
  readonly updatedAt: string;
  readonly title: string;
  readonly summary: string;
  readonly payload?: GovernanceEvidencePayload;
};

export type GovernanceEvidenceSnapshot = {
  readonly id: string;
  readonly evidence: readonly GovernanceEvidence[];
  readonly createdAt: string;
};

export type WorkspaceGovernanceFileReader = (path: string) => Promise<string | null>;

export type WorkspaceGovernanceSnapshot = {
  readonly files: readonly string[];
  readonly readFile: WorkspaceGovernanceFileReader;
};
