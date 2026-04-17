/**
 * 通用工具块组件 - 用于展示各种工具调用
 * Generic Tool Block Component - for displaying various tool calls
 * 使用 task-container 样式 + codicon 图标（匹配参考项目）
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ConversationItem } from '../../../../types';
import { parseDiff, type ParsedDiffLine } from '../../../../utils/diff';
import { computeDiff } from '../../utils/diffUtils';
import { LocalImage } from '../LocalImage';
import { Markdown } from '../Markdown';
import {
  asRecord,
  extractToolName,
  getToolDisplayName,
  getFileName,
  truncateText,
  parseToolArgs,
  getFirstStringField,
  isMcpTool,
  isReadTool,
  isEditTool,
  isBashTool,
  isSearchTool,
  isWebTool,
  resolveToolStatus,
} from './toolConstants';
import { FileIcon } from './FileIcon';

type StatusTone = 'completed' | 'processing' | 'failed' | 'pending';
type NormalizedChangeKind = 'added' | 'modified' | 'deleted' | 'renamed';

type DiffStats = {
  additions: number;
  deletions: number;
};

const FILE_CHANGE_PATH_KEYS = [
  'file_path',
  'filePath',
  'filepath',
  'path',
  'target_file',
  'targetFile',
  'filename',
  'file',
];

const FILE_CHANGE_DIFF_KEYS = [
  'diff',
  'patch',
  'unified_diff',
  'unifiedDiff',
];

const FILE_CHANGE_DIFF_PREVIEW_MAX_LINES = 48;
const IMAGE_FILE_EXTENSION_REGEX =
  /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|ico|avif)(?:[?#].*)?$/i;

type DisplayChange = {
  path: string;
  normalizedKind: NormalizedChangeKind;
  kindCode: 'A' | 'M' | 'D' | 'R';
  diffStats: DiffStats;
  diffText?: string;
  diffPreviewLines: ParsedDiffLine[];
  diffPreviewTruncated: boolean;
};

type ExitPlanCardContent = {
  planMarkdown: string;
  planFilePath: string;
  rawText: string;
};

type ExitPlanExecutionMode = 'default' | 'full-access';
const EXIT_PLAN_RAW_OUTPUT_NOISE = new Set(['{}', '[]', 'Exit plan mode?', 'Implement this plan.']);

interface GenericToolBlockProps {
  item: Extract<ConversationItem, { kind: 'tool' }>;
  workspaceId?: string | null;
  isExpanded: boolean;
  onToggle: (id: string) => void;
  activeCollaborationModeId?: string | null;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  hasPendingUserInputRequest?: boolean;
  onOpenDiffPath?: (path: string) => void;
  selectedExitPlanExecutionMode?: ExitPlanExecutionMode | null;
  onExitPlanModeExecute?: (
    itemId: string,
    mode: ExitPlanExecutionMode,
  ) => Promise<void> | void;
}

// codicon 图标映射（匹配参考项目）
const CODICON_MAP: Record<string, string> = {
  read: 'codicon-eye',
  read_file: 'codicon-eye',
  edit: 'codicon-edit',
  edit_file: 'codicon-edit',
  write: 'codicon-pencil',
  write_to_file: 'codicon-pencil',
  save: 'codicon-pencil',
  'save-file': 'codicon-pencil',
  bash: 'codicon-terminal',
  run_terminal_cmd: 'codicon-terminal',
  execute_command: 'codicon-terminal',
  executecommand: 'codicon-terminal',
  shell_command: 'codicon-terminal',
  grep: 'codicon-search',
  glob: 'codicon-folder',
  search: 'codicon-search',
  find: 'codicon-folder',
  task: 'codicon-tools',
  todowrite: 'codicon-checklist',
  todo_write: 'codicon-checklist',
  webfetch: 'codicon-globe',
  websearch: 'codicon-search',
  delete: 'codicon-trash',
  skill: 'codicon-zap',
  useskill: 'codicon-zap',
  runskill: 'codicon-zap',
  run_skill: 'codicon-zap',
  execute_skill: 'codicon-zap',
  diff: 'codicon-diff',
  update_plan: 'codicon-checklist',
  exitplanmode: 'codicon-check-all',
  askuserquestion: 'codicon-comment-discussion',
  notebookedit: 'codicon-notebook',
};

// 可折叠的工具列表（参考 idea-claude-code-gui）
const COLLAPSIBLE_TOOLS = new Set([
  'grep', 'glob', 'write', 'save-file', 'askuserquestion',
  'update_plan', 'shell_command', 'exitplanmode',
  'webfetch', 'websearch', 'skill', 'useskill', 'runskill',
  'run_skill', 'execute_skill', 'task', 'todowrite',
]);

// 特殊文件名（没有扩展名但确实是文件）
const SPECIAL_FILES = new Set([
  'makefile', 'dockerfile', 'jenkinsfile', 'vagrantfile',
  'gemfile', 'rakefile', 'procfile', 'guardfile',
  'license', 'licence', 'readme', 'changelog',
  'gradlew', 'cname', 'authors', 'contributors',
]);

/**
 * 检查是否为目录路径
 */
function isDirectoryPath(filePath: string, fileName: string): boolean {
  const cleanFileName = fileName.replace(/:\d+(-\d+)?$/, '');
  return (
    filePath.endsWith('/') ||
    filePath === '.' ||
    filePath === '..' ||
    (!cleanFileName.includes('.') && !SPECIAL_FILES.has(cleanFileName.toLowerCase()))
  );
}

