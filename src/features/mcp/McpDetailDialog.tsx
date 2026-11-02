/**
 * One MCP config entry in detail: where it lives, how it connects, the
 * (already redacted) endpoint and variable *names* (never values) and the
 * enable switch for writable sources. Read-only sources state why and can
 * still reveal their config file.
 */
import { useTranslation } from "react-i18next";
import { Button } from "@/components/base/buttons/button";
import { Switch } from "@/components/base/switch/switch";
import { ModalShell } from "@/components/dialogs";
import { ipc } from "@/lib/ipc";
import { isWeb } from "@/lib/transport";
import { readonlyReasonText } from "./labels";
import { LaunchModeRow } from "./launch-ui";
import { ProbeDetail } from "./probe-ui";
import type { McpConfigEntry, McpLaunchMode } from "./types";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-body-2-regular text-text-secondary">{label}</span>
      <span className="min-w-0 text-right text-body-2-regular text-text-primary">
        {children}
      </span>
    </div>
  );
}

export function McpDetailDialog({
  entry,
  pending,
  workspacePath,
  onToggle,
  onLaunchMode,
  onClose,
}: {
  entry: McpConfigEntry;
  pending: boolean;
  /** 连接检测需要工作区（项目级来源的条目按此定位）。 */
  workspacePath: string | null;
  onToggle: (enabled: boolean) => void;
  onLaunchMode: (mode: McpLaunchMode) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const readonlyReason = readonlyReasonText(t, entry);
  return (
    <ModalShell
      onClose={onClose}
      label={t("mcp.detail.title", { name: entry.name })}
      className="flex max-h-[80vh] w-[480px] max-w-[94vw] flex-col"
      dialogClassName="flex min-h-0 flex-col gap-3"
    >
      <div className="flex shrink-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-title-3-medium text-text-primary" title={entry.name}>
          {entry.name}
        </h3>
        {!isWeb ? (
          <Button
            variant="secondary"
            size="small"
            onClick={() => void ipc.revealInFileManager(entry.path)}
          >
            {t("mcp.detail.reveal")}
          </Button>
        ) : null}
        {/* 只读来源也常驻开关、显示真实状态，置灰不可点；原因写在下面的说明里。 */}
        <Switch
          size="sm"
          aria-label={t("mcp.toggle", { name: entry.name })}
          isSelected={entry.enabled}
          isDisabled={pending || !entry.writable}
          onChange={onToggle}
        />
      </div>
      {/* 标题行固定，其余一起滚动：工具清单很长时弹窗不能超出视口。 */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
        {!isWeb ? <LaunchModeRow entry={entry} pending={pending} onChange={onLaunchMode} /> : null}
        <div className="shrink-0 rounded-2lg border border-separator-border px-3 py-1">
          <Row label={t("mcp.detail.engine")}>{entry.engine}</Row>
          <Row label={t("mcp.detail.source")}>{t(`mcp.source.${entry.source}`)}</Row>
          <Row label={t("mcp.detail.scope")}>{t(`mcp.scope.${entry.scope}`)}</Row>
          <Row label={t("mcp.detail.state")}>
            {entry.enabled ? t("mcp.enabled") : t("mcp.disabled")}
          </Row>
          {entry.transport ? <Row label={t("mcp.detail.transport")}>{entry.transport}</Row> : null}
          {entry.command ? (
            <Row label={t("mcp.detail.command")}>
              <span className="break-all font-mono text-caption-1-regular">
                {entry.command}
                {entry.argsCount > 0 ? ` +${entry.argsCount}` : ""}
              </span>
            </Row>
          ) : null}
          {entry.url ? (
            <Row label={t("mcp.detail.url")}>
              <span className="break-all font-mono text-caption-1-regular">{entry.url}</span>
            </Row>
          ) : null}
          {entry.envKeys.length > 0 ? (
            <Row label={t("mcp.detail.env")}>
              <span className="font-mono text-caption-1-regular">
                {entry.envKeys.join(", ")}
              </span>
            </Row>
          ) : null}
          {entry.headerKeys.length > 0 ? (
            <Row label={t("mcp.detail.headers")}>
              <span className="font-mono text-caption-1-regular">
                {entry.headerKeys.join(", ")}
              </span>
            </Row>
          ) : null}
          <Row label={t("mcp.detail.path")}>
            <span className="break-all font-mono text-caption-1-regular">{entry.path}</span>
          </Row>
        </div>
        {!entry.writable ? (
          <p className="rounded-2lg bg-background-tertiary-default px-3 py-2 text-caption-1-regular text-text-secondary">
            {readonlyReason}
          </p>
        ) : null}
        <ProbeDetail entry={entry} workspacePath={workspacePath} />
        <p className="text-caption-1-regular text-text-tertiary">{t("mcp.detail.restartHint")}</p>
      </div>
    </ModalShell>
  );
}
