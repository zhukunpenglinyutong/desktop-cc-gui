import type { EngineType } from "../../../../types";

export type DomainEventCommonFields = Readonly<{
  occurredAt: string;
  workspaceId: string;
  sessionId: string;
  engine: EngineType;
}>;

export type DomainEventFactoryInput = DomainEventCommonFields;

export function assertIsoTimestamp(value: string) {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`Domain event occurredAt must be ISO 8601: ${value}`);
  }
}

export function freezeDomainEvent<T extends object>(event: T): Readonly<T> {
  if (import.meta.env.DEV) {
    return Object.freeze(event);
  }
  return event;
}
