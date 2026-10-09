"use client";

import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Menu from "lucide-react/dist/esm/icons/menu";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Pin from "lucide-react/dist/esm/icons/pin";
import Plus from "lucide-react/dist/esm/icons/plus";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import X from "lucide-react/dist/esm/icons/x";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { paginateThreads } from "@/components/application/ai-chat/repo-pagination";
import { ipc } from "@/lib/ipc";
import { useWorktreeStore } from "@/features/worktree/store";
import { WorktreeProgressRow } from "@/features/worktree/WorktreeProgressRow";
import type { AiChatRepo, AiChatThread, ThreadAction } from "@/components/application/ai-chat/sidebar-types";
import { useDragSource } from "@/features/chat/split/drag";
import { sessionFromThreadId } from "@/features/chat/split/store";
import { cx } from "@/utils/cx";

/** Streaming/unseen status dot on a thread row; renders nothing when the
 *  thread is neither streaming nor waiting to be seen. */
function ThreadStatusDot({
  streaming,
  retrying,
  unseen,
}: {
  streaming: boolean;
  retrying: boolean;
  unseen: boolean;
}) {
  const { t } = useTranslation();
  if (streaming) {
    return (
      <span
        className={cx(
          "sidebar-thread-status sidebar-thread-status-processing",
          retrying && "sidebar-thread-status-retrying",
        )}
        role="status"
        aria-label={t("chat.sessionRunning")}
        title={t("chat.sessionRunning")}
      />
    );
  }
  if (unseen) {
    return (
      <span
        className="sidebar-thread-status sidebar-thread-status-unseen"
        aria-label={t("chat.sessionUnseen")}
        title={t("chat.sessionUnseen")}
      />
    );
  }
  return null;
}

