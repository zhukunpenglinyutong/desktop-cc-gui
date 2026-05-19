## Context

Harness governance Phase 1 delivered specs, checkers, and surfaces, and current code already contains partial governance evidence, policy, cost, capability, and domain-event substrates. The remaining foundation gap is not "no implementation"; it is that these substrates are not yet connected into one policy-consumable loop. This change closes that gap by evolving the existing in-memory governance evidence surface into a harness-grade evidence bridge, then re-anchoring five governance concerns on it without expanding scope into product hot paths or new transport.

This document records the design decisions for the five concerns named on the change brief:

1. Governance Evidence Bridge
2. Capability Routing Migration
3. Harness Gate Consolidation
4. Domain Event Runtime Gate
5. Cost Budget Policy Action Separation
6. Cross-Platform Governance Execution

Each section states the current friction, the decision, the rejected alternatives, and the bounded scope.

## Current State

### Existing governance signals

| Signal | Source | Current consumer |
|---|---|---|
| OpenSpec validation | `openspec validate --all --strict` | CLI / CI only |
| Large-file governance | `check:large-files*` + workflow | CLI / CI / debt ledger |
| Heavy-test-noise | `check:heavy-test-noise` | CLI / CI |
| Realtime replay harness | `perf:realtime:boundary-guard` | CLI / CI |
| Capability matrix | `check:engine-capability-matrix` | CLI / runtime helpers |
| Cost & budget projection | `context-ledger/pricing` + StatusPanel | UI only |
| Checkpoint policy chain | `corePolicy` + first-batch optional policies | StatusPanel `policyAudit` |
| Workspace governance evidence | `src/features/governance/evidence/**` + `useGovernanceEvidence` | Dock-only StatusPanel `GovernanceEvidenceSection` |
| Domain event schema | `src/features/threads/domain-events/**` factories and derivation fixtures | Tests / schema check only |

### Code Fact Baseline

- `src/features/governance/evidence/**` already parses OpenSpec task progress, package scripts, workflows, and Trellis session records into read-only evidence with sources `openspec`, `script`, `workflow`, and `trellis`.
- `GovernanceEvidenceSection` already renders that evidence in the StatusPanel dock checkpoint tab.
- `PolicyDecisionAuditPanel` already renders policy decisions, but policy decisions do not yet carry bridge snapshot metadata.
- `checkpoint-policy-chain` currently evaluates core plus lint/typecheck/tests validation policies; it does not yet consume governance evidence.
- `resolveBudgetThresholdSignal` already enforces `shouldInterruptRuntime: false`; it does not yet emit `cost-budget` evidence.
- `useCapability` and `resolveEngineCapabilityRuntimeStatus` already exist; capability mismatch evidence is not yet emitted.
- `domainEventFactories` and derivation fixtures already exist; there is no runtime subscriber or EventBus.
- Realtime replay and batching harnesses already exist as tests/scripts; their results are not yet represented as bridge evidence.

### Friction

- Each signal lives behind its own reader, command, or runtime path.
- Existing workspace governance evidence is display-only and dock-only; it is not part of the checkpoint policy evidence input.
- Optional policies currently consume only `CheckpointValidationEvidence` (lint / typecheck / tests / build / custom). Anything richer requires shell execution or file I/O, which the policy interface forbids.
- Engine-name branches (`engine === "claude"`, etc.) still proliferate in places that should consult the capability matrix.
- The cost projection module knows enough to flag a budget breach, but the only way it could currently act on it is to call runtime interruption directly, which violates the existing capability separation.
- A domain event runtime has been kept "deferred until a concrete consumer exists" with no path to evolve.

## Design Goals

- Make governance signals **composable** through one typed, in-memory union.
- Keep policy evaluation **pure** (no shell, no file I/O, no logging, no mutation).
- Allow staged capability routing migration **without** introducing a new generic router.
- Allow the domain event runtime to advance, **only** behind a named first consumer and a reducer next-state equivalence proof.
- Separate cost **observation** from cost **action**; the cost module never directly interrupts the runtime.
- Keep bridge collection, evidence ids, report parsing, and validation commands **platform-neutral** across Windows, macOS, and Linux.

## Decisions

### Decision 1: Governance Evidence Bridge Is A Typed In-Memory Union

**Decision.** Evolve the current `src/features/governance/evidence/**` surface into a single capability `governance-evidence-bridge` whose contract defines:

