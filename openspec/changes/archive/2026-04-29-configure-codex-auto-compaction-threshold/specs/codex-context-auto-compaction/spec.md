## MODIFIED Requirements

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
