# Project Context

- Type: OpenSpec Workspace
- Updated At: 2026-05-20T00:00:00+08:00
- Scope: governance snapshot for the current `mossx` repository workspace

## Domain

OpenSpec workflow and governance for `mossx`, covering change lifecycle, main spec maintenance, validation, sync, and archive discipline.

## Architecture

- Spec artifacts: `openspec/specs/*`
- Change workflow artifacts: `openspec/changes/<change-id>/{proposal,design,tasks,verification}.md`
- Archive: `openspec/changes/archive/*`
- Current workspace state: active changes = `11`, archive changes = `316`, main specs = `269`

## Entry Surfaces

- `openspec/README.md`
  - concise navigation and common commands
- `openspec/project.md`
  - detailed governance overview and current workspace snapshot
- `openspec/changes/<change-id>/*`
  - change-local truth for proposal, design, tasks, and verification
- `openspec/specs/*`
  - mainline capability truth after sync/archive

## Governance Model

- `AGENTS.md`
  - repo entry, rule priority, global gates, minimal reading path
- `.trellis/spec/**`
  - implementation rules and executable contracts
- `openspec/**`
  - behavior specs, change workflow, archive, and workspace governance
- `.claude/**` / `.codex/**`
  - host hooks, commands, and adapter glue
- `.omx/**` and other local runtime state
  - runtime artifacts, not repository truth

## Active Changes

### Branch Calibration Snapshot (2026-05-20)

Current implementation branch for this workspace snapshot is `feature/v0.5.0-md`.

The harness governance core set was synced into main specs and archived on 2026-05-20 after proposal-local strict validation and a closure evidence pass. Earlier `feature/v0.5` completion evidence remains non-authoritative; authoritative evidence now lives in the archived change directories plus main specs.

The archive included `formalize-engine-runtime-contract` with an explicit external-CI qualifier: local validation and workflow wiring were recorded, but remote three-platform CI results were not directly observable from the local closure session.

### Archived Harness Governance Core Set

- `2026-05-20-formalize-engine-runtime-contract`
- `2026-05-20-add-engine-capability-matrix-spec`
- `2026-05-20-evolve-context-ledger-to-cost-budget`
- `2026-05-20-evolve-checkpoint-to-policy-chain`
- `2026-05-20-add-agent-domain-event-schema`
- `2026-05-20-add-capability-aware-policy-router`
- `2026-05-20-add-policy-decision-audit-surface`
- `2026-05-20-add-governance-telemetry-loop`
- `2026-05-20-wire-agent-domain-event-runtime`

### Harness Governance Substrate Set

- `refactor-mega-hub-split`
- `optimize-realtime-event-batching`
- `optimize-long-list-virtualization`
- `optimize-bundle-chunking`

### Harness Governance Extension / Follow-up Set

- `add-cross-workspace-cost-admin-view`
- `add-engine-plugin-onboarding-kit`
- `integrate-openspec-trellis-bridge-into-status-panel`

### Other Active Changes

- `stabilize-core-runtime-and-realtime-contracts`
- `add-codex-structured-launch-profile`
- `add-file-markdown-math-preview`
- `harden-claude-sidebar-list-timeout-fallback`

> Harness governance closure status on 2026-05-20: the archived core and extension changes listed above were synchronized into `openspec/specs/**` and moved to `openspec/changes/archive/**`. Deferred contracts intentionally preserve their no-telemetry and no-EventBus boundaries.

> Current status should be read from each change directory itself. `project.md` tracks workspace inventory and governance boundaries, not task-by-task execution detail.

### Code Fact Snapshot (2026-05-20)

Current-branch code inventory shows harness/governance implementation traces in:

