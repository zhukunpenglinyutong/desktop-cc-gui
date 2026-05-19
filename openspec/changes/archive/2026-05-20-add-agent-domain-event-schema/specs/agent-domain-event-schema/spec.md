## ADDED Requirements

### Requirement: Agent Domain Event Schema MUST Be Type-Only With No Runtime Container

This capability MUST introduce only TypeScript type definitions and pure event factories. It MUST NOT introduce a runtime event bus, event store, ring buffer, subscription surface, persistent log, or cross-process publish mechanism.

#### Scenario: no runtime bus, store, buffer, or subscription is introduced by this capability

- **WHEN** this capability is shipped
- **THEN** there MUST NOT be a runtime module that buffers, stores, or subscribes to domain events
- **AND** the codebase MUST NOT contain `useSyncExternalStore` or similar subscription mechanisms introduced by this capability

#### Scenario: future runtime forms require dedicated follow-up changes

- **WHEN** future work proposes a buffer, subscription, persist, or bus mechanism
- **THEN** it MUST be introduced via a separate OpenSpec change with its own design and validation

### Requirement: Domain Event Types MUST Be Immutable

Every domain event type MUST be declared as `Readonly<>` in TypeScript. Pure factories that construct events MUST NOT expose mutable handles to the returned objects.

#### Scenario: TypeScript prevents mutation of domain event fields

- **WHEN** a consumer attempts to assign a field of a returned domain event
- **THEN** TypeScript MUST reject the code with a typecheck error

#### Scenario: factory output is functionally frozen in dev mode

- **WHEN** a factory is invoked in dev mode
- **THEN** the returned object SHOULD be `Object.freeze`-d
- **AND** runtime mutation in dev mode SHOULD throw (production behavior MAY be unfrozen for performance)

### Requirement: Domain Event Schema MUST Cover The Initial Ten Event Types

The capability MUST provide schema definitions for the following ten event types and no more in this change:

1. `session.started`
2. `session.ended`
3. `turn.started`
4. `turn.completed`
5. `turn.failed`
6. `message.delta.appended`
7. `message.completed`
8. `tool.started`
9. `tool.completed`
10. `usage.updated`

#### Scenario: only the documented ten event types are exported

- **WHEN** the capability is shipped
- **THEN** the exported `DomainEvent` type union MUST equal the documented ten event types
- **AND** adding an 11th type MUST require a new OpenSpec change

### Requirement: Domain Event Naming MUST Use `domain.action` Form With Limited Domain Set

Event `type` strings MUST follow `<domain>.<action>` or `<domain>.<sub>.<action>` form. Domain prefixes MUST be drawn from `session`, `turn`, `message`, `tool`, `usage`. Adding a new domain prefix MUST require a separate OpenSpec change.

#### Scenario: every event type matches the documented form

- **WHEN** the schema is validated
- **THEN** every `type` value MUST match `^(session|turn|message|tool|usage)(\.[a-z][a-z0-9-]*)+$`

### Requirement: Every Domain Event MUST Carry Common Identity Fields

Every domain event MUST include the following common fields:

- `type: string` (matching the documented form)
- `occurredAt: string` (ISO 8601)
- `workspaceId: string`
- `sessionId: string`
- `engine: EngineType`

#### Scenario: factories enforce common identity fields at type level

- **WHEN** a factory is invoked without one of the common fields
- **THEN** TypeScript MUST reject the code with a typecheck error

#### Scenario: occurredAt is ISO 8601

- **WHEN** a factory produces an event
- **THEN** `occurredAt` MUST be an ISO 8601 string
- **AND** factories MUST NOT default `occurredAt` silently; the caller MUST provide a clock value

### Requirement: Domain Event Schema MUST Be Derivable From Reducer Mutations By Pure Function

For each documented event type, there MUST exist at least one reducer test fixture demonstrating that the event shape can be produced by a pure derivation function from a reducer state diff. The derivation function MUST NOT be wired into the reducer runtime in this change.

#### Scenario: every event type has a reducer-derivation test fixture

- **WHEN** the test suite runs the schema derivation fixtures
- **THEN** for each of the ten documented event types, the suite MUST demonstrate a pure mapping from a reducer state diff to the corresponding event

#### Scenario: reducer runtime is not modified by this capability

- **WHEN** this capability is shipped
- **THEN** the reducer hooks under `src/features/threads/hooks/useThreadsReducer*.ts` MUST NOT call any domain event factory at runtime
- **AND** existing reducer tests MUST continue to pass without modification

### Requirement: Domain Event Schema Capability MUST Be Validated By CI

The system MUST provide `npm run check:agent-domain-event-schema` that exercises type immutability, factory correctness, identity field enforcement, and reducer-derivation fixtures. The check MUST pass on `ubuntu-latest`, `macos-latest`, and `windows-latest`.

#### Scenario: schema CI parity passes on three platforms

- **WHEN** CI executes the agent-domain-event-schema check
- **THEN** the check MUST pass on Linux, macOS, and Windows runners

#### Scenario: OpenSpec strict validation gates this capability

- **WHEN** CI or release validation runs OpenSpec validation
- **THEN** `openspec validate add-agent-domain-event-schema --strict --no-interactive` MUST pass
