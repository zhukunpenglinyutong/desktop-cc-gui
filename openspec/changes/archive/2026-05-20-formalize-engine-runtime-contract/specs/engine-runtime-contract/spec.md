## ADDED Requirements

### Requirement: Engine Runtime Realtime Event Contract MUST Be Canonical

The system MUST treat the `NormalizedThreadEvent` shape defined in `src/features/threads/contracts/conversationCurtainContracts.ts` as the canonical realtime event contract for all supported engines (`claude` / `codex` / `gemini` / `opencode`). Each `NormalizedThreadEvent` MUST identify its semantics by the pair `(itemKind, operation)` plus the supporting fields `engine`, `workspaceId`, `threadId`, `eventId`, `timestampMs`, `item`, and `sourceMethod`. Engine-private event names captured as `sourceMethod` MAY exist as compatibility inputs but MUST NOT be treated as canonical semantics; canonical semantics live only in `(itemKind, operation)`.

#### Scenario: canonical semantics are expressed by (itemKind, operation)

- **WHEN** the system maps an engine realtime event to a `NormalizedThreadEvent`
- **THEN** the `itemKind` field MUST be one of the documented `NormalizedConversationItemKind` values (`message` / `reasoning` / `diff` / `review` / `explore` / `generatedImage` / `tool`)
- **AND** the `operation` field MUST be one of the documented operations: `itemStarted` / `itemUpdated` / `itemCompleted` / `appendAgentMessageDelta` / `completeAgentMessage` / `appendReasoningSummaryDelta` / `appendReasoningSummaryBoundary` / `appendReasoningContentDelta` / `appendToolOutputDelta`
- **AND** the rest of the payload MUST conform to the field shape declared by `NormalizedThreadEvent`

#### Scenario: engine-private event names are normalized through NORMALIZED_EVENT_DICTIONARY and recorded in sourceMethod

- **WHEN** an engine emits an event whose private name appears in `NORMALIZED_EVENT_DICTIONARY` (e.g. `assistant_message_delta`, `reasoning_delta`, `tool_call`, `tool_result`, `generated_image`, `image_generation_call`)
- **THEN** the adapter MUST normalize that private name to the corresponding `itemKind` via the dictionary
- **AND** the adapter MUST preserve the private name in `sourceMethod` so that legacy aliases remain traceable without being promoted to canonical semantics

#### Scenario: unknown realtime event MUST be dropped, MUST NOT mutate state, and MUST be assertable in tests

- **WHEN** an engine emits a realtime event whose private name is neither in `NORMALIZED_EVENT_DICTIONARY` nor matched by an adapter's documented branch
- **THEN** the adapter's `mapEvent(input)` MUST return `null`
- **AND** the adapter MUST NOT mutate normalized thread state for that event
- **AND** parity tests MUST assert this `null` outcome for at least one unknown-event fixture per engine
- **AND** this contract MUST NOT require a new "structured unknown event signal" runtime API on `RealtimeAdapter`; the existing `NormalizedThreadEvent | null` return is sufficient

### Requirement: Non-NormalizedThreadEvent Realtime Signals Are Out Of This Contract

The system's `NormalizedThreadEvent` shape covers conversation item evolution only. Other realtime signals — including turn lifecycle (`turn started / completed / error`), processing heartbeats, token usage updates, runtime lifecycle, and rate-limit notifications — flow through separate hooks and reducer paths and MUST NOT be re-expressed as `NormalizedThreadEvent` operations by this contract.

#### Scenario: turn lifecycle and usage signals are not encoded as NormalizedThreadEvent operations

- **WHEN** the system observes a turn lifecycle change or a usage update
- **THEN** that observation MUST flow through its existing dedicated channel (turn / usage / runtime hooks)
- **AND** it MUST NOT be encoded as a new `operation` value on `NormalizedThreadEvent`

#### Scenario: future runtime signal contracts are deferred to follow-up changes

- **WHEN** a future requirement proposes formalizing turn-lifecycle or usage-update contracts
- **THEN** that work MUST be introduced via a separate OpenSpec change with its own capability spec
- **AND** it MUST NOT silently extend `NormalizedThreadEvent`

### Requirement: Engine History Snapshot Contract MUST Be Semantically Equivalent To Replayed Realtime

The system MUST guarantee that, for the same conversation, applying a history snapshot from `HistoryLoader` and then resuming realtime ingestion produces a reducer state semantically equivalent to a full-realtime ingestion. History snapshots MAY compress reasoning / tool output deltas but MUST preserve user and assistant message identity, ordering, and completion status.

#### Scenario: history snapshot replay converges to the same reducer state as full realtime

- **WHEN** the system loads history via `sharedHistoryLoader` and then receives subsequent realtime events
- **THEN** the resulting reducer state for user message identity, assistant message identity, and turn lifecycle MUST equal the state produced by processing those same events purely via realtime path

#### Scenario: history snapshot does not duplicate already-visible realtime rows

