/**
 * 批量命令执行分组组件（时间线布局）
 * Groups multiple consecutive Bash tool calls into a timeline view
 */
import { memo, useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConversationItem } from '../../../../types';
import { highlightLine } from '../../../../utils/syntax';
import {
  buildCommandSummary,
  truncateText,
  resolveToolStatus,
  type ToolStatusTone,
} from './toolConstants';

type ToolItem = Extract<ConversationItem, { kind: 'tool' }>;

interface BashToolGroupBlockProps {
  items: ToolItem[];
  onRequestAutoScroll?: () => void;
}

interface ParsedBashItem {
  id: string;
  command: string;
  description: string;
  displayText: string;
  output: string;
  status: ToolStatusTone;
}

const MAX_VISIBLE_ITEMS = 3.5;
const ITEM_HEIGHT = 32;
const MAX_OUTPUT_LINES = 100;
const ERROR_LINE_PATTERN = /(?:\berror\b|\bfailed\b|\bexception\b)/i;

function cleanCommand(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  const shellMatch = trimmed.match(
    /^(?:\/\S+\/)?(?:bash|zsh|sh|fish)(?:\.exe)?\s+-(?:l?c)\s+(['"])([\s\S]+)\1$/,
  );
  const inner = shellMatch ? shellMatch[2] : trimmed;
  const cdMatch = inner.match(/^\s*cd\s+[^&;]+(?:\s*&&\s*|\s*;\s*)([\s\S]+)$/i);
  return (cdMatch ? cdMatch[1] : inner).trim();
}

function parseBashItem(item: ToolItem): ParsedBashItem {
  const command = cleanCommand(buildCommandSummary(item, { includeDetail: false }));
  const description = '';
  const displayText = truncateText(command, 60) || 'Command';
  const output = item.output ?? '';
  const status = resolveToolStatus(item.status, Boolean(item.output));

  return { id: item.id, command, description, displayText, output, status };
}

export const BashToolGroupBlock = memo(function BashToolGroupBlock({
  items,
  onRequestAutoScroll,
}: BashToolGroupBlockProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef(items.length);

  const parsed = useMemo(() => items.map(parseBashItem), [items]);

  const completedCount = parsed.filter((p) => p.status === 'completed').length;
  const failedCount = parsed.filter((p) => p.status === 'failed').length;
  const hasProcessing = parsed.some((p) => p.status === 'processing');

  const groupStatus: ToolStatusTone = hasProcessing
    ? 'processing'
    : failedCount > 0
      ? 'failed'
      : 'completed';

  // 自动展开最后一个正在运行的命令
  useEffect(() => {
    const lastProcessing = [...parsed].reverse().find((p) => p.status === 'processing');
    if (lastProcessing) {
      setExpandedItemId(lastProcessing.id);
    }
  }, [parsed]);

  // 流式时自动滚动
  useEffect(() => {
    if (items.length > prevCountRef.current && timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
    prevCountRef.current = items.length;
  }, [items.length]);

  useEffect(() => {
    if (hasProcessing) {
      onRequestAutoScroll?.();
    }
  }, [hasProcessing, onRequestAutoScroll]);

  const toggleItem = useCallback((id: string) => {
    setExpandedItemId((prev) => (prev === id ? null : id));
  }, []);

  const progressText = failedCount > 0
    ? t("tools.failedCount", { count: failedCount })
    : `${completedCount}/${items.length}`;

  const listHeight = Math.min(parsed.length, MAX_VISIBLE_ITEMS) * ITEM_HEIGHT;
  const needsScroll = parsed.length > MAX_VISIBLE_ITEMS && !expandedItemId;

  return (
    <div className="task-container">
      <div
        className="task-header"
        onClick={() => setIsExpanded((prev) => !prev)}
        style={{
          borderBottom: isExpanded ? '1px solid var(--border-primary)' : undefined,
        }}
      >
        <div className="task-title-section">
          <span className="codicon codicon-terminal tool-title-icon" />
          <span className="tool-title-text">{t("tools.batchRun")}</span>
          <span className="tool-title-summary" style={{
            color: 'var(--text-secondary)',
            marginLeft: '4px',
            flexShrink: 0,
          }}>
            ({items.length})
          </span>
          <span className={`bash-group-progress ${groupStatus}`}>{progressText}</span>
        </div>
        <div className={`tool-status-indicator ${groupStatus === 'failed' ? 'error' : groupStatus === 'completed' ? 'completed' : 'pending'}`} />
      </div>

      {isExpanded && (
        <div
          className="bash-group-timeline"
          ref={timelineRef}
          style={needsScroll ? { maxHeight: listHeight, overflowY: 'auto' } : undefined}
        >
          {parsed.map((entry, index) => {
            const isLast = index === parsed.length - 1;
            const isItemExpanded = expandedItemId === entry.id;
            const outputLines = entry.output
              ? entry.output.split(/\r?\n/).slice(-MAX_OUTPUT_LINES)
              : [];
            const highlightedOutputLines = outputLines.map((line) => highlightLine(line, 'bash'));

            return (
              <div key={entry.id} className="bash-timeline-item">
                <div className="bash-timeline-connector">
                  <div className={`bash-timeline-line${isLast ? ' last' : ''}`} />
                  <div className={`bash-timeline-node ${entry.status}`} />
                </div>
                <div
                  className={`bash-timeline-content${isItemExpanded ? ' expanded' : ''}`}
                  onClick={() => toggleItem(entry.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleItem(entry.id);
                    }
                  }}
                >
                  <div className="bash-timeline-row">
                    <span className="bash-timeline-description">{entry.displayText}</span>
                  </div>
                  {isItemExpanded && (
                    <div className="bash-timeline-detail">
                      {entry.command && (
                        <div className="bash-command-block">{entry.command}</div>
                      )}
                      {outputLines.length > 0 && (
                        <div className="bash-output-block normal">
                          <div className="bash-output-toolbar">
                            <button
                              type="button"
                              className="bash-command-copy-btn"
                              onClick={async (event) => {
                                event.stopPropagation();
                                try {
                                  await navigator.clipboard.writeText(entry.output ?? "");
                                  setCopiedOutputId(entry.id);
                                  window.setTimeout(() => setCopiedOutputId((prev) => (prev === entry.id ? null : prev)), 1200);
                                } catch {
                                  setCopiedOutputId(null);
                                }
                              }}
                            >
                              {copiedOutputId === entry.id ? t("messages.copied") : t("messages.copy")}
                            </button>
                          </div>
                          {outputLines.map((line, i) => (
                            <div
                              key={`${i}-${line.slice(0, 20)}`}
                              className="bash-output-line"
                            >
                              {ERROR_LINE_PATTERN.test(line) ? (
                                <span className="bash-output-line-error">{line || ' '}</span>
                              ) : line.length === 0 ? (
                                <span>&nbsp;</span>
                              ) : (
                                <span
                                  dangerouslySetInnerHTML={{ __html: highlightedOutputLines[i] ?? "" }}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default BashToolGroupBlock;
