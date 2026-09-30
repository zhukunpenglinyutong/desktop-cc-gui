import { FileMentionMenu } from "@/components/application/ai-chat/file-mention-menu";
import { SlashCommandMenu } from "@/components/application/ai-chat/slash-command-menu";
import { BotMenu } from "@/components/application/ai-chat/bot-menu";
import { PromptMenu } from "@/components/application/ai-chat/prompt-menu";
import type { ComposerPickers } from "@/components/application/ai-chat/use-composer-pickers";

/**
 * The composer's floating pickers (`@` files, `/` commands, `#` bots,
 * `!` prompts). All four anchor above the field; only one is active at a
 * time (see useComposerPickers). Hidden while the composer is collapsed.
 */
export function ComposerPickerMenus({
  isCollapsed,
  workspacePath,
  pickers,
}: {
  isCollapsed: boolean;
  workspacePath?: string;
  pickers: ComposerPickers;
}) {
  if (isCollapsed || !workspacePath) return null;
  const {
    mention,
    setMention,
    mentionMenuRef,
    handleMentionSelect,
    slash,
    setSlash,
    slashMenuRef,
    handleSlashSelect,
    bot,
    setBot,
    botMenuRef,
    handleBotSelect,
    prompt,
    setPrompt,
    promptMenuRef,
    handlePromptSelect,
  } = pickers;
  return (
    <>
      {mention && (
        <FileMentionMenu
          root={workspacePath}
          query={mention.query}
          left={mention.left}
          onSelect={handleMentionSelect}
          onClose={() => setMention(null)}
          menuRef={mentionMenuRef}
        />
      )}
      {slash && (
        <SlashCommandMenu
          root={workspacePath}
          query={slash.query}
          left={slash.left}
          onSelect={handleSlashSelect}
          onClose={() => setSlash(null)}
          menuRef={slashMenuRef}
        />
      )}
      {bot && (
        <BotMenu
          query={bot.query}
          left={bot.left}
          onSelect={handleBotSelect}
          onClose={() => setBot(null)}
          menuRef={botMenuRef}
        />
      )}
      {prompt && (
        <PromptMenu
          root={workspacePath}
          query={prompt.query}
          left={prompt.left}
          onSelect={handlePromptSelect}
          onClose={() => setPrompt(null)}
          menuRef={promptMenuRef}
        />
      )}
    </>
  );
}
