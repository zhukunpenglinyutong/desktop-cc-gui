## ADDED Requirements

### Requirement: Engine Plugin Onboarding Kit MUST Be Deferred From Current Harness Governance

This tooling capability MUST NOT be implemented in the current harness governance pass.

#### Scenario: current harness pass excludes engine scaffolding

- **WHEN** current harness governance implementation scope is selected
- **THEN** engine scaffolding scripts, templates, and onboarding docs MUST be excluded

### Requirement: Future Scaffolder MUST Be Dry-Run First And Cross-Platform

If revived, the scaffolder MUST support dry-run and deterministic output across Windows, macOS, and Linux.

#### Scenario: dry-run does not write files

- **WHEN** future scaffolder runs in dry-run mode
- **THEN** it MUST report planned files without modifying the workspace

#### Scenario: paths are platform-safe

- **WHEN** future scaffolder runs on Windows, macOS, or Linux
- **THEN** generated paths MUST be normalized and deterministic

### Requirement: Future Onboarding MUST Not Auto-Mutate Shared Engine Files Without Review

Future scaffolding MUST not silently edit shared registry, matrix, pricing, or i18n files.

#### Scenario: shared file changes require explicit review

- **WHEN** future scaffolder identifies a required shared-file change
- **THEN** it MUST emit a patch or checklist for review instead of silently mutating the file