- `src/features/engine/engineCapabilityMatrix.ts`
- `src/features/context-ledger/cost-budget.ts`
- `src/features/context-ledger/cost/*`
- `src/features/context-ledger/budget/*`
- `src/features/status-panel/utils/policies/*`
- `src/features/status-panel/components/CostBudgetSection.tsx`
- `src/features/status-panel/components/audit/*`
- `src/features/governance/evidence/*`
- `src/features/threads/contracts/realtimeEventBatcher.ts`
- `src/features/threads/contracts/realtimeReplayHarness.ts`
- `src/features/messages/components/messagesTimelineVirtualization.ts`
- `vite.config.ts`
- `scripts/check-engine-capability-matrix.mjs`
- `scripts/realtime-perf-report.ts`
- `.github/workflows/ci.yml`

This snapshot is intentionally evidence-oriented. Archived harness governance completion evidence now lives in the archived change directories and main specs.

## Namespace Policy

- Canonical prefix: `spec-hub-*`
- Compatibility prefix: `spec-platform-*` (legacy only; no new requirements)
- New proposals SHOULD use canonical prefixes unless compatibility migration requires otherwise

## Workflow Governance

- OpenSpec is the source of truth for behavior changes:
  - `openspec/changes/<change-id>/*` defines proposal/design/tasks/spec deltas.
  - behavior changes SHOULD be tracked by an OpenSpec change before implementation.
- Trellis is the execution container for delivery:
  - `.trellis/tasks/*` should map back to one OpenSpec change.
  - implementation and verification should be traceable to the linked change artifacts.
- Recommended delivery loop:
  1. Select or create an OpenSpec change.
  2. Create or activate the linked Trellis task.
  3. Implement and verify.
  4. Sync main specs and archive when the change passes gate checks.

## Key Commands

- `openspec validate --all --strict --no-interactive`
- `openspec status --change <change-id>`
- `find openspec/specs -mindepth 1 -maxdepth 1 -type d | wc -l`
- `find openspec/changes -mindepth 1 -maxdepth 1 -type d ! -name archive | wc -l`
- `find openspec/changes/archive -mindepth 1 -maxdepth 1 -type d | wc -l`
- `python3 .claude/skills/osp-openspec-sync/scripts/validate-consistency.py --project-path . --full`

## Maintenance Boundaries

- `openspec/README.md` stays concise and navigation-oriented.
- `openspec/project.md` keeps durable governance context and current inventory only.
- High-drift implementation evidence, commit matrices, and temporary backfill snapshots should live in the relevant change artifacts or archive notes, not here.
- Host-specific session-start logic belongs in `.claude/**` or `.codex/**`, not in OpenSpec workspace docs.

## Owners

- CodeMoss Team

## Update History

