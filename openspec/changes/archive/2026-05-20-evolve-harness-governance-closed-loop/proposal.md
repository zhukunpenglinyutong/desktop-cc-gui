## Why

Harness governance Phase 1 established specs, checkers, and evidence surfaces, but the signals remain mostly isolated: validation results, capability gaps, cost budget state, realtime harness results, and domain events do not yet converge into one policy-consumable governance loop.

This change closes that foundation gap by evolving the existing workspace governance evidence surface into a harness-grade closed loop: collect evidence, route by capability, evaluate policy, expose audit, and gate runtime actions only through explicit contracts.

## 目标与边界

- Evolve the existing `src/features/governance/evidence/**` readers and `useGovernanceEvidence` hook into a governance evidence bridge that normalizes OpenSpec validation, large-file governance, heavy-test-noise, realtime harness, capability matrix, and cost budget signals into one typed evidence model.
- Keep the bridge core framework-free: React hooks and Tauri workspace readers may collect or render evidence, but checkpoint policies receive only a frozen snapshot through policy evidence input.
- Expand the checkpoint policy chain so governance decisions can consume evidence bridge signals without each policy shelling out or reading files directly.
- Migrate the next batch of engine-name branches toward capability-aware routing using the existing matrix and scanner, not ad-hoc `engine === "..."` checks.
- Introduce a minimal, in-memory domain event runtime only when a concrete first consumer is defined and reducer next-state equivalence is proven.
- Connect cost budget signals to policy evaluation as advisory governance evidence while preserving a clear separation between observation, policy, and any runtime-impacting action.

## 非目标

- No third-party telemetry SDK, network upload, or persistent telemetry store.
- No default-on dashboard or analytics surface.
- No public EventBus publish API for application consumers.
- No reducer side effects without byte-equivalent reducer state proof.
- No automatic runtime interrupt directly from the cost module.
- No global rewrite of every existing engine-name branch in one pass.
- No new generic plugin router or Rust router unless a spec scenario proves it is required.

## What Changes

- Add a `governance-evidence-bridge` capability that extends the existing workspace governance evidence readers instead of creating a parallel bridge, and defines a closed evidence union, source adapters, stale/degraded semantics, and a safe in-memory snapshot API.
- Add cross-platform constraints for bridge collection, report parsing, path handling, line endings, and CI execution across Windows, macOS, and Linux.
- Modify `checkpoint-policy-chain` so optional policies can consume bridge-provided evidence for OpenSpec, large-file, heavy-test-noise, realtime harness, capability, and cost-budget signals.
- Modify `capability-aware-policy-router` to move from read-only scanner plus hook into a staged migration contract for selected high-value engine branches.
- Modify `agent-domain-event-runtime` from "deferred until concrete consumer" to "allowed behind a named first consumer, in-memory-only subscription, and reducer-equivalence gate."
- Modify `context-ledger-cost-budget` so budget threshold signals become policy evidence; runtime interruption remains controlled by policy/runtime contracts, not by cost projection itself.
- Modify realtime governance specs so replay/batching/perf reports can be represented as evidence bridge signals and used as release/checkpoint gates.
- Preserve user-facing explainability by routing all policy decisions through existing audit surfaces rather than adding a separate telemetry dashboard.
- Preserve the existing StatusPanel surfaces: `GovernanceEvidenceSection` remains the read-only evidence list, and `PolicyDecisionAuditPanel` remains the checkpoint policy audit surface. This change connects them through shared snapshot metadata instead of adding a third governance dashboard.

## 技术方案对比

| Option | Description | Trade-off | Decision |
|---|---|---|---|
| A. Central Evidence Bridge | Normalize governance signals into typed in-memory evidence, then feed policy chain. | Requires careful schema design, but keeps policies pure and avoids shell/file I/O inside policy evaluation. | Chosen. This creates the missing foundation without turning every checker into a UI/runtime dependency. |
| B. Direct Policy Integrations | Let each policy call checker scripts, parse files, or read runtime modules directly. | Faster locally, but creates hidden side effects, slow UI paths, and inconsistent evidence semantics. | Rejected. Violates pure policy contract and increases drift. |
| C. EventBus-First Runtime | Wire reducer/domain events into a bus immediately, then derive governance from event stream. | Powerful later, but too much hot-path risk before a concrete consumer and equivalence proof exist. | Deferred behind explicit first-consumer gate. |
| D. Dashboard-First Telemetry | Build a telemetry dashboard and aggregate governance counters visually. | Attractive UI, but adds privacy, persistence, and scope creep before the evidence contract is stable. | Rejected for this phase. |

