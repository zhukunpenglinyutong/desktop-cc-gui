import type { DomainEventCommonFields } from "./base";

export type MessageDeltaAppendedEvent = Readonly<
  DomainEventCommonFields & {
    type: "message.delta.appended";
    messageId: string;
    role: "assistant" | "user";
    delta: string;
  }
>;

export type MessageCompletedEvent = Readonly<
  DomainEventCommonFields & {
    type: "message.completed";
    messageId: string;
    role: "assistant" | "user";
    text: string;
  }
>;

export type MessageDomainEvent = MessageDeltaAppendedEvent | MessageCompletedEvent;
