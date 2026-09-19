/**
 * Bar buckets for the usage chart. The short ranges keep one column per local
 * day; 本年 rolls the same ledger up per month, and 总和 has no calendar axis
 * at all — one column per CLI. `key` is what a ledger row is matched against
 * (a local day, "YYYY-MM", or an engine id), `axis` labels the column, and
 * `title` names the bucket in the hover tooltip where the axis label is too
 * short to be unambiguous.
 */

export interface UsageBucket {
  key: string;
  axis: string;
  title: string;
}

/** One column per local day, oldest first. */
export function dayBuckets(days: string[]): UsageBucket[] {
  return days.map((day) => ({ key: day, axis: day.slice(5), title: day }));
}

/** One column per local month from `from` through `to` (both "YYYY-MM-DD"). */
export function monthBuckets(from: string, to: string): UsageBucket[] {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  const buckets: UsageBucket[] = [];
  // Month arithmetic on one running index keeps the year boundary out of the
  // loop body — stepping 12 → 1 is the only way that could go wrong.
  for (
    let index = fromYear * 12 + (fromMonth - 1);
    index <= toYear * 12 + (toMonth - 1);
    index += 1
  ) {
    const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    buckets.push({ key, axis: key.slice(5), title: key });
  }
  return buckets;
}

/** One column per CLI, in the given order (the details list's own). */
export function cliBuckets(
  clis: { engine: string; label: string }[],
): UsageBucket[] {
  return clis.map((cli) => ({
    key: cli.engine,
    axis: cli.label,
    title: cli.label,
  }));
}