- **WHEN** realtime path has already settled an assistant message
- **AND** history replay later provides an equivalent assistant message
- **THEN** the loader MUST recognize the equivalence and MUST NOT append a duplicate row

### Requirement: Adapter Registry MUST Be Statically Exhaustive Over Every EngineType

The `realtimeAdapterRegistry` MUST be a static `Record<ConversationEngine, RealtimeAdapter>` mapping that exhaustively covers every variant of `ConversationEngine`. Adding a new `ConversationEngine` variant MUST require adding the corresponding adapter in the same change set; otherwise the TypeScript compiler MUST reject the build.

#### Scenario: every ConversationEngine variant has a registered adapter

- **WHEN** the codebase is compiled with `tsc --noEmit`
- **THEN** every variant of `ConversationEngine` MUST be present as a key in `realtimeAdapterRegistry`
- **AND** the absence of any variant MUST be a typecheck failure

#### Scenario: no runtime registration or override path is introduced by this contract

- **WHEN** an adapter is needed at runtime
- **THEN** the resolution MUST use the static registry lookup
- **AND** there MUST NOT be a `registerAdapter()` or `overrideAdapter()` runtime API introduced by this contract

### Requirement: HistoryLoader Registry MUST Be Statically Exhaustive Over Every EngineType

The history loader entry points (`claudeHistoryLoader`, `codexHistoryLoader`, `geminiHistoryLoader`, `opencodeHistoryLoader` and `sharedHistoryLoader`) MUST collectively cover every supported engine. Adding a new engine MUST require providing a corresponding history loader in the same change set.

#### Scenario: every supported engine has a history loader

- **WHEN** the codebase is compiled
- **THEN** every supported engine MUST have a history loader entry point reachable from `sharedHistoryLoader`
- **AND** a missing loader MUST be detectable by typecheck or by the loader parity test

### Requirement: Cross-Engine Parity Test Matrix MUST Cover Canonical Event And History Semantics

The system MUST provide a cross-engine parity test matrix that exercises canonical realtime events and history snapshot semantics across all four supported engines. The matrix MUST live in `src/features/threads/contracts/` or `src/features/threads/adapters/` and be runnable via the standard `npm run test` path.

#### Scenario: parity tests cover the canonical (itemKind, operation) pairs and history equivalence for all four engines

- **WHEN** the parity test suite is executed
- **THEN** for each of `claude` / `codex` / `gemini` / `opencode`, the suite MUST assert correct `NormalizedThreadEvent` normalization for at least: assistant message delta (`itemKind=message`, `operation=appendAgentMessageDelta`), assistant message completion (`operation=completeAgentMessage`), reasoning delta (`itemKind=reasoning`, one of the `appendReasoning*` operations) **or** a documented "not supported" marker for that engine, tool output delta (`itemKind=tool`, `operation=appendToolOutputDelta`), and history-realtime convergence
- **AND** turn-lifecycle / usage / processing-heartbeat signals are explicitly out of this parity matrix per the prior requirement

#### Scenario: parity gaps are reported as test failures rather than silent skips

- **WHEN** a parity dimension is not yet supported by an engine
- **THEN** the test suite MUST encode this as an explicit "documented gap" marker, not as a silent skip
- **AND** removing the gap marker without replacement test MUST cause a test failure

### Requirement: Legacy Realtime Aliases MUST Be Documented As Compatibility Inputs

For every legacy realtime event alias accepted by adapters, the system MUST document the alias, the canonical event it maps to, and the engines that emit it. Legacy aliases MUST be classified as compatibility input only and MUST NOT appear as new canonical names in this contract.

#### Scenario: legacy alias list is enumerable and testable

- **WHEN** a legacy alias is accepted by `sharedRealtimeAdapter`
- **THEN** the alias MUST appear in a documented list (e.g. fixture, test table, or spec annex)
- **AND** removing acceptance of a documented alias MUST require an explicit follow-up change

### Requirement: Engine Runtime Contract MUST Be Validated By CI

The system MUST run focused TypeScript tests for adapter normalization, history equivalence, replay boundary, and cross-engine parity on every CI run. These tests MUST be platform-neutral and MUST pass on `ubuntu-latest`, `macos-latest`, and `windows-latest`.

#### Scenario: CI runs realtime contract tests on three platforms

- **WHEN** CI executes the frontend test job
- **THEN** `realtimeEventContract.test.ts`, `realtimeAdapters.test.ts`, `historyLoaders.test.ts`, `sharedHistoryLoader.test.ts`, `realtimeBoundaryGuard.test.ts`, and `realtimeReplayHarness.test.ts` MUST pass
- **AND** the same tests MUST pass on Linux, macOS, and Windows runners

#### Scenario: OpenSpec strict validation gates this capability

- **WHEN** CI or release validation runs OpenSpec validation
- **THEN** `openspec validate formalize-engine-runtime-contract --strict --no-interactive` MUST pass
