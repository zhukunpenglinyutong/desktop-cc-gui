// 使用真实设置页和示例插件；原生 IPC 不访问用户数据。
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { settingsRegistry } from "@ccgui/plugin-sdk";
import "../../src/index.css";
import "../../src/lib/i18n";
import SettingsPage from "../../src/features/settings/SettingsPage";

settingsRegistry.register({
  id: "nav-preview", key: "nav-preview", group: "system", order: -1,
  label: () => "导航预览",
  component: () => <div>拖动插件图标调整顺序；折叠、搜索和刷新后检查状态恢复。</div>,
});
for (const [index, label] of ["笔记助手", "任务清单", "代码模板"].entries()) {
  settingsRegistry.register({
    id: `plugin:nav-preview:${index}`, key: `plugin:nav-preview:${index}`,
    group: "plugins", order: 1000, label: () => label,
    component: () => <div>{label}示例设置</div>,
  });
}
createRoot(document.getElementById("fixture")!).render(
  <MemoryRouter initialEntries={["/settings?page=nav-preview"]}>
    <SettingsPage />
  </MemoryRouter>,
);
