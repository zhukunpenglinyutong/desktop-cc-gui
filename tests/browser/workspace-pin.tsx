// Open /tests/browser/workspace-pin.html under Vite. Uses the real sidebar,
// menu, store action and ordering with synthetic workspaces; native IPC is stubbed.
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import "../../src/lib/i18n";
import { AiChatSidebar } from "../../src/components/application/ai-chat/ai-chat-sidebar";
import { useChatSidebar } from "../../src/features/chat/use-chat-sidebar";
import { useChatStore } from "../../src/features/chat/store";
import type { Workspace } from "../../src/lib/ipc";

const workspaces: Workspace[] = [
  { id: "alpha", path: "/demo/alpha", name: "Alpha 项目", lastOpenedAt: null, sortOrder: 0, groupId: null, pinned: false },
  { id: "beta", path: "/demo/beta", name: "Beta 项目", lastOpenedAt: null, sortOrder: 1, groupId: null, pinned: true },
  { id: "design", path: "/demo/design", name: "设计稿", lastOpenedAt: null, sortOrder: 2, groupId: "team", pinned: false },
  { id: "client", path: "/demo/client", name: "客户工作台", lastOpenedAt: null, sortOrder: 3, groupId: "team", pinned: true },
];

useChatStore.setState({
  workspaces,
  sessions: [],
  openTabs: [],
  workspaceGroups: [{ id: "team", name: "团队项目", sortOrder: 0 }],
  archivedWorkspaces: [],
  workspaceAliases: {},
});

function Fixture() {
  const sidebar = useChatSidebar({
    sessionById: new Map(),
    threadStreaming: [],
    threadRetrying: [],
    collapseSidebarOnMobile: () => {},
    composerInputRef: { current: null },
    setDialog: () => {},
  });
  return (
    <div className="min-h-screen bg-background-secondary-default p-8 text-text-primary">
      <div className="mx-auto max-w-3xl">
        <h1 className="text-title-2-semibold">工作区置顶效果预览</h1>
        <p className="mt-2 text-body-2-regular text-text-secondary">
          右键工作区选择“置顶工作区 / 取消置顶”；置顶项留在原分组。可拖动文件夹图标调整同类顺序。
        </p>
        <p className="mt-1 text-body-2-regular text-text-secondary">
          使用示例数据与内存中的 IPC；刷新页面会恢复初始状态，不改动真实工作区。
        </p>
        <div className="mt-6 flex h-[600px] overflow-hidden rounded-xl border border-border-button-default bg-background-primary-default shadow-lg">
          <AiChatSidebar
            repos={sidebar.repos}
            sections={sidebar.sections}
            onSetWorkspacePinned={sidebar.handleSetWorkspacePinned}
            onReorderWorkspaces={sidebar.handleReorderWorkspaces}
            onDropWorkspaceToSection={sidebar.handleDropWorkspaceToSection}
          />
          <div className="flex flex-1 items-center justify-center text-body-2-regular text-text-tertiary">
            此预览仅展示侧栏交互
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("fixture")!).render(<Fixture />);
