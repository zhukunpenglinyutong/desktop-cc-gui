import { ipc } from "@/lib/ipc";
import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import { useChatStore } from "@/features/chat/store";
import { withAuthorizedHostInvoke } from "./hardening";

/**
 * ctx.workspaces.add 的宿主实现：把任意路径登记为侧栏工作区（可选携带
 * 透传 meta，如 { wsl: { hostId, distro } }）。独立成模块而不是内联进
 * context.ts：chat store 依赖链重（ipc/events），让 runtime/context 的
 * 单元测试可以只 mock 本模块（composer-draft 同款理由）。
 *
 * 与侧栏「添加工作区」的差异：不要求本机存在该目录（远程机/WSL 发行版
 * 内路径），meta 存在时由后端放行 is_dir 校验并随行存储。
 *
 * meta 含 `wsl` 键 = 远程工作区：引擎随后按 meta.wsl 经 ssh 把会话流量
 * 导到插件指定的主机（见 src-tauri wsl_transport）。这等效于出网 + 远程
 * 执行导向，远超「登记一行侧栏数据」，故需要独立的
 * `host:workspace:remote` 权限（requireRemotePermission 由 context.ts
 * 注入），不接受只有 host:workspace 的插件设置。
 */
export async function addPluginWorkspace(
  pluginId: string,
  path: string,
  meta: Record<string, unknown> | undefined,
  requireRemotePermission: () => void,
): Promise<void> {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error(`[plugins] "${pluginId}" workspaces.add: empty path`);
  }
  if (meta !== null && meta !== undefined && typeof meta === "object" && "wsl" in meta) {
    requireRemotePermission();
  }
  // 走 plugin_add_workspace(Rust 侧复核 manifest 授权,见 plugin_caps.rs)
  // 而非通用 add_workspace——后者拒绝 wsl meta,直连 IPC 绕过 JS 门的插件
  // 会在服务端被拦。错误经 invoke 真实传播,不走 store actionError 静默路径。
  await withAuthorizedHostInvoke(() => ipc.pluginAddWorkspace(pluginId, trimmed, meta));
  await useChatStore.getState().refreshWorkspaces();
}

/** ctx.sessions.selectSession 的宿主实现：按引擎 + 会话 id 打开（或恢复）
 *  一个既有会话。会话必须已存在于宿主会话表（远程来源的登记由插件侧扩展）；
 *  未知的 engine/sessionId 组合抛错，不静默。 */
export function openPluginSession(
  pluginId: string,
  engine: string,
  sessionId: string,
  workspacePath: string,
): void {
  const store = useChatStore.getState();
  const known = store.sessions.some(
    (s) => s.engine === engine && s.sessionId === sessionId && s.workspacePath === workspacePath,
  );
  // 远程来源(如 WSL 发行版)的会话宿主扫描不到,但工作区已登记 → 放行:
  // 打开后走 --resume,历史回放失败由 store 既有 error 分支呈现。
  const workspaceRegistered = store.workspaces.some((w) => w.path === workspacePath);
  if (!known && !workspaceRegistered) {
    throw new Error(
      `[plugins] "${pluginId}" sessions.selectSession: unknown session ${engine}/${sessionId}`,
    );
  }
  // The chat surface comes forward; other center surfaces in view (browser,
  // file, plugin tab/hub, workbench, diff) step aside.
  dismissCenterSurfaces();
  store.selectSession(engine, sessionId, workspacePath);
}
