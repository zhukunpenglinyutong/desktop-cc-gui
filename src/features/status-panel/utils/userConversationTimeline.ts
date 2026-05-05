import type { ConversationItem } from "../../../types";
import { resolveUserConversationSummary } from "../../messages/components/messagesUserPresentation";

type MessageConversationItem = Extract<ConversationItem, { kind: "message" }>;

export interface UserConversationTimelineItem {
  id: string;
  text: string;
  imageCount: number;
  chronologicalIndex: number;
}

export interface UserConversationTimeline {
  items: UserConversationTimelineItem[];
  hasMessage: boolean;
}

function toTimelineItem(
  candidate: MessageConversationItem,
  enableCollaborationBadge: boolean,
): Omit<UserConversationTimelineItem, "chronologicalIndex"> | null {
  const summary = resolveUserConversationSummary({
    text: candidate.text,
    images: candidate.images,
    selectedAgentName: candidate.selectedAgentName,
    selectedAgentIcon: candidate.selectedAgentIcon,
    enableCollaborationBadge,
  });
  if (!summary.hasRenderableConversationContent) {
    return null;
  }
  return {
    id: candidate.id,
    text: summary.previewText,
    imageCount: summary.imageCount,
  };
}

export function resolveUserConversationTimeline(
  items: ConversationItem[] | undefined,
  options?: { enableCollaborationBadge?: boolean },
): UserConversationTimeline {
  if (!Array.isArray(items) || items.length === 0) {
    return { items: [], hasMessage: false };
  }

  const enableCollaborationBadge = options?.enableCollaborationBadge ?? false;

  const visibleUserMessages = items
    .filter(
      (candidate): candidate is MessageConversationItem =>
        candidate?.kind === "message" && candidate.role === "user",
    )
    .map((candidate) => toTimelineItem(candidate, enableCollaborationBadge))
    .filter((candidate): candidate is Omit<UserConversationTimelineItem, "chronologicalIndex"> =>
      candidate !== null)
    .map((candidate, index) => ({
      ...candidate,
      chronologicalIndex: index + 1,
    }));

  const timeline = visibleUserMessages
    .reverse();

  return {
    items: timeline,
    hasMessage: timeline.length > 0,
  };
}
