import { useTranslation } from "react-i18next";
import { BotAvatarView } from "@/features/bots/bot-avatar";
import { type SelectedBot } from "@/features/bots/selected-bot";

/**
 * Pinned-bot chip rendered above the composer input, styled after the
 * attachment chips (ConversationFooter); × clears the selection. It renders
 * the frozen pick (name + avatar as of selection), not the live bot row: a bot
 * renamed mid-conversation must not relabel the prompt it already produced.
 */
export function SelectedBotChip({
  bot,
  onClear,
}: {
  bot: SelectedBot;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1.5 px-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-background-tertiary-default py-0.5 pl-2 text-caption-1-medium text-text-secondary">
        <BotAvatarView avatar={bot.avatar} seed={bot.id} size={14} />
        <span className="max-w-48 truncate">{bot.name}</span>
        <button
          type="button"
          aria-label={t("chat.selectedAgentRemove")}
          onClick={onClear}
          className="cursor-pointer rounded-full px-1 hover:text-text-primary"
        >
          ×
        </button>
      </span>
    </div>
  );
}
