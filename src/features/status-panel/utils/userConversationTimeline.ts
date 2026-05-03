import type { ConversationItem } from "../../../types";

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
  chronologicalIndex: number,
): UserConversationTimelineItem | null {
  const text = candidate.text.trim();
  const imageCount = Array.isArray(candidate.images) ? candidate.images.length : 0;
  if (!text && imageCount === 0) {
    return null;
  }
  return {
    id: candidate.id,
    text,
    imageCount,
    chronologicalIndex,
  };
}

export function resolveUserConversationTimeline(
  items: ConversationItem[] | undefined,
): UserConversationTimeline {
  if (!Array.isArray(items) || items.length === 0) {
    return { items: [], hasMessage: false };
  }

  const timeline = items
    .filter(
      (candidate): candidate is MessageConversationItem =>
        candidate?.kind === "message" && candidate.role === "user",
    )
    .map((candidate, index) => toTimelineItem(candidate, index + 1))
    .filter((candidate): candidate is UserConversationTimelineItem => candidate !== null)
    .reverse();

  return {
    items: timeline,
    hasMessage: timeline.length > 0,
  };
}
