## ADDED Requirements

### Requirement: Governance Evidence MUST Be A Typed In-Memory Discriminated Union

The system MUST expose a single `GovernanceEvidence` discriminated union, keyed by `source`, that normalizes governance signals coming from OpenSpec validation, large-file governance, heavy-test-noise sentry, realtime harness, engine capability matrix, engine runtime contract, and cost budget. Every variant MUST share a common envelope describing `id`, `source`, `status`, `degraded`, `degradationReason?`, `staleAt?`, and `updatedAt`. Variant-specific fields MUST be encoded under a typed `payload` field.

The bridge MUST evolve the existing workspace governance evidence readers under `src/features/governance/evidence/**`, whose current source ids are `openspec`, `trellis`, `script`, and `workflow`, until those readers are explicitly migrated with regression tests. The system MUST NOT introduce a second unconnected governance evidence bridge for policy input.

#### Scenario: every evidence variant carries the common envelope

- **WHEN** any source adapter produces a `GovernanceEvidence` value
- **THEN** the value MUST include `id`, `source`, `status`, `degraded`, and `updatedAt`
- **AND** `status` MUST be one of `pass`, `warn`, `fail`, or `unknown`
- **AND** the variant `payload` MUST conform to the discriminated shape declared for that `source`

#### Scenario: adding a new source requires an OpenSpec change

- **WHEN** a contributor proposes a new evidence `source`
- **THEN** the addition MUST be introduced through an OpenSpec change that updates this capability
- **AND** ad-hoc additions to the union without a corresponding spec change MUST be rejected by typecheck or by the bridge conformance check

#### Scenario: existing governance evidence readers remain compatible

- **WHEN** the bridge is introduced
- **THEN** existing readers under `src/features/governance/evidence/**` MUST continue to compile
- **AND** the current StatusPanel governance evidence surface MUST continue to render `openspec`, `trellis`, `script`, and `workflow` evidence or an explicitly wrapped equivalent

#### Scenario: policy and UI consume the same bridge substrate

- **WHEN** bridge-fed policies consume governance evidence
- **THEN** they MUST consume a snapshot derived from the same canonical bridge substrate used by `useGovernanceEvidence` or its migrated replacement
- **AND** no parallel bridge module may bypass existing workspace evidence compatibility tests

### Requirement: Bridge Snapshot MUST Be Pure, In-Memory, And Deterministic

The system MUST expose a framework-free snapshot core that returns a frozen, deterministic projection of all current evidence. React hooks such as `useGovernanceEvidence` MAY wrap that core for loading and rendering, but policy evaluation MUST receive the snapshot through `CheckpointPolicyEvidence` or an equivalent policy input object. Policy code MUST NOT import React hooks, Tauri workspace readers, or collection runtimes. Snapshots MUST NOT be persisted to disk, IndexedDB, localStorage, or any backend storage, and MUST NOT cross process boundaries.

#### Scenario: snapshot identity is stable within a commit

- **WHEN** the same snapshot is read twice within a single React commit
- **THEN** the returned reference MUST be identical
- **AND** the snapshot contents MUST be deeply equal

#### Scenario: snapshot core is independent from React and Tauri

- **WHEN** the snapshot core is tested in isolation
- **THEN** it MUST construct and freeze snapshots without mounting React hooks
- **AND** it MUST NOT require Tauri workspace ids, `getWorkspaceFiles`, or `readWorkspaceFile`

#### Scenario: snapshot is not persisted

- **WHEN** the bridge produces a snapshot
- **THEN** the snapshot MUST NOT be written to localStorage, IndexedDB, the filesystem, or any backend
- **AND** the snapshot MUST NOT be published over Tauri IPC, WebSocket, worker channel, or any cloud transport

#### Scenario: snapshot is safe to read from policy evaluate

- **WHEN** a policy `evaluate` function receives a snapshot through its evidence input
- **THEN** the policy MUST NOT mutate the snapshot
- **AND** the policy MUST NOT perform I/O while consuming the snapshot
- **AND** the policy MUST NOT call `useGovernanceEvidence` or any other React hook

#### Scenario: snapshot metadata links UI evidence and policy audit

- **WHEN** the same snapshot is used to render `GovernanceEvidenceSection` and evaluate bridge-fed policies
- **THEN** bridge-fed policy decisions MUST reference the snapshot identity through `evidenceSnapshotId`
- **AND** audit consumers MUST be able to trace each policy decision back to the evidence source in that snapshot

### Requirement: Source Adapters MUST Be Pure And Push-Based

Each source adapter MUST convert raw governance output into evidence without performing shell execution, network requests, or arbitrary filesystem reads inside a render or policy path. Reads from on-disk governance artifacts (e.g., OpenSpec validation cache, large-file report) MUST occur in a dedicated collection runtime before snapshot creation. That runtime MUST hand normalized raw input to adapters; adapters and consumers MUST NOT read arbitrary files themselves.

