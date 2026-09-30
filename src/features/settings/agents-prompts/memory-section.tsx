import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import Download from "lucide-react/dist/esm/icons/download";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Button } from "@/components/base/buttons/button";
import { TextArea } from "@/components/base/input/textarea";
import { Switch } from "@/components/base/switch/switch";
import { ConfirmDialog } from "@/components/dialogs";
import { cx } from "@/utils/cx";
import {
  exportMemoryLedger,
  memoryErrorMessage,
  useMemoryReview,
  useMemoryStore,
} from "@/features/bots/memory";
import {
  ipc,
  type BotConfig,
  type MemoryEntry,
  type MemoryLedger,
  type MemoryReviewOutcome,
  type PendingMemoryWrite,
} from "@/lib/ipc";

const ICON_BUTTON =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary transition-colors hover:bg-background-secondary-hover hover:text-foreground-icon-primary";

/** 用量条：与「人格 + 工作规则」同一种读法，超过 80% 变黄、超限变红。 */
function Usage({ used, limit }: { used: number; limit: number }) {
  const { t } = useTranslation();
  const ratio = limit > 0 ? used / limit : 0;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-caption-1-regular">
        <span className="text-text-tertiary">{t("settings.memoryUsageLabel")}</span>
        <span
          className={cx(
            "font-mono",
            ratio > 1
              ? "text-text-error-primary"
              : ratio > 0.8
                ? "text-text-warning-primary"
                : "text-text-secondary",
          )}
        >
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-background-tertiary-default">
        <div
          className={cx(
            "h-full rounded-full",
            ratio > 1 ? "bg-text-error-primary" : ratio > 0.8 ? "bg-text-warning-primary" : "bg-accent-500",
          )}
          style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }}
        />
      </div>
    </div>
  );
}

