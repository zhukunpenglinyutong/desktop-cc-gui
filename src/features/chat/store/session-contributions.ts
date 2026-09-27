import type { PromptContribution } from "@ccgui/plugin-sdk";
import { isPromptContributionActive, isPromptContributionConfirmed, promptContributionOwner } from "@/features/plugins/runtime/hooks";

interface ContributionScope {
  remembered: Record<string, PromptContribution>;
  resets: Record<string, PromptContribution>;
  /** Evicted active owners require a generic reset on the following launch. */
  overflowed: boolean;
}

/** Session instructions and one-shot withdrawal notices, including turn-only
 * instructions already carried into a CLI's native conversation history. */
export type SessionContributions = Record<string, ContributionScope>;

/** Capacity bounds: ids kept per scope, scopes kept overall (oldest evicted). */
const PER_SCOPE_LIMIT = 32;
const SCOPE_LIMIT = 64;

function withdrawalContribution(pluginId: string): PromptContribution {
  const subject = pluginId
    ? `CCGUI has deactivated the earlier internal instructions from plugin ${JSON.stringify(pluginId)} for this session.`
    : "This is a resumed session. Earlier CCGUI internal instructions and private protocol frames are inactive unless their instructions are supplied again with the current request.";
  return {
    id: `host:internal-instructions-reset:${pluginId}`,
    content: `${subject} Do not continue automatic maintenance, read or update private context files, or emit private protocol frames solely because of those retired instructions. Only internal instructions supplied for the current turn remain active. Historical task facts are still background information. Continue the current user's request normally; explicit user instructions take precedence.`,
    placement: "system-tail",
    visibility: "internal",
    persistence: "turn",
  };
}

/** Scope of remembered session-scoped contributions: the native session when
 * known, otherwise the not-yet-created session of one engine+workspace. */
export function sessionContributionScope(
  engine: string,
  sessionId: string | null,
  workspacePath: string,
): string {
  return sessionId ? `${engine}/${sessionId}` : `pending:${engine}:${workspacePath}`;
}

/** Remembered session contributions first, then this turn's; a fresh
 * contribution with the same id wins. */
function mergeSessionContributions(
  remembered: Record<string, PromptContribution> | undefined,
  fresh: PromptContribution[],
): PromptContribution[] {
  if (!remembered) return fresh.every(isPromptContributionActive) ? fresh : fresh.filter(isPromptContributionActive);
  const byId = new Map<string, PromptContribution>();
  for (const contribution of Object.values(remembered)) {
    if (isPromptContributionActive(contribution)) byId.set(contribution.id, contribution);
  }
  for (const contribution of fresh) {
    if (isPromptContributionActive(contribution)) byId.set(contribution.id, contribution);
  }
  return [...byId.values()];
}

/** Prepare the next launch without replaying retired owners. A notice is kept
 * until the engine accepts it, then disappears until that owner contributes
 * again. Unknown restored sessions get one generic reset; known fresh sessions
 * without plugins get none. Stored notices move with pending/native scopes. */