function normalizeToolIdentifier(toolName: string): string {
  return toolName.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchesNormalizedToolIdentifier(toolName: string, expected: string): boolean {
  const normalizedToolName = normalizeToolIdentifier(toolName);
  const normalizedExpected = normalizeToolIdentifier(expected);
  return (
    normalizedToolName === normalizedExpected ||
    normalizedToolName.endsWith(normalizedExpected)
  );
}

function isExitPlanToolVariant(toolName: string, title: string): boolean {
  const normalizedTitle = normalizeToolIdentifier(title);
  return (
    matchesNormalizedToolIdentifier(toolName, 'exitplanmode') ||
    matchesNormalizedToolIdentifier(title, 'exitplanmode') ||
    normalizedTitle.includes('exitplanmode')
  );
}

function looksLikeExitPlanPayload(
  item: Extract<ConversationItem, { kind: 'tool' }>,
  value?: string,
): boolean {
  if (item.toolType !== 'toolCall' || !/claude/i.test(item.title)) {
    return false;
  }
  if (!value) {
    return false;
  }
  const normalized = value.trim();
  if (!normalized) {
    return false;
  }
  const hasPlanSection = /(?:^|\n)PLAN\s*(?=\n|$)/i.test(normalized);
  const hasAllowedPromptsSection = /(?:^|\n)ALLOWEDPROMPTS\s*(?=\n|$)/i.test(normalized);
  if (hasPlanSection && hasAllowedPromptsSection) {
    return true;
  }
  try {
    const parsed = JSON.parse(normalized) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    return (
      typeof record.plan === 'string' &&
      record.plan.trim().length > 0 &&
      (
        (typeof record.planFilePath === 'string' && record.planFilePath.trim().length > 0) ||
        (Array.isArray(record.allowedPrompts) && record.allowedPrompts.length > 0) ||
        (Array.isArray(record.ALLOWEDPROMPTS) && record.ALLOWEDPROMPTS.length > 0)
      )
    );
  } catch {
    return false;
  }
}

/**
 * 根据工具名称获取 codicon 图标类名
 */
function getCodiconClass(toolName: string, title: string): string {
  const lower = toolName.toLowerCase();
  const normalized = normalizeToolIdentifier(toolName);
  const lowerTitle = title.toLowerCase();

  if (
    lower === 'filechange' ||
    lower === 'file change' ||
    lower === 'file changes' ||
    lowerTitle.includes('file change')
  ) {
    return 'codicon-diff';
  }

  // 直接映射
  if (CODICON_MAP[lower]) return CODICON_MAP[lower];
  if (CODICON_MAP[normalized]) return CODICON_MAP[normalized];

  // 分类匹配
  if (isReadTool(lower)) return 'codicon-eye';
  if (isEditTool(lower)) return 'codicon-edit';
  if (isBashTool(lower)) return 'codicon-terminal';
  if (lower.includes('grep')) return 'codicon-search';
  if (lower.includes('glob') || lower.includes('find')) return 'codicon-folder';
  if (isSearchTool(lower)) return 'codicon-search';
  if (isWebTool(lower)) return 'codicon-globe';
  if (lower.includes('skill')) return 'codicon-zap';
  if (lower.includes('diff')) return 'codicon-diff';

  // MCP 工具根据名称猜测
  if (isMcpTool(title)) {
    if (lowerTitle.includes('search') || lowerTitle.includes('context')) return 'codicon-search';
    if (lowerTitle.includes('read') || lowerTitle.includes('file')) return 'codicon-eye';
    if (lowerTitle.includes('database') || lowerTitle.includes('sql')) return 'codicon-database';
    if (lowerTitle.includes('web') || lowerTitle.includes('fetch')) return 'codicon-globe';
  }

  return 'codicon-tools';
}

/**
 * 获取工具状态
 */
function getToolStatus(
  item: Extract<ConversationItem, { kind: 'tool' }>,
  hasChanges: boolean,
): StatusTone {
  const resolved = resolveToolStatus(item.status, Boolean(item.output) || hasChanges);
  return resolved === 'processing' ? 'pending' : resolved;
}

/**
 * 检查工具是否应该可折叠
 */
function isCollapsibleTool(toolName: string, title: string): boolean {
  const lower = toolName.toLowerCase();
  const normalized = normalizeToolIdentifier(toolName);
  return COLLAPSIBLE_TOOLS.has(lower) || COLLAPSIBLE_TOOLS.has(normalized) || isMcpTool(title);
}

/**
 * 提取工具摘要信息
 */
function extractSummary(
  item: Extract<ConversationItem, { kind: 'tool' }>,
  toolName: string,
): string {
  const args = parseToolArgs(item.detail);
  const lower = toolName.toLowerCase();

  if (isReadTool(lower)) {
    const filePath = getFirstStringField(args, ['file_path', 'path', 'target_file', 'filename']);
    return filePath ? getFileName(filePath) : '';
  }

  if (isEditTool(lower)) {
    const filePath = getFirstStringField(args, ['file_path', 'path', 'target_file', 'filename']);
    return filePath ? getFileName(filePath) : '';
  }

  if (isSearchTool(lower)) {
    const query = getFirstStringField(args, ['pattern', 'query', 'search_term', 'text']);
    return query ? truncateText(query, 50) : '';
  }

  if (isBashTool(lower)) {
    const command = getFirstStringField(args, ['command', 'cmd']);
    return command ? truncateText(command, 60) : '';
  }

  if (isWebTool(lower)) {
    const url = getFirstStringField(args, ['url', 'query']);
    return url ? truncateText(url, 50) : '';
  }

  if (isMcpTool(item.title)) {
    const query = getFirstStringField(args, ['query', 'pattern', 'path', 'file_path']);
    return query ? truncateText(query, 50) : '';
  }

  if (args) {
    for (const key of ['query', 'pattern', 'path', 'file_path', 'command', 'text']) {
      const value = args[key];
      if (typeof value === 'string' && value.trim()) {
        return truncateText(value.trim(), 50);
      }
    }
  }

  return '';
}

function normalizeChangeKind(kind?: string): NormalizedChangeKind {
  const value = (kind ?? '').toLowerCase();
  if (value === 'a') return 'added';
  if (value === 'm') return 'modified';
  if (value === 'd') return 'deleted';
  if (value === 'r') return 'renamed';
  if (value.includes('add')) return 'added';
  if (value.includes('create')) return 'added';
  if (value.includes('new')) return 'added';
  if (value.includes('del')) return 'deleted';
  if (value.includes('remove')) return 'deleted';
  if (value.includes('rename')) return 'renamed';
  if (value.includes('move')) return 'renamed';
  if (value.includes('mod')) return 'modified';
  if (value.includes('update')) return 'modified';
  if (value.includes('edit')) return 'modified';
  return 'modified';
}

function changeKindCode(kind: NormalizedChangeKind): 'A' | 'M' | 'D' | 'R' {
  if (kind === 'added') return 'A';
  if (kind === 'deleted') return 'D';
  if (kind === 'renamed') return 'R';
  return 'M';
}

function collectDiffStats(diff?: string): DiffStats {
  if (!diff) {
    return { additions: 0, deletions: 0 };
  }
  let additions = 0;
  let deletions = 0;
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
  }
  return { additions, deletions };
}

