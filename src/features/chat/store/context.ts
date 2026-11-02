import type { SessionMeta, SessionPage } from "@/lib/ipc";
import type { ChatStore } from "./types";

/**
 * Shared plumbing for the store action factories: the zustand set/get pair
 * plus the helpers that cross group boundaries (tabs reach into messaging's
 * queue drain, lifecycle into tab activation, ...). Each factory declares
 * the subset it needs as its deps interface. Type-only imports keep every
 * factory free of runtime cycles with ../store — the same rule
 * engine-events.ts follows.
 */

/** zustand's set, narrowed to the merge (non-replace) call shape. */
export type StoreSet = (
  partial: Partial<ChatStore> | ((s: ChatStore) => Partial<ChatStore>),
) => void;

export type StoreGet = () => ChatStore;

/** store.ts's loadHistoryPage: it reads the live store for the session
 * catalog, so it stays next to the store and arrives here through deps. */
export type LoadHistoryPage = (
  engine: string,
  sessionId: string,
  workspacePath: string,
  limit?: number,
  beforeSeq?: number | null,
  meta?: SessionMeta,
  forceReload?: boolean,
) => Promise<SessionPage>;

/** useChatStore.subscribe, injected so compactContext needs no store import. */
export type StoreSubscribe = (listener: () => void) => () => void;
