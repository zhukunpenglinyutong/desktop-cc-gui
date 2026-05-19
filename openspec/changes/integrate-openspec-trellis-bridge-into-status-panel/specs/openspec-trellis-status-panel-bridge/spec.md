## ADDED Requirements

### Requirement: Governance Evidence Bridge MUST Be Read-Only

The bridge MUST collect and normalize governance evidence from workspace artifacts without modifying OpenSpec or Trellis files.

#### Scenario: bridge does not write source artifacts

- **WHEN** the bridge reads OpenSpec or Trellis artifacts
- **THEN** it MUST NOT write, rewrite, or checkbox-update any file under `openspec/**` or `.trellis/**`

#### Scenario: malformed artifacts degrade safely

- **WHEN** a markdown file is missing, malformed, or incomplete
- **THEN** the bridge MUST return `unknown` or `warn` evidence
- **AND** it MUST NOT throw into the UI path

### Requirement: Governance Evidence MUST Use A Normalized DTO

Governance signals from OpenSpec task progress, known package scripts, and governance workflow presence MUST be normalized into a single evidence shape before UI consumption. Trellis evidence is P1 and MUST NOT be required for the MVP.

#### Scenario: OpenSpec change is normalized

- **WHEN** an OpenSpec change directory is parsed
- **THEN** the resulting evidence MUST include source `openspec`, a status, a title, and a summary

#### Scenario: script gate is normalized

- **WHEN** a known governance script is represented
- **THEN** the resulting evidence MUST include source `script`, a status, a title, and a summary

#### Scenario: governance workflow presence is normalized

- **WHEN** the large-file or heavy-test workflow file exists
- **THEN** the resulting evidence MUST include source `workflow`, a status, a title, and a summary

#### Scenario: Trellis evidence is not required for MVP

- **WHEN** `.trellis/tasks` is absent, incomplete, or schema-ambiguous
- **THEN** the MVP bridge MUST still return OpenSpec/script/workflow evidence

### Requirement: Bridge MUST Not Implement Bidirectional Sync

This capability MUST NOT synchronize Trellis state into OpenSpec tasks, OpenSpec task checkboxes into Trellis, or run automatic file watchers.

#### Scenario: no task checkbox sync exists

- **WHEN** this capability is implemented
- **THEN** it MUST NOT contain logic that automatically checks or unchecks lines in `tasks.md`

#### Scenario: no file watcher is introduced

- **WHEN** this capability is implemented
- **THEN** it MUST NOT introduce a governance file watcher

### Requirement: Optional UI MUST Be Minimal And Read-Only

If a UI surface is added, it MUST present evidence summaries only and MUST NOT expose mutation actions for OpenSpec or Trellis files.

#### Scenario: UI exposes no write action

- **WHEN** governance evidence is rendered
- **THEN** there MUST NOT be an action that writes OpenSpec or Trellis files

### Requirement: Evidence Bridge MUST Preserve Governance Workflow Gates And Three-Platform Compatibility

The implementation MUST remain compatible with large-file governance and the final harness-wide noise sentry, and readers MUST be portable across Linux, macOS, and Windows.

#### Scenario: full noise sentry is deferred to integration closure

- **WHEN** this capability is implemented
- **THEN** full noise sentry execution MAY be deferred to final harness-wide integration closure

#### Scenario: large file governance gate remains compatible

- **WHEN** this capability is implemented
- **THEN** `node --test scripts/check-large-files.test.mjs` MUST pass
- **AND** `npm run check:large-files:near-threshold` MUST pass without hard failures
- **AND** `npm run check:large-files:gate` MUST pass

#### Scenario: readers are three-platform safe

- **WHEN** reader tests run on ubuntu-latest, macos-latest, and windows-latest
- **THEN** readers MUST normalize workspace-relative paths
- **AND** markdown parsing MUST tolerate LF and CRLF
- **AND** tests MUST avoid shell-only behavior and case-sensitive filename assumptions
