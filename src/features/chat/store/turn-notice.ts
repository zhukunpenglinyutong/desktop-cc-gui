import type { Message } from "@/lib/ipc";
import { findPlanMessage } from "./plan-review";

/**
 * What a settled turn hands to its OS notification (src/lib/notifications.ts).
 * A turn is everything after the last user row: the rows before it belong to
 * earlier turns, whose leftovers must not speak for this one.
 */

/** Index of the current turn's first row (0 when no user row exists). */
function turnStart(messages: readonly Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return i + 1;
  }
  return 0;
}

/** The reply text this turn ended on, or "" when it wrote none — a tool-only
 *  turn must not resurface the previous turn's answer. */
export function turnReplyText(messages: readonly Message[]): string {
  const start = turnStart(messages);
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.text.trim()) return m.text;
  }
  return "";
}

/** Whether this turn ended on a card the user still has to act on: a
 *  question, a plan awaiting review, or a grant card nothing came after.
 *  notifyTurnComplete skips its own notice when that card's notice actually
 *  went out. */
export function turnAwaitsUser(messages: readonly Message[]): boolean {
  const start = turnStart(messages);
  for (let i = start; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === "question" && m.question?.status === "pending") return true;
    if (m.planReview?.status === "awaiting_review") return true;
  }
  return endsOnPendingGrant(messages, start);
}

/** A denial does not stop the turn: the CLI works around it and keeps going,
 *  so a grant card followed by more output says nothing about the end. Only
 *  the trailing grant cards count, e.g. Claude's stdio denials, which surface
 *  on the result line right before done. */
function endsOnPendingGrant(messages: readonly Message[], start: number): boolean {
  for (let i = messages.length - 1; i >= start && messages[i].role === "grant"; i--) {
    if (messages[i].grant?.status === "pending") return true;
  }
  return false;
}

/** Status of one plan revision's card, or undefined before it is rendered. */
export function planRevisionStatus(
  messages: readonly Message[],
  planId: string,
  revision: number,
): string | undefined {
  const index = findPlanMessage(messages as Message[], planId, revision);
  return index >= 0 ? messages[index].planReview?.status : undefined;
}
