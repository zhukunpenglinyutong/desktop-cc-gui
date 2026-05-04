import { describe, expect, it } from "vitest";
import {
  CONVERSATION_ASSEMBLY_MIGRATION_GATES,
  resolveConversationAssemblyMigrationGate,
} from "./conversationMigrationGates";

describe("conversationMigrationGates", () => {
  it("defines independent implementation-local gates for Claude and Gemini", () => {
    const claudeGate = resolveConversationAssemblyMigrationGate("claude");
    const geminiGate = resolveConversationAssemblyMigrationGate("gemini");

    expect(claudeGate).toEqual(
      expect.objectContaining({
        engine: "claude",
        assemblerEnabled: true,
        profileEnabled: true,
        storageOwner: "implementation-local",
        diagnosticLabel: "conversation-assembly-migration:claude",
      }),
    );
    expect(geminiGate).toEqual(
      expect.objectContaining({
        engine: "gemini",
        assemblerEnabled: true,
        profileEnabled: true,
        storageOwner: "implementation-local",
        diagnosticLabel: "conversation-assembly-migration:gemini",
      }),
    );
    expect(claudeGate?.diagnosticLabel).not.toBe(geminiGate?.diagnosticLabel);
  });

  it("does not create migration gates for stable Codex or unrelated engines", () => {
    expect(resolveConversationAssemblyMigrationGate("codex")).toBeNull();
    expect(resolveConversationAssemblyMigrationGate("opencode")).toBeNull();
  });

  it("exposes mutable implementation-local gates for focused rollback tests", () => {
    const previousClaudeGate = { ...CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude };
    try {
      CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude.assemblerEnabled = false;
      CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude.profileEnabled = false;

      expect(resolveConversationAssemblyMigrationGate("claude")).toEqual(
        expect.objectContaining({
          assemblerEnabled: false,
          profileEnabled: false,
        }),
      );
      expect(resolveConversationAssemblyMigrationGate("gemini")).toEqual(
        expect.objectContaining({
          assemblerEnabled: true,
          profileEnabled: true,
        }),
      );
    } finally {
      CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude.assemblerEnabled =
        previousClaudeGate.assemblerEnabled;
      CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude.profileEnabled =
        previousClaudeGate.profileEnabled;
    }
  });
});
