## 1. Governance Evidence Bridge

- [x] 1.0 [P0][depends:none][I: current `src/features/governance/evidence/**`, `GovernanceEvidenceSection`, `PolicyDecisionAuditPanel`, cost/capability/domain-event substrates][O: implementation baseline note][V: note maps existing code facts to bridge gaps and confirms no parallel bridge will be introduced] Record the current harness substrate baseline before implementation.
- [x] 1.1 [P0][depends:none][I: existing governance signals (OpenSpec validation cache, large-file report, heavy-test-noise report, realtime harness output, capability matrix snapshot, cost budget projection)][O: typed `GovernanceEvidence` union][V: every variant carries `source`, `status`, `degraded`, `staleAt`, and optional `payload`] Define the typed in-memory governance evidence union shape.
- [x] 1.2 [P0][depends:1.1][I: evidence union][O: bridge snapshot API][V: snapshot is read-only, deterministic, and returns the same identity within the same React commit] Define the bridge snapshot consumption contract.
- [x] 1.2a [P0][depends:1.2][I: bridge snapshot API, `useGovernanceEvidence`, policy chain evidence input][O: framework-free snapshot core and wrapper boundary][V: snapshot core tests run without React/Tauri mocks; `useGovernanceEvidence` remains a wrapper and policies receive snapshots only through checkpoint evidence input] Separate pure bridge core from React/Tauri wrappers.
- [x] 1.3 [P0][depends:1.1][I: existing readers in `src/features/governance/**`][O: source adapter contracts for OpenSpec, large-file, heavy-test-noise, realtime harness, capability matrix, cost budget][V: adapters and consumers have no shell / filesystem / network work on render or policy paths and produce explicit degraded/stale reasons] Specify source adapter contracts for the six initial evidence sources.
- [x] 1.4 [P0][depends:1.2,1.3][I: bridge snapshot consumers][O: stale/degraded propagation rules][V: stale evidence MUST flag `staleAt` and degraded evidence MUST flag `degradationReason`] Specify staleness and degradation propagation rules.
- [x] 1.5 [P0][depends:1.2][I: bridge snapshot][O: zero-persistence guarantee][V: bridge MUST NOT write to localStorage, IndexedDB, or filesystem and MUST NOT publish over Tauri IPC] Specify non-persistence and non-network guarantees.
- [x] 1.6 [P1][depends:1.1-1.5][I: existing CI checks][O: validation script entry][V: `npm run check:governance-evidence-bridge` verifies evidence shape, adapter purity, snapshot determinism, and legacy governance evidence compatibility] Add a check command for evidence shape conformance.
- [x] 1.7 [P0][depends:1.1-1.3][I: existing `src/features/governance/evidence/**` readers][O: compatibility migration note and regression tests][V: existing StatusPanel governance evidence still renders `openspec` / `trellis` / `script` / `workflow` evidence or a wrapped equivalent] Preserve existing workspace governance evidence compatibility.
- [x] 1.8 [P0][depends:1.1-1.6][I: Windows/macOS/Linux path and report fixtures][O: platform-neutral evidence identity][V: evidence ids and source paths are repo-relative, POSIX-normalized, CRLF/LF-stable, and contain no user-specific absolute paths] Add cross-platform evidence normalization tests.
- [x] 1.9 [P0][depends:1.2,1.7][I: `useGovernanceEvidence` and bridge-fed policy evidence][O: one canonical snapshot substrate][V: UI evidence and bridge-fed policies consume the same canonical snapshot or migrated wrapper; conformance check rejects an unconnected second bridge] Prevent duplicate governance evidence bridges.

## 2. Checkpoint Policy Chain Integration

