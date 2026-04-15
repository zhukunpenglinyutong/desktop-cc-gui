import type { SharedSessionSupportedEngine } from "../utils/sharedSessionEngines";

export type SharedSessionNativeBinding = {
  workspaceId: string;
  sharedThreadId: string;
  nativeThreadId: string;
  engine: SharedSessionSupportedEngine;
  registeredAtMs?: number;
};

type RuntimeSharedSessionNativeBinding = SharedSessionNativeBinding & {
  registeredAtMs: number;
};

const PENDING_BINDING_STALE_MS = 30_000;
const sharedBindingsByNativeKey = new Map<string, RuntimeSharedSessionNativeBinding>();

function toBindingKey(workspaceId: string, nativeThreadId: string) {
  return `${workspaceId}::${nativeThreadId}`;
}

function toPublicBinding(
  binding: RuntimeSharedSessionNativeBinding | null | undefined,
): SharedSessionNativeBinding | null {
  if (!binding) {
    return null;
  }
  const { registeredAtMs: _registeredAtMs, ...publicBinding } = binding;
  return publicBinding;
}

export function registerSharedSessionNativeBinding(binding: SharedSessionNativeBinding) {
  const registeredAtMs =
    typeof binding.registeredAtMs === "number" && Number.isFinite(binding.registeredAtMs)
      ? binding.registeredAtMs
      : Date.now();
  sharedBindingsByNativeKey.set(
    toBindingKey(binding.workspaceId, binding.nativeThreadId),
    {
      ...binding,
      registeredAtMs,
    },
  );
}

function isPendingSharedNativeThreadId(
  engine: SharedSessionSupportedEngine,
  nativeThreadId: string,
) {
  if (engine === "claude") {
    return nativeThreadId.startsWith("claude-pending-shared-");
  }
  return nativeThreadId.startsWith("codex-pending-shared-");
}

export function resolveSharedSessionBindingByNativeThread(
  workspaceId: string,
  nativeThreadId: string,
) {
  return toPublicBinding(
    sharedBindingsByNativeKey.get(toBindingKey(workspaceId, nativeThreadId)),
  );
}

export function resolvePendingSharedSessionBindingForEngine(
  workspaceId: string,
  engine: SharedSessionSupportedEngine,
) {
  const matches: RuntimeSharedSessionNativeBinding[] = [];
  const now = Date.now();
  sharedBindingsByNativeKey.forEach((binding) => {
    if (binding.workspaceId !== workspaceId || binding.engine !== engine) {
      return;
    }
    if (isPendingSharedNativeThreadId(engine, binding.nativeThreadId)) {
      if (now - binding.registeredAtMs > PENDING_BINDING_STALE_MS) {
        return;
      }
      matches.push(binding);
    }
  });
  if (matches.length !== 1) {
    return null;
  }
  return toPublicBinding(matches[0]);
}

export function rebindSharedSessionNativeThread(params: {
  workspaceId: string;
  oldNativeThreadId: string;
  newNativeThreadId: string;
}) {
  const oldKey = toBindingKey(params.workspaceId, params.oldNativeThreadId);
  const existing = sharedBindingsByNativeKey.get(oldKey);
  if (!existing) {
    return null;
  }
  sharedBindingsByNativeKey.delete(oldKey);
  const next = {
    ...existing,
    nativeThreadId: params.newNativeThreadId,
    registeredAtMs: Date.now(),
  };
  sharedBindingsByNativeKey.set(
    toBindingKey(params.workspaceId, params.newNativeThreadId),
    next,
  );
  return toPublicBinding(next);
}

export function clearSharedSessionBindingsForSharedThread(
  workspaceId: string,
  sharedThreadId: string,
) {
  const keysToDelete: string[] = [];
  sharedBindingsByNativeKey.forEach((binding, key) => {
    if (binding.workspaceId === workspaceId && binding.sharedThreadId === sharedThreadId) {
      keysToDelete.push(key);
    }
  });
  keysToDelete.forEach((key) => {
    sharedBindingsByNativeKey.delete(key);
  });
}
