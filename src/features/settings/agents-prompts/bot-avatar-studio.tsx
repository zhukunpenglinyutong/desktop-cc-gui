import { useTranslation } from "react-i18next";
import Dices from "lucide-react/dist/esm/icons/dices";
import { AgentAvatar } from "@/components/application/agent-avatar/agent-avatar";
import {
  Dropdown,
  DropdownPopover,
  DropdownTrigger,
} from "@/components/base/dropdown/dropdown";
import { EmotionPicker } from "@/components/application/multi-agent-chat/emotion-picker";
import { ShapeArc } from "@/components/application/multi-agent-chat/shape-arc";
import { CustomColorPicker } from "@/components/application/theme/custom-color-picker";
import {
  ActiveRing,
  GlossSwatch,
  RainbowGlossArt,
} from "@/components/application/theme/accent-gloss";
import {
  BOT_COLOR_PRESETS,
  BOT_EYES,
  BOT_FOLD_SHAPES,
  avatarConfig,
  avatarHex,
  hexToAppearance,
  normalizeAvatar,
  randomAvatar,
} from "@/features/bots/bot-avatar";
import type { BotAvatar } from "@/lib/ipc";
import { cx } from "@/utils/cx";

/**
 * Avatar studio — BoardUI's Agent Creator identity block.
 *
 * The layout is the vendored block's: the live avatar sits inside the emotion
 * wheel, the nine silhouettes ride an arc below it, and the colour row is a
 * pill of glossy swatches with the rainbow well at the end. A dice button in
 * the corner shuffles all three at once. Everything the user picks is written
 * straight into the bot's `avatar`, so the list, the `#` picker and the chat
 * badge show the same character.
 *
 * Emoji and image avatars are not offered any more (they looked nothing like
 * the rest of the app); one that already exists is shown with a note rather
 * than converted behind the user's back.
 */
export function BotAvatarStudio({
  avatar,
  seed,
  onChange,
}: {
  avatar: BotAvatar;
  /** Identity the deterministic fallback and the engine's rhythm use. */
  seed: string;
  onChange: (avatar: BotAvatar) => void;
}) {
  const { t } = useTranslation();
  const value = normalizeAvatar(avatar, seed);
  const config = avatarConfig(value, seed);
  const isPaper = value.type === "generated";

  /** Any pick lands on the paper avatar: choosing a shape, a face or a colour
   *  while an emoji avatar is stored replaces it (and clears the glyph). */
  const patch = (next: Partial<BotAvatar>) =>
    onChange({ ...value, type: "generated", value: undefined, ...next });

  const eyesLabels = Object.fromEntries(
    BOT_EYES.map((eyes) => [eyes, t(`settings.botEyes.${eyes}`)]),
  );
  const shapeLabels = Object.fromEntries(
    BOT_FOLD_SHAPES.map((shape) => [shape, t(`settings.botShape.${shape}`)]),
  );

  const activePreset = BOT_COLOR_PRESETS.findIndex(
    (preset) =>
      value.lightness === undefined &&
      value.hue === preset.hue &&
      value.saturation === preset.saturation,
  );
  const isCustomColor = isPaper && (value.lightness !== undefined || activePreset === -1);

  return (
    <div className="flex flex-col gap-3">
      {/* 旧数据的 emoji / 图片头像仍然照常显示；这里只说清「选一个形象就会替换」，
          不静默改掉用户原来的图标。 */}
      {!isPaper && (
        <p className="rounded-2lg border border-separator-border bg-background-primary-default px-3 py-2 text-caption-1-regular text-text-tertiary">
          {t("settings.botAvatarLegacyNote", {
            icon: avatar.type === "emoji" ? (avatar.value ?? "") : "🖼",
          })}
        </p>
      )}
      <div className="relative h-[360px] overflow-hidden">
        <button
          type="button"
          aria-label={t("settings.botAvatarRandom")}
          title={t("settings.botAvatarRandom")}
          onClick={() => onChange(randomAvatar())}
          className={cx(
            "absolute right-0 top-0 z-20 flex size-7 cursor-pointer items-center justify-center rounded-lg",
            "text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary",
            "outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
          )}
        >
          <Dices className="size-4" aria-hidden />
        </button>
        <div className="pointer-events-none absolute left-1/2 top-[30px] z-10 -translate-x-1/2">
          <EmotionPicker
            key={seed}
            config={config}
            labels={eyesLabels}
            onChange={(eyes) => patch({ eyes })}
          />
        </div>
        <div className="pointer-events-none absolute left-1/2 top-[83px] -translate-x-1/2">
          <AgentAvatar
            config={config}
            size={162}
            label={t("settings.botAvatarPreview", {
              name: t(`settings.botShape.${value.foldShape}`),
            })}
          />
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0">
          <ShapeArc
            key={seed}
            config={config}
            labels={shapeLabels}
            onChange={(foldShape) => patch({ foldShape })}
          />
        </div>
      </div>

      <div className="flex justify-center">
        <div
          role="group"
          aria-label={t("settings.botAvatarColor")}
          className="flex h-[38px] shrink-0 items-center gap-1 rounded-full border border-border-button-default bg-background-primary-default p-[5px]"
        >
          {BOT_COLOR_PRESETS.map((preset, index) => (
            <GlossSwatch
              key={preset.gloss}
              hue={preset.gloss}
              active={index === activePreset}
              label={t(`settings.botColor.${preset.gloss}`)}
              onSelect={() =>
                patch({ hue: preset.hue, saturation: preset.saturation, lightness: undefined })
              }
            />
          ))}
          <Dropdown>
            <DropdownTrigger
              aria-label={t("settings.botAvatarColorCustom")}
              className={cx(
                "relative size-[26px] shrink-0 cursor-pointer overflow-hidden rounded-full",
                "transition-transform hover:scale-110",
                "outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
              )}
            >
              {/* react-aria's Button does not forward `title`; the wrapper
                  carries the pointer hint instead. */}
              <span title={t("settings.botAvatarColorCustom")} className="contents">
                <RainbowGlossArt />
                {isCustomColor && <ActiveRing />}
              </span>
            </DropdownTrigger>
            <DropdownPopover
              aria-label={t("settings.botAvatarColorCustom")}
              placement="bottom end"
              className="w-[248px] rounded-3xl p-2.5"
            >
              <CustomColorPicker
                value={avatarHex(value, seed)}
                onChange={(hex) => onChange({ ...value, ...hexToAppearance(hex) })}
              />
            </DropdownPopover>
          </Dropdown>
        </div>
      </div>
    </div>
  );
}
