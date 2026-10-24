/**
 * Session selection for plugin events: the channel a session runs with and
 * the model selector the picker spells. Facts only — deriving a provider id
 * from a `provider/model` selector stays with the plugin, which knows its
 * engine's selector convention.
 */

import type { SessionSelection } from "@/features/plugins/runtime/events";
import { PSEUDO_LOCAL } from "@/features/settings/providers";
import { sameTab, sessionKey, type ActiveSession } from "./persistence";
import {
  resolveSessionModel,
  resolveSessionProvider,
  type SessionState,
} from "./stream";

/** The slice of the chat store the resolver reads. */
export interface SelectionState {
  active: ActiveSession | null;
  openTabs: ActiveSession[];
  bySession: Record<
    string,
    Pick<SessionState, "activeProvider" | "activeModel" | "messages">
  >;
  providers: Record<string, string>;
  models: Record<string, string>;
  /** Session rows: the only place that remembers a session's last model
   *  before its history has loaded. */
  sessions: { engine: string; sessionId: string; model?: string | null; provider?: string | null }[];
}

/**
 * Resolve what `engine`/`sessionId` runs right now.
 *
 * `provider` is the selected channel id; the pseudo "use the engine's own
 * settings" marker is reported as null so plugins never have to know host
 * sentinels. `model` is the picker's selector (may include a `provider/`
 * prefix, e.g. `deepseek/deepseek-flash`) or null for the CLI default.
 */
export function sessionSelection(
  state: SelectionState,
  engine: string,
  sessionId: string | null,
  workspacePath: string,
): SessionSelection {
  const tab = state.openTabs.find((item) =>
    sameTab(item, engine, sessionId, workspacePath),
  );
  const session = state.bySession[sessionKey(engine, sessionId, workspacePath)];
  const meta = sessionId
    ? state.sessions.find(
        (item) => item.engine === engine && item.sessionId === sessionId,
      )
    : undefined;
  const channel = resolveSessionProvider(
    tab ?? { engine, sessionId },
    session,
    meta?.provider ?? state.providers[engine],
  );
  return {
    provider: channel && channel !== PSEUDO_LOCAL ? channel : null,
    model:
      resolveSessionModel(tab, session, meta?.model ?? state.models[engine]) ??
      null,
  };
}
