## ADDED Requirements

### Requirement: Manual Recovery Actions MUST Settle To Non-Contradictory Conversation State

Manual recovery actions on the conversation surface MUST leave lifecycle state consistent with the actual target thread that can accept future work.

#### Scenario: fresh fallback cannot masquerade as old conversation continuity
- **WHEN** a manual recovery action for a stale Codex thread creates a fresh replacement conversation
- **THEN** lifecycle state MUST identify the fresh thread as the active continuation target
- **AND** the UI MUST NOT claim that the old stale thread was restored in place

#### Scenario: failed manual recovery keeps the user in a recoverable state
- **WHEN** a manual recovery action fails to produce a usable target thread
- **THEN** the current conversation surface MUST leave processing state
- **AND** the recovery affordance MUST remain visibly failed or retryable instead of silently doing nothing

#### Scenario: runtime reconnect remains separate from conversation identity recovery
- **WHEN** runtime readiness succeeds during a stale thread recovery action
- **AND** the stale conversation identity still cannot be rebound
- **THEN** lifecycle state MUST NOT treat runtime readiness alone as successful conversation recovery
- **AND** the thread identity recovery outcome MUST determine whether the recovery card succeeds, fails, or offers fresh continuation