- [x] 2.1 [P0][depends:1.2][I: existing `Policy` interface][O: extended evidence input contract][V: optional policies can read bridge snapshot via the existing `evaluate(evidence)` argument without I/O] Extend optional policy evidence input to include bridge snapshot fields.
- [x] 2.1a [P0][depends:1.2a,2.1][I: `CheckpointPolicyEvidence`, `useGovernanceEvidence`, workspace readers][O: policy import boundary tests][V: bridge-fed policies do not import React hooks, `getWorkspaceFiles`, `readWorkspaceFile`, or collection runtimes] Enforce policy snapshot injection boundary.
- [x] 2.2 [P0][depends:2.1][I: existing first-batch policies (`lint`, `typecheck`, `tests`)][O: second-batch bridge-fed policies (OpenSpec, large-file, heavy-test-noise, realtime harness, capability mismatch, cost budget threshold)][V: each new optional policy returns one of `needs_review` / `running` / `ready` / `no_contribution` only and never `blocked`] Define second-batch optional policies bound to bridge evidence.
- [x] 2.3 [P0][depends:2.2][I: optional policy ceiling rule][O: bridge-fed policy contribution ceiling][V: bridge-fed optional policies MUST NOT contribute `blocked`] Preserve the existing optional policy contribution ceiling.
- [x] 2.4 [P0][depends:2.2][I: bridge-fed decisions][O: audit trail entries][V: every bridge-fed decision MUST carry `sourceId`, `reasonKey`, `evidenceSnapshotId`] Extend audit trail entries to identify the bridge evidence source.
- [x] 2.5 [P0][depends:2.1-2.4][I: existing checkpoint tests][O: zero-regression evidence][V: `npm run test src/features/status-panel/utils/checkpoint.test.ts` MUST still pass without modification] Preserve existing checkpoint UX and audit semantics.
- [x] 2.6 [P0][depends:2.1-2.4][I: `PolicyDecisionAuditPanel` and `GovernanceEvidenceSection`][O: shared snapshot audit traceability][V: bridge-fed audit rows reference `evidenceSnapshotId` and source ids present in the rendered evidence snapshot] Connect policy audit to evidence snapshot metadata.

## 3. Capability Routing Migration

- [x] 3.1 [P0][depends:none][I: `scripts/scan-engine-name-branches.mjs` output][O: prioritized engine-name branch inventory][V: inventory classifies branches as `matrix-eligible`, `runtime-isolated`, or `legacy-allowlist` with rationale] Triage existing engine-name branches into migration tiers.
- [x] 3.2 [P0][depends:3.1][I: `useCapability` hook + matrix helpers][O: capability-aware refactor of selected matrix-eligible branches][V: refactored branches use `getEngineCapabilityState` or `useCapability` instead of `engine === "..."`] Migrate the first batch of matrix-eligible branches.
- [x] 3.3 [P0][depends:3.2][I: refactored branches][O: capability mismatch evidence emission][V: a runtime-detected mismatch (e.g., calling unsupported capability) produces `GovernanceEvidence` of source `engine-capability-matrix`] Wire detected mismatches into the bridge.
- [x] 3.4 [P0][depends:3.1][I: legacy-allowlist branches][O: explicit allowlist artifact][V: allowlist entries MUST include engine, branch site, reason, and removal owner] Document legacy-allowlist branches with rationale.
- [x] 3.5 [P0][depends:3.2,3.3][I: capability-aware branches][O: explainable degradation][V: unsupported / unknown capability MUST produce i18n-keyed UI degradation, not silent fallback] Preserve explainable degradation for unsupported/unknown capabilities.
- [x] 3.6 [P1][depends:3.1-3.5][I: scanner output][O: scanner regression report][V: scanner re-run MUST show monotonic decrease (or documented growth rationale) in `engine === "..."` count] Re-run the scanner and record migration progress.
- [x] 3.7 [P1][depends:3.6][I: scanner output on Windows/macOS/Linux][O: platform-neutral branch inventory][V: scanner branch sites use repo-relative POSIX-style paths and classification does not depend on native path separators or case sensitivity] Validate scanner report portability.
- [x] 3.8 [P0][depends:3.3][I: `resolveEngineCapabilityRuntimeStatus` and `useCapability`][O: reused capability evidence projection][V: evidence payload uses existing `specState`, `runtimeState`, and `available` semantics; no duplicate capability projection table is introduced] Reuse existing capability helpers for evidence emission.

## 4. Harness Gate Consolidation

- [x] 4.1 [P0][depends:1.3][I: realtime replay harness output (`npm run perf:realtime:boundary-guard`)][O: realtime gate evidence][V: replay harness produces evidence with `status: pass | warn | fail` and `replayMetrics` payload] Represent realtime harness results as gate evidence.
- [x] 4.2 [P0][depends:1.3][I: realtime batching/perf reports][O: batching/perf gate evidence][V: batching p95/p99 thresholds map to `warn` / `fail` statuses] Represent batching and perf reports as gate evidence.
- [x] 4.3 [P0][depends:1.3][I: OpenSpec validation cache][O: OpenSpec gate evidence][V: strict-validation failures produce `fail` status with `changeId` payload] Represent OpenSpec validation as gate evidence.
- [x] 4.4 [P0][depends:1.3][I: large-file governance report][O: large-file gate evidence][V: hard-debt growth produces `fail`, near-threshold growth produces `warn`] Represent large-file governance as gate evidence.
- [x] 4.5 [P0][depends:1.3][I: heavy-test-noise sentry output][O: heavy-test-noise gate evidence][V: sentry breach produces `warn` only; runtime never blocked by noise alone] Represent heavy-test-noise as advisory gate evidence.
- [x] 4.6 [P0][depends:4.1-4.5][I: consolidated gate evidence][O: checkpoint / release gate decision][V: a single release gate decision MUST consume the union of evidence and MUST cite each contributing gate] Consolidate gates into a single release decision.
- [x] 4.7 [P1][depends:4.6][I: audit surface][O: rendered consolidated gate explanation][V: audit surface MUST render gate id, status, degraded reason, and last-updated time] Render consolidated gate explanation in the audit surface.
- [x] 4.8 [P0][depends:4.1-4.7][I: Windows/macOS/Linux gate fixtures][O: portable consolidated gate decision][V: severity composition and cited source ids are identical across path separators and CRLF/LF report variants] Validate gate consolidation portability.

