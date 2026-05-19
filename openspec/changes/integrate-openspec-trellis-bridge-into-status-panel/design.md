## Design / 设计

### Current Client Facts

- The client already exposes file read APIs through `src/services/tauri.ts`.
- The repository already has check scripts for engine capability matrix, context ledger, checkpoint policy chain, domain event schema, large files, and heavy test noise.
- OpenSpec and Trellis are repository artifacts. Treating the UI as an editor for those artifacts is too risky for this phase.

## Decisions

### Decision 1: Read-Only Evidence Bridge

The bridge reads and normalizes governance signals. It never writes back.

Why:
- OpenSpec/Trellis files are source-of-truth artifacts and should remain edited by explicit tooling.
- UI writeback creates merge-conflict and accidental-checkbox risks.
- The current harness need is visibility, not mutation.

### Decision 2: Normalize To `GovernanceEvidence`

Suggested DTO:

```ts
interface GovernanceEvidence {
  readonly id: string;
  readonly source: "openspec" | "trellis" | "script" | "workflow";
  readonly status: "pass" | "warn" | "fail" | "unknown";
  readonly title: string;
  readonly summary: string;
  readonly updatedAt?: string;
}
```

Why:
- One shape can feed StatusPanel, check scripts, or future reports.
- It avoids coupling UI to markdown internals.

### Decision 3: MVP Sources Are Fixed And Small

The first bridge reads exactly these source classes:

- OpenSpec task progress from `openspec/changes/*/tasks.md`.
- Known package scripts from `package.json`, limited to harness governance checks.
- Workflow presence for `.github/workflows/large-file-governance.yml`; full noise sentry evidence is collected during final harness-wide integration closure.

Trellis session/task reading is P1 unless an implementation can prove a stable schema in current workspace fixtures.

Why:
- These sources exist in the current repository.
- They are enough to show governance readiness without executing commands.
- Keeping the list closed prevents the bridge from becoming a generic repository crawler.

### Decision 4: Parse In Small Adapters

- `openspecEvidenceReader`
- `scriptEvidenceReader`
- `workflowEvidenceReader`
- `trellisEvidenceReader` (P1)

Each adapter returns evidence and degraded warnings instead of throwing on malformed input.

### Decision 5: Minimal UI Is Optional

If implemented, UI should be a small read-only section, not a new full governance dashboard.

Rejected:
- New StatusPanel tab.
- markdown drill-down viewer.
- file watcher.
- task checkbox sync.

## Boundary

The bridge is complete when OpenSpec task progress, known harness scripts, and the two governance workflows can be collected into a small normalized evidence list without modifying repository files.

## Mandatory Governance Gates

Implementation MUST preserve the large-file workflow gate during staged work and defer the full noise sentry to final harness-wide integration closure:

- Full noise sentry
  - Deferred to final harness-wide integration closure.
- `.github/workflows/large-file-governance.yml`
  - `node --test scripts/check-large-files.test.mjs`
  - `npm run check:large-files:near-threshold`
  - `npm run check:large-files:gate`

Readers and fixtures MUST be portable across ubuntu-latest, macos-latest, and windows-latest. They MUST normalize workspace-relative paths, parse LF and CRLF markdown, avoid shell-only commands, and avoid case-sensitive filename assumptions.
