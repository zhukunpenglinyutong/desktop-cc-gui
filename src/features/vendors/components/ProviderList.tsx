import { useTranslation } from "react-i18next";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { ProviderConfig } from "../types";
import { LOCAL_SETTINGS_PROVIDER_ID } from "../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ProviderListProps {
  providers: ProviderConfig[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (provider: ProviderConfig) => void;
  onDelete: (provider: ProviderConfig) => void;
  onSwitch: (id: string) => void;
}

export function ProviderList({
  providers,
  loading,
  onAdd,
  onEdit,
  onDelete,
  onSwitch,
}: ProviderListProps) {
  const { t } = useTranslation();
  const providerList = Array.isArray(providers) ? providers : [];
  const localProvider =
    providerList.find(
      (provider) =>
        provider.id === LOCAL_SETTINGS_PROVIDER_ID || provider.isLocalProvider,
    ) ?? null;
  const regularProviders = providerList.filter(
    (provider) =>
      provider.id !== LOCAL_SETTINGS_PROVIDER_ID && !provider.isLocalProvider,
  );

  return (
    <div className="vendor-provider-list flex flex-col gap-3">
      <div className="vendor-list-header flex items-center justify-between">
        <span className="vendor-list-title text-[13px] font-semibold text-[var(--text-primary)]">
          {t("settings.vendor.allProviders")}
        </span>
        <div className="vendor-list-actions flex items-center gap-2">
          <Button size="sm" onClick={onAdd}>
            + {t("settings.vendor.add")}
          </Button>
        </div>
      </div>

      {loading && (
        <div className="vendor-loading text-center py-5 text-[var(--text-secondary)] text-[13px]">{t("settings.loading")}</div>
      )}

      <div className="vendor-cards flex flex-col gap-2.5">
        {localProvider && (
          <div
            className={cn(
              "vendor-card vendor-local-provider-card flex items-center justify-between p-[14px_16px] rounded-lg border border-[var(--border-muted)] bg-[var(--surface-card)] transition-[border-color] duration-150 gap-3 hover:border-[var(--border-stronger)] border-l-[3px] border-l-[#f39c12] bg-[linear-gradient(90deg,rgba(243,156,18,0.08)_0%,transparent_45%)]",
              localProvider.isActive && "active border-[var(--vendor-button-primary-border)] bg-[var(--vendor-button-primary-soft)]",
            )}
          >
            <div className="vendor-card-info flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="vendor-card-name vendor-local-provider-name text-[13px] font-medium text-[var(--text-primary)] flex items-center gap-2 [&_svg]:text-[#f39c12]">
                <FileText size={14} />
                {t("settings.vendor.localProviderName")}
              </div>
              <div
                className="vendor-card-remark text-[11px] text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap"
                title={t("settings.vendor.localProviderDescription")}
              >
                {t("settings.vendor.localProviderDescription")}
              </div>
            </div>
            <div className="vendor-card-actions flex items-center gap-1.5 shrink-0">
              {localProvider.isActive ? (
                <Badge variant="outline" className="text-stone-700 dark:text-stone-200">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-emerald-500"
                  />
                  {t("settings.vendor.inUse")}
                </Badge>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onSwitch(localProvider.id)}
                >
                  {t("settings.vendor.enable")}
                </Button>
              )}
            </div>
          </div>
        )}

        {regularProviders.map((provider) => (
          <div
            key={provider.id}
            className={cn(
              "vendor-card flex items-center justify-between p-[14px_16px] rounded-lg border border-[var(--border-muted)] bg-[var(--surface-card)] transition-[border-color] duration-150 gap-3 hover:border-[var(--border-stronger)]",
              provider.isActive && "active border-[var(--vendor-button-primary-border)] bg-[var(--vendor-button-primary-soft)]",
            )}
          >
            <div className="vendor-card-info flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="vendor-card-name text-[13px] font-medium text-[var(--text-primary)] flex items-center gap-2">
                {provider.name}
                {provider.source === "cc-switch" && (
                  <Badge
                    variant="outline"
                    size="sm"
                    className="text-stone-600 dark:text-stone-300"
                  >
                    cc-switch
                  </Badge>
                )}
              </div>
              {(provider.remark || provider.websiteUrl) && (
                <div
                  className="vendor-card-remark text-[11px] text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap"
                  title={provider.remark || provider.websiteUrl}
                >
                  {provider.remark || provider.websiteUrl}
                </div>
              )}
            </div>
            <div className="vendor-card-actions flex items-center gap-1.5 shrink-0">
              {provider.isActive ? (
                <Badge variant="outline" className="text-stone-700 dark:text-stone-200">
                  <span
                    aria-hidden="true"
                    className="size-1.5 rounded-full bg-emerald-500"
                  />
                  {t("settings.vendor.inUse")}
                </Badge>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => onSwitch(provider.id)}
                >
                  {t("settings.vendor.enable")}
                </Button>
              )}
              <span className="vendor-card-divider w-px self-stretch bg-[var(--border-muted)]" />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onEdit(provider)}
                title={t("settings.vendor.edit")}
              >
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                className="hover:text-destructive"
                onClick={() => onDelete(provider)}
                title={t("settings.vendor.delete")}
              >
                <Trash2 aria-hidden />
              </Button>
            </div>
          </div>
        ))}
      </div>

      {!loading && regularProviders.length === 0 && !localProvider && (
        <div className="vendor-empty text-center px-5 py-[30px] text-[var(--text-secondary)] text-[13px] border border-dashed border-[var(--border-muted)] rounded-lg bg-[var(--surface-card)]">
          {t("settings.vendor.emptyState")}
        </div>
      )}
    </div>
  );
}
