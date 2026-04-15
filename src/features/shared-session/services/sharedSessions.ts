import { invoke } from "@tauri-apps/api/core";
import type { EngineType } from "../../../types";
import { normalizeSharedSessionEngine } from "../utils/sharedSessionEngines";

export async function startSharedSession(
  workspaceId: string,
  selectedEngine?: EngineType | null,
) {
  return invoke<Record<string, unknown> | null | undefined>("start_shared_session", {
    workspaceId,
    selectedEngine: normalizeSharedSessionEngine(selectedEngine),
  });
}

export async function sendSharedSessionMessage(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
  text: string,
  options?: {
    model?: string | null;
    effort?: string | null;
    accessMode?: "default" | "read-only" | "current" | "full-access";
    images?: string[];
    collaborationMode?: Record<string, unknown> | null;
    preferredLanguage?: string | null;
    customSpecRoot?: string | null;
  },
) {
  return invoke<Record<string, unknown> | null | undefined>("send_shared_session_message", {
    workspaceId,
    threadId,
    engine,
    text,
    model: options?.model ?? null,
    effort: options?.effort ?? null,
    accessMode: options?.accessMode ?? null,
    images: options?.images ?? null,
    preferredLanguage: options?.preferredLanguage ?? null,
    collaborationMode: options?.collaborationMode ?? null,
    customSpecRoot: options?.customSpecRoot ?? null,
  });
}

export async function listSharedSessions(workspaceId: string) {
  return invoke<Record<string, unknown>[]>("list_shared_sessions", {
    workspaceId,
  });
}

export async function loadSharedSession(workspaceId: string, threadId: string) {
  return invoke<Record<string, unknown> | null>("load_shared_session", {
    workspaceId,
    threadId,
  });
}

export async function setSharedSessionSelectedEngine(
  workspaceId: string,
  threadId: string,
  selectedEngine: EngineType,
) {
  return invoke<Record<string, unknown> | null>("set_shared_session_selected_engine", {
    workspaceId,
    threadId,
    selectedEngine: normalizeSharedSessionEngine(selectedEngine),
  });
}

export async function updateSharedSessionNativeBinding(
  workspaceId: string,
  threadId: string,
  engine: EngineType,
  oldNativeThreadId: string | null,
  newNativeThreadId: string,
) {
  return invoke<Record<string, unknown> | null>("update_shared_session_native_binding", {
    workspaceId,
    threadId,
    engine,
    oldNativeThreadId,
    newNativeThreadId,
  });
}

export async function syncSharedSessionSnapshot(
  workspaceId: string,
  threadId: string,
  items: unknown[],
  selectedEngine: EngineType,
) {
  return invoke<Record<string, unknown> | null>("sync_shared_session_snapshot", {
    workspaceId,
    threadId,
    items,
    selectedEngine: normalizeSharedSessionEngine(selectedEngine),
  });
}

export async function deleteSharedSession(
  workspaceId: string,
  threadId: string,
) {
  return invoke<Record<string, unknown> | null>("delete_shared_session", {
    workspaceId,
    threadId,
  });
}