- 2026-05-20: Archived nine harness governance changes (`formalize-engine-runtime-contract`, `add-engine-capability-matrix-spec`, `evolve-context-ledger-to-cost-budget`, `evolve-checkpoint-to-policy-chain`, `add-agent-domain-event-schema`, `add-capability-aware-policy-router`, `add-policy-decision-audit-surface`, `add-governance-telemetry-loop`, `wire-agent-domain-event-runtime`) after syncing delta specs into main specs and recording closure evidence. `formalize-engine-runtime-contract` carries an explicit external-CI qualifier because remote three-platform CI was not directly observable from the local closure session. Refreshed inventory to active=11, archive=316, specs=269.
- 2026-05-19: Recalibrated `project.md` against current `feature/v0.5.0-md` code and active proposal inventory. Workspace counts are now active=20, archive=307, specs=260. Harness governance is no longer described as implementation-unstarted; current-branch code traces exist and must be reconciled through fresh validation before sync/archive.
- 2026-05-19: Recalibrated the harness governance proposal set for `feature/v0.5.0-md` only. Prior `feature/v0.5` implementation artifacts are explicitly excluded from the current baseline; all harness governance implementation must be redone from the current branch facts.
- 2026-05-17: Hardened harness governance implementation constraints to v1.6 by making heavy-test-noise sentry, large-file governance sentry, and Win/macOS/Linux compatibility explicit requirements across the governance change set; corrected `formalize-engine-runtime-contract` task wording so runtime contract legislation is not confused with capability matrix work.
- 2026-05-17: Added and calibrated the harness governance design set (`formalize-engine-runtime-contract`, `add-engine-capability-matrix-spec`, `evolve-context-ledger-to-cost-budget`, `evolve-checkpoint-to-policy-chain`, `add-agent-domain-event-schema`) plus substrate blockers (`refactor-mega-hub-split`, `optimize-realtime-event-batching`, `optimize-long-list-virtualization`, `optimize-bundle-chunking`); refreshed workspace inventory after the v1.5 governance design closure (specs=258, archive=303, active=11).
- 2026-05-15: Archived eight verified changes (`fix-claude-repeat-turn-first-token-latency`, `harden-claude-stream-json-liveness`, `fix-claude-pending-transcript-reconciliation`, `repair-project-memory-reference-retrieval-integrity`, `harden-codex-silent-turn-liveness`, `harden-session-start-and-claude-list-window`, `fix-claude-sidebar-native-session-continuity`, `improve-progressive-file-tree-loading`) after syncing their delta specs into main specs; resolved the overlapping `claude-session-sidebar-state-parity` updates by preserving both sidebar continuity and configured display-window requirements; refreshed workspace inventory (specs=257, archive=302, active=1).
- 2026-05-15: Refreshed active-change inventory after adding `add-runtime-perf-baseline` and detecting `stabilize-core-runtime-and-realtime-contracts`; current workspace inventory is specs=257, archive=302, active=3.
- 2026-05-14: Archived `clean-openspec-main-spec-hygiene` after replacing archive-generated Purpose placeholders, removing the empty `claude-session-engine-resolution` capability directory, and adding main-spec hygiene governance; refreshed workspace inventory (specs=251, archive=289, active=2).
- 2026-05-14: Closed and archived the Phase 1 release set (`add-cli-one-click-installer`, `optimize-runtime-session-background-scheduling`, `fix-linux-appimage-wayland-library-pruning`, `fix-windows-codex-app-server-wrapper-launch`, `claude-code-mode-progressive-rollout`) with explicit release qualifiers for external platform/manual evidence; refreshed workspace inventory (specs=252, archive=288, active=2).
- 2026-05-14: Recorded Phase 1.2 release evidence, archived `fix-claude-native-session-continuation-race`, and refreshed workspace inventory after strict validation (specs=250, archive=283, active=7).
- 2026-05-13: Backfilled the current OpenSpec workspace snapshot after the v0.4.17 code/doc pass, including active installer, Linux AppImage, native menu, Claude continuation, and runtime scheduling changes (specs=249, archive=278, active=10).
- 2026-05-08: Archived `dynamic-claude-model-discovery` after syncing the Claude dynamic discovery spec and selector refresh requirements into the main specs (specs=235, archive=259, active=4).
- 2026-05-06: Archived `fix-conversation-curtain-visible-copy-tail` after syncing the remaining curtain visible-copy requirements into the main specs (specs=226, archive=247, active=8).
- 2026-05-06: Archived `fix-conversation-curtain-i18n-gaps` after syncing curtain i18n requirements into the main specs (specs=226, archive=246, active=7).
- 2026-05-06: Removed stale package-template references from manual Trellis entry docs and pruned `project.md` to a low-drift governance snapshot (specs=226, archive=245, active=7).
- 2026-05-02: Archived 10 completed changes after strict validation; synced missing specs for `conversation-curtain-normalization-core`, `project-memory-ui`, and `codex-composer-startup-selection-stability` before archive where needed.
- 2026-04-23: Recalibrated OpenSpec snapshot counts after archive drift and cleared the last strict validation warning on `conversation-user-path-reference-cards`.
- 2026-04-16: Added team governance for OpenSpec + Trellis collaboration, including mandatory change/task linkage and delivery loop definition.
- 2026-02-23: Initial OpenSpec workspace context import.
