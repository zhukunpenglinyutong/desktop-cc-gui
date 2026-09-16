"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Reorder, useDragControls, type DragControls } from "motion/react";

/**
 * Workspace reorder via a dedicated drag handle on the repo row, built on
 * motion's Reorder: pressing the handle starts the drag immediately (no
 * long-press), the dragged row follows the pointer, siblings spring to their
 * new slots, and the row settles with inertia on drop. Plain clicks elsewhere
 * on the row keep working as the expand-collapse toggle.
 *
 * Cross-section moves: while dragging, the row is pointer-events-none and
 * the element under the pointer is resolved against the sidebar's
 * `[data-workspace-drop-target]` containers (group sections, the ungrouped
 * block, the 已归档 section). Releasing over one fires onDropToSection
 * instead of committing an in-list reorder; dropping on the row's own
 * section stays a plain reorder.
 */

/** DOM marker on sidebar containers that accept a dragged workspace row;
 *  value "" = the ungrouped section. */
export const WORKSPACE_DROP_TARGET_ATTR = "data-workspace-drop-target";
/** Highlight attribute toggled on the hovered drop container mid-drag;
 *  styled via Tailwind's `data-[drop-hover=true]:` variant. */
const DROP_HOVER_ATTR = "data-drop-hover";

export interface RepoDragChrome {
  /** Drag in progress for this row. */
  isDragging: boolean;
  /**
   * Attach to the row's drag handle: a primary-button press starts the drag
   * right away, so the handle must stopPropagation its own click to keep it
   * from reaching the row's toggle handler.
   */
  dragHandleProps: {
    onPointerDown: (event: ReactPointerEvent) => void;
  } | null;
}

interface SortableRowProps<T extends { id?: string }> {
  item: T;
  canReorder: boolean;
  /** Section this list renders (null = ungrouped); a drop resolving to the
   *  same section is a plain reorder, not a move. */
  sectionId: string | null;
  renderItem: (item: T, drag: RepoDragChrome | null) => ReactNode;
  onArm: () => void;
  /** Commit the current preview order if it differs from the base order. */
  onCommit: () => void;
  /** Drag ended without a reorder (handle pressed but never moved). */
  onAbort: () => void;
  /** Drop resolved to another section container (null target = ungrouped);
   *  null prop = cross-section drops disabled. */
  onGroupDrop: ((targetSectionId: string | null) => void) | null;
}