/** Row-hover actions (pin / rename / delete). Drafts only offer delete. */
function ThreadHoverActions({
  id,
  pinned,
  isDraft,
  onAction,
}: {
  id: string;
  pinned: boolean;
  isDraft: boolean;
  onAction?: (id: string, action: ThreadAction) => void;
}) {
  const { t } = useTranslation();
  if (!onAction) return null;
  const iconClass = "text-foreground-icon-secondary hover:text-foreground-icon-primary";
  return (
    <span className="hidden shrink-0 items-center gap-1.5 group-hover:inline-flex">
      {!isDraft && (
        <button
          type="button"
          aria-label={pinned ? t("chat.unpin") : t("chat.pin")}
          onClick={(event) => {
            event.stopPropagation();
            onAction(id, "pin");
          }}
          className={iconClass}
        >
          <Pin className="size-3.5" aria-hidden />
        </button>
      )}
      {!isDraft && (
        <button
          type="button"
          aria-label={t("chat.renameSession")}
          onClick={(event) => {
            event.stopPropagation();
            onAction(id, "rename");
          }}
          className={iconClass}
        >
          <Pencil className="size-3.5" aria-hidden />
        </button>
      )}
      <button
        type="button"
        aria-label={t("chat.deleteSession")}
        onClick={(event) => {
          event.stopPropagation();
          onAction(id, "delete");
        }}
        className={iconClass}
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}

/** Chat row under an open repo — indented 36px, relative-time chip on the
 *  right, hover action icons (pin / rename / delete; archive lives in the
 *  right-click menu only). */
function ThreadItem({
  id,
  label,
  engine,
  time,
  pinned = false,
  isSelected = false,
  streaming = false,
  retrying = false,
  unseen = false,
  isDraft = false,
  tabIndex,
  onSelect,
  onAction,
  onContextMenu,
}: AiChatThread & {
  tabIndex?: number;
  onSelect?: (id: string) => void;
  onAction?: (id: string, action: ThreadAction) => void;
  /** Right-click anywhere on the row: opens the thread context menu. */
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>, id: string) => void;
}) {
  // 拖到中心区 = 分屏（边=切分到那一侧，中心=替换/互换）：会话在按下时才查，
  // 免得每一行都订阅整个会话列表。
  const startDrag = useDragSource(
    useCallback(() => {
      const session = sessionFromThreadId(id);
      return session ? { kind: "session" as const, session, label } : null;
    }, [id, label]),
  );
  return (
    <div
      onContextMenu={
        id && onContextMenu ? (event) => onContextMenu(event, id) : undefined
      }
      className={cx(
        "group flex w-full cursor-pointer items-center gap-2.5 rounded-2lg py-[5px] pr-2 pl-9 transition-colors duration-150 ease",
        isSelected ? "bg-background-secondary-hover" : "hover:bg-background-secondary-hover",
      )}
    >
      {/* The row body is the button; hover actions sit beside it so no
          control nests inside another. */}
      <button
        type="button"
        tabIndex={tabIndex}
        aria-current={isSelected ? "page" : undefined}
        onPointerDown={startDrag}
        onClick={() => id && onSelect?.(id)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left"
      >
        {engine && (
          <EngineIcon
            engine={engine}
            size={12}
            className="size-3 shrink-0 text-foreground-icon-secondary"
          />
        )}
        <ThreadStatusDot streaming={streaming} retrying={retrying} unseen={unseen} />
        {/* Native title tooltip: hover a moment to read the full title when
            the row truncates it (same pattern as the repo row below). */}
        <span
          className="min-w-0 flex-1 truncate text-body-2-medium text-text-secondary"
          title={label}
        >
          {pinned && (
            <Pin
              fill="currentColor"
              className="mr-1 inline size-3 text-foreground-icon-secondary"
              aria-hidden
            />
          )}
          {label}
        </span>
      </button>
      {id && (
        <ThreadHoverActions id={id} pinned={pinned} isDraft={isDraft} onAction={onAction} />
      )}
      {time ? (
        <span className="inline-flex shrink-0 items-center justify-center rounded-sm bg-background-tertiary-default px-1 py-px text-caption-2-medium whitespace-nowrap text-text-secondary group-hover:hidden">
          {time}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Curved tree connector (Figma "Vector 132"): a vertical guide dropping from
 * the repo's folder icon with a rounded elbow into each thread row.
 */
function TreeConnector({ count }: { count: number }) {
  // Rows are 28px tall (py-[5px] + 18px line-height) with a 2px gap,
  // and the container's pt-0.5 pushes the first row down 2px.
  const rowPitch = 30; // 28px row + 2px gap
  const firstCenter = 16; // 2px container padding + half of the 28px row
  const height = firstCenter + rowPitch * (count - 1) + 1;
  return (
    <svg
      aria-hidden
      width="12"
      height={height}
      viewBox={`0 0 12 ${height}`}
      fill="none"
      className="pointer-events-none absolute top-0 left-[16.5px] text-foreground-icon-quaternary"
    >
      {Array.from({ length: count }, (_, i) => {
        const y = firstCenter + rowPitch * i;
        return (
          <path
            key={y}
            d={`M0.5 0 V${y - 5} Q0.5 ${y} 5.5 ${y} H11.5`}
            stroke="currentColor"
            strokeWidth="1"
          />
        );
      })}
    </svg>
  );
}

/** Immediate drag entry attached to a repo row's grip handle. */
interface DragHandleProps {
  onPointerDown: (event: ReactPointerEvent) => void;
}

/** The repo row itself: merged folder/reorder-grip button, label, hover
 *  actions (new session / remove) and the thread count chip. Right-click
 *  bubbles to the workspace context menu via `onContextMenu`. */
function RepoHeaderRow({
  repo,
  expanded,
  isDragging,
  dragHandleProps,
  hasHoverActions,
  dragDownPos,
  onToggleOpen,
  onNewSession,
  onRemove,
  onContextMenu,
}: {
  repo: AiChatRepo;
  expanded: boolean;
  isDragging: boolean;
  dragHandleProps: DragHandleProps | null;
  hasHoverActions: boolean;
  /** Pointer-down position on the merged folder/grip button: a press that
   *  travels past the threshold is a reorder drag, so its trailing click must
   *  not toggle the row. */
  dragDownPos: { current: { x: number; y: number } | null };
  onToggleOpen: () => void;
  onNewSession?: (id: string) => void;
  onRemove?: (id: string) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const Icon = expanded ? FolderOpen : FolderSymlink;
  const collapseLabel = expanded ? t("chat.collapseWorkspace") : t("chat.expandWorkspace");
  // 工作区多目录:主目录 + 附加根。只有多于一个时才显示多根标识,单目录
  // 行与旧行为一致(不多一个 chip)。
  const rootCount = 1 + (repo.roots?.length ?? 0);
  return (
    <div
      onContextMenu={onContextMenu}
      className="group flex w-full cursor-pointer items-center gap-2 rounded-2lg p-2 transition-colors duration-150 ease hover:bg-background-secondary-hover"
    >
      <button
        type="button"
        aria-label={collapseLabel}
        title={dragHandleProps ? t("chat.dragToReorder") : collapseLabel}
        onPointerDown={(event) => {
          if (!dragHandleProps) return;
          event.stopPropagation();
          dragDownPos.current = { x: event.clientX, y: event.clientY };
          dragHandleProps.onPointerDown(event);
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (dragDownPos.current) {
            const dx = Math.abs(event.clientX - dragDownPos.current.x);
            const dy = Math.abs(event.clientY - dragDownPos.current.y);
            dragDownPos.current = null;
            if (dx + dy > 4) return;
          }
          onToggleOpen();
        }}
        className={cx(
          "relative -m-0.5 size-6 shrink-0 cursor-pointer rounded-md transition-colors duration-150 hover:bg-background-tertiary-hover/55",
          dragHandleProps && "group-hover:cursor-grab",
          isDragging && "cursor-grabbing",
        )}
      >
        {/* One slot, two affordances: folder by default; on row hover it
            fades out and the reorder grip fades in (when reorder is
            enabled). Plain click toggles collapse; press-and-move drags. */}
        <span
          className={cx(
            "absolute inset-0 flex items-center justify-center transition-opacity duration-150",
            dragHandleProps && "group-hover:opacity-0",
          )}
          aria-hidden
        >
          <Icon className="size-4 text-foreground-icon-secondary" />
        </span>
        {dragHandleProps && (
          <span
            className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            aria-hidden
          >
            <Menu className="size-4 text-foreground-icon-secondary group-hover:text-foreground-icon-primary" />
          </span>
        )}
      </button>
      {/* Row body toggles as its own button, keeping the folder/drag handle
          and hover actions as sibling controls instead of nested ones. */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggleOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center text-left"
      >
        <span
          title={repo.originalLabel}
          className="truncate text-body-2-medium whitespace-nowrap text-text-secondary"
        >
          {repo.label}
        </span>
        {repo.labelSuffix && (
          <span className="ws-label-badge ml-1.5 shrink-0">
            {repo.labelSuffix}
          </span>
        )}
        {rootCount > 1 && (
          <span
            className="ml-1.5 shrink-0 rounded-sm bg-background-tertiary-default px-1 py-px text-caption-2-medium text-text-tertiary"
            title={t("chat.multiRootBadgeTooltip", { count: rootCount })}
          >
            {t("chat.multiRootBadge", { count: rootCount })}
          </span>
        )}
      </button>
      {hasHoverActions && (
        <span className="ml-auto hidden shrink-0 items-center gap-1.5 group-hover:inline-flex">
          {repo.id && onNewSession && (
            <button
              type="button"
              aria-label={t("chat.newSession")}
              title={t("chat.newSession")}
              onClick={(event) => {
                event.stopPropagation();
                onNewSession(repo.id!);
              }}
              className="cursor-pointer text-foreground-icon-secondary hover:text-foreground-icon-primary"
            >
              <Plus className="size-4" aria-hidden />
            </button>
          )}
          {repo.id && onRemove && (
            <button
              type="button"
              aria-label={t("chat.removeWorkspace")}
              title={t("chat.removeWorkspace")}
              onClick={(event) => {
                event.stopPropagation();
                onRemove(repo.id!);
              }}
              className="cursor-pointer text-foreground-icon-secondary hover:text-foreground-icon-primary"
            >
              <X className="size-4" aria-hidden />
            </button>
          )}
        </span>
      )}
      <span
        className={cx(
          "text-caption-2-medium text-text-tertiary",
          hasHoverActions ? "group-hover:hidden" : "ml-auto",
        )}
      >
        {repo.threads.length}
      </span>
    </div>
  );
}

/** A worktree child row: branch icon + branch label + optional PR badge;
 *  click toggles its own thread list, right-click opens the workspace menu
 *  (which renders worktree entries for it). */
function WorktreeChildRow({
  repo,
  expanded,
  active,
  onToggleOpen,
  onNewSession,
  onContextMenu,
}: {
  repo: AiChatRepo;
  expanded: boolean;
  /** This worktree owns the active session. */
  active: boolean;
  onToggleOpen: () => void;
  /** Per-row + button: start a new chat in this worktree workspace. */
  onNewSession?: (workspaceId: string) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const { t } = useTranslation();
  const missing = useWorktreeStore((s) =>
    repo.path ? s.missingPaths[repo.path] === true : false,
  );
  // 收起时把线程运行状态聚合到本行（展开时各线程行自己带状态点）：任一
  // 线程流式中即显示呼吸点；全部流式线程都在退避重试时降为静态点，与会
  // 话行 / 页签同一套 `sidebar-thread-status` 视觉语言。
  const running = repo.threads.some((th) => th.streaming);
  const retrying = running && repo.threads.every((th) => !th.streaming || th.retrying);
  return (
    <div
      onContextMenu={onContextMenu}
      className={cx(
        "group flex w-full cursor-pointer items-center gap-1 rounded-2lg py-[5px] pr-2 pl-4 transition-colors duration-150 ease",
        active ? "bg-background-secondary-hover" : "hover:bg-background-secondary-hover",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={repo.worktree?.branch}
        title={repo.originalLabel}
        onClick={onToggleOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
      >
        <ChevronRight
          aria-hidden
          className={cx(
            "size-3.5 shrink-0 text-foreground-icon-secondary transition-transform duration-150",
            expanded && "rotate-90",
          )}
        />
        <GitBranch aria-hidden className="size-3.5 shrink-0 text-foreground-icon-tertiary" />
        {!expanded && running && (
          <ThreadStatusDot streaming retrying={retrying} unseen={false} />
        )}
        <span className="min-w-0 flex-1 truncate text-body-2-medium text-text-secondary">
          {repo.label}
        </span>
        {repo.worktree?.prNumber != null && (
          <span className="shrink-0 rounded-sm bg-status-purple-background px-1 py-px text-caption-2-medium text-status-purple-text">
            {t("worktree.prBadge", { number: repo.worktree.prNumber })}
          </span>
        )}
        {missing && (
          <span
            className="shrink-0 rounded-sm bg-status-rose-background px-1 py-px text-caption-2-medium text-status-rose-text"
            title={t("worktree.missingDirectoryHint")}
          >
            {t("worktree.missingDirectory")}
          </span>
        )}
      </button>
      {repo.id && onNewSession && (
        <button
          type="button"
          aria-label={t("chat.newSession")}
          title={t("chat.newSession")}
          onClick={(event) => {
            event.stopPropagation();
            onNewSession(repo.id!);
          }}
          className="hidden shrink-0 cursor-pointer items-center text-foreground-icon-secondary group-hover:inline-flex hover:text-foreground-icon-primary"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** 「WORKTREES · n」分组：父工作区展开区内的子工作区列表 + 进行中的创建
 *  进度行。组折叠态与各子行展开态都可持久化（后者复用侧栏的展开集），
 *  两层的展开/收起都走 `SidebarDisclosure` 的高度动画（不再条件渲染直接
 *  闪现）。没有 worktree 也没有进行中创建时不渲染——首个创建入口在右键
 *  菜单。 */
function WorktreeGroup({
  parent,
  activeThreadId,
  isRepoExpanded,
  onToggleRepo,
  onThreadSelect,
  onThreadAction,
  onThreadContextMenu,
  onRepoContextMenu,
  onNewWorktree,
  onNewSession,
}: {
  parent: AiChatRepo;
  activeThreadId?: string;
  isRepoExpanded: (repo: AiChatRepo) => boolean;
  onToggleRepo: (repo: AiChatRepo) => void;
  onThreadSelect?: (id: string) => void;
  onThreadAction?: (id: string, action: ThreadAction) => void;
  onThreadContextMenu?: (event: ReactMouseEvent<HTMLElement>, id: string) => void;
  onRepoContextMenu?: (event: ReactMouseEvent<HTMLElement>, workspaceId: string) => void;
  onNewWorktree?: (workspaceId: string) => void;
  /** Per-worktree + button: start a new chat in that worktree workspace. */
  onNewSession?: (workspaceId: string) => void;
}) {
  const { t } = useTranslation();
  const children = parent.worktrees ?? [];
  const parentId = parent.id;
  // 选原始数组（引用稳定），filter 放 useMemo：selector 返回新建数组会让
  // zustand 的 getSnapshot 缓存检查报无限循环。
  const allPending = useWorktreeStore((s) => s.pending);
  const pending = useMemo(
    () => allPending.filter((p) => p.parentWorkspaceId === parentId),
    [allPending, parentId],
  );
  const collapsed = useWorktreeStore((s) => (parentId ? s.collapsedGroups[parentId] === true : false));
  const toggleGroupCollapsed = useWorktreeStore((s) => s.toggleGroupCollapsed);

  // 采一次 worktree 列表拿 locked / prunable 状态（右键菜单禁用删除、
  // 子行「目录已丢失」徽标用）。
  const childPathsKey = children.map((c) => c.path ?? "").join("|");
  useEffect(() => {
    if (collapsed) return;
    if (parent.path) {
      void ipc
        .gitWorktreeList(parent.path)
        .then((list) => {
          const locked: Record<string, string> = {};
          const missing: Record<string, true> = {};
          for (const w of list) {
            if (w.locked) locked[w.path] = w.lockReason ?? "";
            if (w.prunable && !w.isMain) missing[w.path] = true;
          }
          useWorktreeStore.getState().setGitStates(locked, missing);
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 用路径串代替数组引用
  }, [childPathsKey, collapsed, parent.path]);

  if (children.length === 0 && pending.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-0.5 pt-0.5">
      <div className="group flex w-full items-center gap-1 rounded-2lg py-[5px] pr-2 pl-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() => parentId && toggleGroupCollapsed(parentId)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-left"
        >
          <ChevronRight
            aria-hidden
            className={cx(
              "size-3 shrink-0 text-foreground-icon-secondary transition-transform duration-150",
              !collapsed && "rotate-90",
            )}
          />
          <span className="min-w-0 flex-1 truncate text-caption-1-medium text-text-tertiary">
            {t("worktree.groupLabel", { count: children.length })}
          </span>
        </button>
        {parentId && onNewWorktree && (
          <button
            type="button"
            aria-label={t("worktree.newWorktree")}
            title={t("worktree.newWorktree")}
            onClick={() => onNewWorktree(parentId)}
            className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary transition-colors duration-150 hover:bg-background-tertiary-hover/55 hover:text-foreground-icon-primary"
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        )}
      </div>
      <SidebarDisclosure expanded={!collapsed}>
        <div className="flex w-full flex-col gap-0.5">
          {pending.map((p) => (
            <WorktreeProgressRow key={p.creationId} pending={p} />
          ))}
          {children.map((child) => {
            const expanded = isRepoExpanded(child);
            return (
              <div key={child.id ?? child.label} className="flex w-full flex-col">
                <WorktreeChildRow
                  repo={child}
                  expanded={expanded}
                  active={child.threads.some((th) => th.id === activeThreadId)}
                  onToggleOpen={() => onToggleRepo(child)}
                  onNewSession={onNewSession}
                  onContextMenu={
                    onRepoContextMenu && child.id
                      ? (event) => onRepoContextMenu(event, child.id!)
                      : undefined
                  }
                />
                <div className="ml-4">
                  <RepoThreadList
                    expanded={expanded}
                    threads={child.threads}
                    threadLimit={child.threadLimit}
                    activeThreadId={activeThreadId}
                    onThreadSelect={onThreadSelect}
                    onThreadAction={onThreadAction}
                    onThreadContextMenu={onThreadContextMenu}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SidebarDisclosure>
    </div>
  );
}

/** Sidebar disclosure close animation length. Content unmounts when it ends,
 *  so the next expand remounts thread pagination at page 0. */
const SIDEBAR_COLLAPSE_MS = 300;

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Height disclosure shared by the sidebar's expandable regions (repo thread
 *  lists, the WORKTREES group): the grid track goes 1fr ⇄ 0fr so the region's
 *  real box grows and shrinks and the rows below are pushed smoothly.
 *  Content stays mounted until the close animation ends (instant unmount
 *  pops; unmount + opacity fade leaves a compositor ghost), then drops out of
 *  the DOM and the a11y tree. Reduced motion cuts straight to the end. */
function SidebarDisclosure({
  expanded,
  children,
}: {
  expanded: boolean;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(expanded);
  useLayoutEffect(() => {
    if (expanded) {
      setMounted(true);
      return;
    }
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const timeout = window.setTimeout(() => setMounted(false), SIDEBAR_COLLAPSE_MS);
    return () => window.clearTimeout(timeout);
  }, [expanded]);

  return (
    <div
      aria-hidden={!expanded}
      {...(!expanded ? { inert: "" } : {})}
      className={cx(
        "grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none",
        expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
      )}
    >
      <div className="min-h-0 overflow-hidden">{mounted ? children : null}</div>
    </div>
  );
}

/** The collapsible thread area under a repo row, animated by
 *  `SidebarDisclosure` (height clips shut, no opacity fade). */
function RepoThreadList({
  expanded,
  threads,
  threadLimit,
  activeThreadId,
  onThreadSelect,
  onThreadAction,
  onThreadContextMenu,
  trailing,
}: {
  expanded: boolean;
  threads: AiChatThread[];
  threadLimit?: number;
  activeThreadId?: string;
  onThreadSelect?: (id: string) => void;
  onThreadAction?: (id: string, action: ThreadAction) => void;
  onThreadContextMenu?: (event: ReactMouseEvent<HTMLElement>, id: string) => void;
  /** Rendered after the thread rows inside the same collapse animation (the
   *  parent repo's WORKTREES group), so it folds away with the threads. */
  trailing?: ReactNode;
}) {
  return (
    <SidebarDisclosure expanded={expanded}>
      <PagedThreadList
        expanded={expanded}
        threads={threads}
        threadLimit={threadLimit}
        activeThreadId={activeThreadId}
        onThreadSelect={onThreadSelect}
        onThreadAction={onThreadAction}
        onThreadContextMenu={onThreadContextMenu}
      />
      {trailing}
    </SidebarDisclosure>
  );
}

/** Paged thread rows with the tree connector and the show-more/fewer
 *  pagination buttons. The parent keeps this instance mounted throughout
 *  the close animation, then unmounts it; the next expand therefore starts
 *  at page 0 without changing page or connector height mid-collapse. */
function PagedThreadList({
  expanded,
  threads,
  threadLimit,
  activeThreadId,
  onThreadSelect,
  onThreadAction,
  onThreadContextMenu,
}: {
  expanded: boolean;
  threads: AiChatThread[];
  threadLimit?: number;
  activeThreadId?: string;
  onThreadSelect?: (id: string) => void;
  onThreadAction?: (id: string, action: ThreadAction) => void;
  onThreadContextMenu?: (event: ReactMouseEvent<HTMLElement>, id: string) => void;
}) {

  const { t } = useTranslation();
  // Pagination: 0 = 初始 limit 条, 1 = +50 条, 2 = 全部。收起动画结束前组件保持
  // 挂载，重开后重新挂载即从 page 0 开始；动画期间快速重开时在 render 中直接
  // 调整（React 推荐的 adjust-state-during-render 模式，effect 会先闪一帧旧页）。
  const [page, setPage] = useState(0);
  const [prevExpanded, setPrevExpanded] = useState(expanded);
  if (prevExpanded !== expanded) {
    setPrevExpanded(expanded);
    if (expanded) setPage(0);
  }
  const { visibleThreads, hiddenCount } = paginateThreads(threads, threadLimit, page);
  const pageButtonClasses =
    "flex w-full cursor-pointer items-center rounded-2lg py-[5px] pr-2 pl-4 text-caption-1-medium text-text-tertiary transition-colors duration-150 ease hover:bg-background-secondary-hover hover:text-text-secondary";
  return (
    <div className="relative flex w-full flex-col gap-0.5 pt-0.5">
      <TreeConnector count={visibleThreads.length} />
      {visibleThreads.map((thread) => (
        <ThreadItem
          key={thread.id ?? thread.label}
          {...thread}
          isSelected={thread.id ? thread.id === activeThreadId : thread.isSelected}
          onSelect={onThreadSelect}
          onAction={onThreadAction}
          onContextMenu={onThreadContextMenu}
        />
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setPage((value) => value + 1)}
          className={pageButtonClasses}
        >
          <span className="truncate">{t("chat.showMoreSessions")}</span>
        </button>
      ) : null}
      {page > 0 ? (
        <button
          type="button"
          onClick={() => setPage(0)}
          className={pageButtonClasses}
        >
          {t("chat.showFewerSessions")}
        </button>
      ) : null}
    </div>
  );
}

/** Expandable repo folder: clicking the row (or the folder icon) toggles the
 *  thread list; row hover reveals per-row actions — new session, drag
 *  handle (press to reorder, no long-press), remove. */
export function RepoItem({
  repo,
  open,
  onToggleOpen,
  activeThreadId,
  onThreadSelect,
  onThreadAction,
  onThreadContextMenu,
  onRemove,
  onNewSession,
  onContextMenu,
  onRepoContextMenu,
  onNewWorktree,
  isRepoExpanded,
  onToggleRepo,
  isDragging = false,
  dragHandleProps = null,
}: {
  repo: AiChatRepo;
  /** Expanded state, owned by the sidebar so it can persist across restarts. */
  open: boolean;
  onToggleOpen?: () => void;
  activeThreadId?: string;
  onThreadSelect?: (id: string) => void;
  onThreadAction?: (id: string, action: ThreadAction) => void;
  /** Right-click on a thread row: opens the thread context menu. */
  onThreadContextMenu?: (event: ReactMouseEvent<HTMLElement>, id: string) => void;
  onRemove?: (id: string) => void;
  /** Per-row + button: start a new chat in this workspace. */
  onNewSession?: (id: string) => void;
  /** Right-click on the repo header row: opens the workspace menu. */
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
  /** Right-click on a worktree child row: same menu, worktree entries. */
  onRepoContextMenu?: (event: ReactMouseEvent<HTMLElement>, workspaceId: string) => void;
  /** WORKTREES group ＋ button: open the create dialog for this repo. */
  onNewWorktree?: (workspaceId: string) => void;
  /** Expansion state accessors for worktree child rows (sidebar-owned). */
  isRepoExpanded?: (repo: AiChatRepo) => boolean;
  onToggleRepo?: (repo: AiChatRepo) => void;
  /** Drag-handle reorder in progress for this row. */
  isDragging?: boolean;
  /** Immediate drag entry attached to the row's grip handle. */
  dragHandleProps?: DragHandleProps | null;
}) {
  const dragDownPos = useRef<{ x: number; y: number } | null>(null);
  const expanded = open;
  const toggleOpen = useCallback(() => onToggleOpen?.(), [onToggleOpen]);
  const hasHoverActions = Boolean(
    (repo.id && onNewSession) || dragHandleProps || (repo.id && onRemove),
  );

  return (
    <div className="flex w-full flex-col">
      <RepoHeaderRow
        repo={repo}
        expanded={expanded}
        isDragging={isDragging}
        dragHandleProps={dragHandleProps}
        hasHoverActions={hasHoverActions}
        dragDownPos={dragDownPos}
        onToggleOpen={toggleOpen}
        onNewSession={onNewSession}
        onRemove={onRemove}
        onContextMenu={onContextMenu}
      />
      <RepoThreadList
        expanded={expanded}
        threads={repo.threads}
        threadLimit={repo.threadLimit}
        activeThreadId={activeThreadId}
        onThreadSelect={onThreadSelect}
        onThreadAction={onThreadAction}
        onThreadContextMenu={onThreadContextMenu}
        trailing={
          isRepoExpanded && onToggleRepo ? (
            <WorktreeGroup
              parent={repo}
              activeThreadId={activeThreadId}
              isRepoExpanded={isRepoExpanded}
              onToggleRepo={onToggleRepo}
              onThreadSelect={onThreadSelect}
              onThreadAction={onThreadAction}
              onThreadContextMenu={onThreadContextMenu}
              onRepoContextMenu={onRepoContextMenu}
              onNewWorktree={onNewWorktree}
              onNewSession={onNewSession}
            />
          ) : undefined
        }
      />
    </div>
  );
}
