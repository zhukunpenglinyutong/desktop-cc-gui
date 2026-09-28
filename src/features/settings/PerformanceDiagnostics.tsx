import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import Activity from "lucide-react/dist/esm/icons/activity";
import Check from "lucide-react/dist/esm/icons/check";
import Copy from "lucide-react/dist/esm/icons/copy";
import Download from "lucide-react/dist/esm/icons/download";
import X from "lucide-react/dist/esm/icons/x";
import { Button } from "@/components/base/buttons/button";
import { ModalShell } from "@/components/dialogs";
import { ipc } from "@/lib/ipc";
import { getAppVersion } from "@/lib/platform";
import { collectPerformanceReport } from "@/lib/performance-report";
import { copyText } from "@/lib/clipboard";
import { COPY_FEEDBACK_MS } from "@/hooks/use-copied";
import { Switch } from "@/components/base/switch/switch";
import { summarizePerformanceReport, type PerformanceReport } from "@/lib/performance-summary";
import { exportPerformanceReport } from "@/lib/performance-export";
import { getPerformancePreference, subscribePerformancePreference, setPerformanceEnabled, synchronizePerformancePreference } from "@/lib/performance-preference";
import { isReactScanEnabled, setReactScanEnabled } from "@/lib/react-scan";

function DiagnosticsHeader({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between border-b border-separator-border px-4 py-3">
      <h3 className="text-title-3-semibold text-text-primary">{t("diagnostics.title")}</h3>
      <Button
        size="small"
        variant="ghost"
        leadingIcon={X}
        aria-label={t("common.close")}
        onClick={onClose}
      />
    </div>
  );
}

/** Preference / save result lines, right under the toggle. */
function DiagnosticsPreferenceMessages({
  enabled,
  saveFailed,
}: {
  enabled: boolean | null;
  saveFailed: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {enabled === null && <p role="status">{t("diagnostics.preferenceUnavailable")}</p>}
      {enabled === false && <p role="status">{t("diagnostics.disabled")}</p>}
      {saveFailed && <p role="alert">{t("diagnostics.saveFailed")}</p>}
    </>
  );
}

/** Footer buttons: export the report and copy the summary. */
function DiagnosticsActions({
  hasReport,
  hasText,
  busy,
  exporting,
  copying,
  copied,
  onExport,
  onCopy,
}: {
  hasReport: boolean;
  hasText: boolean;
  busy: boolean;
  exporting: boolean;
  copying: boolean;
  copied: boolean;
  onExport: () => void;
  onCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button
        size="small"
        variant="secondary"
        leadingIcon={Download}
        disabled={!hasReport || exporting || busy}
        onClick={onExport}
      >
        {t("diagnostics.export")}
      </Button>
      <Button
        size="small"
        variant="secondary"
        leadingIcon={copied ? Check : Copy}
        disabled={!hasText || copying}
        onClick={onCopy}
      >
        {copied ? t("common.copied") : t("diagnostics.copy")}
      </Button>
    </div>
  );
}