function SortableRow<T extends { id?: string }>({
  item,
  canReorder,
  sectionId,
  renderItem,
  onArm,
  onCommit,
  onAbort,
  onGroupDrop,
}: SortableRowProps<T>) {
  const controls: DragControls = useDragControls();
  const draggingRef = useRef(false);
  const dragEndedRef = useRef(false);
  const suppressClickRef = useRef(false);
  // Removes the gesture's window listeners when the row unmounts mid-drag.
  const gestureCleanupRef = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);
  // Drop target resolved on release ({ target: null } = the ungrouped
  // section); consumed by endDrag only when the drag actually moved.
  const groupDropRef = useRef<{ target: string | null } | null>(null);
  const dropHoverElRef = useRef<Element | null>(null);
  const clearDropHover = useCallback(() => {
    dropHoverElRef.current?.removeAttribute(DROP_HOVER_ATTR);
    dropHoverElRef.current = null;
  }, []);

  const endDrag = useCallback(
    (commit: boolean) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      clearDropHover();
      // A click without movement never counts as a section drop: motion
      // skips onDragEnd for those, so commit=false lands here instead.
      const groupDrop = commit ? groupDropRef.current : null;
      groupDropRef.current = null;
      if (groupDrop) {
        // Reset the in-list preview order; the parent moves the workspace.
        onAbort();
        onGroupDrop?.(groupDrop.target);
      } else if (commit) {
        onCommit();
      } else {
        onAbort();
      }
      // Swallow the click the browser fires after the gesture so it never
      // doubles as a row toggle.
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    },
    [onAbort, onCommit, onGroupDrop, clearDropHover],
  );

  // Keep the latest callback reachable from the pointer handlers without
  // re-binding window listeners on every render.
  const endDragRef = useRef(endDrag);
  useEffect(() => {
    endDragRef.current = endDrag;
  });
  useEffect(
    () => () => {
      gestureCleanupRef.current?.();
    },
    [],
  );

  const dragHandleProps = useMemo<RepoDragChrome["dragHandleProps"]>(() => {
    if (!canReorder) return null;
    return {
      onPointerDown: (event: ReactPointerEvent) => {
        if (event.button !== 0 || draggingRef.current) return;
        draggingRef.current = true;
        dragEndedRef.current = false;
        suppressClickRef.current = true;
        setDragging(true);
        onArm();
        controls.start(event.nativeEvent);

        const pointerId = event.pointerId;
        // The dragged row is pointer-events-none, so the element under the
        // pointer is whatever the row hovers over. "" resolves to null (the
        // ungrouped section); the row's own section never counts as a move.
        const resolveDropTarget = (x: number, y: number) => {
          const el =
            document.elementFromPoint(x, y)?.closest(`[${WORKSPACE_DROP_TARGET_ATTR}]`) ??
            null;
          if (!el) return null;
          const attr = el.getAttribute(WORKSPACE_DROP_TARGET_ATTR);
          const target = attr === "" ? null : attr;
          return target === sectionId ? null : { el, target };
        };
        const onPointerMove = onGroupDrop
          ? (moveEvent: PointerEvent) => {
              if (moveEvent.pointerId !== pointerId) return;
              const hit = resolveDropTarget(moveEvent.clientX, moveEvent.clientY);
              const el = hit?.el ?? null;
              if (el === dropHoverElRef.current) return;
              clearDropHover();
              if (el) {
                dropHoverElRef.current = el;
                el.setAttribute(DROP_HOVER_ATTR, "true");
              }
            }
          : null;
        if (onPointerMove) window.addEventListener("pointermove", onPointerMove);
        const onPointerUp = (upEvent: PointerEvent) => {
          if (upEvent.pointerId !== pointerId) return;
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);
          if (onPointerMove) window.removeEventListener("pointermove", onPointerMove);
          gestureCleanupRef.current = null;
          if (onGroupDrop) {
            const hit = resolveDropTarget(upEvent.clientX, upEvent.clientY);
            groupDropRef.current = hit ? { target: hit.target } : null;
          }
          // motion fires onDragEnd (post-render) when the drag actually
          // moved; fall back to a plain reset when the handle was pressed
          // but never dragged.
          window.setTimeout(() => {
            if (!dragEndedRef.current) endDragRef.current(false);
          }, 120);
        };
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerUp);
        gestureCleanupRef.current = () => {
          window.removeEventListener("pointerup", onPointerUp);
          window.removeEventListener("pointercancel", onPointerUp);
          if (onPointerMove) window.removeEventListener("pointermove", onPointerMove);
          clearDropHover();
        };
      },
    };
  }, [canReorder, controls, onArm, onGroupDrop, sectionId, clearDropHover]);

  return (
    <Reorder.Item
      as="div"
      value={item.id}
      data-workspace-id={item.id}
      dragListener={false}
      dragControls={controls}
      onDragEnd={() => {
        dragEndedRef.current = true;
        endDragRef.current(true);
      }}
      onClickCapture={(event: React.MouseEvent<HTMLDivElement>) => {
        if (suppressClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      className={
        dragging
          ? // pointer-events-none: elementFromPoint must see the drop
            // container under the row, not the row itself.
            "pointer-events-none cursor-grabbing rounded-2lg bg-background-secondary-hover ring-1 ring-border-button-active"
          : undefined
      }
    >
      {renderItem(item, canReorder ? { isDragging: dragging, dragHandleProps } : null)}
    </Reorder.Item>
  );
}

export function WorkspaceSortableList<T extends { id?: string }>({
  items,
  sectionId = null,
  disabled = false,
  onReorder,
  onDropToSection,
  onDragActiveChange,
  renderItem,
  className,
}: {
  items: T[];
  /** Section this list renders (null = ungrouped); drops resolving to it
   *  stay in-list reorders. */
  sectionId?: string | null;
  /** Searching / missing callbacks → plain list. */
  disabled?: boolean;
  onReorder?: (orderedIds: string[]) => void;
  /** Drop of a row onto another section container (group id, the archived
   *  sentinel, or null = ungrouped). */
  onDropToSection?: (itemId: string, targetSectionId: string | null) => void;
  /** Fired when any row starts / finishes a drag (empty-group and archived
   *  drop targets render only mid-drag). */
  onDragActiveChange?: (active: boolean) => void;
  renderItem: (item: T, drag: RepoDragChrome | null) => ReactNode;
  className?: string;
}) {
  // Cross-section drops keep single-item lists draggable: the grip means
  // "drag to reorder or move", and a one-member section can still move out.
  const canReorder =
    !disabled &&
    items.every((item) => item.id) &&
    ((Boolean(onReorder) && items.length >= 2) || Boolean(onDropToSection));
  const baseIds = useMemo(() => items.map((item) => item.id ?? ""), [items]);
  // Preview order committed live by Reorder.Group while dragging.
  const [order, setOrder] = useState(baseIds);
  const orderRef = useRef(order);
  const draggingRef = useRef(false);

  // Follow external list changes (add / remove / backend refresh), but never
  // fight an in-flight drag.
  useEffect(() => {
    if (!draggingRef.current) {
      orderRef.current = baseIds;
      setOrder(baseIds);
    }
  }, [baseIds]);

  const itemById = useMemo(() => {
    const map = new Map<string, T>();
    items.forEach((item) => {
      if (item.id) map.set(item.id, item);
    });
    return map;
  }, [items]);

  const handleGroupReorder = useCallback((nextOrder: string[]) => {
    orderRef.current = nextOrder;
    setOrder(nextOrder);
  }, []);

  const handleArm = useCallback(() => {
    draggingRef.current = true;
    onDragActiveChange?.(true);
  }, [onDragActiveChange]);

  const handleCommit = useCallback(() => {
    draggingRef.current = false;
    onDragActiveChange?.(false);
    const next = orderRef.current;
    const changed =
      next.length === baseIds.length && next.some((id, index) => id !== baseIds[index]);
    if (changed) onReorder?.(next);
  }, [baseIds, onReorder, onDragActiveChange]);

  const handleAbort = useCallback(() => {
    draggingRef.current = false;
    onDragActiveChange?.(false);
    // Roll the preview order back (a group drop may have moved over
    // siblings before resolving to a section container).
    orderRef.current = baseIds;
    setOrder(baseIds);
  }, [baseIds, onDragActiveChange]);

  return (
    <Reorder.Group
      as="div"
      axis="y"
      values={order}
      onReorder={handleGroupReorder}
      className={className}
      data-workspace-reorder-list="true"
    >
      {order.map((id) => {
        const item = itemById.get(id);
        if (!item) return null;
        return (
          <SortableRow
            key={id}
            item={item}
            canReorder={canReorder}
            sectionId={sectionId}
            renderItem={renderItem}
            onArm={handleArm}
            onCommit={handleCommit}
            onAbort={handleAbort}
            onGroupDrop={
              onDropToSection ? (target) => onDropToSection(id, target) : null
            }
          />
        );
      })}
    </Reorder.Group>
  );
}