- A typed `GovernanceEvidence` discriminated union keyed by `source` (`openspec` | `large-file` | `heavy-test-noise` | `realtime-harness` | `engine-capability-matrix` | `engine-runtime-contract` | `cost-budget`).
- A common envelope: `{ id, source, status: 'pass' | 'warn' | 'fail' | 'unknown', degraded: boolean, degradationReason?, staleAt?, updatedAt }`.
- Source-specific `payload` fields constrained per variant.
- A framework-free snapshot core that returns a frozen, deterministic projection within a single React commit.
- A React hook wrapper that may keep the existing `useGovernanceEvidence` loading behavior, but does not become the policy input boundary.
- A checkpoint evidence injection path that passes the frozen snapshot through `CheckpointPolicyEvidence`; policies must not import React hooks, Tauri file readers, or workspace collection helpers.
- A compatibility path for the existing StatusPanel governance evidence readers whose current source ids are `openspec`, `trellis`, `script`, and `workflow`.
- A single canonical bridge module that both `GovernanceEvidenceSection` and bridge-fed policies consume; no second bridge implementation is allowed.

**Why.**
- One union lets policies and audit surfaces consume governance signals through a single type, not through six bespoke readers or a second parallel bridge.
- Determinism is required to satisfy the existing `Verdict computation is deterministic` requirement on the policy chain.
- Freezing the snapshot prevents accidental mutation by consumers.

**Rejected alternatives.**
- *Direct policy integrations*: faster locally, but each policy would gain hidden side effects (file reads, shell calls) and break the pure-function contract.
- *EventBus-first*: viable later, but premature without a concrete consumer and an equivalence proof.
- *Telemetry-first dashboard*: rejected because the privacy and persistence model is not stable yet.

**Bounded scope.**
- No persistence (no localStorage, IndexedDB, filesystem).
- No transport (no Tauri IPC, WebSocket, worker channel).
- No new external dependency.
- No public `publish` API; sources push evidence into adapters owned by this capability.
- No breaking replacement of the existing workspace governance evidence surface; legacy reader output must be wrapped, versioned, or migrated through tests.
- No duplicate `src/features/governance/harnessEvidence/**` or dashboard-only bridge that bypasses `src/features/governance/evidence/**`.
- No policy dependency on `useGovernanceEvidence`; that hook is an adapter over the snapshot substrate, not the substrate itself.

**Implementation guard.**
- Source adapters may parse already-supplied data or reports handed to them by a collection runtime, but adapters and policy/render consumption paths must not perform shell execution, process spawning, network calls, or arbitrary filesystem reads.
- If on-disk artifacts are needed, a dedicated collection runtime reads them before snapshot creation and hands normalized raw input into the adapter.
- The pure snapshot module should be testable without React, Tauri mocks, workspace ids, or filesystem fixtures. React and Tauri concerns belong only in collection/wrapper tests.

### Decision 2: Capability Routing Migration Is Staged And Matrix-Backed

**Decision.** Migrate a first batch of high-value engine-name branches to use the existing matrix (`getEngineCapabilityState`, `isEngineCapabilityAvailable`, `resolveEngineCapabilityRuntimeStatus`, `useCapability`). Classify remaining branches into:

- `matrix-eligible` — must migrate in this change.
- `runtime-isolated` — branches that gate runtime/process selection and are kept as-is until a follow-up change with explicit runtime contract evidence.
- `legacy-allowlist` — documented with engine, branch site, reason, and removal owner.

**Why.**
- The matrix is already the source of truth (spec, TS, Rust agree). Branching on raw engine name silently bypasses it.
- A staged migration prevents the change from becoming a global rewrite.
- The allowlist makes residual debt explicit instead of invisible.

**Rejected alternatives.**
- *Generic route registry / Rust router*: out of scope and not justified by any current scenario.
- *Lint enforcement against `engine === "..."`*: blocked by the prior phase's "no lint enforcement" requirement; revisit only after the inventory stabilizes.

**Bounded scope.**
- No global rewrite.
- No codemod.
- Capability mismatches at runtime emit evidence through the bridge instead of throwing or silently falling back.
- Existing `useCapability` semantics remain the implementation anchor; this change extends it with evidence emission rather than replacing it.

### Decision 3: Harness Gate Consolidation Goes Through The Bridge

**Decision.** Realtime replay harness, batching/perf reports, OpenSpec validation, large-file governance, heavy-test-noise, capability matrix, and engine runtime contract all produce `GovernanceEvidence`. A new capability `harness-governance-gate-consolidation` defines how those evidences combine into one checkpoint/release gate decision.

