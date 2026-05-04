## ADDED Requirements

### Requirement: Gemini Live Assistant Delta MUST Use Lossless Realtime Batching
Gemini live assistant text deltas MUST participate in the same lossless realtime batching contract as other engine assistant deltas unless an explicit safety guard requires immediate dispatch.

#### Scenario: gemini assistant deltas are batched when batching is enabled
- **WHEN** realtime batching is enabled
- **AND** Gemini assistant text deltas arrive within the same flush window for the same thread
- **THEN** the client MUST buffer them through the realtime batching queue
- **AND** dispatch/render amplification MUST be reduced without losing any accepted delta

#### Scenario: gemini batching preserves processing and interruption semantics
- **WHEN** a Gemini assistant delta is buffered
- **THEN** the eventual flush MUST still ensure the thread, mark processing when appropriate, preserve original per-thread operation order, call message activity once per flush window, and respect interrupted-thread suppression
- **AND** unmount cleanup MUST flush or discard buffers according to the same lossless contract used by other engines

### Requirement: Reasoning And Tool Delta Reducers MUST Avoid Per-Chunk Full Derivation When Safe
High-frequency reasoning and tool output deltas MUST avoid full thread canonical derivation for repeated same-item updates when the thread structure is unchanged.

#### Scenario: reasoning delta updates existing live reasoning item incrementally
- **WHEN** a Claude Code, Gemini, or Codex-compatible reasoning delta appends or snapshots text for an existing reasoning item
- **AND** no item kind, item order, generated-image anchoring, ask-user normalization, exploration summary, or tool truncation boundary can change
- **THEN** the reducer MUST update only the affected reasoning item
- **AND** it MUST NOT run full `prepareThreadItems(...)` for that delta

#### Scenario: tool output delta updates existing live tool item incrementally
- **WHEN** a tool output delta appends text to an existing running tool item
- **AND** the update does not cross a truncation boundary requiring canonical tool output processing
- **THEN** the reducer MUST update only the affected tool item
- **AND** it MUST NOT run full `prepareThreadItems(...)` for that delta

#### Scenario: structural boundaries return to canonical derivation
- **WHEN** a new item is inserted, an item completes, a tool output crosses truncation policy boundaries, a generated image anchor may change, or legacy id canonicalization is required
- **THEN** the reducer MUST run the canonical derivation path
- **AND** final thread items MUST preserve existing dedupe, truncation, generated image anchoring, ask-user normalization, exploration summary, and metadata semantics

### Requirement: Normalized Realtime Assistant Events MUST Coalesce By Engine-Agnostic Safety Rules
Normalized realtime assistant events MUST be eligible for batching/coalescing based on operation and item semantics rather than Codex-only engine identity when they satisfy the same snapshot-equivalence safety contract.

#### Scenario: safe assistant snapshot events coalesce by item identity
- **WHEN** normalized realtime assistant `itemStarted` or `itemUpdated` events arrive for the same thread and item identity within one flush window
- **AND** the events are safe to replace with the latest snapshot without losing semantic ordering
- **THEN** the client MUST coalesce them by thread/item identity
- **AND** this rule MUST be available to Codex, Claude Code, and Gemini when their normalized events satisfy the same safety contract

#### Scenario: non-snapshot or completion events preserve full ordering
- **WHEN** normalized realtime events represent completion, tool/review/generated-image changes, user messages, or any non-equivalent operation
- **THEN** the client MUST preserve the full event sequence
- **AND** it MUST NOT coalesce events merely because they share an item id
