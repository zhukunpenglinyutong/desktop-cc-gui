import type { ConversationItem } from "../../../types";
import { extractToolName } from "./toolBlocks/toolConstants";

function normalizeToolIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isExitPlanModeConversationTool(
  item: ConversationItem,
): item is Extract<ConversationItem, { kind: "tool" }> {
  if (item.kind !== "tool") {
    return false;
  }
  const normalizedToolName = normalizeToolIdentifier(extractToolName(item.title));
  const normalizedTitle = normalizeToolIdentifier(item.title);
  return (
    normalizedToolName === "exitplanmode" ||
    normalizedToolName.endsWith("exitplanmode") ||
    normalizedTitle.includes("exitplanmode")
  );
}

export function buildExitPlanDeduplicationKey(
  item: Extract<ConversationItem, { kind: "tool" }>,
) {
  const rawSources = [item.detail, item.output ?? ""]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  let planMarkdown = "";
  let planFilePath = "";

  for (const source of rawSources) {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      const record = parsed as Record<string, unknown>;
      if (typeof record.plan === "string" && record.plan.trim()) {
        planMarkdown = record.plan.trim();
      }
      if (typeof record.planFilePath === "string" && record.planFilePath.trim()) {
        planFilePath = record.planFilePath.trim();
      }
      if (planMarkdown || planFilePath) {
        break;
      }
    } catch {
      // ignore non-json payloads
    }
  }

  if (!planMarkdown) {
    const labeledPlanMatch = /(?:^|\n)PLAN\s*\n([\s\S]*?)(?:\nPLANFILEPATH\s*\n|$)/i.exec(
      rawSources.join("\n\n"),
    );
    if (labeledPlanMatch?.[1]) {
      planMarkdown = labeledPlanMatch[1].trim();
    }
  }

  if (!planFilePath) {
    const labeledPlanFileMatch = /(?:^|\n)PLANFILEPATH\s*\n([^\n]+)$/im.exec(
      rawSources.join("\n\n"),
    );
    if (labeledPlanFileMatch?.[1]) {
      planFilePath = labeledPlanFileMatch[1].trim();
    }
  }

  if (planMarkdown || planFilePath) {
    return ["plan", planMarkdown, planFilePath].join("::");
  }

  return ["semantic", normalizeToolIdentifier(extractToolName(item.title))].join("::");
}

function hasStructuredExitPlanContent(
  item: Extract<ConversationItem, { kind: "tool" }>,
) {
  return buildExitPlanDeduplicationKey(item).startsWith("plan::");
}

export function dedupeExitPlanItemsKeepFirst(items: ConversationItem[]) {
  const seenExitPlanKeys = new Set<string>();
  const seenExitPlanSemantics = new Set<string>();
  return items.filter((item) => {
    if (!isExitPlanModeConversationTool(item)) {
      return true;
    }
    const key = buildExitPlanDeduplicationKey(item);
    const semanticKey = normalizeToolIdentifier(extractToolName(item.title));
    const hasStructuredContent = hasStructuredExitPlanContent(item);
    if (seenExitPlanKeys.has(key)) {
      return false;
    }
    if (seenExitPlanSemantics.has(semanticKey) && !hasStructuredContent) {
      return false;
    }
    seenExitPlanKeys.add(key);
    seenExitPlanSemantics.add(semanticKey);
    return true;
  });
}
