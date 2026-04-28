## ADDED Requirements

### Requirement: Codex Background Helper Rollouts MUST Stay Out Of Default Conversation Projection

Codex unified history projection MUST exclude known background/helper rollouts from default conversation surfaces even when those rollouts are readable from local session files or live thread rows.

#### Scenario: memory writing helper rollout is hidden

- **WHEN** local Codex session scanning finds a rollout whose visible prompt is a known memory writing consolidation helper
- **THEN** unified Codex sidebar projection MUST NOT emit it as a normal conversation entry
- **AND** the same logical row MUST remain hidden when a live row and local aliases refer to the same helper session

#### Scenario: normal Codex user prompt remains visible

- **WHEN** a Codex session has a normal user prompt that does not match a known background/helper signature
- **THEN** unified Codex projection MUST keep returning that conversation when it belongs to the current workspace
- **AND** helper filtering MUST NOT hide it merely because the text casually mentions memory or background work
