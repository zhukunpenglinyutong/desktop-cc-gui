# Design

## Approach

Add `codexAutoCompactionEnabled` and `codexAutoCompactionThresholdPercent` to app settings with defaults `true` and `92`.

The frontend renders the enabled toggle and allowed values in the Codex context dual-view tooltip, next to current background-info usage and manual compaction. Threshold choices remain `92`, `100`, `110`, ..., `200`.

Backend settings sanitization accepts only `92` or multiples of `10` between `100` and `200`; invalid persisted values fall back to `92`.

Codex runtime sessions receive the sanitized enabled state and threshold when spawned. The existing auto-compaction state machine keeps its processing, cooldown, and in-flight protections, but skips automatic compaction when disabled and otherwise compares token usage against the session threshold instead of a fixed constant.

## Data Flow

Context usage tooltip -> `updateAppSettings` -> Rust `AppSettings` -> Codex session spawn -> token usage event -> auto-compaction state machine.

## Risks

- Existing sessions need restart to pick up the new enabled state or threshold. The settings restart gate treats both changes as Codex-runtime-relevant.
- Persisted invalid values must not cause unexpected compact storms, so sanitization falls back to `92`.

## Validation

- TypeScript settings normalization tests.
- Rust settings sanitization and auto-compaction state tests.
- OpenSpec validation for this change.
