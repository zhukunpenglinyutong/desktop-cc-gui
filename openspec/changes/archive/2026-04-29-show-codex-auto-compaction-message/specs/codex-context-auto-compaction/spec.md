## ADDED Requirements

### Requirement: Codex Compaction Message Surface
Codex context compaction MUST be visible in the conversation message surface when the frontend receives real compaction lifecycle events, regardless of whether compaction was triggered automatically or by the user.

#### Scenario: show compaction start message
- **WHEN** frontend receives `thread/compacting` for a Codex thread
- **THEN** the conversation message surface SHALL show a visible message describing that Codex is compacting background information
- **AND** the thread SHALL continue using the existing compacting state for Composer context indicators

#### Scenario: settle compaction message on completion
- **WHEN** frontend receives `thread/compacted` for the same Codex thread
- **THEN** the conversation message surface SHALL show a completion message describing that Codex compacted background information
- **AND** duplicate compaction lifecycle events SHALL NOT create duplicate compaction messages for the same thread lifecycle

#### Scenario: manual compaction uses the same visible message path
- **WHEN** frontend receives `thread/compacting` or `thread/compacted` with `manual: true`
- **THEN** the conversation message surface SHALL show Codex compaction copy without claiming the trigger was automatic
- **AND** existing manual compaction state handling SHALL remain unchanged

#### Scenario: non-codex engines are unaffected
- **WHEN** a non-Codex thread receives compaction lifecycle events
- **THEN** the system SHALL NOT show Codex automatic compaction copy
- **AND** existing engine-specific compaction behavior SHALL remain unchanged
