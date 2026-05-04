## ADDED Requirements

### Requirement: Baseline Presentation Profiles MUST Cover Codex Claude Code And Gemini
The client MUST define baseline presentation profiles for Codex, Claude Code, and Gemini independently from evidence-triggered mitigation profiles.

#### Scenario: baseline profile controls normal streaming cadence
- **WHEN** Codex, Claude Code, or Gemini is streaming without latency or visible-stall evidence
- **THEN** assistant Markdown throttle, reasoning throttle, staged Markdown behavior, and waiting/heartbeat affordances MUST come from the engine baseline presentation profile
- **AND** diagnostics MUST NOT report that turn as an active mitigation case solely because a baseline profile changed render cadence

#### Scenario: mitigation profile requires explicit evidence
- **WHEN** a stronger stream mitigation profile overrides baseline cadence
- **THEN** diagnostics MUST record the profile id, activation reason, evidence category, engine, platform, provider/model dimensions when available, and thread/turn correlation
- **AND** disabling that mitigation profile MUST return the engine to its baseline presentation profile

### Requirement: Gemini Streaming Profile MUST Preserve Reasoning And Assistant Visibility
Gemini baseline and mitigation profiles MUST preserve processing visibility and final semantic convergence while reducing render amplification.

#### Scenario: gemini long assistant output remains progressively visible
- **WHEN** Gemini streams a long assistant output
- **THEN** render pacing MAY throttle Markdown work
- **AND** visible assistant text MUST continue progressing or produce visible-stall diagnostics
- **AND** completed output MUST converge to the final Markdown surface without requiring history replay

#### Scenario: gemini reasoning stream keeps semantic row boundaries
- **WHEN** Gemini streams reasoning deltas or reasoning snapshots
- **THEN** throttle or batching MAY reduce UI amplification
- **AND** non-equivalent reasoning steps MUST NOT be collapsed into one semantic row
- **AND** waiting, ingress, and stop affordances MUST remain visible while the turn is processing
