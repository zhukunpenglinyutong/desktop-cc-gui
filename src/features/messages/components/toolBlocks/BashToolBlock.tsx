/**
 * 终端命令工具块组件
 * Bash Tool Block Component - for displaying terminal command executions
 * 使用 task-container 样式 + codicon 图标（匹配参考项目）
 */
import { memo, useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationItem } from '../../../../types';
import { highlightLine } from '../../../../utils/syntax';
import {
  buildCommandSummary,
  truncateText,
  resolveToolStatus,
} from './toolConstants';

interface BashToolBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  onRequestAutoScroll?: () => void;
}

const MAX_OUTPUT_LINES = 200;

/**
 * 清理命令文本，移除 shell 包装
 */
function cleanCommand(commandText: string): string {
  if (!commandText) return '';
  const trimmed = commandText.trim();

  const shellMatch = trimmed.match(
    /^(?:\/\S+\/)?(?:bash|zsh|sh|fish)(?:\.exe)?\s+-(?:l?c)\s+(['"])([\s\S]+)\1$/
  );
  const inner = shellMatch ? shellMatch[2] : trimmed;

  const cdMatch = inner.match(/^\s*cd\s+[^&;]+(?:\s*&&\s*|\s*;\s*)([\s\S]+)$/i);
  const stripped = cdMatch ? cdMatch[1] : inner;

  return stripped.trim();
}

/**
 * 获取状态
 */
function getStatus(item: Extract<ConversationItem, { kind: 'tool' }>): 'completed' | 'processing' | 'failed' {
  return resolveToolStatus(item.status, Boolean(item.output));
}

export const BashToolBlock = memo(function BashToolBlock({
  item,
  isExpanded,
  onToggle,
  onRequestAutoScroll,
}: BashToolBlockProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPinned, setIsPinned] = useState(true);
  const [showLiveOutput, setShowLiveOutput] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [copiedOutput, setCopiedOutput] = useState(false);

  const summaryCommand = useMemo(
    () => buildCommandSummary(item, { includeDetail: false }),
    [item],
  );
  const command = cleanCommand(summaryCommand);
  const displayCommand = truncateText(command, 80);
  const cwd = '';

  const status = getStatus(item);
  const isRunning = status === 'processing';
  const durationMs = typeof item.durationMs === 'number' ? item.durationMs : null;
  const isLongRunning = durationMs !== null && durationMs >= 1200;

  const outputLines = useMemo(() => {
    if (!item.output) return [];
    const lines = item.output.split(/\r?\n/);
    if (lines.length <= MAX_OUTPUT_LINES) return lines;
    return lines.slice(-MAX_OUTPUT_LINES);
  }, [item.output]);
  const highlightedOutputLines = useMemo(
    () => outputLines.map((line) => highlightLine(line, 'bash')),
    [outputLines],
  );

  useEffect(() => {
    if (!isRunning) {
      setShowLiveOutput(false);
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setShowLiveOutput(true);
    }, 600);
    return () => window.clearTimeout(timeoutId);
  }, [isRunning]);

  const handleScroll = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    const threshold = 6;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    setIsPinned(distanceFromBottom <= threshold);
  }, []);

  useEffect(() => {
    const node = containerRef.current;
    if (!node || !isPinned) return;
    node.scrollTop = node.scrollHeight;
  }, [outputLines, isPinned]);

  useEffect(() => {
    if (isRunning && showLiveOutput) {
      onRequestAutoScroll?.();
    }
  }, [isRunning, showLiveOutput, onRequestAutoScroll]);

  const isError = status === 'failed';
  const isCompleted = status === 'completed';
  const showOutput = isExpanded || (isRunning && showLiveOutput) || isLongRunning || isError;
  const isErrorLine = (line: string) => /(?:\berror\b|\bfailed\b|\bexception\b)/i.test(line);

  return (
    <div className="task-container">
      <div
        className="task-header"
        onClick={() => onToggle(item.id)}
        style={{
          borderBottom: showOutput ? '1px solid var(--border-primary)' : undefined,
        }}
      >
        <div className="task-title-section">
          <span className="codicon codicon-terminal tool-title-icon" />
          <span className="tool-title-text">{t("tools.runCommand")}</span>
          {displayCommand ? (
            <span className="tool-title-summary" title={command} style={{ fontFamily: 'var(--font-mono, monospace)', opacity: 0.8 }}>
              {displayCommand}
            </span>
          ) : null}
        </div>
        <div className={`tool-status-indicator ${isError ? 'error' : isCompleted ? 'completed' : 'pending'}`} />
      </div>

      {showOutput && (
        <div className="task-details" style={{ padding: 0, border: 'none' }}>
          {isExpanded && command && (
            <div className="bash-command-shell">
              <div className="bash-command-shell-head">
                <span className="bash-command-shell-title">{t("tools.executeCommand")}</span>
                <button
                  type="button"
                  className="bash-command-copy-btn"
                  onClick={async (event) => {
                    event.stopPropagation();
                    try {
                      await navigator.clipboard.writeText(command);
                      setCopiedCommand(true);
                      window.setTimeout(() => setCopiedCommand(false), 1200);
                    } catch {
                      setCopiedCommand(false);
                    }
                  }}
                >
                  {copiedCommand ? t("messages.copied") : t("messages.copy")}
                </button>
              </div>
              <div className="bash-command-block">{command}</div>
            </div>
          )}
          {cwd && isExpanded && (
            <div style={{ padding: '4px 12px', fontSize: '11px', color: 'var(--text-tertiary, var(--text-secondary))', opacity: 0.7 }}>
              cwd: {cwd}
            </div>
          )}
          {outputLines.length > 0 && (
            <div
              className={`bash-output-block ${isError ? 'error' : 'normal'}`}
              ref={containerRef}
              onScroll={handleScroll}
              role="log"
              aria-live="polite"
              style={{ maxHeight: '300px', overflowY: 'auto', overflowX: 'auto' }}
            >
              <div className="bash-output-toolbar">
                <button
                  type="button"
                  className="bash-command-copy-btn"
                  onClick={async (event) => {
                    event.stopPropagation();
                    try {
                      await navigator.clipboard.writeText(item.output ?? "");
                      setCopiedOutput(true);
                      window.setTimeout(() => setCopiedOutput(false), 1200);
                    } catch {
                      setCopiedOutput(false);
                    }
                  }}
                >
                  {copiedOutput ? t("messages.copied") : t("messages.copy")}
                </button>
              </div>
              {outputLines.map((line, index) => (
                <div key={`${index}-${line.slice(0, 20)}`} className="bash-output-line">
                  {isErrorLine(line) ? (
                    <span className="bash-output-line-error">{line || ' '}</span>
                  ) : line.length === 0 ? (
                    <span>&nbsp;</span>
                  ) : (
                    <span
                      dangerouslySetInnerHTML={{ __html: highlightedOutputLines[index] ?? "" }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default BashToolBlock;