#### Scenario: adapter does not shell out during render or evaluate

- **WHEN** a snapshot is consumed by render code or by a policy `evaluate`
- **THEN** no source adapter or consumer MUST execute a shell command, spawn a child process, perform filesystem I/O, or open a network socket on the consumption path

#### Scenario: collection runtime owns artifact reads

- **WHEN** a governance report must be read from disk
- **THEN** the read MUST happen in the collection runtime before the frozen snapshot is created
- **AND** the resulting adapter input MUST be deterministic and testable without shell execution

#### Scenario: missing source produces unknown evidence

- **WHEN** a source artifact is unavailable (e.g., report file missing)
- **THEN** the adapter MUST produce evidence with `status: 'unknown'`
- **AND** the evidence MUST set `degraded: true` with a documented `degradationReason`

### Requirement: Stale And Degraded Evidence MUST Be Distinguishable From Healthy Evidence

The bridge MUST distinguish three quality states: healthy (`degraded: false`, `staleAt` absent or in future), degraded (`degraded: true` with an explicit `degradationReason`), and stale (`staleAt` indicates the evidence is past its freshness window). Consumers MUST be able to differentiate the three states without inspecting variant-specific payloads.

#### Scenario: degraded evidence carries an explicit reason

- **WHEN** an adapter emits evidence with `degraded: true`
- **THEN** the evidence MUST set `degradationReason` to a documented enum value
- **AND** the reason MUST be representable as an i18n key for downstream rendering

#### Scenario: stale evidence is tagged but still consumable

- **WHEN** evidence has passed its freshness window
- **THEN** the bridge MUST keep the evidence in the snapshot but mark `staleAt`
- **AND** consumers MUST be able to detect staleness without re-running the source

### Requirement: Bridge MUST Be Validated By A Conformance Check

The system MUST provide a check named `npm run check:governance-evidence-bridge` that asserts: union exhaustiveness, snapshot determinism, adapter purity (no shell, filesystem read, or network inside snapshot consumption), absence of persistence/transport calls, compatibility with the existing workspace governance evidence readers, and absence of a second unconnected policy bridge. The check MUST run on Linux, macOS, and Windows.

#### Scenario: conformance check fails on a non-exhaustive consumer

- **WHEN** a consumer adds a switch over `source` that omits a variant
- **THEN** typecheck or the conformance check MUST fail

#### Scenario: conformance check passes on three platforms

- **WHEN** CI executes the conformance check on Linux, macOS, and Windows
- **THEN** the check MUST pass on all three platforms

### Requirement: Evidence Identity And Report Parsing MUST Be Cross-Platform Stable

The bridge MUST produce byte-stable evidence ids, source identifiers, and parsed report payloads across Windows, macOS, and Linux, except for explicitly documented timestamp fields. Evidence identity MUST use repository-relative normalized paths and MUST NOT depend on native path separators, absolute machine paths, platform temp directories, or filesystem case sensitivity.

#### Scenario: native paths are normalized before entering evidence

- **WHEN** a source artifact is discovered through a native filesystem path
- **THEN** the bridge MUST normalize the evidence-facing path to a repository-relative POSIX-style path
- **AND** the emitted evidence MUST NOT include user-specific absolute paths

#### Scenario: Windows path separators do not change evidence identity

- **WHEN** the same report is parsed from `src\\features\\x.ts` on Windows and `src/features/x.ts` on Linux or macOS
- **THEN** the emitted evidence id and source path MUST be identical after normalization

#### Scenario: CRLF and LF reports parse equivalently

- **WHEN** a governance report uses CRLF line endings on Windows and LF line endings on Linux or macOS
- **THEN** the parsed evidence payload MUST be equivalent
- **AND** policy decisions derived from the payload MUST be deterministic

### Requirement: Bridge Tooling MUST Avoid POSIX-Only Shell Assumptions

Bridge collection and validation tooling MUST run through platform-neutral Node/TypeScript entrypoints. Package scripts and checker implementations introduced by this change MUST NOT rely on inline POSIX shell syntax, `bash`-only behavior, `grep` / `sed` / `awk`, `/tmp`, `/dev/null`, shell glob expansion, or executable-bit assumptions.

#### Scenario: package script runs under Windows shell

- **WHEN** `npm run check:governance-evidence-bridge` runs on `windows-latest`
- **THEN** it MUST execute through a Node/TypeScript entrypoint
- **AND** it MUST NOT require `bash`, POSIX utilities, or Unix path syntax

#### Scenario: temp and artifact paths are platform-neutral

- **WHEN** bridge tests create temporary files or artifact paths
- **THEN** they MUST use Node APIs such as `os.tmpdir()` and `path.join()`
- **AND** the evidence-facing output MUST still be normalized to repository-relative POSIX-style paths