## 5. Domain Event Runtime Gate

- [x] 5.1 [P0][depends:none][I: existing reducer paths in `src/features/threads/**`][O: named first consumer candidate][V: candidate MUST be a single, documented in-memory subscriber (no UI side effects) with a specific use case] Name the first concrete consumer for the runtime.
- [x] 5.1a [P0][depends:5.1][I: existing thread diagnostics and event-handler emit callbacks][O: runtime unlock exclusion note][V: diagnostics/refactors are not treated as the first consumer unless the runtime-specific contract and reducer equivalence proof exist] Prevent existing diagnostics from bypassing the runtime unlock gate.
- [x] 5.2 [P0][depends:5.1][I: pure reducer next-state golden fixtures][O: reducer next-state equivalence proof][V: byte-equal next-state for the same action sequence with and without emit hook] Prove reducer next-state equivalence under emit hook.
- [x] 5.3 [P0][depends:5.1,5.2][I: in-memory subscription API][O: subscribe-only public surface][V: no public `publish` / `emit` export is reachable from application consumers] Specify subscribe-only public surface.
- [x] 5.4 [P0][depends:5.1-5.3][I: runtime implementation guard][O: persistence/IPC negative tests][V: tests MUST assert no localStorage, IndexedDB, filesystem, Tauri IPC, WebSocket, or worker channel writes occur] Enforce in-memory-only constraints with negative tests.
- [x] 5.5 [P1][depends:5.1-5.4][I: first consumer use case][O: bridge integration (optional)][V: if the first consumer is a governance consumer, it MUST feed bridge evidence rather than render UI directly] Restrict UI side effects of the first consumer.
- [x] 5.6 [P0][depends:5.1-5.4][I: `domainEventFactories`, `DOMAIN_EVENT_TYPES`, derivation fixtures][O: runtime schema reuse proof][V: emitted runtime events are created through existing factories or a compatible wrapper and every type remains within `DOMAIN_EVENT_TYPES`] Reuse existing domain event schema for runtime unlock.

## 6. Cost Budget Policy Action Separation

- [x] 6.1 [P0][depends:1.3][I: cost budget threshold tiers (`info` / `warn` / `block`)][O: cost budget evidence emission][V: tier crossing emits evidence with `tier`, `currency`, `pricingSource`, and `degraded` fields; `block` is payload severity, not optional-policy `blocked`] Emit cost budget threshold signals as bridge evidence.
- [x] 6.2 [P0][depends:6.1,2.2][I: cost budget evidence][O: cost-budget policy decision][V: policy contributes at most `needs_review`, never `blocked`] Add a cost-budget policy that consumes bridge evidence under the optional policy ceiling.
- [x] 6.3 [P0][depends:6.1,6.2][I: cost projection module][O: separation of observation and action][V: the cost module MUST NOT call any runtime termination / cancel / interrupt API directly] Forbid the cost module from triggering runtime interruption.
- [x] 6.4 [P0][depends:6.2][I: policy/runtime action contract][O: explicit handoff documentation][V: any runtime-impacting action MUST be expressed as an explicit policy/runtime contract and must not be inferred from `tier: block` or evidence emission alone] Document the policy → runtime action handoff explicitly.
- [x] 6.5 [P1][depends:6.1-6.4][I: degraded pricing case][O: cost evidence degraded propagation][V: missing pricing MUST flag `degraded: true` and `degradationReason: 'pricing-unavailable'` on the emitted evidence] Propagate degraded pricing through bridge evidence.
- [x] 6.6 [P0][depends:6.1][I: `resolveBudgetThresholdSignal`][O: reused threshold evidence projection][V: cost evidence derives tier/severity/amount/threshold from existing threshold signal and preserves `shouldInterruptRuntime: false`] Reuse existing budget threshold semantics.

