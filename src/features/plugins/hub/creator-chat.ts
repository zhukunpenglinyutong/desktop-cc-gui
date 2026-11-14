import { ipc, type Workspace } from "@/lib/ipc";
import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import { sessionKey, useChatStore, type ActiveSession } from "@/features/chat/store";

/**
 * 插件中心「创建插件」的入口动作：开一个新会话，把内置插件开发 skill 的调用
 * 预填进输入框，让用户补一句需求就能发。
 *
 * skill 本体随应用分发，只在这里（用户点「创建插件」）同步进各引擎的 skills
 * 根（src-tauri/src/creator_skill.rs）；应用启动时不再写其他 CLI 的目录。
 * 装不上也不静默：失败写日志，界面照常开新会话（引擎找不到该 skill 时用户
 * 会看到引擎自己的报错）。
 */

/** `/` 选择器插入的 token（与 slash-command-menu 的 `/${name} ` 一致）。 */
export const CREATOR_SKILL_COMMAND = "/ccgui-plugin-creator ";

/** 目标工作区：当前会话所在的工作区优先，否则第一个可见工作区。 */
export function creatorChatWorkspace(
  active: ActiveSession | null,
  workspaces: Workspace[],
): Workspace | null {
  return workspaces.find((w) => w.path === active?.workspacePath) ?? workspaces[0] ?? null;
}

/** 开新会话 + 预填 skill 调用；返回该会话的 draft key（调用方据此聚焦输入框）。 */
export function startCreatorChat(workspacePath: string): string {
  void ipc
    .creatorSkillInstall()
    .then((report) => {
      // 落盘结果不阻断开新会话，但不能静默：一个可用目标都没有时（打包缺
      // 资源 / 三个引擎根都被占），预填的命令在引擎侧解析不了，得留下线索。
      // `report` 可能为 null（web 桥未列入该命令等旧后端路径）。
      const ready = (report?.targets ?? []).some(
        (target) => target.action === "written" || target.action === "current",
      );
      if (!report || report.source === null || !ready) {
        console.warn("[creator-skill] not available for any engine", report);
      }
    })
    .catch((error) => console.warn("[creator-skill] install failed", error));
  dismissCenterSurfaces();
  const { startNewChat, activeEngine, setDraft } = useChatStore.getState();
  startNewChat(workspacePath, activeEngine);
  const key = sessionKey(activeEngine, null, workspacePath);
  setDraft(key, CREATOR_SKILL_COMMAND);
  return key;
}
