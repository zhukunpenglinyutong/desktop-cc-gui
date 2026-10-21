/**
 * Response check — did the reply's own account of itself match what this
 * client asked for?
 *
 * Two partial sides, fed by engine events:
 *
 *  - `requested`: the launch selection (`launch`), i.e. the model/effort the
 *    run actually started with, after channel remap.
 *  - `served`: what the response reported (`served`) — claude's assistant
 *    snapshot model, the serving model the pi runtime recovered, or a codex
 *    reroute target.
 *
 * A side that never reported stays `null` and can never produce a verdict:
 * an unreported field is unknown, not a pass. Only the provider prefix and
 * the picker's `[1m]` tag are ignored — the bare model name, including any
 * date/build suffix, must match exactly (`deepseek-v4.1-flash` and
 * `deepseek-v4.1-flash-1017` are different ids). Reasoning levels remain
 * separator/case-insensitive (`xhigh` vs `extra-high`).
 */

export interface SelectionSide {
  model: string | null;
  /** Adapter-resolved request id. Null means the selector could not be resolved. */
  comparisonModel?: string | null;
  effort: string | null;
}

/** Requested vs served selection for the run the tail indicator shows. */
export interface ResponseCheckState {
  requested: SelectionSide;
  served: SelectionSide;
}

export type SelectionVerdict = "match" | "mismatch" | "unknown";

export interface ResponseCheckView {
  model: SelectionVerdict;
  effort: SelectionVerdict;
  /** "mismatch" when a reported side disagrees; "unknown" when a request
   *  alias is unresolved or nothing is comparable; otherwise "match". */
  verdict: "match" | "mismatch" | "unknown";
  /** Visible when the run reported a request side or evidence can be compared. */
  visible: boolean;
}

const EMPTY_SIDE: SelectionSide = { model: null, effort: null };

/** "provider/model" and the picker's "[1m]" tag are the same model. */
function bareModel(id: string): string {
  const trimmed = id.trim().toLowerCase();
  const bare = trimmed.includes("/")
    ? trimmed.slice(trimmed.lastIndexOf("/") + 1)
    : trimmed;
  return bare.replace(/\[1m\]$/, "");
}

export function compareModel(
  requested: string | null,
  served: string | null,
): SelectionVerdict {
  if (!requested || !served) return "unknown";
  return bareModel(requested) === bareModel(served) ? "match" : "mismatch";
}

/** Separator/case-insensitive; `extra-high` is the same level as `xhigh`. */
function effortKey(level: string): string {
  const key = level
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/g, "");
  return key === "extrahigh" ? "xhigh" : key;
}

export function compareEffort(
  requested: string | null,
  served: string | null,
): SelectionVerdict {
  if (!requested || !served) return "unknown";
  return effortKey(requested) === effortKey(served) ? "match" : "mismatch";
}

export function checkResponseSelection(
  check: ResponseCheckState | null | undefined,
): ResponseCheckView {
  const requested = check?.requested ?? EMPTY_SIDE;
  const served = check?.served ?? EMPTY_SIDE;
  const model = compareModel(
    requested.comparisonModel === undefined
      ? requested.model
      : requested.comparisonModel,
    served.model,
  );
  const effort = compareEffort(requested.effort, served.effort);
  const unresolvedAlias =
    requested.comparisonModel === null && !!requested.model && !!served.model;
  const verdict =
    model === "mismatch" || effort === "mismatch"
      ? "mismatch"
      : unresolvedAlias
        ? "unknown"
        : model !== "unknown" || effort !== "unknown"
          ? "match"
          : "unknown";
  // A reported request with no response evidence still has something to say:
  // the card shows the requested side and marks the missing side unreported.
  // Hiding it made an engine that never reports a served id look verified.
  const requestedReported =
    requested.model !== null || requested.effort !== null;
  return {
    model,
    effort,
    verdict,
    visible: requestedReported || verdict !== "unknown" || unresolvedAlias,
  };
}
