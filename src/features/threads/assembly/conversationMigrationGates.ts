import type { ConversationEngine } from "../contracts/conversationCurtainContracts";

export type ConversationAssemblyMigrationGate = {
  engine: Extract<ConversationEngine, "claude" | "gemini">;
  assemblerEnabled: boolean;
  profileEnabled: boolean;
  storageOwner: "implementation-local";
  diagnosticLabel: string;
  removalCondition: string;
};

export const CONVERSATION_ASSEMBLY_MIGRATION_GATES: Record<
  Extract<ConversationEngine, "claude" | "gemini">,
  ConversationAssemblyMigrationGate
> = {
  claude: {
    engine: "claude",
    assemblerEnabled: true,
    profileEnabled: true,
    storageOwner: "implementation-local",
    diagnosticLabel: "conversation-assembly-migration:claude",
    removalCondition:
      "Remove after Claude history/realtime parity, approval replay, plan replay, and long Markdown tests stay green across one release.",
  },
  gemini: {
    engine: "gemini",
    assemblerEnabled: true,
    profileEnabled: true,
    storageOwner: "implementation-local",
    diagnosticLabel: "conversation-assembly-migration:gemini",
    removalCondition:
      "Remove after Gemini history/realtime parity, reasoning cardinality, tool snapshot, and assistant replay tests stay green across one release.",
  },
};

export function resolveConversationAssemblyMigrationGate(
  engine: ConversationEngine,
): ConversationAssemblyMigrationGate | null {
  if (engine !== "claude" && engine !== "gemini") {
    return null;
  }
  return CONVERSATION_ASSEMBLY_MIGRATION_GATES[engine];
}