function getFirstStringFieldCaseInsensitive(
  source: Record<string, unknown> | null,
  keys: string[],
): string {
  if (!source) {
    return '';
  }
  const lowered = new Map<string, unknown>();
  Object.entries(source).forEach(([key, value]) => {
    lowered.set(key.toLowerCase(), value);
  });
  for (const key of keys) {
    const value = lowered.get(key.toLowerCase());
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function countContentLines(value: string): number {
  if (!value) {
    return 0;
  }
  return value.split('\n').length;
}

function extractLabeledBlock(
  rawText: string,
  label: string,
  nextLabels: string[] = [],
): string {
  const normalized = rawText.replace(/\r\n/g, '\n');
  if (!normalized.trim()) {
    return '';
  }

  const startRegex = new RegExp(`(^|\\n)${label}\\s*(?=\\n|$)`, 'i');
  const startMatch = startRegex.exec(normalized);
  if (!startMatch) {
    return '';
  }

  const contentStart = startMatch.index + startMatch[0].length;
  let contentEnd = normalized.length;

  for (const nextLabel of nextLabels) {
    const nextRegex = new RegExp(`\\n${nextLabel}\\s*(?=\\n|$)`, 'i');
    nextRegex.lastIndex = contentStart;
    const slice = normalized.slice(contentStart);
    const nextMatch = nextRegex.exec(slice);
    if (!nextMatch) {
      continue;
    }
    const candidateEnd = contentStart + nextMatch.index;
    if (candidateEnd < contentEnd) {
      contentEnd = candidateEnd;
    }
  }

  return normalized.slice(contentStart, contentEnd).replace(/^\n+|\n+$/g, '');
}

function extractExitPlanCardContent(
  item: Extract<ConversationItem, { kind: 'tool' }>,
): ExitPlanCardContent | null {
  const rawSources = [item.detail, item.output ?? '']
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const rawText = rawSources.join('\n\n').trim();

  if (!rawText) {
    return null;
  }

  let planMarkdown = '';
  let planFilePath = '';
  let normalizedRawText = rawText;

  for (const source of rawSources) {
    try {
      const parsed = JSON.parse(source) as unknown;
      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        if (typeof record.plan === 'string' && record.plan.trim()) {
          planMarkdown = record.plan.trim();
        }
        if (typeof record.planFilePath === 'string' && record.planFilePath.trim()) {
          planFilePath = record.planFilePath.trim();
        }
        normalizedRawText = JSON.stringify(parsed, null, 2);
        break;
      }
    } catch {
      // continue checking remaining raw sources
    }
  }

  if (!planMarkdown && !planFilePath) {
    planMarkdown = extractLabeledBlock(rawText, 'PLAN', ['PLANFILEPATH']);
    planFilePath = extractLabeledBlock(rawText, 'PLANFILEPATH');
  }

  return {
    planMarkdown,
    planFilePath,
    rawText: normalizedRawText,
  };
}

function shouldRenderExitPlanRawOutput(content: ExitPlanCardContent): boolean {
  if (content.planMarkdown || content.planFilePath) {
    return false;
  }
  const normalizedRawText = content.rawText.trim();
  if (!normalizedRawText) {
    return false;
  }
  return !EXIT_PLAN_RAW_OUTPUT_NOISE.has(normalizedRawText);
}

function decodeToolPath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function toImageViewLocalPath(value: string): string {
  const decoded = decodeToolPath(value.trim());
  if (!decoded) {
    return '';
  }
  if (
    decoded.startsWith('http://') ||
    decoded.startsWith('https://') ||
    decoded.startsWith('data:') ||
    decoded.startsWith('asset://')
  ) {
    return decoded;
  }
  if (decoded.startsWith('file://')) {
    const withoutScheme = decoded.slice('file://'.length);
    const withoutHost = withoutScheme.startsWith('localhost/')
      ? withoutScheme.slice('localhost/'.length)
      : withoutScheme;
    if (/^\/[A-Za-z]:[\\/]/.test(withoutHost)) {
      return withoutHost.slice(1);
    }
    if (/^[A-Za-z]:[\\/]/.test(withoutHost)) {
      return withoutHost;
    }
    if (withoutHost.startsWith('/')) {
      return withoutHost;
    }
    return `/${withoutHost}`;
  }
  if (
    decoded.startsWith('/') ||
    decoded.startsWith('./') ||
    decoded.startsWith('../') ||
    decoded.startsWith('~/') ||
    /^[A-Za-z]:[\\/]/.test(decoded) ||
    /^\\\\[^\\]/.test(decoded)
  ) {
    return decoded;
  }
  return '';
}

function resolveImageViewPreviewSrc(rawPath: string): string {
  const normalizedPath = toImageViewLocalPath(rawPath);
  if (!normalizedPath) {
    return '';
  }
  if (
    normalizedPath.startsWith('http://') ||
    normalizedPath.startsWith('https://') ||
    normalizedPath.startsWith('data:') ||
    normalizedPath.startsWith('asset://')
  ) {
    return IMAGE_FILE_EXTENSION_REGEX.test(normalizedPath) ||
        normalizedPath.startsWith('data:image/')
      ? normalizedPath
      : '';
  }
  if (!IMAGE_FILE_EXTENSION_REGEX.test(normalizedPath)) {
    return '';
  }
  try {
    return convertFileSrc(normalizedPath);
  } catch {
    return '';
  }
}

function collectImageSourceCandidatesFromUnknown(
  value: unknown,
  collector: string[],
): void {
  if (typeof value === 'string') {
    if (value.trim()) {
      collector.push(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectImageSourceCandidatesFromUnknown(entry, collector));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  const record = value as Record<string, unknown>;
  const prioritizedKeys = ['image_url', 'imageUrl', 'url', 'src', 'path', 'data'];
  prioritizedKeys.forEach((key) => {
    if (key in record) {
      collectImageSourceCandidatesFromUnknown(record[key], collector);
    }
  });
  Object.values(record).forEach((entry) => {
    collectImageSourceCandidatesFromUnknown(entry, collector);
  });
}

function extractImageSourcesFromPayloadText(payload: string): string[] {
  const candidates: string[] = [];
  const trimmed = payload.trim();
  if (!trimmed) {
    return candidates;
  }
  const compact = trimmed.replace(/\s+/g, '');
  const dataUrlMatch = trimmed.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/);
  if (dataUrlMatch?.[0]) {
    candidates.push(dataUrlMatch[0]);
  }
  if (
    /^[A-Za-z0-9+/=]{64,}$/.test(compact) &&
    compact.length % 4 === 0
  ) {
    candidates.push(`data:image/png;base64,${compact}`);
  }
  const urlMatches = trimmed.match(
    /https?:\/\/[^\s"'()]+?\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg|ico|avif)(?:[?#][^\s"'()]*)?/gi,
  );
  if (urlMatches?.length) {
    candidates.push(...urlMatches);
  }
  const fileUrlMatches = trimmed.match(
    /file:\/\/[^\s"'()]+?\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg|ico|avif)(?:[?#][^\s"'()]*)?/gi,
  );
  if (fileUrlMatches?.length) {
    candidates.push(...fileUrlMatches);
  }
  const posixPathMatches = trimmed.match(
    /\/(?:Users|home|tmp|var|opt|private|mnt|Volumes)\/[^\s"'()]+?\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg|ico|avif)(?:[?#][^\s"'()]*)?/g,
  );
  if (posixPathMatches?.length) {
    candidates.push(...posixPathMatches);
  }
  const windowsPathMatches = trimmed.match(
    /[A-Za-z]:[\\/][^\s"'()]+?\.(?:png|jpe?g|gif|webp|bmp|tiff?|svg|ico|avif)(?:[?#][^\s"'()]*)?/g,
  );
  if (windowsPathMatches?.length) {
    candidates.push(...windowsPathMatches);
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    collectImageSourceCandidatesFromUnknown(parsed, candidates);
  } catch {
    // ignore non-json payload
  }
  return candidates;
}

function resolveImageViewPreviewSrcFromTool(
  detail: string,
  output?: string,
  title?: string,
): string {
  const seeds = [detail, output ?? "", title ?? ""].filter((entry) => entry.trim().length > 0);
  for (const seed of seeds) {
    const directResolved = resolveImageViewPreviewSrc(seed);
    if (directResolved) {
      return directResolved;
    }
    const extracted = extractImageSourcesFromPayloadText(seed);
    for (const candidate of extracted) {
      const resolved = resolveImageViewPreviewSrc(candidate);
      if (resolved) {
        return resolved;
      }
    }
  }
  return '';
}

function resolveImageViewLocalPathFromTool(
  detail: string,
  output?: string,
  title?: string,
): string {
  const seeds = [detail, output ?? "", title ?? ""].filter((entry) => entry.trim().length > 0);
  for (const seed of seeds) {
    const direct = toImageViewLocalPath(seed);
    if (
      direct &&
      !direct.startsWith('http://') &&
      !direct.startsWith('https://') &&
      !direct.startsWith('data:') &&
      !direct.startsWith('asset://') &&
      IMAGE_FILE_EXTENSION_REGEX.test(direct)
    ) {
      return direct;
    }
    const extracted = extractImageSourcesFromPayloadText(seed);
    for (const candidate of extracted) {
      const normalized = toImageViewLocalPath(candidate);
      if (
        normalized &&
        !normalized.startsWith('http://') &&
        !normalized.startsWith('https://') &&
        !normalized.startsWith('data:') &&
        !normalized.startsWith('asset://') &&
        IMAGE_FILE_EXTENSION_REGEX.test(normalized)
      ) {
        return normalized;
      }
    }
  }
  return '';
}

function isImageViewLikeTool(
  item: Extract<ConversationItem, { kind: 'tool' }>,
  toolName: string,
) {
  if (item.toolType === 'imageView') {
    return true;
  }
  const normalizedToolName = toolName.trim().toLowerCase();
  const normalizedTitle = item.title.trim().toLowerCase();
  return (
    /(?:^|\b)view[-_\s]?image(?:\b|$)/.test(normalizedToolName) ||
    /(?:^|\b)view[-_\s]?image(?:\b|$)/.test(normalizedTitle) ||
    /(?:^|\b)imageview(?:\b|$)/.test(normalizedToolName) ||
    /(?:^|\b)imageview(?:\b|$)/.test(normalizedTitle)
  );
}

function computeLineDelta(oldString: string, newString: string): DiffStats {
  const oldCount = countContentLines(oldString);
  const newCount = countContentLines(newString);
  if (oldCount === 0 && newCount === 0) {
    return { additions: 0, deletions: 0 };
  }
  if (oldCount === 0) {
    return { additions: newCount, deletions: 0 };
  }
  if (newCount === 0) {
    return { additions: 0, deletions: oldCount };
  }
  if (oldString !== newString && oldCount === newCount) {
    return { additions: 1, deletions: 1 };
  }
  const diff = newCount - oldCount;
  if (diff >= 0) {
    return { additions: diff || 1, deletions: 0 };
  }
  return { additions: 0, deletions: -diff };
}

function collectDiffStatsFromArgs(args: Record<string, unknown>): DiffStats {
  const oldString = getFirstStringFieldCaseInsensitive(args, ['old_string', 'oldString']);
  const newString = getFirstStringFieldCaseInsensitive(args, ['new_string', 'newString']);
  if (oldString || newString) {
    return computeLineDelta(oldString, newString);
  }
  const content = getFirstStringFieldCaseInsensitive(args, [
    'content',
    'new_content',
    'newContent',
  ]);
  if (content) {
    return { additions: content.split('\n').length, deletions: 0 };
  }
  const diff = getFirstStringFieldCaseInsensitive(args, [
    'diff',
    'patch',
    'unified_diff',
    'unifiedDiff',
  ]);
  if (diff) {
    return collectDiffStats(diff);
  }
  return { additions: 0, deletions: 0 };
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

function pathHintMatches(pathHint: string, targetPath: string): boolean {
  const normalizedHint = normalizePath(pathHint);
  const normalizedTarget = normalizePath(targetPath);
  if (!normalizedHint || !normalizedTarget) {
    return true;
  }
  return (
    normalizedHint === normalizedTarget ||
    normalizedHint.endsWith(`/${normalizedTarget}`) ||
    normalizedTarget.endsWith(`/${normalizedHint}`)
  );
}

function buildSyntheticUnifiedDiffFromArgs(args: Record<string, unknown>): string | undefined {
  const oldString = getFirstStringFieldCaseInsensitive(args, ['old_string', 'oldString']);
  const newString = getFirstStringFieldCaseInsensitive(args, ['new_string', 'newString']);
  const content = getFirstStringFieldCaseInsensitive(args, [
    'content',
    'new_content',
    'newContent',
  ]);
  const oldContent = oldString;
  const newContent = newString || content;
  if (!oldContent && !newContent) {
    return undefined;
  }
  if (oldContent === newContent) {
    return undefined;
  }
  const diff = computeDiff(oldContent, newContent);
  if (diff.lines.length === 0) {
    return undefined;
  }
  const oldLines = oldContent ? oldContent.split('\n').length : 0;
  const newLines = newContent ? newContent.split('\n').length : 0;
  const header = `@@ -1,${oldLines} +1,${newLines} @@`;
  const body = diff.lines
    .map((line) => {
      if (line.type === 'added') {
        return `+${line.content}`;
      }
      if (line.type === 'deleted') {
        return `-${line.content}`;
      }
      return ` ${line.content}`;
    })
    .join('\n');
  return body ? `${header}\n${body}` : header;
}

function resolveChangeDiffText(
  change: { path: string; diff?: string },
  allChanges: Array<{ path: string; kind?: string; diff?: string }>,
  candidateArgs: Record<string, unknown>[],
  outputDiffText: string,
): string | undefined {
  const direct = (change.diff ?? '').trim();
  if (direct) {
    return direct;
  }
  if (allChanges.length === 1) {
    for (const args of candidateArgs) {
      const pathHint = getFirstStringFieldCaseInsensitive(args, FILE_CHANGE_PATH_KEYS);
      if (pathHint && !pathHintMatches(pathHint, change.path)) {
        continue;
      }
      const argsDiff = getFirstStringFieldCaseInsensitive(args, FILE_CHANGE_DIFF_KEYS);
      if (argsDiff) {
        return argsDiff;
      }
      const synthetic = buildSyntheticUnifiedDiffFromArgs(args);
      if (synthetic) {
        return synthetic;
      }
    }
    const outputTrimmed = outputDiffText.trim();
    if (outputTrimmed) {
      return outputTrimmed;
    }
  }
  return undefined;
}

function resolveChangeDiffStats(
  change: { path: string; diff?: string },
  allChanges: Array<{ path: string; kind?: string; diff?: string }>,
  candidateArgs: Record<string, unknown>[],
  outputStats: DiffStats,
  resolvedDiffText?: string,
): DiffStats {
  if (resolvedDiffText) {
    return collectDiffStats(resolvedDiffText);
  }
  const direct = collectDiffStats(change.diff);
  if (direct.additions > 0 || direct.deletions > 0) {
    return direct;
  }
  if (allChanges.length === 1) {
    for (const args of candidateArgs) {
      const pathHint = getFirstStringFieldCaseInsensitive(args, FILE_CHANGE_PATH_KEYS);
      if (pathHint && !pathHintMatches(pathHint, change.path)) {
        continue;
      }
      const fromArgs = collectDiffStatsFromArgs(args);
      if (fromArgs.additions > 0 || fromArgs.deletions > 0) {
        return fromArgs;
      }
    }
    if (outputStats.additions > 0 || outputStats.deletions > 0) {
      return outputStats;
    }
  }
  return direct;
}

function buildDiffPreview(diffText?: string): {
  lines: ParsedDiffLine[];
  truncated: boolean;
} {
  if (!diffText) {
    return { lines: [], truncated: false };
  }
  const parsed = parseDiff(diffText);
  if (parsed.length <= FILE_CHANGE_DIFF_PREVIEW_MAX_LINES) {
    return { lines: parsed, truncated: false };
  }
  return {
    lines: parsed.slice(0, FILE_CHANGE_DIFF_PREVIEW_MAX_LINES),
    truncated: true,
  };
}

function toDisplayChanges(
  changes: Array<{ path: string; kind?: string; diff?: string }>,
  candidateArgs: Record<string, unknown>[],
  outputStats: DiffStats,
  outputDiffText: string,
  includePreview: boolean,
): DisplayChange[] {
  return changes.map((change) => {
    const normalizedKind = normalizeChangeKind(change.kind);
    const diffText = resolveChangeDiffText(
      change,
      changes,
      candidateArgs,
      outputDiffText,
    );
    const preview = includePreview
      ? buildDiffPreview(diffText)
      : { lines: [], truncated: false };
    return {
      path: change.path,
      normalizedKind,
      kindCode: changeKindCode(normalizedKind),
      diffStats: resolveChangeDiffStats(
        change,
        changes,
        candidateArgs,
        outputStats,
        diffText,
      ),
      diffText,
      diffPreviewLines: preview.lines,
      diffPreviewTruncated: preview.truncated,
    };
  });
}

function collectChangeStats(changes: DisplayChange[]) {
  let additions = 0;
  let deletions = 0;
  let added = 0;
  let modified = 0;
  let deleted = 0;
  let renamed = 0;

  for (const change of changes) {
    const kind = change.normalizedKind;
    if (kind === 'added') added += 1;
    if (kind === 'modified') modified += 1;
    if (kind === 'deleted') deleted += 1;
    if (kind === 'renamed') renamed += 1;
    additions += change.diffStats.additions;
    deletions += change.diffStats.deletions;
  }
  return { additions, deletions, added, modified, deleted, renamed };
}

function getChangeEntryKey(path: string, index: number): string {
  return `${path}::${index}`;
}

function formatFileCountLabel(count: number): string {
  return count === 1 ? '1 file' : `${count} files`;
}

export const GenericToolBlock = memo(function GenericToolBlock({
  item,
  workspaceId = null,
  isExpanded: externalExpanded,
  onToggle,
  activeCollaborationModeId = null,
  activeEngine,
  hasPendingUserInputRequest = false,
  onOpenDiffPath,
  selectedExitPlanExecutionMode = null,
  onExitPlanModeExecute,
}: GenericToolBlockProps) {
  const { t } = useTranslation();
  const translateWithFallback = useCallback((key: string, fallback: string) => {
    const translated = t(key, { defaultValue: fallback });
    return translated && translated !== key ? translated : fallback;
  }, [t]);
  const toolName = extractToolName(item.title);
  const displayName = getToolDisplayName(toolName, item.title);
  const codiconClass = getCodiconClass(toolName, item.title);
  const hasChanges = (item.changes ?? []).length > 0;
  const status = getToolStatus(item, hasChanges);
  const summary = extractSummary(item, toolName);
  const isExitPlanTool =
    isExitPlanToolVariant(toolName, item.title) ||
    looksLikeExitPlanPayload(item, item.detail) ||
    looksLikeExitPlanPayload(item, item.output);
  const exitPlanContent = useMemo(
    () => (isExitPlanTool ? extractExitPlanCardContent(item) : null),
    [isExitPlanTool, item],
  );
  const exitPlanCopy = useMemo(
    () => ({
      ariaLabel: translateWithFallback('messages.exitPlanCard.ariaLabel', 'Plan ready card'),
      title: translateWithFallback('messages.exitPlanCard.title', 'Execution Plan Ready'),
      modeLabel: translateWithFallback('messages.exitPlanCard.modeLabel', 'Exit Plan mode'),
      planSummary: translateWithFallback('messages.exitPlanCard.planSummary', 'Plan summary'),
      executionHandoff: translateWithFallback(
        'messages.exitPlanCard.executionHandoff',
        'Execution handoff',
      ),
      executionHandoffDescription: translateWithFallback(
        'messages.exitPlanCard.executionHandoffDescription',
        'The planning step is complete. Exit Plan mode to continue with implementation against this approved plan.',
      ),
      executionModeLabel: translateWithFallback(
        'messages.exitPlanCard.executionModeLabel',
        'Choose execution mode',
      ),
      executionModeDescription: translateWithFallback(
        'messages.exitPlanCard.executionModeDescription',
        'Approved plan confirmed. Continue by leaving Plan mode and choosing how to execute.',
      ),
      executionModeDefault: translateWithFallback(
        'messages.exitPlanCard.executionModeDefault',
        'Default approval mode',
      ),
      executionModeFullAccess: translateWithFallback(
        'messages.exitPlanCard.executionModeFullAccess',
        'Full auto',
      ),
      executeDefaultAction: translateWithFallback(
        'messages.exitPlanCard.executeDefaultAction',
        'Switch to default approval mode and run',
      ),
      executeFullAccessAction: translateWithFallback(
        'messages.exitPlanCard.executeFullAccessAction',
        'Switch to full auto and run',
      ),
      planFile: translateWithFallback('messages.exitPlanCard.planFile', 'Plan file'),
      rawOutput: translateWithFallback('messages.exitPlanCard.rawOutput', 'Raw output'),
    }),
    [translateWithFallback],
  );

  const isCollapsible = isCollapsibleTool(toolName, item.title);
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [expandedCollapsedChangeRows, setExpandedCollapsedChangeRows] = useState<
    Record<string, boolean>
  >({});
  const [copiedOutput, setCopiedOutput] = useState(false);
  const [copiedPlanMarkdown, setCopiedPlanMarkdown] = useState(false);
  const isExpanded = isExitPlanTool
    ? externalExpanded
    : isCollapsible ? internalExpanded : externalExpanded;
  const shouldShowExitPlanRawOutput = exitPlanContent
    ? shouldRenderExitPlanRawOutput(exitPlanContent)
    : false;
  const isExitPlanExecutionLocked = selectedExitPlanExecutionMode !== null;
  const isFileChangeTool =
    item.toolType === 'fileChange' ||
    toolName.toLowerCase().includes('file change') ||
    item.title.toLowerCase().includes('file change');
  const isImageViewTool = isImageViewLikeTool(item, toolName);

  const parsedArgs = useMemo(() => parseToolArgs(item.detail), [item.detail]);
  const fileChangeCandidateArgs = useMemo(() => {
    const inputArgs = asRecord(parsedArgs?.input);
    const nestedArgs = asRecord(parsedArgs?.arguments);
    return [parsedArgs, inputArgs, nestedArgs].filter(
      (entry): entry is Record<string, unknown> => Boolean(entry),
    );
  }, [parsedArgs]);
  const outputStats = useMemo(
    () => collectDiffStats(item.output),
    [item.output],
  );
  const outputDiffText = useMemo(
    () => item.output ?? '',
    [item.output],
  );
  const hasExpandedCollapsedChangeRow = useMemo(
    () => Object.values(expandedCollapsedChangeRows).some(Boolean),
    [expandedCollapsedChangeRows],
  );
  const displayChanges = useMemo(
    () => toDisplayChanges(
      item.changes ?? [],
      fileChangeCandidateArgs,
      outputStats,
      outputDiffText,
      isExpanded || hasExpandedCollapsedChangeRow,
    ),
    [
      item.changes,
      fileChangeCandidateArgs,
      outputStats,
      outputDiffText,
      isExpanded,
      hasExpandedCollapsedChangeRow,
    ],
  );
  const changeStats = useMemo(
    () => collectChangeStats(displayChanges),
    [displayChanges],
  );
  const collapsedPreviewChange = useMemo(
    () => (!isExpanded && hasChanges ? displayChanges[0] : undefined),
    [isExpanded, hasChanges, displayChanges],
  );
  const collapsedPreviewMoreCount = useMemo(
    () => Math.max(0, (item.changes?.length ?? 0) - 1),
    [item.changes],
  );
  const filePath = useMemo(() => {
    if (!parsedArgs) return null;
    const path = getFirstStringField(parsedArgs, ['file_path', 'path', 'target_file', 'filename', 'notebook_path']);
    return path || null;
  }, [parsedArgs]);

  const fileName = filePath ? getFileName(filePath) : '';
  const imageViewPreviewSrc = useMemo(
    () =>
      (isImageViewTool
        ? resolveImageViewPreviewSrcFromTool(item.detail, item.output, item.title)
        : ''),
    [isImageViewTool, item.detail, item.output, item.title],
  );
  const imageViewFallbackLocalPath = useMemo(
    () =>
      (isImageViewTool
        ? resolveImageViewLocalPathFromTool(item.detail, item.output, item.title)
        : ''),
    [isImageViewTool, item.detail, item.output, item.title],
  );
  const isDirectory = filePath ? isDirectoryPath(filePath, fileName) : false;
  const isFile = filePath && !isDirectory;

  const omitFields = useMemo(() => new Set([
    'file_path', 'path', 'target_file', 'filename', 'notebook_path',
    'pattern', 'query', 'search_term',
    'command', 'cmd',
    'url',
    'description', 'workdir',
  ]), []);

  const otherParams = useMemo(() => {
    if (!parsedArgs) return [];
    return Object.entries(parsedArgs).filter(
      ([key, value]) => !omitFields.has(key) && value !== undefined && value !== null && value !== ''
    );
  }, [parsedArgs, omitFields]);

  const shouldShowDetails = otherParams.length > 0 && isExpanded;
  const isAskUserQuestionTool = toolName.toLowerCase() === "askuserquestion";
  const suppressPlanModeHintForClaude =
    isAskUserQuestionTool &&
    activeEngine === "claude" &&
    hasPendingUserInputRequest;
  const showPlanModeHint =
    isAskUserQuestionTool &&
    activeCollaborationModeId === "code" &&
    activeEngine !== "claude" &&
    !suppressPlanModeHintForClaude;
  const hasTaskDetails =
    shouldShowDetails ||
    (isExpanded && Boolean(item.output) && !hasChanges) ||
    (isExpanded && hasChanges && Boolean(item.changes)) ||
    (isExpanded && !shouldShowDetails && !item.output && !hasChanges && Boolean(item.detail)) ||
    showPlanModeHint ||
    (isImageViewTool && Boolean(imageViewPreviewSrc));
  const showCollapsedMultiFileRows =
    isFileChangeTool && !isExpanded && displayChanges.length > 1;
  const collapsedContainerClassName = `task-container${
    hasTaskDetails ? '' : ' task-container-collapsed'
  }${
    isFileChangeTool && !isExpanded ? ' tool-change-collapsed-card tool-change-stack-entry' : ''
  }`;
  const collapsedHeaderClassName = `task-header${
    isFileChangeTool && !isExpanded ? ' tool-change-stack-header' : ''
  }`;

  const handleClick = () => {
    if (isExitPlanTool) {
      onToggle(item.id);
      return;
    }
    if (isCollapsible) {
      setInternalExpanded(prev => !prev);
    } else {
      onToggle(item.id);
    }
  };

  if (isExitPlanTool && exitPlanContent) {
    return (
      <section
        className="tool-exit-plan-card"
        aria-label={exitPlanCopy.ariaLabel}
      >
        <div className={`tool-exit-plan-card-header${isExpanded ? ' is-expanded' : ''}`}>
          <button
            type="button"
            className="tool-exit-plan-card-toggle"
            onClick={handleClick}
            aria-expanded={isExpanded}
          >
            <div className="tool-exit-plan-card-title-wrap">
              <span
                className="codicon codicon-notebook tool-exit-plan-card-icon"
                aria-hidden
              />
              <div className="tool-exit-plan-card-title-copy">
                <span className="tool-exit-plan-card-title">
                  {exitPlanCopy.title}
                </span>
                <span className="tool-exit-plan-card-subtitle">
                  {exitPlanCopy.modeLabel}
                </span>
              </div>
            </div>
            <span
              className={`codicon ${isExpanded ? 'codicon-chevron-down' : 'codicon-chevron-right'} tool-exit-plan-card-chevron`}
              aria-hidden
            />
          </button>
          <div className="tool-exit-plan-card-header-actions">
            {exitPlanContent.planMarkdown ? (
              <button
                type="button"
                className={`tool-exit-plan-card-copy-button${copiedPlanMarkdown ? ' is-copied' : ''}`}
                title={copiedPlanMarkdown ? t("messages.copied") : t("messages.copy")}
                aria-label={copiedPlanMarkdown ? t("messages.copied") : t("messages.copy")}
                onClick={(event) => {
                  event.stopPropagation();
                  if (
                    typeof navigator === "undefined" ||
                    !navigator.clipboard ||
                    !exitPlanContent.planMarkdown
                  ) {
                    return;
                  }
                  void navigator.clipboard.writeText(exitPlanContent.planMarkdown)
                    .then(() => {
                      setCopiedPlanMarkdown(true);
                      window.setTimeout(() => setCopiedPlanMarkdown(false), 1800);
                    })
                    .catch(() => {
                      // clipboard errors are non-critical in restricted contexts
                    });
                }}
              >
                <span
                  className={`codicon ${copiedPlanMarkdown ? 'codicon-check' : 'codicon-copy'} tool-exit-plan-card-copy-icon`}
                  aria-hidden
                />
                <span className="tool-exit-plan-card-copy-label">
                  {copiedPlanMarkdown ? t("messages.copied") : t("messages.copy")}
                </span>
              </button>
            ) : null}
          </div>
        </div>

        {isExpanded ? (
          <div className="tool-exit-plan-card-body">
            {exitPlanContent.planMarkdown ? (
              <section className="tool-exit-plan-card-section">
                <div className="tool-exit-plan-card-section-label">
                  {exitPlanCopy.planSummary}
                </div>
                <div className="tool-exit-plan-card-markdown">
                  <Markdown
                    value={exitPlanContent.planMarkdown}
                    workspaceId={workspaceId}
                    preserveFormatting
                  />
                </div>
              </section>
            ) : null}

            <section className="tool-exit-plan-card-section">
              <div className="tool-exit-plan-card-section-label">
                {exitPlanCopy.executionHandoff}
              </div>
              <p className="tool-exit-plan-card-handoff-copy">
                {exitPlanCopy.executionHandoffDescription}
              </p>
            </section>

            {activeEngine === 'claude' && onExitPlanModeExecute ? (
              <section className="tool-exit-plan-card-section tool-exit-plan-card-execution-section">
                <div className="tool-exit-plan-card-section-label">
                  {exitPlanCopy.executionModeLabel}
                </div>
                <p className="tool-exit-plan-card-handoff-copy">
                  {exitPlanCopy.executionModeDescription}
                </p>
                <div className="tool-exit-plan-card-actions">
                  <button
                    type="button"
                    className={`tool-exit-plan-card-action is-default${
                      selectedExitPlanExecutionMode === 'default' ? ' is-selected' : ''
                    }`}
                    disabled={isExitPlanExecutionLocked}
                    onClick={() => {
                      if (isExitPlanExecutionLocked) {
                        return;
                      }
                      void onExitPlanModeExecute?.(item.id, 'default');
                    }}
                  >
                    <span
                      className="codicon codicon-shield tool-exit-plan-card-action-icon"
                      aria-hidden
                    />
                    <span>
                      {selectedExitPlanExecutionMode === 'default'
                        ? `${exitPlanCopy.executeDefaultAction} · 已选`
                        : exitPlanCopy.executeDefaultAction}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`tool-exit-plan-card-action is-primary${
                      selectedExitPlanExecutionMode === 'full-access' ? ' is-selected' : ''
                    }`}
                    disabled={isExitPlanExecutionLocked}
                    onClick={() => {
                      if (isExitPlanExecutionLocked) {
                        return;
                      }
                      void onExitPlanModeExecute?.(item.id, 'full-access');
                    }}
                  >
                    <span
                      className="codicon codicon-rocket tool-exit-plan-card-action-icon"
                      aria-hidden
                    />
                    <span>
                      {selectedExitPlanExecutionMode === 'full-access'
                        ? `${exitPlanCopy.executeFullAccessAction} · 已选`
                        : exitPlanCopy.executeFullAccessAction}
                    </span>
                  </button>
                </div>
              </section>
            ) : null}

            {exitPlanContent.planFilePath ? (
              <section className="tool-exit-plan-card-section">
                <div className="tool-exit-plan-card-section-label">
                  {exitPlanCopy.planFile}
                </div>
                <code
                  className="tool-exit-plan-card-path"
                  title={exitPlanContent.planFilePath}
                >
                  {exitPlanContent.planFilePath}
                </code>
              </section>
            ) : null}

            {shouldShowExitPlanRawOutput ? (
              <section className="tool-exit-plan-card-section">
                <div className="tool-exit-plan-card-section-label">
                  {exitPlanCopy.rawOutput}
                </div>
                <div className="tool-exit-plan-card-markdown">
                  <Markdown value={exitPlanContent.rawText} workspaceId={workspaceId} />
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  if (showCollapsedMultiFileRows) {
    return (
      <div className="tool-change-stack" role="group" aria-label="File changes">
        {displayChanges.map((change, index) => (
          (() => {
            const changeEntryKey = getChangeEntryKey(change.path, index);
            const isChangeExpanded = expandedCollapsedChangeRows[changeEntryKey] ?? false;
            return (
              <div
                key={changeEntryKey}
                className={`task-container tool-change-stack-entry${
                  isChangeExpanded ? '' : ' task-container-collapsed'
                }`}
              >
            <div
              className="task-header tool-change-stack-header"
              onClick={() => {
                setExpandedCollapsedChangeRows((prev) => ({
                  ...prev,
                  [changeEntryKey]: !prev[changeEntryKey],
                }));
              }}
              style={{
                cursor: 'pointer',
                borderBottom: isChangeExpanded ? '1px solid var(--border-primary)' : undefined,
              }}
            >
              <div className="task-title-section">
                <span className="codicon codicon-diff tool-title-icon tool-title-icon-file-change tool-title-icon-file-change-collapsed" />
                <span className="tool-title-text">{displayName}</span>
                <span className="tool-change-summary tool-change-summary-single">
                  <span className="tool-change-summary-count">{formatFileCountLabel(1)}</span>
                  <span className="diff-stat-add">+{change.diffStats.additions}</span>
                  <span className="diff-stat-del">-{change.diffStats.deletions}</span>
                  <span className="tool-change-collapsed-preview" title={change.path}>
                    <span className={`tool-change-kind-badge ${change.normalizedKind}`}>
                      {change.kindCode}
                    </span>
                    <FileIcon fileName={getFileName(change.path)} size={14} />
                    <span className="tool-change-collapsed-file-name">
                      {getFileName(change.path)}
                    </span>
                  </span>
                </span>
              </div>
              <div className={`tool-status-indicator ${status === 'failed' ? 'error' : status === 'completed' ? 'completed' : 'pending'}`} />
            </div>
                {isChangeExpanded && (
                  <div className="task-details tool-change-details" style={{ border: 'none' }}>
                    <div className="task-content-wrapper">
                      <div className="tool-change-entry">
                        <div className="tool-change-row">
                          <span className={`tool-change-kind-badge ${change.normalizedKind}`}>
                            {change.kindCode}
                          </span>
                          <FileIcon fileName={getFileName(change.path)} size={14} />
                          {onOpenDiffPath ? (
                            <button
                              type="button"
                              className="tool-change-file-name tool-change-file-link"
                              title={change.path}
                              onClick={(event) => {
                                event.stopPropagation();
                                try {
                                  onOpenDiffPath(change.path);
                                } catch {
                                  // Keep conversation interactive even if diff entry routing fails.
                                }
                              }}
                            >
                              {getFileName(change.path)}
                            </button>
                          ) : (
                            <span className="tool-change-file-name" title={change.path}>
                              {getFileName(change.path)}
                            </span>
                          )}
                          <span className="tool-change-file-diff-stats">
                            <span className="diff-stat-add">+{change.diffStats.additions}</span>
                            <span className="diff-stat-del">-{change.diffStats.deletions}</span>
                          </span>
                        </div>
                        {change.diffPreviewLines.length > 0 && (
                          <div className="tool-change-inline-diff edit-diff-viewer">
                            {change.diffPreviewLines.map((line, lineIndex) => {
                              const lineClass =
                                line.type === 'del'
                                  ? 'is-deleted'
                                  : line.type === 'add'
                                    ? 'is-added'
                                    : line.type === 'hunk' || line.type === 'meta'
                                      ? 'is-hunk'
                                      : '';
                              const sign =
                                line.type === 'del'
                                  ? '-'
                                  : line.type === 'add'
                                    ? '+'
                                    : line.type === 'hunk'
                                      ? ''
                                      : ' ';
                              const signNode =
                                line.type === 'hunk' ? (
                                  <span
                                    className="codicon codicon-diff tool-change-hunk-icon"
                                    aria-hidden
                                  />
                                ) : (
                                  sign
                                );
                              const content =
                                line.type === 'hunk'
                                  ? line.text
                                      .replace(/^@@\s*/, '')
                                      .replace(/\s*@@$/, '')
                                  : line.text;
                              return (
                                <div
                                  key={`${change.path}-${line.type}-${lineIndex}`}
                                  className={`edit-diff-line ${lineClass}`}
                                >
                                  <div className="edit-diff-gutter" />
                                  <div className={`edit-diff-sign ${lineClass}`}>{signNode}</div>
                                  <pre className="edit-diff-content">{content}</pre>
                                </div>
                              );
                            })}
                            {change.diffPreviewTruncated && (
                              <div className="tool-change-inline-diff-truncated">
                                Diff truncated…
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()
        ))}
      </div>
    );
  }

  return (
    <div className={collapsedContainerClassName}>
      <div
        className={collapsedHeaderClassName}
        onClick={handleClick}
        style={{
          cursor: isCollapsible || otherParams.length > 0 || item.output || hasChanges ? 'pointer' : 'default',
          borderBottom: isExpanded ? '1px solid var(--border-primary)' : undefined,
        }}
      >
        <div className="task-title-section">
          <span
            className={`codicon ${codiconClass} tool-title-icon${
              isFileChangeTool ? ' tool-title-icon-file-change' : ''
            }${
              isFileChangeTool && !isExpanded
                ? ' tool-title-icon-file-change-collapsed'
                : ''
            }`}
          />
          <span className="tool-title-text">{displayName}</span>
          {summary && (
            <span
              className="tool-title-summary"
              title={summary}
              style={(isFile || isDirectory) ? { display: 'inline-flex', alignItems: 'center', gap: '4px' } : undefined}
            >
              {(isFile || isDirectory) && (
                <FileIcon fileName={isDirectory ? fileName + '/' : fileName} size={14} />
              )}
              {summary}
            </span>
          )}
          {hasChanges && (
            <span
              className="tool-change-summary"
            >
              <span className="tool-change-summary-count">
                {formatFileCountLabel(item.changes?.length ?? 0)}
              </span>
              <span className="diff-stat-add">+{changeStats.additions}</span>
              <span className="diff-stat-del">-{changeStats.deletions}</span>
              {collapsedPreviewChange && (
                <span className="tool-change-collapsed-preview" title={collapsedPreviewChange.path}>
                  <FileIcon fileName={getFileName(collapsedPreviewChange.path)} size={14} />
                  <span className="tool-change-collapsed-file-name">
                    {getFileName(collapsedPreviewChange.path)}
                  </span>
                  {collapsedPreviewMoreCount > 0 && (
                    <span className="tool-change-collapsed-more">
                      +{collapsedPreviewMoreCount} more
                    </span>
                  )}
                </span>
              )}
            </span>
          )}
        </div>
        <div className={`tool-status-indicator ${status === 'failed' ? 'error' : status === 'completed' ? 'completed' : 'pending'}`} />
      </div>

      {shouldShowDetails && (
        <div className="task-details" style={{ border: 'none' }}>
          <div className="task-content-wrapper">
            {otherParams.map(([key, value]) => (
              <div key={key} className="task-field">
                <div className="task-field-label">{key}</div>
                <div className="task-field-content">
                  {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isExpanded && item.output && !hasChanges && (!isImageViewTool || !imageViewPreviewSrc) && (
        <div className="task-details" style={{ padding: '12px', border: 'none' }}>
          <div className="task-field-content tool-output-raw-shell" style={{ maxHeight: '300px', overflowY: 'auto', overflowX: 'auto' }}>
            <div className="tool-output-toolbar">
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
            <pre className="tool-output-raw-pre">{item.output}</pre>
          </div>
        </div>
      )}

      {isImageViewTool && imageViewPreviewSrc && (
        <div className="task-details" style={{ padding: '12px', border: 'none' }}>
          <div
            className="task-field-content"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <LocalImage
              src={imageViewPreviewSrc}
              workspaceId={workspaceId}
              localPath={imageViewFallbackLocalPath}
              alt={fileName || 'image preview'}
              loading="lazy"
              style={{ maxWidth: '100%', maxHeight: '240px', borderRadius: '8px' }}
            />
          </div>
        </div>
      )}

      {isExpanded && hasChanges && item.changes && (
        <div className="task-details tool-change-details" style={{ border: 'none' }}>
          <div className="task-content-wrapper">
            {displayChanges.map((change, index) => (
              <div key={`${change.path}-${index}`} className="tool-change-entry">
                <div className="tool-change-row">
                  <span className={`tool-change-kind-badge ${change.normalizedKind}`}>
                    {change.kindCode}
                  </span>
                  <FileIcon fileName={getFileName(change.path)} size={14} />
                  {onOpenDiffPath ? (
                    <button
                      type="button"
                      className="tool-change-file-name tool-change-file-link"
                      title={change.path}
                      onClick={(event) => {
                        event.stopPropagation();
                        try {
                          onOpenDiffPath(change.path);
                        } catch {
                          // Keep conversation interactive even if diff entry routing fails.
                        }
                      }}
                    >
                      {getFileName(change.path)}
                    </button>
                  ) : (
                    <span className="tool-change-file-name" title={change.path}>
                      {getFileName(change.path)}
                    </span>
                  )}
                  <span className="tool-change-file-diff-stats">
                    <span className="diff-stat-add">+{change.diffStats.additions}</span>
                    <span className="diff-stat-del">-{change.diffStats.deletions}</span>
                  </span>
                </div>
                {change.diffPreviewLines.length > 0 && (
                  <div className="tool-change-inline-diff edit-diff-viewer">
                    {change.diffPreviewLines.map((line, lineIndex) => {
                      const lineClass =
                        line.type === 'del'
                          ? 'is-deleted'
                          : line.type === 'add'
                            ? 'is-added'
                            : line.type === 'hunk' || line.type === 'meta'
                              ? 'is-hunk'
                              : '';
                      const sign =
                        line.type === 'del'
                          ? '-'
                          : line.type === 'add'
                            ? '+'
                            : line.type === 'hunk'
                              ? ''
                              : ' ';
                      const signNode =
                        line.type === 'hunk' ? (
                          <span
                            className="codicon codicon-diff tool-change-hunk-icon"
                            aria-hidden
                          />
                        ) : (
                          sign
                        );
                      const content =
                        line.type === 'hunk'
                          ? line.text
                              .replace(/^@@\s*/, '')
                              .replace(/\s*@@$/, '')
                          : line.text;
                      return (
                        <div
                          key={`${change.path}-${line.type}-${lineIndex}`}
                          className={`edit-diff-line ${lineClass}`}
                        >
                          <div className="edit-diff-gutter" />
                          <div className={`edit-diff-sign ${lineClass}`}>{signNode}</div>
                          <pre className="edit-diff-content">{content}</pre>
                        </div>
                      );
                    })}
                    {change.diffPreviewTruncated && (
                      <div className="tool-change-inline-diff-truncated">Diff truncated…</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isExpanded && !shouldShowDetails && !item.output && !hasChanges && item.detail && (
        <div className="task-details" style={{ padding: '12px', border: 'none' }}>
          <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>{item.detail}</pre>
        </div>
      )}

      {showPlanModeHint && (
        <div className="task-details" style={{ border: 'none' }}>
          <div className="task-content-wrapper">
            <div className="task-field-content">This feature requires Plan mode</div>
          </div>
        </div>
      )}
    </div>
  );
});

export default GenericToolBlock;
