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
  parseToolArgs,
  getFirstStringField,
  truncateText,
  resolveToolStatus,
  type ToolStatusTone,
  asRecord,
  getFirstCommandField,
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
const EXPANDED_MAX_HEIGHT = 400;
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
  const args = parseToolArgs(item.detail);
  const nestedInput = asRecord(args?.input);
  const nestedArgs = asRecord(args?.arguments);
  const commandKeys = ['command', 'cmd', 'script', 'shell_command', 'bash', 'argv'];
  const descriptionKeys = ['description', 'summary', 'label', 'title', 'task'];
  const commandFromArgs =
    getFirstCommandField(args, commandKeys) ||
    getFirstCommandField(nestedInput, commandKeys) ||
    getFirstCommandField(nestedArgs, commandKeys);
  const summaryCommand = buildCommandSummary(item, { includeDetail: false });
  const command = cleanCommand(commandFromArgs || summaryCommand);
  const description =
    getFirstStringField(args, descriptionKeys) ||
    getFirstStringField(nestedInput, descriptionKeys) ||
    getFirstStringField(nestedArgs, descriptionKeys);
  const displayText = truncateText(description || command, 60) || 'Command';
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
  const totalCount = parsed.length;

  const completedCount = parsed.filter((p) => p.status === 'completed').length;
  const failedCount = parsed.filter((p) => p.status === 'failed').length;
  const hasProcessing = parsed.some((p) => p.status === 'processing');

  useEffect(() => {
    const lastProcessing = [...parsed].reverse().find((p) => p.status === 'processing');
    if (lastProcessing) {
      setExpandedItemId(lastProcessing.id);
    }
  }, [parsed]);

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

  const needsScroll = totalCount > MAX_VISIBLE_ITEMS;
  const baseHeight = needsScroll
    ? MAX_VISIBLE_ITEMS * ITEM_HEIGHT
    : totalCount * ITEM_HEIGHT;
  const listHeight = expandedItemId ? EXPANDED_MAX_HEIGHT : baseHeight;
  const overflowY = (needsScroll || expandedItemId) ? 'auto' : 'hidden';

  const progressNode = (() => {
    if (failedCount > 0) {
      return (
        <span className="bash-group-progress error">
          <span className="codicon codicon-warning" style={{ fontSize: '12px', marginRight: '4px' }} />
          {failedCount} {t("tools.bashGroupFailed")}
        </span>
      );
    }
    if (totalCount > 0 && completedCount === totalCount) {
      return (
        <span className="bash-group-progress completed">
          <span className="codicon codicon-check" style={{ fontSize: '12px', marginRight: '4px' }} />
          {t("tools.bashGroupAllCompleted")}
        </span>
      );
    }
    return (
      <span className="bash-group-progress">
        {completedCount}/{totalCount}
      </span>
    );
  })();

  return (
    <div className="task-container bash-group-container">
      <div
        className="task-header bash-group-header"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <div className="task-title-section">
          <span
            className="codicon codicon-terminal tool-title-icon bash-group-chevron"
          />
          <span className="tool-title-text">
            {t("tools.bashGroupBatchRun")} ({totalCount})
          </span>
        </div>
        <div className="bash-group-summary">{progressNode}</div>
      </div>

      {isExpanded && (
        <div
          className="bash-group-timeline"
          ref={timelineRef}
          style={{
            maxHeight: `${listHeight + 16}px`,
            overflowY,
          }}
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
                  <div className="bash-timeline-node" />
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
                    <div
                      className={`tool-status-indicator ${
                        entry.status === 'failed'
                          ? 'error'
                          : entry.status === 'completed'
                            ? 'completed'
                            : 'pending'
                      } bash-item-status`}
                    />
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
