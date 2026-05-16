import type { PreviewOutlineItem } from "../utils/filePreviewOutline";

type PreviewOutlineSidebarProps = {
  title: string;
  emptyLabel: string;
  items: PreviewOutlineItem[];
  activeItemId: string | null;
  onSelectItem: (item: PreviewOutlineItem) => void;
};

type PreviewOutlineEntryProps = {
  item: PreviewOutlineItem;
  depth: number;
  activeItemId: string | null;
  onSelectItem: (item: PreviewOutlineItem) => void;
};

function PreviewOutlineEntry({
  item,
  depth,
  activeItemId,
  onSelectItem,
}: PreviewOutlineEntryProps) {
  const isActive = activeItemId === item.id;

  return (
    <li className="fvp-preview-outline-entry flex flex-col gap-1">
      <button
        type="button"
        className={`fvp-preview-outline-button w-full border-0 rounded-[10px] bg-transparent text-left text-[12px] leading-[1.5] py-2 px-3 transition-[background,color] duration-[140ms] hover:bg-[color-mix(in_srgb,var(--surface-hover)_66%,transparent)] hover:text-(--fvp-reader-text) ${isActive ? "is-active bg-[color-mix(in_srgb,var(--surface-active)_82%,transparent)] text-(--text-stronger)" : "text-(--fvp-reader-muted)"}`}
        style={{ paddingInlineStart: `${12 + depth * 14}px` }}
        aria-current={isActive ? "location" : undefined}
        onClick={() => onSelectItem(item)}
      >
        {item.title}
      </button>
      {item.children.length > 0 ? (
        <ul className="fvp-preview-outline-list flex flex-col gap-1 m-0 p-0 list-none">
          {item.children.map((childItem) => (
            <PreviewOutlineEntry
              key={childItem.id}
              item={childItem}
              depth={depth + 1}
              activeItemId={activeItemId}
              onSelectItem={onSelectItem}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function PreviewOutlineSidebar({
  title,
  emptyLabel,
  items,
  activeItemId,
  onSelectItem,
}: PreviewOutlineSidebarProps) {
  return (
    <nav className="fvp-preview-outline sticky top-0 flex flex-col gap-3 max-[980px]:static max-h-[calc(100vh-180px)] max-[980px]:max-h-none min-w-0 py-3.5 px-3 border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] rounded-[14px] bg-[color-mix(in_srgb,var(--surface-card)_84%,transparent)] overflow-auto" aria-label={title}>
      <header className="fvp-preview-section-header flex flex-wrap items-center justify-between gap-2.5 text-(--fvp-reader-muted) text-[12px] [&_strong]:text-(--fvp-reader-text) [&_strong]:text-[13px] [&_strong]:font-bold">
        <strong>{title}</strong>
      </header>
      {items.length > 0 ? (
        <ul className="fvp-preview-outline-list flex flex-col gap-1 m-0 p-0 list-none">
          {items.map((item) => (
            <PreviewOutlineEntry
              key={item.id}
              item={item}
              depth={0}
              activeItemId={activeItemId}
              onSelectItem={onSelectItem}
            />
          ))}
        </ul>
      ) : (
        <div className="fvp-preview-outline-empty rounded-[10px] bg-[color-mix(in_srgb,var(--surface-control)_38%,transparent)] text-(--fvp-reader-muted) text-[12px] leading-[1.5] py-2.5 px-3">{emptyLabel}</div>
      )}
    </nav>
  );
}