**Why.**
- Today each gate is an isolated CLI exit code. Consolidation lets policy and audit surfaces explain release readiness in one place.
- A consolidated decision must still cite each contributing gate, preserving traceability.
- Heavy-test-noise stays advisory (`warn` only); it never blocks release on its own.

**Rejected alternatives.**
- *Aggregate score*: rejected because hiding contributing gates behind a single number defeats audit.
- *Single hard gate*: rejected because some gates (noise, near-threshold large-file) are intentionally advisory.

**Bounded scope.**
- Consolidation is a pure projection over bridge evidence; it does not run any check itself.
- The consolidated decision is consumed by the policy chain and the audit surface, not by a new UI tab.
- Existing CLI/test exit codes remain authoritative for CI. Bridge evidence explains those results to policy/audit consumers but does not replace the checks.

### Decision 4: Domain Event Runtime Gate Has An Explicit Unlock Path

**Decision.** Replace the unconditional "deferred until a concrete consumer exists" gate with a four-part unlock:

1. **Named first consumer.** Must be a single, documented in-memory subscriber whose use case is justified and bounded. UI rendering is not an acceptable first consumer; a governance evidence sink is.
2. **Reducer next-state equivalence proof.** Byte-equal next-state for the same action sequence with and without the emit hook, asserted by golden fixtures.
3. **Subscribe-only public surface.** No public `publish` / `emit` reachable from application consumers.
4. **In-memory only.** Negative tests assert no writes to localStorage, IndexedDB, filesystem, Tauri IPC, WebSocket, or worker channel.

**Why.**
- The existing "deferred" gate has no unlock condition, which means the capability cannot advance even when a concrete need appears.
- The four-part unlock keeps the previous safety properties (no persistence, no transport, no publish leak) while letting a single bounded consumer use the runtime.
- A reducer-equivalence proof is the strongest available guarantee that emit hooks do not perturb reducer state.

**Rejected alternatives.**
- *Wire EventBus first, find consumers later*: this is the hot-path risk the previous spec deliberately blocked.
- *Make publish public*: rejected; application code must remain unable to inject events.

**Bounded scope.**
- The first consumer SHOULD be a governance evidence sink (e.g., feeding the bridge with reducer-derived signals). If it is not, the design document for the first consumer MUST justify why.
- Adding a second consumer is out of scope for this change.
- Existing `domainEventFactories` and derivation fixtures are the schema baseline. Runtime work must reuse them and prove reducer equivalence against those fixtures.
- Existing thread diagnostics, settlement audit callbacks, or event-handler refactors do not satisfy the named-first-consumer gate by themselves. They may be used as input facts only after the runtime spec names the consumer and proves reducer equivalence.

### Decision 5: Cost Budget Observes; Policy Acts

**Decision.** The cost budget module:

- Emits `cost-budget` evidence on tier crossings (`info` / `warn` / `block`) and on degraded pricing.
- MUST NOT call any runtime termination, cancellation, or interrupt API directly.

A new cost-budget optional policy in the checkpoint chain:

- Consumes that evidence under the existing optional policy ceiling (max `needs_review`).
- MAY recommend a runtime action; the runtime action contract belongs to runtime/policy infrastructure, not to the cost module.

**Why.**
- The previous spec already states block-tier crossings must not forcibly interrupt the runtime. This change formalizes the separation between observation and action.
- Routing action through policy keeps audit explainability and respects the optional policy contribution ceiling.

**Rejected alternatives.**
- *Cost module calls cancel directly*: rejected; violates separation of concerns and breaks existing contract.
- *Cost-budget policy contributes `blocked`*: rejected; only `corePolicy` may contribute `blocked` for runtime/fatal failures.

**Bounded scope.**
- Cost projection rules and pricing source semantics are unchanged.
- Aggregate cost / degraded propagation rules are unchanged except for the new evidence emission path.
- The `block` tier is a budget severity inside the cost payload, not permission for an optional policy to emit `blocked`.
- Existing `resolveBudgetThresholdSignal` and its `shouldInterruptRuntime: false` invariant remain the source of budget threshold semantics.

### Compatibility Note: Existing Governance Evidence Readers

The current code already has `src/features/governance/evidence/**` with `GovernanceEvidenceSource = "openspec" | "trellis" | "script" | "workflow"` and a StatusPanel consumer path. This change MUST NOT remove or silently rename that surface in the first implementation step.

The implementation should choose one of these compatible paths:

