/**
 * MCP 服务的新增 / 编辑表单：一次只填一种传输（stdio 用命令，远程用地址），
 * env / headers 用键值对列表。编辑态先通过 `getRawEntry` 拉文件里的原始
 * 值（不脱敏），提交时走版本比对的 update；新增走 create。
 *
 * 启停不在这张表单里：它是独立的 `mcp_set_enabled` 通道，表单不碰
 * （编辑态后端也会忽略 `enabled`，避免「改个参数」把停用状态重置）。
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Loader2 from "lucide-react/dist/esm/icons/loader-2";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ModalShell } from "@/components/dialogs";
import { mcpApi } from "./api";
import type {
  McpConfigEntry,
  McpConfigSource,
  McpServerInput,
  McpServerKeyValue,
} from "./types";

type Mode = { kind: "create"; source: McpConfigSource } | { kind: "edit"; entry: McpConfigEntry };

const EMPTY_INPUT: McpServerInput = {
  name: "",
  transport: "stdio",
  command: "",
  args: [],
  cwd: "",
  env: [],
  url: "",
  headers: [],
  enabled: true,
};

/** 参数 / env / headers 的多行编辑：一行一条，参数保留空格原样，键值对按
 *  第一个 `=` 拆分（值里可以再有 `=`）。 */
function kvToText(kvs: McpServerKeyValue[]): string {
  return kvs.map((item) => `${item.key}=${item.value}`).join("\n");
}

function textToKv(text: string): McpServerKeyValue[] {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const eq = line.indexOf("=");
      if (eq < 0) return { key: line.trim(), value: "" };
      return { key: line.slice(0, eq).trim(), value: line.slice(eq + 1) };
    })
    .filter((item) => item.key.length > 0);
}

function argsToText(args: string[]): string {
  return args.join("\n");
}

function textToArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function McpConfigFormDialog({
  mode,
  workspacePath,
  onSubmit,
  onClose,
}: {
  mode: Mode;
  workspacePath: string | null;
  /** 返回 Promise；resolve 后父组件关弹窗并刷新清单。 */
  onSubmit: (input: McpServerInput) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = mode.kind === "edit";
  const [form, setForm] = useState<McpServerInput>(EMPTY_INPUT);
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");
  const [headersText, setHeadersText] = useState("");
  const [loading, setLoading] = useState(isEdit);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 编辑态回显：从文件里读原始值（未脱敏）。失败时表单保持空，错误显示出来。
  useEffect(() => {
    if (mode.kind !== "edit") return;
    let cancelled = false;
    setLoading(true);
    mcpApi
      .getRawEntry(mode.entry, workspacePath)
      .then((raw) => {
        if (cancelled) return;
        setForm(raw);
        setArgsText(argsToText(raw.args));
        setEnvText(kvToText(raw.env));
        setHeadersText(kvToText(raw.headers));
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, workspacePath]);

  const patch = (part: Partial<McpServerInput>) =>
    setForm((value) => ({ ...value, ...part }));

  const isRemote = form.transport === "http" || form.transport === "sse";
  const validationError = useMemo(() => {
    if (!form.name.trim()) return t("mcp.form.errorName");
    if (isRemote ? !form.url.trim() : !form.command.trim()) {
      return isRemote ? t("mcp.form.errorUrl") : t("mcp.form.errorCommand");
    }
    return null;
  }, [form.name, form.command, form.url, isRemote, t]);

  const submit = async () => {
    if (validationError || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const input: McpServerInput = {
      ...form,
      name: form.name.trim(),
      args: isRemote ? [] : textToArgs(argsText),
      // 远程与命令互斥：清掉另一边的残留（编辑远程服务时旧 command 会带回来）。
      command: isRemote ? "" : form.command.trim(),
      cwd: isRemote ? "" : form.cwd,
      env: isRemote ? [] : textToKv(envText),
      url: isRemote ? form.url.trim() : "",
      headers: isRemote ? textToKv(headersText) : [],
    };
    try {
      await onSubmit(input);
      onClose();
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const title = isEdit
    ? t("mcp.form.titleEdit", { name: mode.kind === "edit" ? mode.entry.name : "" })
    : t("mcp.form.titleCreate");

  return (
    <ModalShell
      onClose={onClose}
      label={title}
      className="w-[480px]"
      dialogClassName="flex max-h-[80vh] flex-col"
    >
      <h2 className="mb-3 text-heading-3 text-text-primary">{title}</h2>
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-text-secondary">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-body-2-regular">{t("mcp.form.loading")}</span>
        </div>
      ) : loadError ? (
        <p className="text-body-2-regular text-text-error-primary">{loadError}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <Input
            label={t("mcp.form.name")}
            value={form.name}
            isDisabled={isEdit}
            hint={isEdit ? t("mcp.form.nameLocked") : t("mcp.form.nameHint")}
            onChange={(value) => patch({ name: value })}
          />
          <div className="flex flex-col gap-1">
            <span className="text-body-2-medium text-text-secondary">
              {t("mcp.form.transportLabel")}
            </span>
            <div className="flex gap-2" role="radiogroup" aria-label={t("mcp.form.transportLabel")}>
              {(["stdio", "http", "sse"] as const).map((kind) => (
                <label
                  key={kind}
                  className="flex cursor-pointer items-center gap-1.5 text-body-2-regular text-text-primary"
                >
                  <input
                    type="radio"
                    name="mcp-transport"
                    checked={form.transport === kind}
                    onChange={() => patch({ transport: kind })}
                    className="accent-[var(--colors-foreground-fg-brand-primary)]"
                  />
                  {t(`mcp.form.transport.${kind}`)}
                </label>
              ))}
            </div>
          </div>
          {!isRemote ? (
            <>
              <Input
                label={t("mcp.form.command")}
                placeholder="npx / uvx / node …"
                value={form.command}
                onChange={(value) => patch({ command: value })}
              />
              <div className="flex flex-col gap-1">
                <span className="text-body-2-medium text-text-secondary">
                  {t("mcp.form.args")}
                </span>
                <textarea
                  value={argsText}
                  onChange={(event) => setArgsText(event.target.value)}
                  placeholder={t("mcp.form.argsPlaceholder")}
                  rows={2}
                  className="w-full rounded-lg border border-border-primary bg-background-primary-default px-3 py-2 font-mono text-body-2-regular text-text-primary outline-none focus:border-border-brand"
                />
              </div>
              <Input
                label={t("mcp.form.cwd")}
                hint={t("mcp.form.cwdHint")}
                value={form.cwd}
                onChange={(value) => patch({ cwd: value })}
              />
              <div className="flex flex-col gap-1">
                <span className="text-body-2-medium text-text-secondary">
                  {t("mcp.form.env")}
                </span>
                <textarea
                  value={envText}
                  onChange={(event) => setEnvText(event.target.value)}
                  placeholder={t("mcp.form.envPlaceholder")}
                  rows={3}
                  className="w-full rounded-lg border border-border-primary bg-background-primary-default px-3 py-2 font-mono text-body-2-regular text-text-primary outline-none focus:border-border-brand"
                />
              </div>
            </>
          ) : (
            <>
              <Input
                label={t("mcp.form.url")}
                placeholder="https://…"
                value={form.url}
                onChange={(value) => patch({ url: value })}
              />
              <div className="flex flex-col gap-1">
                <span className="text-body-2-medium text-text-secondary">
                  {t("mcp.form.headers")}
                </span>
                <textarea
                  value={headersText}
                  onChange={(event) => setHeadersText(event.target.value)}
                  placeholder={t("mcp.form.headersPlaceholder")}
                  rows={3}
                  className="w-full rounded-lg border border-border-primary bg-background-primary-default px-3 py-2 font-mono text-body-2-regular text-text-primary outline-none focus:border-border-brand"
                />
              </div>
            </>
          )}
          {!isEdit ? (
            <label className="flex cursor-pointer items-center gap-2 text-body-2-regular text-text-primary">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
                className="accent-[var(--colors-foreground-fg-brand-primary)]"
              />
              {t("mcp.form.enabledOnCreate")}
            </label>
          ) : null}
          {submitError ? (
            <p className="text-body-2-regular text-text-error-primary">{submitError}</p>
          ) : validationError ? null : null}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between gap-2">
        <span className="text-caption-1-regular text-text-tertiary">
          {isEdit ? t("mcp.form.editNote") : ""}
        </span>
        <div className="flex gap-2">
          <Button variant="secondary" size="small" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="small"
            disabled={Boolean(validationError) || submitting || loading}
            onClick={() => void submit()}
          >
            {submitting
              ? t("mcp.form.saving")
              : isEdit
                ? t("mcp.form.save")
                : t("mcp.form.create")}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

/** 删除确认：列出将要移除的来源与路径，强调会立即改配置文件。 */
export function McpDeleteConfirmDialog({
  entry,
  deleting,
  onConfirm,
  onClose,
}: {
  entry: McpConfigEntry;
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ModalShell onClose={onClose} label={t("mcp.delete.title", { name: entry.name })}>
      <h2 className="text-heading-3 text-text-primary">
        {t("mcp.delete.title", { name: entry.name })}
      </h2>
      <p className="mt-2 text-body-2-regular text-text-secondary">
        {t("mcp.delete.message", { name: entry.name })}
      </p>
      <div className="mt-3 flex flex-col gap-1 rounded-lg bg-background-secondary-default p-3 text-caption-1-regular text-text-secondary">
        <span>
          {t("mcp.detail.source")}: {t(`mcp.source.${entry.source}`)}
        </span>
        <span className="break-all font-mono">{entry.path}</span>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" size="small" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button
          variant="danger"
          size="small"
          autoFocus
          disabled={deleting}
          onClick={onConfirm}
        >
          {deleting ? t("mcp.form.saving") : t("mcp.delete.confirm")}
        </Button>
      </div>
    </ModalShell>
  );
}

/** 行内操作按钮：编辑（铅笔）与删除（垃圾桶）。能力位为 false 时不渲染，
 *  与「只读来源连启用开关都置灰」同一口径。 */
export function EntryActionButtons({
  entry,
  onEdit,
  onDelete,
}: {
  entry: McpConfigEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  if (!entry.updatable && !entry.deletable) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {entry.updatable ? (
        <button
          type="button"
          aria-label={t("mcp.row.edit", { name: entry.name })}
          title={t("mcp.row.edit", { name: entry.name })}
          onClick={(event) => {
            event.stopPropagation();
            onEdit();
          }}
          className="rounded-md p-1 text-text-tertiary outline-none hover:bg-background-secondary-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          <Pencil className="size-3.5" />
        </button>
      ) : null}
      {entry.deletable ? (
        <button
          type="button"
          aria-label={t("mcp.row.delete", { name: entry.name })}
          title={t("mcp.row.delete", { name: entry.name })}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded-md p-1 text-text-tertiary outline-none hover:bg-background-error-secondary hover:text-text-error-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
    </span>
  );
}