export function prepareSessionContributions(
  all: SessionContributions,
  scope: string,
  fresh: PromptContribution[],
  restored: boolean,
): { promptContributions: PromptContribution[]; next: SessionContributions | null } {
  const previous = all[scope];
  let remembered: Record<string, PromptContribution> = previous?.remembered ?? Object.create(null);
  let resets: Record<string, PromptContribution> = previous?.resets ?? Object.create(null);
  let changed = !previous;
  for (const id of Object.keys(remembered)) {
    if (isPromptContributionActive(remembered[id])) continue;
    if (remembered === previous?.remembered) remembered = Object.assign(Object.create(null), remembered);
    delete remembered[id];
    changed = true;
  }
  for (const contribution of fresh) {
    if (contribution.persistence !== "session" || !isPromptContributionActive(contribution)) continue;
    if (remembered[contribution.id] === contribution) continue;
    if (remembered === previous?.remembered) remembered = Object.assign(Object.create(null), remembered);
    remembered[contribution.id] = contribution;
    changed = true;
  }
  const ids = Object.keys(remembered);
  if (ids.length > PER_SCOPE_LIMIT) {
    for (const id of ids.slice(0, ids.length - PER_SCOPE_LIMIT)) delete remembered[id];
  }
  const contributed = mergeSessionContributions(remembered, fresh);
  const owners = new Set<string>();
  for (const contribution of contributed) {
    const owner = promptContributionOwner(contribution);
    if (owner) owners.add(owner);
  }
  if ((!previous && restored) || (previous?.overflowed && (!resets[""] || isPromptContributionConfirmed(resets[""])))) {
    if (resets === previous?.resets) resets = Object.assign(Object.create(null), resets);
    resets[""] = withdrawalContribution("");
    changed = true;
  }
  for (const owner of owners) {
    if (resets[owner] && !isPromptContributionConfirmed(resets[owner])) continue;
    if (resets === previous?.resets) resets = Object.assign(Object.create(null), resets);
    resets[owner] = withdrawalContribution(owner);
    changed = true;
  }
  const resetIds = Object.keys(resets).filter((owner) => owner !== "");
  let overflowed = false;
  if (resetIds.length > PER_SCOPE_LIMIT) {
    if (resets === previous?.resets) resets = Object.assign(Object.create(null), resets);
    for (let index = 0; index < resetIds.length - PER_SCOPE_LIMIT; index++) {
      const owner = resetIds[index];
      if (owners.has(owner)) overflowed = true;
      else if (!isPromptContributionConfirmed(resets[owner]) && (!resets[""] || isPromptContributionConfirmed(resets[""]))) {
        resets[""] = withdrawalContribution("");
      }
      delete resets[owner];
    }
    changed = true;
  }
  if (overflowed !== previous?.overflowed) changed = true;
  const withdrawals = Object.entries(resets)
    .filter(([owner, notice]) => !owners.has(owner) && !isPromptContributionConfirmed(notice))
    .map(([, notice]) => notice);
  const promptContributions = withdrawals.length > 0 ? [...withdrawals, ...contributed] : contributed;
  if (!changed) return { promptContributions, next: null };
  const next = { ...all, [scope]: { remembered, resets, overflowed } };
  const scopes = Object.keys(next);
  if (scopes.length > SCOPE_LIMIT) {
    for (const old of scopes.slice(0, scopes.length - SCOPE_LIMIT)) delete next[old];
  }
  return { promptContributions, next };
}

/** Carry a pending tab's instructions and notice identities onto its native
 * session. Pending contributions win; an unacknowledged withdrawal survives. */
export function migrateSessionContributions(
  all: SessionContributions,
  engine: string,
  workspacePath: string,
  sessionId: string,
): SessionContributions | null {
  const from = sessionContributionScope(engine, null, workspacePath);
  const pending = all[from];
  if (!pending) return null;
  const to = sessionContributionScope(engine, sessionId, workspacePath);
  const existing = all[to];
  const resets = Object.assign(Object.create(null), existing?.resets, pending.resets) as Record<string, PromptContribution>;
  for (const [owner, notice] of Object.entries(existing?.resets ?? {})) {
    if (!isPromptContributionConfirmed(notice)) resets[owner] = notice;
  }
  const next = { ...all, [to]: {
    remembered: Object.assign(Object.create(null), existing?.remembered, pending.remembered),
    resets,
    overflowed: pending.overflowed || existing?.overflowed === true,
  } };
  delete next[from];
  return next;
}

/** Drop a scope's remembered contributions (tab closed, session deleted).
 * Pure: the next map, or null when the scope held nothing. */
export function forgetSessionContributions(
  all: SessionContributions,
  engine: string,
  sessionId: string | null,
  workspacePath: string,
): SessionContributions | null {
  const scope = sessionContributionScope(engine, sessionId, workspacePath);
  if (!(scope in all)) return null;
  const next = { ...all };
  delete next[scope];
  return next;
}
