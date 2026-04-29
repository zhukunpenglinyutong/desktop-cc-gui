## ADDED Requirements

### Requirement: Codex Stalled Turn MUST Quarantine Late Events For The Settled Turn

When a Codex foreground turn enters stalled, dead-recoverable, abandoned, or equivalent terminal liveness settlement, the system MUST prevent late events from that same old turn from reviving normal processing state.

#### Scenario: late event after no-progress stall is diagnostic-only
- **WHEN** a Codex foreground turn has been marked stalled due to a bounded no-progress timeout
- **AND** a later realtime event arrives for the same `threadId` and `turnId`
- **THEN** the system MUST record the late event as diagnostic evidence
- **AND** the event MUST NOT mark the thread as processing, active, or generating again

#### Scenario: successor turn remains live
- **WHEN** a Codex foreground turn has been marked stalled
- **AND** a later realtime event arrives for the same thread but a different active successor `turnId`
- **THEN** the system MUST allow the successor event to update conversation state normally
- **AND** the old stalled turn quarantine MUST NOT suppress the successor turn

### Requirement: Codex Execution-Active No-Progress Window MUST Be Twenty Minutes

Codex stalled recovery MUST use a 1200-second execution-active no-progress window for foreground turns that have active command, tool, file-change, or equivalent execution items.

#### Scenario: quiet execution is not stalled at fifteen minutes
- **WHEN** a Codex foreground turn has an active execution item
- **AND** no progress evidence arrives for 900 seconds
- **THEN** the system MUST keep the turn out of stalled settlement
- **AND** the thread MUST remain eligible to continue receiving progress evidence

#### Scenario: quiet execution stalls at twenty minutes
- **WHEN** a Codex foreground turn has an active execution item
- **AND** no terminal event, stream delta, tool event, user-input request, approval request, or equivalent progress evidence arrives for 1200 seconds
- **THEN** the turn MUST transition to `stalled`, `dead-recoverable`, or an equivalent recoverable liveness state
- **AND** the thread MUST NOT remain indefinitely in normal processing state

#### Scenario: tool progress resets execution-active window
- **WHEN** a Codex foreground turn has an active execution item
- **AND** an `item/started`, `item/updated`, `item/completed`, tool output delta, assistant delta, or equivalent normalized realtime event arrives before the execution-active timeout
- **THEN** the system MUST treat that event as progress evidence
- **AND** the 1200-second no-progress window MUST be measured from that latest progress evidence