- Wrap legacy evidence as `payload.kind = "legacy-workspace-evidence"` under a bridge source such as `openspec` or `workflow`.
- Version the bridge type so legacy readers continue to compile while new bridge-fed policies consume the stricter harness source variants.
- Migrate legacy readers one by one with regression tests proving current StatusPanel governance evidence still renders.

Directly replacing the existing union without migration tests is out of scope because it would create avoidable UI regression risk.

### Audit Surface Continuity Note

The current UI has two separate but related surfaces:

- `GovernanceEvidenceSection`: read-only workspace governance evidence list.
- `PolicyDecisionAuditPanel`: checkpoint policy decision audit trail.

This change MUST connect them through shared bridge snapshot metadata (`evidenceSnapshotId`, source id, stale/degraded markers) while preserving their roles. `GovernanceEvidenceSection` shows evidence; `PolicyDecisionAuditPanel` explains how policy consumed evidence. A third StatusPanel tab, standalone dashboard, or telemetry panel would fragment the governance story and is out of scope.

### Decision 6: Cross-Platform Compatibility Is A Governance Gate

**Decision.** All bridge and gate code introduced by this change must be platform-neutral by construction:

- Use Node/TypeScript APIs such as `path`, `URL`, and structured JSON parsing instead of string-splitting path separators.
- Normalize evidence ids and source paths to repository-relative POSIX-style paths for display and snapshot identity, while preserving native paths only at filesystem boundaries.
- Avoid POSIX-only shell syntax, inline `bash`, `grep`, `sed`, `awk`, `/tmp`, `/dev/null`, shell glob assumptions, and executable-bit assumptions in package scripts or validation code.
- Treat CRLF and LF as equivalent when parsing generated reports.
- Treat filesystem case sensitivity as unstable; evidence identity must not rely on only case-different paths.
- Run the bridge conformance and gate consolidation validation on `ubuntu-latest`, `macos-latest`, and `windows-latest`.

**Why.**
- Governance evidence is only useful if it is comparable across developer machines and CI runners.
- Windows failures often come from shell and path assumptions, not business logic.
- Stable evidence ids are required for audit traceability and deterministic policy evaluation.

**Rejected alternatives.**
- *Linux-only governance scripts*: rejected because CI and local contributors include Windows/macOS.
- *Normalize only in UI*: too late; policy/audit snapshots would already contain divergent ids.
- *Document manual platform exceptions*: rejected for P0 governance checks. Exceptions must be explicit residual risks, not hidden behavior.

**Bounded scope.**
- This does not require building platform-specific UI.
- This does not require adding a new shell abstraction library.
- Native filesystem paths may still be used inside collection runtimes, but must be normalized before becoming evidence ids, payload source paths, audit source ids, or report comparison keys.

## Non-Goals

- No third-party telemetry SDK, network upload, or persistent telemetry store.
- No default-on dashboard or analytics surface.
- No public EventBus publish API for application consumers.
- No automatic runtime interrupt directly from the cost module.
- No global rewrite of every existing engine-name branch.
- No new generic plugin router or Rust router.
- No edits to archived harness governance changes.
- No edits under `src/features/files/**` (owned by a separate task).

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Evidence union grows uncontrolled | Add new variants only through a new OpenSpec change; CI check asserts variant exhaustiveness. |
| Policy becomes impure when consuming evidence | `evaluate` keeps the same `evidence` argument shape; bridge snapshot is frozen and passed through evidence input only. |
| Existing workspace evidence bridge is duplicated | Treat `src/features/governance/evidence/**` as the substrate; conformance tests must fail if a second unconnected bridge becomes the policy input. |
| First domain event consumer becomes a UI dependency | Spec forbids UI side effects in the first consumer; governance evidence sink is the recommended use case. |
| Cost budget evidence accidentally triggers UI churn | Evidence emission is deterministic per tier; consumers re-render only when tier or degraded flag changes. |
| Capability migration regresses behavior | First batch is limited to matrix-eligible branches; scanner re-run records regression and progress. |
| Governance checks pass on Linux but fail on Windows/macOS | Platform-neutral path parsing, line-ending normalization, no POSIX-only shell syntax, and CI matrix validation are required by spec. |

## Out Of Scope For Follow-Ups

- Second domain event consumer.
- Telemetry revival (must consume bridge snapshots when revived, never instrument product paths directly).
- Generic route registry or Rust router.
- Cross-workspace governance aggregate.
- Block-level cost attribution.
