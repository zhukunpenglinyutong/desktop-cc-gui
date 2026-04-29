## ADDED Requirements

### Requirement: Manual Stale Thread Recovery MUST Return A Classified Outcome

Codex stale thread manual recovery MUST distinguish verified thread rebind from fresh-thread fallback and unrecoverable failure.

#### Scenario: verified replacement reports rebound outcome
- **WHEN** `thread not found` recovery finds a verified replacement thread or successfully refreshes the original thread
- **THEN** the recovery result MUST be classified as `rebound`
- **AND** the result MUST include the target canonical `threadId`

#### Scenario: no verified replacement reports fresh fallback separately
- **WHEN** `thread not found` recovery cannot verify a replacement thread
- **AND** the system creates a new Codex thread for explicit user continuation
- **THEN** the recovery result MUST be classified as `fresh`
- **AND** the system MUST NOT treat that result as proof that the original stale thread was recovered

#### Scenario: no target reports failed outcome
- **WHEN** `thread not found` recovery cannot refresh, cannot verify a replacement, and cannot create a fresh thread
- **THEN** the recovery result MUST be classified as `failed`
- **AND** the UI MUST keep the recovery card actionable or visibly failed rather than silently clearing it

### Requirement: Recover And Resend MUST Make Fresh Fallback Visible

When a user explicitly chooses to recover and resend from a stale Codex thread recovery card, a fresh-thread fallback MUST visibly continue the user intent in the new thread.

#### Scenario: rebound resend preserves duplicate suppression
- **WHEN** recover-and-resend receives a `rebound` result
- **THEN** the resend path MUST preserve existing duplicate suppression for the previous user prompt
- **AND** the recovered canonical thread MUST remain the target of the resend

#### Scenario: fresh resend shows the replayed user prompt
- **WHEN** recover-and-resend receives a `fresh` result
- **THEN** the UI MUST switch to the fresh thread
- **AND** the resend path MUST render or otherwise visibly surface the replayed user prompt in that fresh thread

#### Scenario: failed recovery does not resend
- **WHEN** manual recovery returns `failed`
- **THEN** recover-and-resend MUST NOT send the previous prompt
- **AND** the recovery card MUST show a failure detail

### Requirement: Recover Only MUST Preserve Conservative Rebind Semantics

Recover-only stale thread actions MUST only report success for actual rebind outcomes.

#### Scenario: recover-only succeeds for rebound
- **WHEN** recover-only receives a `rebound` result
- **THEN** the UI MUST switch or remain on the canonical recovered thread
- **AND** the action MAY clear the failed recovery state

#### Scenario: recover-only does not present fresh fallback as recovered session
- **WHEN** recover-only receives a `fresh` result
- **THEN** the UI MUST NOT present the original stale thread as recovered
- **AND** the user MUST receive an explicit indication that continuing requires the fresh conversation path
