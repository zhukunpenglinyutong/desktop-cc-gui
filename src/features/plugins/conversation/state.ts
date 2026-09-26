import { safeRandomUUID } from "@/lib/id";
import { readStoredJson, writeStored } from "@/lib/storage";

export class ConversationModeState {
  private identities = new Map<string, string>();
  private selections = new Map<string, string>();
  private blocked = new Map<string, string>();

  constructor(
    saved: Record<string, string> = {},
    private persist: (identities: Record<string, string>) => void = () => {},
    savedLocks: Record<string, string> = {},
    private persistLocks: (locks: Record<string, string>) => void = () => {},
  ) {
    this.identities = new Map(Object.entries(saved).filter(([, identity]) => typeof identity === "string"));
    this.blocked = new Map(Object.entries(savedLocks).filter(([, mode]) => typeof mode === "string"));
    this.selections = new Map(this.blocked);
  }

  identity(sessionKey: string, workspacePath: string, draft: boolean): string {
    const key = JSON.stringify([workspacePath, sessionKey]);
    let identity = this.identities.get(key);
    if (!identity) {
      identity = draft ? JSON.stringify([workspacePath, sessionKey, safeRandomUUID()]) : key;
      this.identities.set(key, identity);
      this.persist(Object.fromEntries(this.identities));
    }
    return identity;
  }

  retain(sessions: readonly { key: string; workspacePath: string }[]): void {
    const retained = new Set(sessions.map((session) => JSON.stringify([session.workspacePath, session.key])));
    let changed = false;
    for (const [key, identity] of this.identities) {
      if (!retained.has(key) && !this.isExitBlocked(identity)) {
        this.identities.delete(key);
        this.selections.delete(identity);
        changed = true;
      }
    }
    if (changed) this.persist(Object.fromEntries(this.identities));
  }

  select(identity: string, mode: string, streaming: boolean, queued: number): boolean {
    if (streaming || queued > 0 || (this.isExitBlocked(identity) && this.blocked.get(identity) !== mode)) return false;
    this.selections.set(identity, mode);
    return true;
  }

  selected(identity: string): string | undefined {
    return this.blocked.get(identity) ?? this.selections.get(identity);
  }

  exit(identity: string): void {
    if (this.isExitBlocked(identity)) return;
    this.selections.delete(identity);
  }

  setExitBlocked(identity: string, mode: string, blocked: boolean): void {
    if (blocked) {
      this.blocked.set(identity, mode);
      this.selections.set(identity, mode);
    } else if (this.blocked.get(identity) === mode) {
      this.blocked.delete(identity);
    } else return;
    this.persistLocks(Object.fromEntries(this.blocked));
  }

  isExitBlocked(identity: string): boolean {
    return this.blocked.has(identity);
  }

  isTabCloseBlocked(sessionKey: string, workspacePath: string): boolean {
    const identity = this.identities.get(JSON.stringify([workspacePath, sessionKey]));
    return identity !== undefined && this.isExitBlocked(identity);
  }

  removeMode(mode: string): void {
    for (const [identity, selected] of this.selections) {
      if (selected === mode) this.selections.delete(identity);
    }
  }
}

function readStringMap(key: string): Record<string, string> {
  return readStoredJson<Record<string, string>>(key, (value) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).filter(([, entry]) => typeof entry === "string"))
      : null,
  ) ?? {};
}

let sharedState: ConversationModeState | undefined;

export function getConversationModeState(): ConversationModeState {
  const identityKey = "ccgui.plugin-conversation-identities:v1";
  const lockKey = "ccgui.plugin-conversation-locks:v1";
  return sharedState ??= new ConversationModeState(
    readStringMap(identityKey),
    (identities) => writeStored(identityKey, JSON.stringify(identities)),
    readStringMap(lockKey),
    (locks) => writeStored(lockKey, JSON.stringify(locks)),
  );
}
