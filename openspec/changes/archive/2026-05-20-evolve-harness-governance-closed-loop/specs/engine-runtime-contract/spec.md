## MODIFIED Requirements

### Requirement: Engine Runtime Contract MUST Be Validated By CI

The system MUST run focused TypeScript tests for adapter normalization, history equivalence, replay boundary, and cross-engine parity on every CI run. These tests MUST be platform-neutral and MUST pass on `ubuntu-latest`, `macos-latest`, and `windows-latest`. In addition, contract violations detected by the replay harness or the cross-engine parity matrix MUST be representable as `GovernanceEvidence` of source `engine-runtime-contract` through the governance evidence bridge.

#### Scenario: CI runs realtime contract tests on three platforms

- **WHEN** CI executes the frontend test job
- **THEN** `realtimeEventContract.test.ts`, `realtimeAdapters.test.ts`, `historyLoaders.test.ts`, `sharedHistoryLoader.test.ts`, `realtimeBoundaryGuard.test.ts`, and `realtimeReplayHarness.test.ts` MUST pass
- **AND** the same tests MUST pass on Linux, macOS, and Windows runners

#### Scenario: replay harness contract violation emits bridge evidence

- **WHEN** the replay harness or the cross-engine parity matrix detects a contract violation
- **THEN** the system MUST be able to emit `GovernanceEvidence` of source `engine-runtime-contract`
- **AND** the evidence MUST identify the engine, the violated requirement, and the offending fixture or event id

#### Scenario: OpenSpec strict validation gates this change

- **WHEN** CI or release validation runs OpenSpec validation
- **THEN** `openspec validate evolve-harness-governance-closed-loop --strict --no-interactive` MUST pass

## ADDED Requirements

### Requirement: Realtime Harness Evidence MUST Distinguish Pass, Warn, And Fail Outcomes

When the replay harness, batching gauge, or perf report produces a result, the emitted `engine-runtime-contract` evidence MUST encode one of `pass`, `warn`, or `fail` statuses. `warn` MUST be reserved for advisory thresholds (e.g., near-budget p95 latency); `fail` MUST be reserved for contract violations or replay divergence.

#### Scenario: replay divergence emits fail evidence

- **WHEN** the replay harness detects reducer state divergence between realtime and history paths
- **THEN** the emitted evidence MUST set `status: 'fail'`
- **AND** the evidence MUST identify the divergent reducer fields and the engine

#### Scenario: near-threshold perf report emits warn evidence

- **WHEN** the perf report shows p95 latency above the warn threshold but below the fail threshold
- **THEN** the emitted evidence MUST set `status: 'warn'`
- **AND** the evidence MUST NOT be elevated to `fail`

### Requirement: Bridge Evidence MUST NOT Replace The Authoritative Harness Exit Code

The bridge evidence path MUST be additive to the existing `npm run perf:realtime:boundary-guard` and parity test suites. The CLI / test exit codes remain authoritative for CI gating; bridge evidence is a complementary signal for UI, audit, and policy consumers.

#### Scenario: CLI/test exit code remains authoritative

- **WHEN** the realtime harness or parity test suite exits non-zero
- **THEN** the bridge evidence MUST NOT downgrade or suppress that failure
- **AND** CI MUST still treat the CLI/test exit code as authoritative

#### Scenario: bridge evidence is advisory for UI and policy

- **WHEN** UI or policy consumes runtime contract evidence from the bridge
- **THEN** the consumer MAY use the evidence as an explanatory signal
- **AND** the consumer MUST NOT replace the CLI/test check with a runtime-only signal

### Requirement: Runtime Contract Evidence MUST Normalize Platform-Specific Paths

Runtime contract evidence emitted from replay fixtures, perf reports, or parity matrices MUST normalize fixture ids and source paths before they enter the bridge. Evidence MUST NOT expose user-specific absolute paths, platform temp directories, or native path separators in audit-facing ids.

#### Scenario: replay fixture path is normalized

- **WHEN** a replay harness failure references a fixture through a native path
- **THEN** emitted `engine-runtime-contract` evidence MUST use a repository-relative normalized fixture id
- **AND** the same fixture MUST produce the same id on Windows, macOS, and Linux
