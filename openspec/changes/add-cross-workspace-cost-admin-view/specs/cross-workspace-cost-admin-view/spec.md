## ADDED Requirements

### Requirement: Cross-Workspace Cost Admin MUST Be Deferred From Current Harness Governance

This capability MUST NOT be implemented as part of the current harness governance layer.

#### Scenario: current harness pass excludes cost admin

- **WHEN** the current harness governance implementation scope is selected
- **THEN** cross-workspace cost admin storage and UI MUST be excluded

### Requirement: Future Cost Admin MUST Consume Cost-Budget Projection

If revived, this capability MUST consume cost values already projected by cost-budget and MUST NOT recompute pricing independently.

#### Scenario: no parallel pricing computation

- **WHEN** future implementation appends a cost record
- **THEN** its cost value MUST come from cost-budget projection
- **AND** it MUST NOT bypass cost-budget by directly recomputing pricing

### Requirement: Future Cost Admin MUST Define Privacy And Retention Before Storage

Future implementation MUST define retention and export sanitization before introducing durable storage.

#### Scenario: storage requires retention

- **WHEN** durable cost records are introduced
- **THEN** a retention policy MUST be specified before records are written

#### Scenario: export excludes sensitive content

- **WHEN** export is introduced
- **THEN** it MUST exclude prompts and filesystem paths