## Capabilities

### New Capabilities

- `governance-evidence-bridge`: Defines typed in-memory governance evidence, source adapters, stale/degraded semantics, and snapshot consumption contracts.
- `harness-governance-gate-consolidation`: Defines how realtime harness, batching, perf, OpenSpec, large-file, and noise sentries become standard gate evidence for checkpoint/release decisions.

### Modified Capabilities

- `checkpoint-policy-chain`: Extend optional policy input from existing validation evidence to bridge-provided governance evidence while preserving pure policy evaluation and the optional-policy ceiling.
- `capability-aware-policy-router`: Add staged migration requirements for selected engine-name branches and explainable degradation paths.
- `agent-domain-event-runtime`: Allow an in-memory subscription runtime only after a named first consumer and reducer-equivalence proof exist.
- `context-ledger-cost-budget`: Promote budget threshold signals into policy evidence without letting the cost module directly interrupt runtime.
- `policy-decision-audit-surface`: Require audit rendering for bridge-fed policy decisions and degraded/missing evidence reasons.
- `engine-capability-matrix`: Require capability mismatch and unknown-cell signals to be representable as governance evidence.
- `engine-runtime-contract`: Require runtime/realtime contract violations discovered by replay harnesses to be representable as governance evidence.
- `governance-telemetry-loop`: Keep telemetry deferred; if revived, it must consume bridge snapshots rather than instrumenting product paths directly.

## Impact

- Frontend governance modules under `src/features/governance/**`, `src/features/status-panel/utils/policies/**`, and `src/features/status-panel/components/**`.
- Engine capability usage under `src/features/engine/**` and selected UI branch sites discovered by `scripts/scan-engine-name-branches.mjs`.
- Context ledger cost/budget modules under `src/features/context-ledger/**`.
- Threads domain event schema/runtime modules under `src/features/threads/domain-events/**`.
- Realtime contracts and harnesses under `src/features/threads/contracts/**` and related performance scripts.
- Scripts and CI entries for OpenSpec validation, large-file governance, heavy-test-noise, realtime harness reporting, and capability matrix checks.
- No new external dependencies are expected; if design later proposes a dependency, it must justify maintenance activity and why existing Node/TS tooling is insufficient.
- Existing `src/features/governance/evidence/**` readers already expose workspace evidence with legacy sources (`openspec`, `trellis`, `script`, `workflow`). This change must migrate or wrap those readers without breaking the current StatusPanel governance evidence surface.
- Existing code already includes `useCapability`, `resolveEngineCapabilityRuntimeStatus`, `resolveBudgetThresholdSignal`, `domainEventFactories`, and domain-event derivation fixtures. Implementation must reuse those as the starting substrate instead of duplicating capability, cost, or domain-event semantics.
- Cross-platform behavior is in scope for governance scripts and evidence parsing: implementations must avoid POSIX-only shell assumptions, normalize path separators for evidence ids, and remain deterministic under Windows case-insensitive paths and CRLF line endings.

## 验收标准

- `openspec validate evolve-harness-governance-closed-loop --strict --no-interactive` passes.
- `openspec validate --all --strict --no-interactive` passes after specs are synced.
- Governance evidence bridge exposes typed, in-memory, deterministic evidence snapshots with degraded/stale states.
- Existing governance evidence readers and `GovernanceEvidenceSection` keep rendering during migration; no parallel bridge or duplicate dashboard is introduced.
- Bridge-fed policies do not import `useGovernanceEvidence`, Tauri workspace readers, or collection runtimes; they consume only the injected frozen snapshot.
- Policy chain tests cover bridge-fed evidence without introducing file I/O, shell execution, logging, or mutation inside policy `evaluate`.
- Capability migration tests prove selected engine branches use matrix-backed capability checks or carry explicit allowlist rationale.
- Domain event runtime remains absent unless the design names a first consumer and tests reducer next-state equivalence.
- Cost budget can contribute policy evidence, but runtime interruption requires an explicit policy/runtime action contract.
- Realtime harness results can be represented as gate evidence and shown through policy audit surfaces.
- Existing governance checkers continue to pass: capability matrix, cost budget, checkpoint policy chain, domain event schema, realtime batching, large-file governance, and heavy-test-noise.
- Bridge and gate validation run on Linux, macOS, and Windows; generated evidence ids, source paths, and report parsing results must be byte-stable except for documented timestamp fields.
