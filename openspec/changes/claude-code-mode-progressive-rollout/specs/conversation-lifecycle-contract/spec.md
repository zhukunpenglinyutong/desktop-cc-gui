## MODIFIED Requirements

### Requirement: Unified Cross-Engine Conversation Lifecycle Contract
The system MUST define consistent lifecycle semantics (delete, recent ordering, restart visibility, key tool card recoverability, runtime mode input handling, and approval continuity) across Claude, Codex, and OpenCode.

#### Scenario: lifecycle contract applies to all engines
- **WHEN** the system executes lifecycle-related conversation operations
- **THEN** semantics MUST remain consistent across all three engines
- **AND** engine-specific differences MUST stay inside internal adapter layers

#### Scenario: key tool card lifecycle parity across engines
- **WHEN** `commandExecution` or `fileChange` cards are produced in any engine session
- **THEN** lifecycle semantics for visibility and recovery MUST be equivalent across engines
- **AND** engine adapter differences MUST NOT leak to user-visible card continuity

#### Scenario: restart replay preserves key tool card continuity
- **WHEN** user restarts the app and reopens the same conversation
- **THEN** previously visible `commandExecution` and `fileChange` cards MUST be replayed from persisted history
- **AND** replayed card semantics MUST match pre-restart behavior

#### Scenario: runtime mode selection stays user-visible and effective
- **WHEN** user selects an engine mode that is exposed as available in conversation UI
- **THEN** that mode MUST remain a real runtime input for the target engine
- **AND** product-layer initialization MUST NOT silently override it before send

## ADDED Requirements

### Requirement: Claude Progressive Mode Rollout MUST Preserve Conversation Continuity

Claude mode availability changes MUST preserve conversation lifecycle continuity and MUST NOT require users to switch to a different engine contract.

#### Scenario: current claude mode expansion does not reset thread flow
- **WHEN** Claude exposes `default`, `plan`, and `full-access`
- **THEN** existing Claude thread creation and message send flow MUST remain continuous
- **AND** previously working `full-access` conversations MUST continue without lifecycle regression

#### Scenario: approval-dependent claude modes stay inside existing event stream
- **WHEN** Claude mode execution requires GUI approval
- **THEN** approval requests MUST flow through the existing conversation event stream
- **AND** user-visible lifecycle progression MUST remain consistent with other engines using the same approval surface

### Requirement: Claude Synthetic Approval Resume MUST Preserve History Recoverability

Claude synthetic approval handling MUST preserve both live continuity and restart recoverability.

#### Scenario: approval completion resumes the interrupted claude turn
- **WHEN** the last pending Claude synthetic approval in a turn is resolved
- **THEN** runtime MUST continue the interrupted Claude session instead of ending permanently at the approval summary
- **AND** the user MUST still receive the post-approval execution result in the same conversation flow

#### Scenario: synthetic approval markers do not leak into user-visible history
- **WHEN** approval resume metadata is carried through Claude history using an internal marker payload
- **THEN** loaders and thread item parsing MUST strip the raw marker from visible text
- **AND** the payload MUST be reconstructed into structured lifecycle items such as `File changes`

#### Scenario: multi-approval turns finalize only after the last request resolves
- **WHEN** multiple Claude approvals are pending for the same turn
- **THEN** the conversation MUST remain resumable until every pending approval is answered
- **AND** intermediate approvals MUST NOT prematurely finalize the turn

### Requirement: Claude Inline Approval Surface MUST Stay Decision-Oriented

Claude synthetic approvals MUST remain readable and decision-oriented in the shared conversation surface rather than degrading into generic notices or raw content dumps.

#### Scenario: inline approval renders as a distinct approval card near the active turn tail
- **WHEN** Claude synthetic approval is rendered inline inside the message canvas
- **THEN** the UI MUST present it as a visually distinct approval card with clear approval affordance
- **AND** the inline placement MUST anchor near the bottom of the active conversation flow instead of occupying the top reading entry

#### Scenario: approval detail hides large raw content fields by default
- **WHEN** Claude synthetic approval payload contains large raw body fields such as `content`, `diff`, `patch`, or equivalent rewritten text
- **THEN** the inline approval detail MUST hide those raw fields by default
- **AND** the card MUST continue surfacing compact decision-critical metadata such as path, command summary, tool label, or approval note

### Requirement: Exit Plan Handoff MUST Keep UI Mode And Execution Mode In Sync

When Claude `plan` execution reaches `ExitPlanMode`, the UI MUST require an explicit execution-mode choice and MUST NOT leave the conversation selector showing `plan` after execution starts.

#### Scenario: exit plan card offers explicit execution mode choices
- **WHEN** Claude renders an `ExitPlanMode` handoff card after plan confirmation
- **THEN** the card MUST state that continuing execution requires leaving planning mode
- **AND** it MUST provide explicit actions for `default` and `full-access`

#### Scenario: choosing default approval mode syncs selector before execution
- **WHEN** user clicks the `default` execution action from the `ExitPlanMode` card
- **THEN** the collaboration selector MUST leave `plan`
- **AND** the access selector MUST switch to `default`
- **AND** the follow-up implementation prompt MUST run with `default` access mode

#### Scenario: choosing full access syncs selector before execution
- **WHEN** user clicks the `full-access` execution action from the `ExitPlanMode` card
- **THEN** the collaboration selector MUST leave `plan`
- **AND** the access selector MUST switch to `full-access`
- **AND** the follow-up implementation prompt MUST run with `full-access`

#### Scenario: historical claude thread still enforces read-only while plan mode is active
- **WHEN** user reopens an existing Claude thread, switches conversation UI to `plan`, and sends a follow-up request
- **THEN** runtime MUST send the follow-up turn as `read-only`
- **AND** stale writable access state from the same thread MUST NOT leak through and allow file creation or approval prompts
