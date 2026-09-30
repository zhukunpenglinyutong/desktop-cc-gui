import type { Message } from "@/lib/ipc";

const EMPTY_MESSAGES: Message[] = [];

/** Keep one history result per hook. Zustand checks every selector on any
 * store write, including other sessions' stream flushes; unchanged inputs
 * must not walk the same history again. Message writes are immutable. */
export function memoizeMessageHistory<Result, Extra = undefined>(
  derive: (messages: Message[], extra: Extra | undefined) => Result,
) {
  let previousMessages: Message[] | undefined;
  let previousExtra: Extra | undefined;
  let result: Result;
  return (messages: Message[] | undefined, extra?: Extra): Result => {
    const current = messages ?? EMPTY_MESSAGES;
    if (current !== previousMessages || !Object.is(extra, previousExtra)) {
      result = derive(current, extra);
      previousMessages = current;
      previousExtra = extra;
    }
    return result;
  };
}
