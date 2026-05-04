## MODIFIED Requirements

### Requirement: ConversationAssembler MUST Be The Shared Semantic Assembly Boundary

`ConversationAssembler` MUST serve as the shared semantic assembly boundary for `Codex`、`Claude Code` 与 `Gemini` realtime observations and history snapshots before conversation-visible state is consumed by lifecycle-aware clients.

#### Scenario: codex history hydrate is canonicalized before reducer-visible items are read

- **WHEN** a `Codex` history loader returns a snapshot for initial open, reopen, or reconcile refresh
- **THEN** the system MUST assemble that snapshot through `ConversationAssembler.hydrateHistory()`
- **AND** lifecycle consumers MUST read the assembled items rather than raw loader items

#### Scenario: claude history hydrate is canonicalized before reducer-visible items are read

- **WHEN** a `Claude Code` history loader returns JSONL-derived or shared-session-derived conversation items
- **THEN** the system MUST assemble that snapshot through `ConversationAssembler.hydrateHistory()` or an equivalent shared assembler entrypoint
- **AND** reducer-visible items MUST be assembled canonical items rather than raw loader-local rows

#### Scenario: gemini history hydrate is canonicalized before reducer-visible items are read

- **WHEN** a `Gemini` history loader returns parsed assistant、reasoning、tool 或 user items
- **THEN** the system MUST assemble that snapshot through `ConversationAssembler.hydrateHistory()` or an equivalent shared assembler entrypoint
- **AND** downstream lifecycle consumers MUST NOT reinterpret raw Gemini history payload semantics

#### Scenario: equivalent history replay preserves visible row cardinality

- **WHEN** a thread already converged locally for user, assistant, reasoning, or tool rows
- **AND** a later history replay provides only equivalent semantic observations
- **THEN** the assembled history state MUST preserve the same visible row cardinality
- **AND** replay MAY only update canonical ids, metadata, or structured facts

### Requirement: Normalized Realtime Input MUST Have An Assembly Boundary

Normalized realtime input MUST have a reusable assembly boundary so adapter outputs can be converged without reinterpreting raw engine payload semantics. This boundary MUST be available for `Codex`、`Claude Code` 与 `Gemini` main realtime adapter outputs.

#### Scenario: normalized codex event can assemble canonical conversation state

- **WHEN** a `Codex` realtime adapter emits normalized conversation observations
- **THEN** the system MUST provide an assembly path that can converge those observations into canonical conversation items
- **AND** that path MUST remain compatible with the same semantic rules used for history hydrate

#### Scenario: normalized claude event can assemble canonical conversation state

- **WHEN** a `Claude Code` realtime adapter emits assistant text、reasoning、tool snapshot、approval、or plan observations
- **THEN** the system MUST provide an assembly path that can converge those observations into canonical conversation items
- **AND** the reducer MUST NOT need raw Claude CLI carrier fields to dedupe equivalent history replay

#### Scenario: normalized gemini event can assemble canonical conversation state

- **WHEN** a `Gemini` realtime adapter emits assistant text、reasoning、or tool observations
- **THEN** the system MUST provide an assembly path that can converge those observations into canonical conversation items
- **AND** Gemini-specific telemetry gaps MAY degrade metadata richness but MUST NOT bypass semantic row convergence

#### Scenario: legacy runtime handlers may coexist without changing visible semantics

- **WHEN** part of the runtime still routes normalized events through legacy handlers during migration
- **THEN** visible conversation semantics MUST remain equivalent to the shared assembly contract
- **AND** migration staging MUST NOT change duplicate-collapse or lifecycle outcomes

### Requirement: ConversationAssembler MUST Reuse Shared Normalization Semantics

`ConversationAssembler` MUST reuse the shared conversation normalization semantics for user, assistant, reasoning, and conversation-visible tool equivalence rather than maintaining a second comparator policy.

#### Scenario: assembler user equivalence matches curtain normalization

- **WHEN** an optimistic or queued-handoff user bubble is compared with an authoritative history observation
- **THEN** assembler equivalence MUST apply the same wrapper-stripping and canonical comparison semantics as the shared normalization core
- **AND** the system MUST NOT keep duplicate user bubbles because assembler and reducer disagree

#### Scenario: assembler assistant and reasoning equivalence match curtain normalization

- **WHEN** assistant replay or reasoning snapshot observations are assembled from realtime or history sources
- **THEN** assembler equivalence MUST match the shared normalization core for duplicate collapse
- **AND** the system MUST NOT reintroduce duplicate assistant or reasoning rows through assembler-local comparator drift

#### Scenario: engine-specific loaders do not own independent comparator policy

- **WHEN** Claude or Gemini loaders need to merge adjacent fragments or replayed snapshots
- **THEN** they MUST call shared normalization / assembler helpers or preserve enough raw observations for assembler convergence
- **AND** loader-local comparator logic MUST remain a thin adapter, not a second source of truth
