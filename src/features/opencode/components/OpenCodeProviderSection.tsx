import { useState } from "react";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import type { OpenCodeProviderHealth } from "../types";

type OpenCodeProviderSectionProps = {
  providerHealth: OpenCodeProviderHealth;
  providerStatusTone: "is-ok" | "is-runtime" | "is-fail";
  providerStatusLabel: string;
  showHeader?: boolean;
  connectingProvider: boolean;
  onConnectProvider: () => Promise<void>;
};

export function OpenCodeProviderSection({
  providerHealth,
  providerStatusTone,
  providerStatusLabel,
  showHeader = true,
  connectingProvider,
  onConnectProvider,
}: OpenCodeProviderSectionProps) {
  const [providerCheckFeedback, setProviderCheckFeedback] = useState<string | null>(null);

  const statusToneClass =
    providerStatusTone === "is-ok"
      ? "bg-[#dcfce7] text-[#166534]"
      : providerStatusTone === "is-runtime"
        ? "bg-[#fffbeb] text-[#92400e]"
        : "bg-[#fee2e2] text-[#991b1b]";
  return (
    <div className="opencode-panel-provider mt-2.5 border-t-0 pt-0">
      {showHeader && (
        <>
          <div className="opencode-provider-head mb-1.5 flex items-center justify-between">
            <div className="opencode-provider-title inline-flex items-center gap-1.5 text-[12px] font-semibold">
              <ShieldCheck size={13} aria-hidden />
              <span>Provider</span>
            </div>
            <span
              className={`opencode-provider-status rounded-full px-2 py-0.5 text-[11px] ${statusToneClass} ${providerStatusTone}`}
              title={providerHealth.error ?? ""}
            >
              {providerStatusLabel}
            </span>
          </div>
          <div className="opencode-provider-meta mb-1.5 flex gap-2 text-[11px] text-[color:var(--text-muted,#6b7280)]">
            <span>{providerHealth.provider}</span>
            <span>{providerHealth.credentialCount} credential(s)</span>
          </div>
        </>
      )}
      <div className="opencode-provider-connect mb-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="opencode-provider-connect-btn inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap rounded-lg border border-[color:color-mix(in_srgb,var(--border-accent,#4a8caa)_62%,var(--border-subtle,#d7dce8))] bg-[color:color-mix(in_srgb,var(--border-accent-soft,#2a5570)_32%,var(--surface-card,#fff))] px-[9px] text-[10px] font-semibold leading-none text-[color:var(--text-accent,#1d4ed8)] h-[26px]"
          onClick={async () => {
            await onConnectProvider();
            setProviderCheckFeedback("已拉起 CLI 认证流程，请在终端中自行选择空间/Provider 并完成认证。");
          }}
          disabled={connectingProvider}
          title="在系统终端中打开 OpenCode CLI 原生登录流程"
        >
          <Link2 size={12} aria-hidden className="w-[11px] h-[11px]" />
          <span>{connectingProvider ? "启动中..." : "连接（CLI 选择）"}</span>
        </button>
      </div>
      <div className="opencode-provider-hint mb-1.5 text-[10px] text-[color:var(--text-muted,#6b7280)]">
        会在系统终端打开 OpenCode 原生认证流程，完成后回到当前会话继续使用即可；此处不再预选 Provider。
      </div>
      {providerCheckFeedback && (
        <div
          className="opencode-provider-feedback my-0.5 mb-1.5 text-[11px] text-[color:var(--text-muted,#6b7280)]"
          role="status"
        >
          {providerCheckFeedback}
        </div>
      )}
    </div>
  );
}
