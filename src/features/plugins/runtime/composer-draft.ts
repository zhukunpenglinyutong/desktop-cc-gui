import { sessionKey, useChatStore } from "@/features/chat/store";

/**
 * ctx.composer.setDraft 的宿主实现：替换当前活动会话的聊天输入框草稿。
 * 独立成模块而不是内联进 context.ts：chat store 依赖链重（ipc/events），
 * 让 runtime/context 的单元测试可以只 mock 本模块。
 *
 * 无活动会话（一个 tab 都没有）时抛错——能力调用失败要对插件可见，
 * 不静默吞掉（与 context.ts 的 requirePermission 同一约定）。
 */
export function setActiveComposerDraft(pluginId: string, text: string): void {
  const { active, setDraft } = useChatStore.getState();
  if (!active) {
    throw new Error(`[plugins] "${pluginId}" composer.setDraft: no active session`);
  }
  setDraft(sessionKey(active.engine, active.sessionId, active.workspacePath), text);
}
