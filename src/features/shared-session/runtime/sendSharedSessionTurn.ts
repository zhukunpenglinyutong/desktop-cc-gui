import type { SharedSessionSupportedEngine } from "../utils/sharedSessionEngines";
import {
  sendSharedSessionMessage,
  setSharedSessionSelectedEngine,
} from "../services/sharedSessions";
import {
  registerSharedSessionNativeBinding,
  rebindSharedSessionNativeThread,
} from "./sharedSessionBridge";

export async function sendSharedSessionTurn(input: {
  workspaceId: string;
  threadId: string;
  engine: SharedSessionSupportedEngine;
  text: string;
  model: string | null;
  effort: string | null;
  accessMode?: "default" | "read-only" | "current" | "full-access";
  images: string[];
  collaborationMode?: Record<string, unknown> | null;
  preferredLanguage?: string | null;
  customSpecRoot?: string | null;
}) {
  const selection = await setSharedSessionSelectedEngine(
    input.workspaceId,
    input.threadId,
    input.engine,
  );
  const selectedNativeThreadId =
    typeof selection?.nativeThreadId === "string" ? selection.nativeThreadId.trim() : "";
  if (selectedNativeThreadId) {
    registerSharedSessionNativeBinding({
      workspaceId: input.workspaceId,
      sharedThreadId: input.threadId,
      nativeThreadId: selectedNativeThreadId,
      engine: input.engine,
    });
  }
  const response = await sendSharedSessionMessage(
    input.workspaceId,
    input.threadId,
    input.engine,
    input.text,
    {
      model: input.model,
      effort: input.effort,
      collaborationMode: input.collaborationMode,
      accessMode: input.accessMode,
      images: input.images,
      preferredLanguage: input.preferredLanguage,
      customSpecRoot: input.customSpecRoot,
    },
  );
  const nativeThreadId =
    typeof response?.nativeThreadId === "string" ? response.nativeThreadId.trim() : "";
  if (nativeThreadId) {
    const shouldRebindSelectedThread =
      selectedNativeThreadId &&
      selectedNativeThreadId !== nativeThreadId &&
      selectedNativeThreadId.startsWith(`${input.engine}-pending-shared-`);
    if (shouldRebindSelectedThread) {
      const rebound = rebindSharedSessionNativeThread({
        workspaceId: input.workspaceId,
        oldNativeThreadId: selectedNativeThreadId,
        newNativeThreadId: nativeThreadId,
      });
      if (!rebound) {
        registerSharedSessionNativeBinding({
          workspaceId: input.workspaceId,
          sharedThreadId: input.threadId,
          nativeThreadId,
          engine: input.engine,
        });
      }
    } else {
      registerSharedSessionNativeBinding({
        workspaceId: input.workspaceId,
        sharedThreadId: input.threadId,
        nativeThreadId,
        engine: input.engine,
      });
    }
  }
  return response;
}
