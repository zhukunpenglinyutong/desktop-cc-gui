## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Implemented

- Immutable domain event types under `src/features/threads/domain-events/events/*`
- Ten-event union and exported type list in `eventTypes.ts`
- Pure factories in `eventFactories.ts`
- Reducer diff derivation fixtures in `eventDerivationFixtures.ts`
- Checker: `scripts/check-agent-domain-event-schema.mjs`

### Validation

- `npm run check:agent-domain-event-schema`: pass
- `npm exec vitest run src/features/threads/domain-events/eventFactories.test.ts src/features/threads/domain-events/eventDerivationFixtures.test.ts src/features/threads/hooks/useThreadsReducer.test.ts`: pass
- `npm run typecheck`: pass

### Runtime Boundary

Reducer runtime was not wired to the event factories. The checker verifies that reducer files do not call `domainEventFactories` or `deriveDomainEventFromStateDiff`.

### Completion Review

- Residual risk: the schema is type/factory/fixture only; no runtime subscribers will receive events yet.
- Follow-up backlog: ring buffer, subscription API, EventBus, persistent audit trail, and session-activity migration.
- Runtime non-integration is intentional and verified by checker/source scan.
