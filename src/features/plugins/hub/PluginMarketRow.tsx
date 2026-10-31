import { useTranslation } from "react-i18next";
import { githubAvatarUrl } from "@/lib/github-avatar";
import type { MarketPlugin } from "@/lib/ipc";
import { githubLoginFor, isOfficialPlugin } from "./catalog";
import { formatInstallCount } from "./install-count";
import { MarketActionButton } from "./MarketActionButton";
import { PluginAvatar } from "./PluginAvatar";

const BADGE =
  "rounded-md bg-background-secondary-default px-1.5 py-0.5 text-xs text-text-secondary";
/** First-party marker: purple is reserved for "this is ours", so it never
 *  competes with the neutral tier badge or the lime installed badge. An
 *  official plugin shows only this badge in the developer column — the
 *  account behind it is implicit, and the truncated login was just noise. */
const OFFICIAL_BADGE =
  "shrink-0 rounded-md bg-status-purple-background px-1.5 py-0.5 text-xs text-status-purple-text";

const CELL = "px-4 py-2.5";
const NUM_CELL = `${CELL} text-right text-body-2-regular text-text-secondary tabular-nums`;

/**
 * One row of the market table. Identity is a button (opens details) and the
 * row click is pointer sugar over the same action — buttons inside the row
 * keep their own click, so the two never fight.
 */
export function PluginMarketRow({
  entry,
  onOpenDetail,
  showDownloads,
}: {
  entry: MarketPlugin;
  onOpenDetail: (id: string) => void;
  showDownloads: boolean;
}) {
  const { t } = useTranslation();
  const authorLogin = githubLoginFor(entry);
  const official = isOfficialPlugin(entry);

  return (
    <tr
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button")) return;
        onOpenDetail(entry.id);
      }}
      className="cursor-pointer transition-colors hover:bg-background-primary-hover [&>td]:border-b [&>td]:border-separator-border last:[&>td]:border-b-0"
    >
      <td className={CELL}>
        <div className="flex min-w-0 items-center gap-3">
          <PluginAvatar id={entry.id} name={entry.name} src={entry.icon ?? null} size={36} />
          <button
            type="button"
            onClick={() => onOpenDetail(entry.id)}
            className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 text-left"
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="truncate text-body-medium text-text-primary">{entry.name}</span>
              {entry.tier === "declarative" && (
                <span className={BADGE}>{t("plugins.hub.tierDeclarative")}</span>
              )}
            </span>
            {entry.description && (
              <span
                title={entry.description}
                className="w-full truncate text-body-2-regular text-text-secondary"
              >
                {entry.description}
              </span>
            )}
          </button>
        </div>
      </td>

      <td className={CELL}>
        {official ? (
          <span className={OFFICIAL_BADGE}>{t("plugins.hub.official")}</span>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            {entry.author && (
              <PluginAvatar
                id={entry.author}
                name={entry.author}
                src={authorLogin ? githubAvatarUrl(authorLogin, 20) : null}
                size={20}
                shape="circle"
              />
            )}
            <span title={entry.author} className="truncate text-body-2-regular text-text-secondary">
              {entry.author || "—"}
            </span>
          </div>
        )}
      </td>

      {showDownloads && (
        <td className={NUM_CELL}>
          {entry.downloads != null ? formatInstallCount(entry.downloads) : "—"}
        </td>
      )}

      <td className={NUM_CELL}>v{entry.version}</td>

      <td className={CELL}>
        <div className="flex justify-end">
          <MarketActionButton entry={entry} onOpenDetail={onOpenDetail} />
        </div>
      </td>
    </tr>
  );
}
