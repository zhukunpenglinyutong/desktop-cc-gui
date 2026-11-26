// 真实侧栏组件与示例入口；原生 IPC 不访问用户数据。
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { sidebarNavRegistry } from "@ccgui/plugin-sdk";
import "../../src/index.css";
import "../../src/lib/i18n";
import { SidebarPrimaryNav } from "../../src/components/application/ai-chat/sidebar-chrome";

const names = ["笔记助手", "任务清单", "代码模板"];
function Fixture() {
  const [count, setCount] = useState(3);
  const [mount, setMount] = useState(0);
  const [notice, setNotice] = useState("尚未打开页面");
  useEffect(() => {
    const disposers = names.slice(0, count).map((name, index) => sidebarNavRegistry.register({
      id: `plugin:sidebar-preview:${index}`,
      label: () => name,
      badge: index === 1 ? () => 3 : undefined,
      onOpen: () => setNotice(`已打开${name}`),
    }));
    return () => disposers.forEach((dispose) => dispose());
  }, [count]);
  return (
    <div className="min-h-screen bg-background-primary-default p-8 text-text-primary">
      <h1 className="text-title-2-semibold">侧栏插件导航</h1>
      <p className="my-4 text-body-2-regular">拖动图标、点击行尾箭头，或增减入口；刷新检查独立保存的顺序与折叠状态。</p>
      <div className="mb-6 flex flex-wrap gap-4">
        <button onClick={() => setCount((value) => Math.min(3, value + 1))}>增加入口</button>
        <button onClick={() => setCount((value) => Math.max(0, value - 1))}>移除末项</button>
        <button onClick={() => setMount((value) => value + 1)}>重新挂载导航</button>
        <span>入口数：{count}</span>
      </div>
      <div className="flex gap-8">
        <aside className="w-72 shrink-0 rounded-xl border border-border-button-default p-3">
          <SidebarPrimaryNav key={mount}
            onNewSession={() => setNotice("新建会话")}
            onOpenPlugins={() => setNotice("已打开插件中心")}
            onNewBrowser={() => setNotice("新建浏览器")}
            onOpenMission={() => setNotice("任务工作台")}
          />
          <p className="mt-6 text-text-tertiary">工作区列表</p>
        </aside>
        <div role="status">{notice}</div>
      </div>
    </div>
  );
}
createRoot(document.getElementById("fixture")!).render(<Fixture />);
