import { corePolicy } from "./corePolicy";
import { bridgeGovernancePolicies } from "./bridgeGovernancePolicies";
import {
  lintValidationPolicy,
  testsValidationPolicy,
  typecheckValidationPolicy,
} from "./validationPolicies";
import type {
  CheckpointPolicyEvidence,
  Policy,
  PolicyAuditEntry,
  PolicyChainResult,
  PolicyDecision,
  PolicyVerdictContribution,
} from "./policyTypes";

const DEFAULT_AUDIT_LIMIT = 50;
const VERDICT_SEVERITY: Record<PolicyVerdictContribution, number> = {
  no_contribution: 0,
  ready: 1,
  running: 2,
  needs_review: 3,
  blocked: 4,
};

function normalizeAuditLimit(limit: number) {
  if (!Number.isFinite(limit)) {
    return DEFAULT_AUDIT_LIMIT;
  }
  return Math.max(Math.floor(limit), 0);
}

export function createPolicyRegistry(seed: readonly Policy[] = []) {
  const policies = new Map<string, Policy>();
  policies.set(corePolicy.id, corePolicy);
  for (const policy of seed) {
    policies.set(policy.id, policy);
  }

  return {
    register(policy: Policy) {
      policies.set(policy.id, policy);
    },
    unregister(policyId: string) {
      if (policyId !== corePolicy.id) {
        policies.delete(policyId);
      }
    },
    list(): readonly Policy[] {
      return Array.from(policies.values());
    },
  };
}

export const defaultPolicyRegistry = createPolicyRegistry([
  lintValidationPolicy,
  typecheckValidationPolicy,
  testsValidationPolicy,
  ...bridgeGovernancePolicies,
]);

function resolveMostSevereDecision(decisions: readonly PolicyDecision[]) {
  return decisions.reduce<PolicyDecision | null>((current, decision) => {
    if (decision.verdictContribution === "no_contribution") {
      return current;
    }
    if (!current) {
      return decision;
    }
    return VERDICT_SEVERITY[decision.verdictContribution] >
      VERDICT_SEVERITY[current.verdictContribution]
      ? decision
      : current;
  }, null);
}

export function evaluatePolicyChain(
  evidence: CheckpointPolicyEvidence,
  policies: readonly Policy[] = defaultPolicyRegistry.list(),
): PolicyChainResult {
  const normalizedPolicies = policies.some((policy) => policy.id === corePolicy.id)
    ? policies
    : [corePolicy, ...policies];
  const decisions = normalizedPolicies
    .filter((policy) => policy.appliesTo(evidence))
    .map((policy) => policy.evaluate(evidence));
  const mostSevereDecision = resolveMostSevereDecision(decisions);

  return {
    verdict:
      mostSevereDecision?.verdictContribution === "no_contribution" ||
      mostSevereDecision == null
        ? "needs_review"
        : mostSevereDecision.verdictContribution,
    decisions,
  };
}

export function createPolicyAuditBuffer(limit = DEFAULT_AUDIT_LIMIT) {
  const entries: PolicyAuditEntry[] = [];
  const normalizedLimit = normalizeAuditLimit(limit);

  return {
    push(entry: PolicyAuditEntry) {
      if (normalizedLimit === 0) {
        return;
      }
      entries.push(entry);
      while (entries.length > normalizedLimit) {
        entries.shift();
      }
    },
    list(): readonly PolicyAuditEntry[] {
      return [...entries];
    },
    clear() {
      entries.splice(0, entries.length);
    },
  };
}
