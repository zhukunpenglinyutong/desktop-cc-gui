## ADDED Requirements

### Requirement: Realtime Conversation Client MUST Expose A Three-Engine Performance Budget
The client MUST define a shared performance budget for Codex, Claude Code, and Gemini realtime conversation turns so optimization decisions are evaluated against the same observable contract.

#### Scenario: streaming turn records client-side budget evidence
- **WHEN** a Codex, Claude Code, or Gemini turn enters realtime streaming
- **THEN** the client MUST be able to correlate event ingress cadence, batching flush cadence, reducer derivation cost, render-visible text cadence, and composer responsiveness evidence to the same workspace/thread/turn identity
- **AND** this evidence MUST remain bounded for long streaming turns

#### Scenario: budget evidence distinguishes engine-specific symptoms from shared client amplification
- **WHEN** Gemini, Claude Code, or Codex shows slow or choppy visible output
- **THEN** diagnostics MUST distinguish provider/upstream delay, backend forwarding stall, client reducer amplification, render amplification, and composer responsiveness degradation
- **AND** the system MUST NOT classify a shared client hot-path issue as a provider-specific issue solely because one engine exposed it first

### Requirement: Streaming Optimizations MUST Preserve Send-Critical Composer State
Realtime conversation optimizations MUST isolate high-frequency live conversation props from the composer without delaying or rewriting user-owned input state.

#### Scenario: live curtain updates do not drive composer input source of truth
- **WHEN** a conversation is streaming and the user is typing in the composer
- **THEN** deferred or throttled live props MAY be used for advisory status, context usage, rate limits, stream activity, and message items
- **AND** draft text, selection, IME composition state, attachments, and final send payload MUST remain immediate and canonical

#### Scenario: streaming completion converges deferred composer props
- **WHEN** a streaming turn completes after composer-facing live props were deferred
- **THEN** the composer MUST naturally converge to the latest canonical status and usage data
- **AND** stale advisory props MUST NOT remain visible after the turn has settled

### Requirement: Realtime Client Performance Changes MUST Be Rollback-Safe
Each client performance optimization layer MUST have a safe rollback path that restores baseline-compatible semantics without breaking session continuity.

#### Scenario: rollback disables one optimization layer without disabling diagnostics
- **WHEN** batching, incremental derivation, render pacing, or mitigation profile changes are disabled by a rollback flag
- **THEN** the client MUST continue processing realtime events with baseline-compatible semantics
- **AND** diagnostics MUST continue collecting enough evidence to compare baseline and optimized behavior

#### Scenario: rollback remains scoped to affected engine or layer
- **WHEN** a Claude/Gemini/Codex-specific profile or fast path is rolled back
- **THEN** unrelated engines and unrelated optimization layers MUST keep their existing behavior
- **AND** disabling one layer MUST NOT silently disable all realtime performance protections
