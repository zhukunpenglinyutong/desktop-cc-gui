# codex-context-auto-compaction Specification

## Purpose
TBD - created by archiving change codex-context-auto-compaction-runtime. Update Purpose after archive.
## Requirements
### Requirement: Codex Auto Compaction Trigger
The system MUST automatically trigger context compaction for Codex threads when context usage reaches the configured high-watermark.

#### Scenario: Skip auto compaction when disabled
- **WHEN** Codex auto compaction is disabled in app settings
- **AND** a Codex thread reports token usage percent greater than or equal to the configured compaction threshold
- **THEN** the runtime SHALL NOT start automatic context compaction for that thread

#### Scenario: Trigger compaction when threshold exceeded
- **WHEN** a Codex thread reports token usage percent greater than or equal to the configured compaction threshold
- **AND** Codex auto compaction is enabled
- **AND** the thread is not processing a user turn
- **THEN** the runtime SHALL start auto compaction for that thread

#### Scenario: Do not trigger below threshold
- **WHEN** a Codex thread reports token usage percent lower than the configured compaction threshold
- **THEN** the runtime SHALL NOT start auto compaction

### Requirement: Codex Auto Compaction Settings
Users MUST be able to configure Codex auto-compaction enabled state and threshold from the Codex background-info tooltip using bounded percentage choices.

#### Scenario: show enabled toggle in background-info tooltip
- **WHEN** the user opens the Codex background-info usage tooltip
- **THEN** the UI SHALL expose a switch for enabling or disabling automatic compaction

#### Scenario: show bounded threshold choices
- **WHEN** the user opens the Codex background-info usage tooltip
- **THEN** the UI SHALL offer `92%`, `100%`, `110%`, `120%`, `130%`, `140%`, `150%`, `160%`, `170%`, `180%`, `190%`, and `200%`

#### Scenario: sanitize invalid persisted threshold
- **WHEN** app settings contain a threshold outside the supported choices
- **THEN** the system SHALL fall back to `92%`

### Requirement: Codex Compaction Message Surface
Codex context compaction MUST be visible in the conversation message surface when the frontend receives real compaction lifecycle events, regardless of whether compaction was triggered automatically or by the user.

#### Scenario: show compaction start message
- **WHEN** frontend receives `thread/compacting` for a Codex thread
- **THEN** the conversation message surface SHALL show a visible message describing that Codex is compacting background information
- **AND** the thread SHALL continue using the existing compacting state for Composer context indicators

#### Scenario: settle latest compaction message on completion
- **WHEN** frontend receives `thread/compacted` for the same Codex thread
- **AND** the conversation message surface already contains the latest visible Codex compaction start message for that lifecycle
- **THEN** the conversation message surface SHALL update that latest compaction message to a completion message describing that Codex compacted background information
- **AND** duplicate compaction lifecycle events SHALL NOT create duplicate compaction messages for the same thread lifecycle

#### Scenario: append completion fallback when start message is missing
- **WHEN** frontend receives `thread/compacted` for a Codex thread with compaction source flags
- **AND** the conversation message surface does not contain a visible Codex compaction start message for that lifecycle
- **THEN** the conversation message surface SHALL append one completed compaction message for that lifecycle
- **AND** repeated completion events for the same lifecycle SHALL NOT append duplicate fallback messages

#### Scenario: manual compaction uses the same visible message path
- **WHEN** frontend receives `thread/compacting` or `thread/compacted` with `manual: true`
- **THEN** the conversation message surface SHALL show Codex compaction copy without claiming the trigger was automatic
- **AND** existing manual compaction state handling SHALL remain unchanged

#### Scenario: non-codex engines are unaffected
- **WHEN** a non-Codex thread receives compaction lifecycle events
- **THEN** the system SHALL NOT show Codex automatic compaction copy
- **AND** existing engine-specific compaction behavior SHALL remain unchanged

### Requirement: Codex-Only Compaction Scope
Auto compaction logic MUST be limited to Codex runtime sessions.

#### Scenario: Non-codex engines are unaffected
- **WHEN** a thread belongs to non-codex engines
- **THEN** auto compaction scheduling SHALL NOT execute for that thread
- **AND** existing thread behavior SHALL remain unchanged

### Requirement: Compaction Idempotency and Cooldown
The runtime MUST prevent duplicate or storm-style compaction requests for the same thread.

#### Scenario: Prevent duplicate while in-flight
- **WHEN** a thread already has an in-flight compaction request
- **THEN** the runtime SHALL NOT send another compaction request for that thread

#### Scenario: Respect cooldown window
- **WHEN** a thread has triggered auto compaction within the configured cooldown interval
- **THEN** the runtime SHALL NOT trigger another compaction request until cooldown expires

### Requirement: Failure-safe Behavior
Compaction failures MUST not block normal conversation flow.

#### Scenario: Compaction request fails
- **WHEN** runtime fails to start compaction for a thread
- **THEN** the thread SHALL remain available for normal send/receive turns
- **AND** runtime SHALL record failure diagnostics for observability
