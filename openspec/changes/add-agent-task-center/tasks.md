> Execution tracking: Trellis task `05-03-task-center-phase1`; depends on `05-03-context-ledger-phase1`; master plan `docs/plans/2026-05-03-context-ledger-then-task-center-implementation.md`.

## 1. Run Model And Storage

- [ ] 1.1 Introduce a `TaskRun` record schema with stable `runId`, trigger, lineage, status, linked-thread fields, and run-level observability fields such as plan snapshot, current step, latest output summary, diagnostics, and artifact summaries.
- [ ] 1.2 Persist task runs separately from Kanban task definitions and project the latest run summary back into Kanban metadata.

## 2. Execution Projection

- [ ] 2.1 Project manual, scheduled, chained, retry, and resume execution into normalized task-run lifecycle states, with one-active-run eligibility guards per task definition.
- [ ] 2.2 Normalize Codex, Claude Code, and Gemini runtime/thread telemetry into the shared Task Center run model.

## 3. Surface

- [ ] 3.1 Build an independent Task Center run list and detail surface with engine/status/workspace filters.
- [ ] 3.2 Add bounded recovery actions (`open conversation`, `retry`, `resume`, `cancel`, `fork new run`) with active-run eligibility checks plus latest-output / artifact summaries.

## 4. Verification

- [ ] 4.1 Add focused tests for run history persistence, Kanban latest-run projection, chained/scheduled lineage, run diagnostics, and single-active-run guards.
- [ ] 4.2 Run `openspec validate --all --strict --no-interactive`, `npm run lint`, `npm run typecheck`, focused frontend tests, and runtime contract validation for touched paths.
