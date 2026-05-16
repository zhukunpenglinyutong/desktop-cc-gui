import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Globe from "lucide-react/dist/esm/icons/globe";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import Server from "lucide-react/dist/esm/icons/server";
import type { ClaudeCurrentConfig, ProviderConfig } from "../types";
import { LOCAL_SETTINGS_PROVIDER_ID } from "../types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CurrentClaudeConfigCardProps {
  config: ClaudeCurrentConfig | null;
  loading: boolean;
  providers: ProviderConfig[];
  onSwitchProvider: (id: string) => void;
}

function maskApiKey(value: string) {
  if (!value) return "";
  if (value.length <= 10) return "•".repeat(value.length);
  return `${value.slice(0, 8)}${"•".repeat(8)}${value.slice(-4)}`;
}

function copyToClipboard(value: string) {
  if (!value || typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  void navigator.clipboard.writeText(value);
}

export function CurrentClaudeConfigCard({
  config,
  loading,
  providers,
  onSwitchProvider,
}: CurrentClaudeConfigCardProps) {
  const { t } = useTranslation();
  const [showApiKey, setShowApiKey] = useState(false);

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.isActive),
    [providers],
  );
  const switchableProviders = useMemo(
    () => providers.filter((provider) => !provider.isActive),
    [providers],
  );

  const providerName = useMemo(() => {
    if (activeProvider?.id === LOCAL_SETTINGS_PROVIDER_ID || activeProvider?.isLocalProvider) {
      return t("settings.vendor.localProviderName");
    }
    if (activeProvider?.name) {
      return activeProvider.name;
    }
    return config?.providerName ?? "";
  }, [activeProvider, config?.providerName, t]);

  if (loading) {
    return (
      <div className="vendor-current-config border border-[var(--border-muted)] rounded-[10px] bg-[var(--surface-card)]">
        <div className="vendor-current-config-loading text-[var(--text-secondary)] text-[13px] px-4 py-[18px]">
          {t("settings.loading")}
        </div>
      </div>
    );
  }

  const apiKey = config?.apiKey ?? "";
  const baseUrl = config?.baseUrl ?? "";
  const hasAnyConfig = apiKey.length > 0 || baseUrl.length > 0;

  return (
    <div className="vendor-current-config border border-[var(--border-muted)] rounded-[10px] bg-[var(--surface-card)]">
      <div className="vendor-current-config-header flex items-center justify-between gap-2.5 px-4 py-3.5 border-b border-[var(--border-muted)]">
        <div className="vendor-current-config-title-row flex items-center gap-2.5 min-w-0">
          <span className="vendor-current-config-title text-base font-bold text-[var(--text-primary)]">
            {t("settings.vendor.currentConfig")}
          </span>
          {providerName && (
            <Badge
              variant="secondary"
              size="sm"
              className="vendor-current-config-badge max-w-[280px] text-ellipsis overflow-hidden whitespace-nowrap"
            >
              {providerName}
            </Badge>
          )}
        </div>

        {switchableProviders.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowLeftRight size={14} />
                {t("settings.vendor.switch")}
                <ChevronDown size={14} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              {switchableProviders.map((provider) => {
                const displayName =
                  provider.id === LOCAL_SETTINGS_PROVIDER_ID || provider.isLocalProvider
                    ? t("settings.vendor.localProviderName")
                    : provider.name;
                return (
                  <DropdownMenuItem
                    key={provider.id}
                    onClick={() => onSwitchProvider(provider.id)}
                    className="gap-2"
                  >
                    {provider.id === LOCAL_SETTINGS_PROVIDER_ID || provider.isLocalProvider ? (
                      <FileText size={14} />
                    ) : (
                      <Server size={14} />
                    )}
                    <span>{displayName}</span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {!hasAnyConfig ? (
        <div className="vendor-current-config-empty text-[var(--text-secondary)] text-[13px] px-4 py-[18px]">
          {t("settings.vendor.noConfig")}
        </div>
      ) : (
        <div className="vendor-current-config-body grid grid-cols-2 gap-2.5 px-4 py-3.5 max-[900px]:grid-cols-1">
          <div className="vendor-current-config-field flex items-center gap-2 border border-[var(--border-muted)] rounded-lg bg-[var(--surface-card-strong)] min-h-[38px] px-2">
            <span className="vendor-current-config-field-icon text-[var(--text-secondary)] inline-flex">
              <KeyRound size={14} />
            </span>
            <button
              type="button"
              className="vendor-current-config-field-value flex-1 min-w-0 border-none bg-transparent text-[var(--text-primary)] text-left font-[var(--font-code)] text-sm cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap hover:text-[var(--text-accent)]"
              onClick={() => copyToClipboard(apiKey)}
              title={t("settings.vendor.dialog.apiKey")}
            >
              {apiKey
                ? showApiKey
                  ? apiKey
                  : maskApiKey(apiKey)
                : t("settings.vendor.notConfigured")}
            </button>
            {apiKey && (
              <button
                type="button"
                className="vendor-current-config-toggle border-none bg-transparent text-[var(--text-secondary)] w-6 h-6 rounded inline-flex items-center justify-center cursor-pointer hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                onClick={() => setShowApiKey((current) => !current)}
                title={showApiKey ? t("settings.vendor.hide") : t("settings.vendor.show")}
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            )}
          </div>

          <div className="vendor-current-config-field flex items-center gap-2 border border-[var(--border-muted)] rounded-lg bg-[var(--surface-card-strong)] min-h-[38px] px-2">
            <span className="vendor-current-config-field-icon text-[var(--text-secondary)] inline-flex">
              <Globe size={14} />
            </span>
            <button
              type="button"
              className="vendor-current-config-field-value flex-1 min-w-0 border-none bg-transparent text-[var(--text-primary)] text-left font-[var(--font-code)] text-sm cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap hover:text-[var(--text-accent)]"
              onClick={() => copyToClipboard(baseUrl)}
              title={t("settings.vendor.dialog.apiUrl")}
            >
              {baseUrl || t("settings.vendor.notConfigured")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
