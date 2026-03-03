import type { ComponentPropsWithoutRef, KeyboardEvent as ReactKeyboardEvent } from 'react';

type ResizeDirection = 'n';

export function ResizeHandles({
  getHandleProps,
  nudge,
  isCollapsed = false,
  onExpandCollapsed,
}: {
  getHandleProps: (dir: ResizeDirection) => ComponentPropsWithoutRef<'div'>;
  nudge: (delta: { wrapperHeightPx?: number }) => void;
  isCollapsed?: boolean;
  onExpandCollapsed?: () => void;
}) {
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 24 : 8;

    const key = e.key;
    if (key !== 'ArrowUp' && key !== 'ArrowDown') {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    if (key === 'ArrowUp') nudge({ wrapperHeightPx: step });
    if (key === 'ArrowDown') nudge({ wrapperHeightPx: -step });
  };

  return (
    <div className="resize-handle-hover-zone" aria-hidden>
      <div
        className="resize-handle resize-handle--n"
        {...getHandleProps('n')}
        onClick={(event) => {
          if (!isCollapsed) return;
          event.preventDefault();
          event.stopPropagation();
          if (onExpandCollapsed) {
            onExpandCollapsed();
            return;
          }
          nudge({ wrapperHeightPx: 24 });
        }}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize input height"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}
