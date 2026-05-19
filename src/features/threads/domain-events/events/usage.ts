import type { ThreadTokenUsage } from "../../../../types";
import type { DomainEventCommonFields } from "./base";

export type UsageUpdatedEvent = Readonly<
  DomainEventCommonFields & {
    type: "usage.updated";
    usage: ThreadTokenUsage;
  }
>;

export type UsageDomainEvent = UsageUpdatedEvent;