function EntryRow({
  entry,
  onSave,
  onDelete,
}: {
  entry: MemoryEntry;
  /** true = 已落盘；false = 被闸退回（错误已由上层展示），保持编辑态。 */
  onSave: (content: string) => Promise<boolean>;
  /** 只是请求删除（打开确认对话框），真正落盘由上层确认后触发。 */
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.content);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(entry.content);
  }, [entry.content, editing]);

  if (editing) {
    return (
      <div className="flex flex-col gap-2 px-3.5 py-3">
        <TextArea
          value={draft}
          onChange={setDraft}
          rows={3}
          aria-label={t("settings.memoryEdit")}
          maxLength={10_000}
        />
        <div className="flex items-center gap-2">
          <Button
            size="small"
            disabled={busy || draft.trim().length === 0}
            onClick={() => {
              setBusy(true);
              void onSave(draft)
                // 保存失败时不关编辑态：草稿还在输入框里，用户改一下就能重试。
                .then((saved) => {
                  if (saved) setEditing(false);
                })
                .finally(() => setBusy(false));
            }}
          >
            {t("settings.memorySave")}
          </Button>
          <Button size="small" variant="secondary" onClick={() => setEditing(false)}>
            {t("settings.memoryCancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-3 border-b border-separator-border px-3.5 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap break-words text-body-2-regular text-text-primary">
          {entry.content}
        </p>
        <p className="mt-1 text-caption-1-regular text-text-quaternary">
          {entry.source === "agent"
            ? t("settings.memorySourceAgent")
            : entry.source === "review"
              ? t("settings.memorySourceReview")
              : t("settings.memorySourceUser")}
          {" · "}
          {new Date(entry.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          aria-label={t("settings.memoryEdit")}
          title={t("settings.memoryEdit")}
          onClick={() => setEditing(true)}
          className={ICON_BUTTON}
        >
          <Pencil className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={t("settings.memoryDelete")}
          title={t("settings.memoryDelete")}
          onClick={onDelete}
          className={ICON_BUTTON}
        >
          <Trash2 className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function LedgerCard({
  title,
  desc,
  ledger,
  filename,
  onAdd,
  onSave,
  onDelete,
  onClear,
}: {
  title: string;
  desc: string;
  ledger: MemoryLedger;
  filename: string;
  onAdd: (content: string) => Promise<boolean>;
  onSave: (id: string, content: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onClear: () => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<MemoryEntry | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const add = () => {
    if (!draft.trim()) return;
    setBusy(true);
    void onAdd(draft)
      // 失败（超限 / 扫描 / 空）时不清空输入框，用户改改就能重试。
      .then((added) => {
        if (added) setDraft("");
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="rounded-2xl border border-separator-border bg-background-secondary-default">
      <div className="flex flex-col gap-3 border-b border-separator-border px-3.5 py-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-body-regular text-text-primary">{title}</p>
            <p className="text-caption-1-regular text-text-tertiary">{desc}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={t("settings.memoryExport")}
              title={t("settings.memoryExport")}
              onClick={() => {
                void exportMemoryLedger(title, filename, ledger.entries)
                  .then((result) => {
                    if (result !== "cancelled") setNotice(t("settings.memoryExported"));
                  })
                  .catch((error: unknown) => setNotice(memoryErrorMessage(error)));
              }}
              className={ICON_BUTTON}
            >
              <Download className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t("settings.memoryClear")}
              title={t("settings.memoryClear")}
              disabled={ledger.entries.length === 0}
              onClick={() => setConfirming(true)}
              className={cx(ICON_BUTTON, "disabled:cursor-not-allowed disabled:opacity-40")}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>
        <Usage used={ledger.used} limit={ledger.limit} />
      </div>

      {ledger.entries.length === 0 ? (
        <p className="px-3.5 py-4 text-body-2-regular text-text-tertiary">
          {t("settings.memoryEmpty")}
        </p>
      ) : (
        ledger.entries.map((entry) => (
          <EntryRow
            key={entry.id}
            entry={entry}
            onSave={(content) => onSave(entry.id, content)}
            onDelete={() => setPendingDelete(entry)}
          />
        ))
      )}

      <div className="flex flex-col gap-2 border-t border-separator-border px-3.5 py-3">
        <TextArea
          value={draft}
          onChange={setDraft}
          rows={2}
          maxLength={10_000}
          placeholder={t("settings.memoryAddPlaceholder")}
          aria-label={t("settings.memoryAddPlaceholder")}
        />
        <div className="flex items-center gap-2">
          <Button
            size="small"
            variant="secondary"
            disabled={busy || draft.trim().length === 0}
            onClick={add}
          >
            {t("settings.memoryAdd")}
          </Button>
          {notice && (
            <span role="status" className="min-w-0 flex-1 truncate text-caption-1-regular text-text-tertiary">
              {notice}
            </span>
          )}
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          danger
          message={t("settings.memoryClearConfirm", { title })}
          onConfirm={() => {
            setConfirming(false);
            void onClear();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {pendingDelete && (
        <ConfirmDialog
          danger
          message={t("settings.memoryDeleteConfirm")}
          onConfirm={() => {
            const entry = pendingDelete;
            setPendingDelete(null);
            void onDelete(entry.id);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

const OP_LABEL: Record<PendingMemoryWrite["op"], string> = {
  add: "settings.memoryPendingOpAdd",
  replace: "settings.memoryPendingOpReplace",
  remove: "settings.memoryPendingOpRemove",
};

/** 复盘结果的置地说明：跳过/失败一定写清原因，不让它看起来像「没写就是没内容」。 */
function reviewSummary(outcome: MemoryReviewOutcome, t: TFunction): string {
  const failure = () =>
    outcome.failed > 0
      ? t("settings.memoryReviewFailedCount", { failed: outcome.failed })
      : null;
  switch (outcome.status) {
    case "applied":
      return [
        t("settings.memoryReviewApplied", { applied: outcome.applied }),
        outcome.staged > 0
          ? t("settings.memoryReviewStaged", { staged: outcome.staged })
          : null,
        failure(),
      ]
        .filter(Boolean)
        .join("，");
    case "staged":
      return [
        t("settings.memoryReviewStaged", { staged: outcome.staged }),
        failure(),
      ]
        .filter(Boolean)
        .join("，");
    case "empty":
      return t("settings.memoryReviewEmpty");
    case "skipped":
      if (outcome.message === "no_channel") return t("settings.memoryReviewNoChannel");
      if (outcome.message === "busy") return t("settings.memoryReviewBusy");
      if (outcome.message === "disabled") return t("settings.memoryReviewDisabled");
      return t("settings.memoryReviewSkipped", {
        message: outcome.message ?? "",
      });
    default:
      return t("settings.memoryReviewFailed", {
        message: outcome.message ?? "",
      });
  }
}

/** 待审批队列：模型想写但还没落盘的条目。replace/remove 展示暂存时的原文，
 *  用户能看清「改什么 / 删什么」再决定。批准失败（超限 / 原文已变）由上层
 *  就地报错，条目留在队列里。 */
function PendingCard({
  pending,
  onApprove,
  onReject,
  onApproveAll,
  onRejectAll,
}: {
  pending: PendingMemoryWrite[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onApproveAll: () => void;
  onRejectAll: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-separator-border bg-background-secondary-default">
      <div className="flex items-center gap-3 border-b border-separator-border px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-body-regular text-text-primary">
            {t("settings.memoryPendingTitle", { count: pending.length })}
          </p>
          <p className="text-caption-1-regular text-text-tertiary">
            {t("settings.memoryPendingHint")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="small" variant="secondary" onClick={onRejectAll}>
            {t("settings.memoryPendingRejectAll")}
          </Button>
          <Button size="small" onClick={onApproveAll}>
            {t("settings.memoryPendingApproveAll")}
          </Button>
        </div>
      </div>
      {pending.map((item) => (
        <div
          key={item.id}
          className="flex flex-col gap-2 border-b border-separator-border px-3.5 py-3 last:border-b-0"
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-md bg-background-tertiary-default px-1.5 py-0.5 text-caption-1-regular text-text-secondary">
              {t(OP_LABEL[item.op])}
            </span>
            <span className="shrink-0 text-caption-1-regular text-text-tertiary">
              {item.target === "user"
                ? t("settings.memoryPendingTargetUser")
                : t("settings.memoryPendingTargetMemory")}
            </span>
            <span className="min-w-0 flex-1 truncate text-caption-1-regular text-text-quaternary">
              {item.origin === "review"
                ? t("settings.memorySourceReview")
                : t("settings.memorySourceAgent")}
            </span>
          </div>
          {item.op !== "add" && item.targetSnapshot && (
            <p className="whitespace-pre-wrap break-words text-body-2-regular text-text-tertiary">
              <span className="line-through">{item.targetSnapshot}</span>
            </p>
          )}
          {item.content && (
            <p className="whitespace-pre-wrap break-words text-body-2-regular text-text-primary">
              {item.content}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button size="small" onClick={() => onApprove(item.id)}>
              {t("settings.memoryPendingApprove")}
            </Button>
            <Button size="small" variant="secondary" onClick={() => onReject(item.id)}>
              {t("settings.memoryPendingReject")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 记忆页签：两个账本（这个 Bot 的 MEMORY、全局 USER）的查看与手动增删改，
 * 加上三个开关（启用记忆 / 写入需要审批 / 会话结束后台复盘）。写入路径与
 * 审批闸在后端（memory/mcp.rs、memory/pending.rs），面板只展示与批准；
 * 复盘由 features/bots/memory-review.ts 触发，结果在这里就地说明。
 */
export function MemorySection({
  bot,
  engines,
  onChange,
}: {
  bot: BotConfig;
  /** 引擎能力来自 `list_engines`：只有支持 MCP 的引擎能挂 memory 工具。 */
  engines: { id: string; supportsMemory?: boolean }[];
  onChange: (patch: { memory?: BotConfig["memory"] }) => void;
}) {
  const { t } = useTranslation();
  const refresh = useMemoryStore((s) => s.refresh);
  const view = useMemoryStore((s) => (s.botId === bot.id ? s.view : null));
  const loading = useMemoryStore((s) => (s.botId === bot.id ? s.loading : false));
  const loadError = useMemoryStore((s) => (s.botId === bot.id ? s.error : null));
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void refresh(bot.id);
  }, [bot.id, refresh]);

  /** 运行一次写入并刷新账本；true = 成功，false = 被闸退回（错误已就地展示）。 */
  const run = (action: () => Promise<unknown>): Promise<boolean> => {
    setActionError(null);
    return action()
      .then(() => refresh(bot.id))
      .then(() => true)
      .catch((error: unknown) => {
        setActionError(memoryErrorMessage(error));
        return false;
      });
  };

  const lastReview = useMemoryReview(bot.id);

  /** 一次批准/驳回多个：逐条执行，全部完成只刷新一次；第一条失败照常报错，
   *  其余继续（一条过期不该把后面能批准的条目一起卡住）。 */
  const runAll = (action: (id: string) => Promise<unknown>) => {
    const ids = view?.pending.map((item) => item.id) ?? [];
    setActionError(null);
    void (async () => {
      let firstError: string | null = null;
      for (const id of ids) {
        try {
          await action(id);
        } catch (error) {
          firstError ??= memoryErrorMessage(error);
        }
      }
      await refresh(bot.id);
      if (firstError) setActionError(firstError);
    })();
  };

  const memoryLimit = bot.memory.memoryCharLimit;
  // `engines` 在 list_engines 回来前是空的：那几秒不给「没有引擎支持」的
  // 结论（会把还在加载说成不支持），等列表到了再判。
  const enginesLoaded = engines.length > 0;
  const anyToolEngine = engines.some((engine) => engine.supportsMemory);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-body-medium text-text-primary">{t("settings.botTabMemory")}</p>
        <p className="mt-1 text-body-2-regular text-text-secondary">
          {t("settings.botMemoryDesc")}
        </p>
      </div>

      <div className="rounded-2xl border border-separator-border bg-background-secondary-default">
        {[
          {
            id: "enable",
            label: t("settings.memoryEnable"),
            hint: t("settings.memoryEnableHint"),
            selected: bot.memory.enabled,
            // 审批与复盘都以记忆为前提：关掉记忆时它们没有对象可作用。
            disabled: false,
            onChange: (enabled: boolean) =>
              onChange({ memory: { ...bot.memory, enabled } }),
          },
          {
            id: "approval",
            label: t("settings.memoryApproval"),
            hint: t("settings.memoryApprovalHint"),
            selected: bot.memory.writeApproval,
            disabled: !bot.memory.enabled,
            onChange: (writeApproval: boolean) =>
              onChange({ memory: { ...bot.memory, writeApproval } }),
          },
          {
            id: "review",
            label: t("settings.memoryReview"),
            hint: t("settings.memoryReviewHint"),
            selected: bot.memory.reviewEnabled,
            disabled: !bot.memory.enabled,
            onChange: (reviewEnabled: boolean) =>
              onChange({ memory: { ...bot.memory, reviewEnabled } }),
          },
        ].map((row) => (
          <div
            key={row.id}
            className="flex items-center gap-3 border-b border-separator-border px-3.5 py-3 last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <p className="text-body-regular text-text-primary">{row.label}</p>
              <p className="text-caption-1-regular text-text-tertiary">{row.hint}</p>
            </div>
            <Switch
              size="sm"
              isSelected={row.selected}
              isDisabled={row.disabled}
              onChange={row.onChange}
              aria-label={row.label}
            />
          </div>
        ))}
      </div>

      {lastReview && (
        <p
          role="status"
          className={cx(
            "text-caption-1-regular",
            lastReview.status === "failed"
              ? "text-text-error-primary"
              : "text-text-tertiary",
          )}
        >
          {reviewSummary(lastReview, t)}
        </p>
      )}

      {view && view.pending.length > 0 && (
        <PendingCard
          pending={view.pending}
          onApprove={(id) => void run(() => ipc.memoryPendingApprove(id))}
          onReject={(id) => void run(() => ipc.memoryPendingReject(id))}
          onApproveAll={() => runAll((id) => ipc.memoryPendingApprove(id))}
          onRejectAll={() => runAll((id) => ipc.memoryPendingReject(id))}
        />
      )}

      {enginesLoaded && (
        <p className="text-caption-1-regular text-text-tertiary">
          {anyToolEngine ? t("settings.memoryEngineHint") : t("settings.memoryEngineHintNone")}
        </p>
      )}

      {actionError && (
        <p role="alert" className="text-body-2-regular text-text-error-primary">
          {actionError}
        </p>
      )}

      {loading && !view ? (
        <p className="text-body-2-regular text-text-tertiary">{t("common.loading")}</p>
      ) : loadError && !view ? (
        <p role="alert" className="text-body-2-regular text-text-error-primary">
          {loadError}
        </p>
      ) : (
        <>
          {view?.memory && (
            <LedgerCard
              title={t("settings.memoryBookTitle")}
              desc={t("settings.memoryBookDesc", { limit: memoryLimit.toLocaleString() })}
              ledger={view.memory}
              filename="MEMORY.md"
              onAdd={(content) => run(() => ipc.memoryAdd({ botId: bot.id, target: "memory", content }))}
              onSave={(id, content) => run(() => ipc.memoryUpdate(id, content))}
              onDelete={(id) => run(() => ipc.memoryRemove(id))}
              onClear={() => run(() => ipc.memoryClear({ botId: bot.id, target: "memory" }))}
            />
          )}
          {view && (
            <LedgerCard
              title={t("settings.memoryUserTitle")}
              desc={t("settings.memoryUserDesc")}
              ledger={view.user}
              filename="USER.md"
              onAdd={(content) => run(() => ipc.memoryAdd({ botId: null, target: "user", content }))}
              onSave={(id, content) => run(() => ipc.memoryUpdate(id, content))}
              onDelete={(id) => run(() => ipc.memoryRemove(id))}
              onClear={() => run(() => ipc.memoryClear({ botId: null, target: "user" }))}
            />
          )}
        </>
      )}
    </div>
  );
}
