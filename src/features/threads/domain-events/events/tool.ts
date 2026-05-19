import type { DomainEventCommonFields } from "./base";

export type ToolStartedEvent = Readonly<
  DomainEventCommonFields & {
    type: "tool.started";
    toolCallId: string;
    toolType: string;
    title: string;
  }
>;

export type ToolCompletedEvent = Readonly<
  DomainEventCommonFields & {
    type: "tool.completed";
    toolCallId: string;
    toolType: string;
    status: "completed" | "failed" | string;
  }
>;

export type ToolDomainEvent = ToolStartedEvent | ToolCompletedEvent;
