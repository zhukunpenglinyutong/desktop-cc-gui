import type { DomainEvent } from "./eventTypes";

export type DomainEventSubscriber = (event: DomainEvent) => void;

export type DomainEventRuntime = {
  readonly firstConsumer: "governance-evidence-bridge";
  readonly subscribe: (subscriber: DomainEventSubscriber) => () => void;
};

export type DomainEventRuntimeController = {
  readonly runtime: DomainEventRuntime;
  readonly emitInternal: (event: DomainEvent) => void;
};

export function createDomainEventRuntimeController(): DomainEventRuntimeController {
  const subscribers = new Set<DomainEventSubscriber>();

  const runtime = Object.freeze({
    firstConsumer: "governance-evidence-bridge" as const,
    subscribe(subscriber: DomainEventSubscriber) {
      subscribers.add(subscriber);
      let active = true;
      return () => {
        if (!active) {
          return;
        }
        active = false;
        subscribers.delete(subscriber);
      };
    },
  });

  return Object.freeze({
    runtime,
    emitInternal(event: DomainEvent) {
      for (const subscriber of Array.from(subscribers)) {
        subscriber(event);
      }
    },
  });
}

export function createDomainEventRuntime(): DomainEventRuntime {
  return createDomainEventRuntimeController().runtime;
}
