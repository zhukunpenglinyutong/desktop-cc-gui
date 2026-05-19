## Design / 设计

### Position

Deferred P1 runtime bridge. Not part of the current P0 harness governance implementation.

## Current Client Facts

- Domain event schema and factories already exist under `src/features/threads/domain-events/`.
- Derivation fixtures already prove events can be derived from state transitions.
- No current P0 consumer requires raw runtime event subscription.

## Decisions

### Decision 1: No EventBus Until There Is A Concrete Consumer

Do not introduce a runtime bus just because schema exists.

Why:
- Reducer emit is a side effect in a hot path.
- EventBus can become a hidden global state system.
- Evidence bridge and audit surface can work from existing projections.

### Decision 2: Future Bus Is In-Memory Only

If implemented later:

- no persistence.
- no IPC.
- no replay.
- no cross-process publish.
- no consumer publish API.

### Decision 3: Remove Session-Activity Raw Mode From This Proposal

Session activity currently works from derived state. Migrating it to raw events is a separate behavior change.

## Future Minimal Shape

```ts
interface DomainEventSubscription {
  subscribe(handler: (event: DomainEvent) => void): () => void;
}
```

Publishing remains internal to a bridge and is not exported to application consumers.
