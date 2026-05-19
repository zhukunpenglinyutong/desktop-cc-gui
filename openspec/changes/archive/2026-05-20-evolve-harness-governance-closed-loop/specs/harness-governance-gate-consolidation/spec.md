## ADDED Requirements

### Requirement: Harness Gates MUST Consolidate Through Governance Evidence

The system MUST project realtime replay harness, batching/perf reports, OpenSpec validation, large-file governance, heavy-test-noise sentry, engine capability matrix, and engine runtime contract results into `GovernanceEvidence` variants. The consolidated checkpoint or release gate decision MUST be a pure function of the bridge snapshot. Consolidation MUST NOT execute any check itself.

#### Scenario: consolidated decision cites each contributing gate

- **WHEN** the consolidated gate decision is produced
- **THEN** the decision MUST list each contributing evidence `source` and `status`
- **AND** the decision MUST be reproducible from the same snapshot

#### Scenario: consolidation does not run checks

- **WHEN** the consolidator computes a decision
- **THEN** it MUST NOT execute shell commands, spawn child processes, or perform filesystem I/O during consolidation

### Requirement: Severity Composition MUST Preserve Per-Gate Audit

The system MUST compose gate severities by selecting the most severe contributing status (`fail` > `warn` > `unknown` > `pass`). All non-`pass` contributions MUST remain visible in the consolidated decision so that audit surfaces can render per-gate explanation.

#### Scenario: most severe gate wins

- **WHEN** one gate is `fail` and others are `warn` or `pass`
- **THEN** the consolidated status MUST be `fail`

#### Scenario: warn-only set yields warn

- **WHEN** every contributing gate is `warn` or `pass` and at least one is `warn`
- **THEN** the consolidated status MUST be `warn`

#### Scenario: unknown is surfaced, not hidden

- **WHEN** a gate contributes `unknown` and no other gate contributes `fail` or `warn`
- **THEN** the consolidated status MUST be `unknown`
- **AND** the consumer MUST be able to identify which gate is unknown

### Requirement: Advisory Gates MUST NOT Block Release Alone

Heavy-test-noise sentry results and large-file near-threshold (watchlist) results MUST be treated as advisory. They MUST contribute at most `warn` to the consolidated decision. Hard release blocking MUST come from non-advisory gates such as realtime contract violations, OpenSpec strict-validation failures, or large-file hard-debt regressions.

#### Scenario: heavy-test-noise alone never blocks release

- **WHEN** heavy-test-noise sentry is the only gate reporting an issue
- **THEN** the consolidated status MUST NOT be `fail`
- **AND** the consolidated status MUST be `warn` or weaker

#### Scenario: near-threshold large-file alone never blocks release

- **WHEN** large-file near-threshold is the only gate reporting an issue
- **THEN** the consolidated status MUST NOT be `fail`

### Requirement: Consolidated Decision MUST Be Consumable By Policy Chain And Audit Surface

The consolidated decision MUST be exposed in a shape that the existing checkpoint policy chain can consume as evidence, and that the existing audit surface can render. The decision MUST NOT introduce a new StatusPanel tab or settings dashboard in this change.

#### Scenario: policy chain consumes consolidated decision

- **WHEN** the policy chain evaluates evidence containing the consolidated decision
- **THEN** the policy chain MUST be able to extract per-gate severity and reason
- **AND** the consumption MUST NOT require shell execution or filesystem reads

#### Scenario: audit surface renders consolidated decision inline

- **WHEN** the audit surface renders policy decisions derived from the consolidated decision
- **THEN** the surface MUST render per-gate id, status, and `degradationReason` when present
- **AND** no separate audit tab MUST be added by this capability

### Requirement: Consolidation MUST Be Validated On Three Platforms

The system MUST validate consolidation behavior on `ubuntu-latest`, `macos-latest`, and `windows-latest`. The validation MUST cover severity composition, advisory ceiling, bridge snapshot consumption, normalized evidence ids, CRLF/LF report parsing, and path separator normalization without depending on platform-specific paths or shell behavior.

#### Scenario: consolidation tests pass on three platforms

- **WHEN** CI runs the consolidation validation suite
- **THEN** the suite MUST pass on Linux, macOS, and Windows runners

#### Scenario: consolidated decision is stable across path formats

- **WHEN** contributing evidence uses Windows-style and POSIX-style source paths for the same repository-relative file
- **THEN** the consolidated decision MUST cite one normalized source id
- **AND** the severity composition MUST be identical on Linux, macOS, and Windows

#### Scenario: OpenSpec strict validation gates this capability

- **WHEN** CI or release validation runs OpenSpec validation
- **THEN** `openspec validate evolve-harness-governance-closed-loop --strict --no-interactive` MUST pass
