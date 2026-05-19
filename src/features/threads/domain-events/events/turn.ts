import type { DomainEventCommonFields } from "./base";

export type TurnStartedEvent = Readonly<
  DomainEventCommonFields & {
    type: "turn.started";
    turnId: string;
  }
>;

export type TurnCompletedEvent = Readonly<
  DomainEventCommonFields & {
    type: "turn.completed";
    turnId: string;
    durationMs: number | null;
  }
>;

export type TurnFailedEvent = Readonly<
  DomainEventCommonFields & {
    type: "turn.failed";
    turnId: string;
    errorMessage: string;
  }
>;

export type TurnDomainEvent = TurnStartedEvent | TurnCompletedEvent | TurnFailedEvent;