## 7. Audit Surface, Telemetry, And Engine Contract Wiring

- [x] 7.1 [P0][depends:2.4,4.7][I: existing `policyAudit` projection][O: bridge-fed decision rendering][V: audit rows render `sourceId`, `evidenceSnapshotId`, `degradationReason`, and `staleAt` when present] Render bridge-fed policy decisions in the audit surface.
- [x] 7.2 [P0][depends:1.5][I: governance telemetry deferral contract][O: telemetry-consumes-bridge constraint][V: any future telemetry implementation MUST consume bridge snapshots and MUST NOT instrument product hot paths directly] Restate telemetry deferral and reroute future implementations through the bridge.
- [x] 7.3 [P0][depends:1.3,4.1-4.2][I: engine-runtime-contract replay harness][O: contract-violation evidence][V: replay harness contract violations MUST be representable as evidence of source `engine-runtime-contract`] Represent engine runtime contract violations as evidence.
- [x] 7.4 [P0][depends:1.3,3.3][I: capability matrix][O: unknown-cell / mismatch evidence][V: matrix unknown-cell or runtime mismatch MUST be representable as evidence of source `engine-capability-matrix`] Represent capability matrix gaps and mismatches as evidence.
- [x] 7.5 [P0][depends:7.3][I: replay fixture paths and perf report paths][O: normalized runtime-contract evidence ids][V: runtime contract evidence never exposes absolute paths or native separators in audit-facing ids] Normalize runtime contract evidence paths.
- [x] 7.6 [P0][depends:1.9,2.6,7.1][I: `GovernanceEvidenceSection`, `PolicyDecisionAuditPanel`, `CheckpointPanel`][O: no-new-dashboard proof][V: evidence list and audit trail remain in existing CheckpointPanel surfaces; no third governance tab/dashboard is introduced] Preserve existing StatusPanel governance surfaces.

## 8. Validation Gates

- [x] 8.1 [P0][depends:1-7][I: OpenSpec artifacts][O: strict validation evidence][V: `openspec validate evolve-harness-governance-closed-loop --strict --no-interactive`] Validate this change in strict mode.
- [x] 8.2 [P0][depends:1-7][I: full spec set][O: full-suite strict validation evidence][V: `openspec validate --all --strict --no-interactive`] Validate the full spec suite after sync.
- [x] 8.3 [P0][depends:1-7][I: frontend governance modules][O: type/test evidence][V: `npm run typecheck && npm run test`] Run frontend type and test gates.
- [x] 8.4 [P0][depends:2,4][I: policy chain implementation][O: policy chain check evidence][V: `npm run check:checkpoint-policy-chain`] Run policy chain capability check.
- [x] 8.5 [P0][depends:3,7.4][I: capability matrix][O: matrix check evidence][V: `npm run check:engine-capability-matrix`] Run engine capability matrix check.
- [x] 8.6 [P0][depends:6][I: cost budget][O: cost budget check evidence][V: `npm run check:context-ledger-cost-budget`] Run cost budget capability check.
- [x] 8.7 [P0][depends:4.1-4.2,7.3][I: realtime harness][O: realtime boundary evidence][V: `npm run perf:realtime:boundary-guard`] Run realtime boundary harness.
- [x] 8.8 [P1][depends:1-7][I: governance scripts][O: noise/large-file evidence][V: `node --test scripts/check-heavy-test-noise.test.mjs scripts/check-large-files.test.mjs`] Run noise and large-file sentries.
- [x] 8.9 [P0][depends:1,3,4,7][I: CI matrix][O: Windows/macOS/Linux compatibility evidence][V: bridge conformance, scanner portability, and gate consolidation tests pass on `ubuntu-latest`, `macos-latest`, and `windows-latest`] Run cross-platform governance validation.

## 9. Completion Review

- [x] 9.1 [P0][depends:8][I: validation outputs][O: residual risk list][V: skipped commands include concrete reason, impact, and residual risk] Record validation outputs and skipped-gate rationale.
- [x] 9.2 [P1][depends:9.1][I: out-of-scope items][O: follow-up backlog][V: deferred items name a follow-up OpenSpec change or explicit "not now" rationale] List explicit follow-ups (e.g., second consumer for domain event runtime, telemetry revival, additional capability migrations).
- [x] 9.3 [P1][depends:9.1][I: scope deltas][O: priority calibration note][V: review record confirms no scope creep into archived harness changes or `src/features/files/**`] Confirm boundaries were respected.
