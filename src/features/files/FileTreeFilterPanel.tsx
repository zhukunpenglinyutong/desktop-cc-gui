import { useState } from "react";
import { useTranslation } from "react-i18next";
import { parseFilterLines } from "./file-tree-filter";
import { useFilesStore } from "./store";

export function FileTreeFilterPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const config = useFilesStore((s) => s.filterConfig);
  const setFilterConfig = useFilesStore((s) => s.setFilterConfig);
  const [ignoreText, setIgnoreText] = useState(config.ignorePatterns.join("\n"));
  const [allowText, setAllowText] = useState(config.dotWhitelist.join("\n"));

  return (
    <div
      role="dialog"
      aria-label={t("files.filterRules")}
      className="absolute right-2 top-8 z-20 w-72 max-w-[calc(100%-1rem)] rounded-lg border border-border-button-default bg-background-primary-default p-3 shadow-dropdown"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="text-body-medium font-medium">{t("files.filterRules")}</p>
      <p className="mt-1 text-caption-1-regular text-text-tertiary">{t("files.filterHelp")}</p>
      <label className="mt-3 block text-caption-1-medium">
        {t("files.dotWhitelist")}
        <textarea
          autoFocus
          value={allowText}
          onChange={(event) => setAllowText(event.target.value)}
          rows={3}
          className="mt-1 w-full resize-y rounded border border-border-button-default bg-background-primary-default p-2 text-body-2-regular outline-none focus-visible:border-border-focus-ring"
        />
      </label>
      <label className="mt-3 block text-caption-1-medium">
        {t("files.customIgnore")}
        <textarea
          value={ignoreText}
          onChange={(event) => setIgnoreText(event.target.value)}
          rows={4}
          className="mt-1 w-full resize-y rounded border border-border-button-default bg-background-primary-default p-2 text-body-2-regular outline-none focus-visible:border-border-focus-ring"
        />
      </label>
      <p className="mt-2 text-caption-1-regular text-text-tertiary">{t("files.builtinIgnore")}</p>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-body-2-regular hover:bg-background-primary-hover">{t("common.cancel")}</button>
        <button
          type="button"
          onClick={() => {
            setFilterConfig({
              ignorePatterns: parseFilterLines(ignoreText),
              dotWhitelist: parseFilterLines(allowText),
            });
            onClose();
          }}
          className="rounded bg-button-primary px-2 py-1 text-body-2-regular text-text-white hover:opacity-90"
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
