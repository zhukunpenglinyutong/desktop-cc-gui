import type { ClientDocumentationNode } from "../clientDocumentationTypes";
import type { ClientDocumentationIconComponent } from "./clientDocumentationIcons";
import { getClientDocumentationIconComponent } from "./clientDocumentationIcons";

type ClientDocumentationTreeProps = {
  nodes: ClientDocumentationNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

export function ClientDocumentationTree({
  nodes,
  selectedNodeId,
  onSelectNode,
}: ClientDocumentationTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className="client-documentation-tree-empty">
        暂无客户端说明文档目录。
      </div>
    );
  }

  return (
    <nav
      className="client-documentation-tree flex flex-col gap-3"
      aria-label="客户端说明文档目录"
    >
      {nodes.map((node) => (
        <div
          className="client-documentation-tree-group flex flex-col gap-0.5"
          key={node.id}
        >
          <TopLevelTreeNode
            node={node}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
          />
          {node.children && node.children.length > 0 ? (
            <div className="client-documentation-tree-children">
              {node.children.map((child) => {
                const isActive = selectedNodeId === child.id;
                return (
                  <button
                    type="button"
                    className={`client-documentation-tree-node is-child ml-10 w-[calc(100%-40px)] border-0 rounded-[11px] text-left flex flex-col gap-1 cursor-pointer [-webkit-app-region:no-drag] py-[7px] px-2.5 text-xs ${
                      isActive
                        ? "is-active bg-[linear-gradient(135deg,rgba(37,99,235,0.2),rgba(37,99,235,0.08)),var(--surface-raised)] text-(--text-stronger) shadow-[inset_0_0_0_1px_rgba(37,99,235,0.35)]"
                        : "bg-transparent text-(--text-muted) hover:bg-[color-mix(in_srgb,var(--surface-control-hover)_86%,rgba(37,99,235,0.1))] hover:text-(--text-primary) focus-visible:bg-[color-mix(in_srgb,var(--surface-control-hover)_86%,rgba(37,99,235,0.1))] focus-visible:text-(--text-primary) focus-visible:outline-none"
                    }`}
                    key={child.id}
                    onClick={() => onSelectNode(child.id)}
                  >
                    <span className="client-documentation-tree-title font-[650] leading-[1.35]">
                      {child.title}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </nav>
  );
}

type TopLevelTreeNodeProps = {
  node: ClientDocumentationNode;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

function TopLevelTreeNode({
  node,
  selectedNodeId,
  onSelectNode,
}: TopLevelTreeNodeProps) {
  const Icon: ClientDocumentationIconComponent = getClientDocumentationIconComponent(
    node.iconKey,
  );
  const isActive = selectedNodeId === node.id;

  return (
    <button
      type="button"
      className={`client-documentation-tree-node is-top-level w-full border-0 rounded-2xl text-left py-2.5 px-[11px] flex flex-col gap-1 cursor-pointer [-webkit-app-region:no-drag] ${
        isActive
          ? "is-active bg-[linear-gradient(135deg,rgba(37,99,235,0.2),rgba(37,99,235,0.08)),var(--surface-raised)] text-(--text-stronger) shadow-[inset_0_0_0_1px_rgba(37,99,235,0.35)]"
          : "bg-transparent text-(--text-muted) hover:bg-[color-mix(in_srgb,var(--surface-control-hover)_86%,rgba(37,99,235,0.1))] hover:text-(--text-primary) focus-visible:bg-[color-mix(in_srgb,var(--surface-control-hover)_86%,rgba(37,99,235,0.1))] focus-visible:text-(--text-primary) focus-visible:outline-none"
      }`}
      onClick={() => onSelectNode(node.id)}
    >
      <span className="client-documentation-tree-node-main grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2.5 w-full items-start">
        <span
          className={`client-documentation-tree-icon w-[30px] h-[30px] rounded-[11px] inline-flex items-center justify-center shadow-[inset_0_0_0_1px_rgba(37,99,235,0.18)] ${
            isActive
              ? "text-white bg-[#2563eb]"
              : "text-[#2563eb] bg-[rgba(37,99,235,0.12)]"
          }`}
          aria-hidden="true"
        >
          <Icon size={16} strokeWidth={2.1} />
        </span>
        <span className="client-documentation-tree-copy min-w-0 flex flex-col gap-1">
          <span className="client-documentation-tree-title font-[650] leading-[1.35]">
            {node.title}
          </span>
          <span className="client-documentation-tree-summary text-[11px] leading-[1.4] text-(--text-subtle)">
            {node.summary}
          </span>
        </span>
        <span className="client-documentation-tree-count min-w-[22px] h-[22px] rounded-full inline-flex items-center justify-center text-(--text-subtle) bg-[color-mix(in_srgb,var(--surface-base)_70%,transparent)] text-[10px] font-extrabold">
          {node.children?.length ?? 0}
        </span>
      </span>
    </button>
  );
}
