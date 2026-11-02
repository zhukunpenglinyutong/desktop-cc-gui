/**
 * 连接检测的展示件：状态徽标、检测按钮与详情区。
 *
 * 状态分两处表达：徽标在条目行（一眼看全），详情区给出错误原因、服务自报
 * 名称、工具清单与耗时。设置页与 `/mcp` 面板共用同一份结果（`useMcpProbeStore`）。
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Activity from "lucide-react/dist/esm/icons/activity";
import Check from "lucide-react/dist/esm/icons/check";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import TriangleAlert from "lucide-react/dist/esm/icons/triangle-alert";
import X from "lucide-react/dist/esm/icons/x";
import { cx } from "@/utils/cx";
import { probeStateFor, useMcpProbeStore } from "./probe-store";
import type { McpConfigEntry } from "./types";

const BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] ring-1";
const TONE = {
  connected:
    "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/60",
  attention:
    "bg-background-tertiary-default text-text-secondary ring-separator-border",
  error:
    "bg-background-tertiary-default text-text-error-primary ring-separator-border",
  pending:
    "bg-background-tertiary-default text-text-tertiary ring-separator-border",
};

/** 行内纯图标按钮（检测 / 启用 / 启动方式）共用的尺寸与交互态。 */
export const ROW_ICON_BUTTON =
  "flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-background-tertiary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed disabled:hover:bg-transparent";

/** 一行里的连接状态；没有结果时不占位。 */
export function ProbeStatusChip({ entry }: { entry: McpConfigEntry }) {
  const { t } = useTranslation();
  const results = useMcpProbeStore((state) => state.results);
  const pending = useMcpProbeStore((state) => Boolean(state.pending[entry.id]));
  if (pending) {
    return (
      <span className={cx(BADGE, TONE.pending)}>
        <Loader2 className="size-3 animate-spin" aria-hidden />
        {t("mcp.probe.pending")}
      </span>
    );
  }
  const state = probeStateFor(results, entry);
  if (!state) return null;
  const { result } = state;
  if (result.status === "connected") {
    return (
      <span className={cx(BADGE, TONE.connected)} title={result.serverName ?? undefined}>
        <Check className="size-3" aria-hidden />
        {result.toolCount > 0
          ? t("mcp.probe.connectedTools", { count: result.toolCount })
          : t("mcp.probe.connected")}
      </span>
    );
  }
  if (result.status === "needs_auth") {
    return (
      <span className={cx(BADGE, TONE.attention)} title={result.message ?? undefined}>
        <TriangleAlert className="size-3" aria-hidden />
        {t("mcp.probe.needsAuth")}
      </span>
    );
  }
  return (
    <span className={cx(BADGE, TONE.error)} title={result.message ?? undefined}>
      <X className="size-3" aria-hidden />
      {t("mcp.probe.failed")}
    </span>
  );
}

/** 单条检测按钮（行内右侧）。 */
export function ProbeActionButton({
  entry,
  workspacePath,
}: {
  entry: McpConfigEntry;
  workspacePath: string | null;
}) {
  const { t } = useTranslation();
  const pending = useMcpProbeStore((state) => Boolean(state.pending[entry.id]));
  const probe = useMcpProbeStore((state) => state.probe);
  return (
    <button
      type="button"
      aria-label={t("mcp.probe.check", { name: entry.name })}
      title={t("mcp.probe.hint")}
      disabled={pending}
      onClick={() => void probe(entry, workspacePath)}
      className={ROW_ICON_BUTTON}
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Activity className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

/** 详情弹窗里的检测区：按钮 + 最近一次结果。 */
export function ProbeDetail({
  entry,
  workspacePath,
}: {
  entry: McpConfigEntry;
  workspacePath: string | null;
}) {
  const { t, i18n } = useTranslation();
  const results = useMcpProbeStore((state) => state.results);
  const pending = useMcpProbeStore((state) => Boolean(state.pending[entry.id]));
  const probe = useMcpProbeStore((state) => state.probe);
  const state = probeStateFor(results, entry);
  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    [i18n.language],
  );
  const checkedAt = state ? timeFormat.format(new Date(state.checkedAt)) : null;
  return (
    <div className="flex flex-col gap-2 rounded-2lg border border-separator-border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-body-2-regular text-text-secondary">
          {t("mcp.probe.detailTitle")}
        </span>
        <ProbeStatusChip entry={entry} />
        <button
          type="button"
          disabled={pending}
          onClick={() => void probe(entry, workspacePath)}
          className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-caption-1-regular text-text-secondary transition-colors hover:bg-background-tertiary-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring disabled:cursor-not-allowed"
        >
          {t("mcp.probe.check", { name: entry.name })}
        </button>
      </div>
      <p className="text-caption-1-regular text-text-tertiary">{t("mcp.probe.hint")}</p>
      {state ? (
        <div className="flex flex-col gap-1">
          {state.result.message ? (
            <p className="text-caption-1-regular text-text-secondary">
              {state.result.message}
            </p>
          ) : null}
          {state.result.serverName || state.result.protocolVersion ? (
            <p className="text-caption-1-regular text-text-tertiary">
              {[
                state.result.serverName
                  ? t("mcp.probe.serverName", { name: state.result.serverName })
                  : null,
                state.result.protocolVersion
                  ? t("mcp.probe.protocol", { version: state.result.protocolVersion })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
          {state.result.tools.length > 0 ? (
            // 工具名可能上百个：清单自己限高滚动，不把弹窗撑出视口；按逗号后的
            // 空格换行，不在工具名中间断开。
            <p className="max-h-40 overflow-y-auto break-words pr-1 font-mono text-caption-1-regular text-text-tertiary">
              {state.result.toolCount > state.result.tools.length
                ? t("mcp.probe.toolListTruncated", {
                    total: state.result.toolCount,
                    count: state.result.tools.length,
                    tools: state.result.tools.join(", "),
                  })
                : t("mcp.probe.toolList", { tools: state.result.tools.join(", ") })}
            </p>
          ) : null}
          <p className="text-caption-1-regular text-text-tertiary">
            {t("mcp.probe.checkedAt", {
              time: checkedAt,
              ms: state.result.elapsedMs,
            })}
          </p>
        </div>
      ) : null}
    </div>
  );
}