export function PerformanceDiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const enabled = useSyncExternalStore(subscribePerformancePreference, getPerformancePreference);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<"saved" | "downloaded" | "failed" | null>(null);
  const [partial, setPartial] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const mounted = useRef(false);
  const reportRevision = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (getPerformancePreference() === null) void synchronizePerformancePreference().catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    reportRevision.current += 1;
    mounted.current = true;
    setText("");
    setReport(null);
    setCopied(false);
    setCopying(false);
    setExporting(false);
    setCopyFailed(false);
    setExportResult(null);
    setPartial(false);
    if (enabled !== false) void collectPerformanceReport(() => ipc.performanceDiagnostics(), getAppVersion).then((report) => {
      if (cancelled) return;
      setReport(report);
      setText(summarizePerformanceReport(report));
      setPartial(report.native.status !== "available");
    });
    return () => {
      cancelled = true;
      reportRevision.current += 1;
      mounted.current = false;
      clearTimeout(resetTimer.current);
    };
  }, [enabled]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setSaveFailed(false);
    try { await setPerformanceEnabled(next); }
    catch { if (mounted.current) setSaveFailed(true); }
    finally { setSaving((value) => (mounted.current ? false : value)); }
  };

  const exportFile = async () => {
    if (!report || exporting) return;
    const revision = reportRevision.current;
    setExporting(true);
    setExportResult(null);
    try {
      const result = await exportPerformanceReport(report, t("diagnostics.export"));
      if (mounted.current && reportRevision.current === revision && result !== "cancelled") setExportResult(result);
    } catch { if (mounted.current && reportRevision.current === revision) setExportResult("failed"); }
    finally { if (mounted.current && reportRevision.current === revision) setExporting(false); }
  };

  const copy = async () => {
    if (!text || copying) return;
    const revision = reportRevision.current;
    setCopying(true);
    setCopied(false);
    setCopyFailed(false);
    clearTimeout(resetTimer.current);
    try {
      const ok = await copyText(text);
      if (!ok) {
        if (mounted.current && reportRevision.current === revision) setCopyFailed(true);
        return;
      }
      if (mounted.current && reportRevision.current === revision) {
        setCopied(true);
        resetTimer.current = setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      }
    } catch {
      if (mounted.current && reportRevision.current === revision) setCopyFailed(true);
    } finally {
      if (mounted.current && reportRevision.current === revision) setCopying(false);
    }
  };

  return (
    <ModalShell
      onClose={onClose}
      label={t("diagnostics.title")}
      className="flex max-h-[calc(100dvh-64px)] w-[640px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-2xl p-0"
      dialogClassName="flex min-h-0 flex-col"
    >
      <DiagnosticsHeader onClose={onClose} />
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-4">
        <p className="text-body-regular text-text-secondary">{t("diagnostics.description")}</p>
        <div className="flex items-center justify-between gap-3">
          <span className="text-body-regular text-text-primary">{t("diagnostics.enabled")}</span>
          <Switch
            size="sm"
            aria-label={t("diagnostics.enabled")}
            isSelected={enabled === true}
            isDisabled={enabled === null || saving || exporting || copying}
            onChange={(next) => void toggle(next)}
          />
        </div>
        <p className="text-caption-1-regular text-text-tertiary">{t("diagnostics.toggleHint")}</p>
        <DiagnosticsPreferenceMessages enabled={enabled} saveFailed={saveFailed} />
        <p className="text-caption-1-regular text-text-tertiary">{t("diagnostics.privacy")}</p>
        <p className="text-caption-1-regular text-text-tertiary">{t("diagnostics.limits")}</p>
        {partial && (
          <p role="status" className="text-body-regular text-text-secondary">
            {t("diagnostics.partial")}
          </p>
        )}
        <textarea
          aria-label={t("diagnostics.report")}
          readOnly
          value={text}
          placeholder={t(enabled === false ? "diagnostics.disabled" : "diagnostics.collecting")}
          spellCheck={false}
          className="h-52 min-h-32 w-full shrink-0 resize-y rounded-lg border border-separator-border bg-background-secondary-default p-3 font-mono text-[11px] text-text-secondary outline-none focus:border-border-focus-ring"
        />
        {copyFailed && (
          <p role="alert" className="text-body-regular text-text-secondary">
            {t("diagnostics.copyFailed")}
          </p>
        )}
        {exportResult && (
          <p role={exportResult === "failed" ? "alert" : "status"}>
            {t(`diagnostics.${exportResult}`)}
          </p>
        )}
        <DiagnosticsActions
          hasReport={report !== null}
          hasText={text.length > 0}
          busy={saving}
          exporting={exporting}
          copying={copying}
          copied={copied}
          onExport={() => void exportFile()}
          onCopy={() => void copy()}
        />
      </div>
    </ModalShell>
  );
}

/** 性能诊断 page (设置 → 其他): the settings entry to the diagnostics dialog.
 *  The page title row already names the section, so the body carries the
 *  description and the open button without a second section label. */
export function PerformanceDiagnosticsSection() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [renderScanOn, setRenderScanOn] = useState(() => isReactScanEnabled());
  const toggleRenderScan = (enabled: boolean) => {
    setRenderScanOn(enabled);
    void setReactScanEnabled(enabled);
  };
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col items-start gap-3 rounded-xl border border-separator-border p-3">
        <p className="text-body-regular text-text-secondary">{t("diagnostics.description")}</p>
        <Button size="small" variant="secondary" leadingIcon={Activity} onClick={() => setOpen(true)}>{t("diagnostics.open")}</Button>
      </div>
      <div
        data-setting-anchor="renderScan"
        className="flex items-center justify-between gap-4 rounded-xl border border-separator-border p-3"
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-body-regular text-text-primary">{t("diagnostics.renderPanelTitle")}</p>
          <p className="text-body-2-regular text-text-secondary">{t("diagnostics.renderPanelDescription")}</p>
          <p className="text-caption-1-regular text-text-tertiary">{t("diagnostics.renderPanelDetail")}</p>
        </div>
        <Switch
          size="sm"
          aria-label={t("diagnostics.renderPanelTitle")}
          isSelected={renderScanOn}
          onChange={toggleRenderScan}
        />
      </div>
      {open && <PerformanceDiagnosticsDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
