import type { DomainEventCommonFields } from "./base";

export type SessionStartedEvent = Readonly<
  DomainEventCommonFields & {
    type: "session.started";
    threadId: string;
  }
>;

export type SessionEndedEvent = Readonly<
  DomainEventCommonFields & {
    type: "session.ended";
    threadId: string;
    reason: "completed" | "failed" | "cancelled";
  }
>;

export type SessionDomainEvent = SessionStartedEvent | SessionEndedEvent;
