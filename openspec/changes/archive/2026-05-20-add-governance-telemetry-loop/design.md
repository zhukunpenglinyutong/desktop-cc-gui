## Design / 设计

### Position

This is a deferred contract, not an implementation plan for the current harness governance pass.

## Decisions

### Decision 1: No Persistence In The First Telemetry Shape

If implemented later, the first recorder should be an in-memory or test-fixture counter only.

Why:
- Persistent telemetry creates privacy, retention, migration, and UI obligations.
- Current governance needs evidence normalization first.

### Decision 2: Default Off Until There Is A User-Visible Contract

Telemetry MUST NOT default on in this stage.

Why:
- "Local only" is still user observation.
- A settings toggle and privacy copy should exist before persistence or collection.

### Decision 3: Allowlist Everything

Event names and tags must be closed unions. Unknown keys/values are rejected before recording.

### Decision 4: No Dashboard

A dashboard duplicates the proposed evidence bridge. If evidence bridge later needs counters, it can consume a minimal counter snapshot.

## Future Minimal Shape

```ts
type GovernanceTelemetryEvent =
  | "governance.policy.evaluated"
  | "governance.policy.audit.expanded"
  | "governance.evidence.degraded";

interface GovernanceTelemetryRecorder {
  record(event: GovernanceTelemetryEvent, tags?: GovernanceTelemetryTags): void;
  snapshot(): readonly GovernanceCounter[];
  reset(): void;
}
```

No persistence, no export, no network.
