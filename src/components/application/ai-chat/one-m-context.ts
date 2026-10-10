/**
 * 「1M 上下文」的模型标识约定：模型 id 带 `[1m]` 后缀。
 *
 * 这条约定不是新造的：后端 spawn 时 `claude_channel::resolve_model`
 * （src-tauri/src/engine/claude_channel.rs）已按该后缀拆解、解析别名 / 渠道
 * 映射后再拼回 `[1m]`；模型记忆按字符串存、校验比较（response-check.ts）
 * 与用量统计也早已接受该形态。所以前端只需在模型 id 上读写后缀，会话 /
 * 标签页 / DB 的持久化自动成立，不需要任何新字段。
 */

export const ONE_M_SUFFIX = "[1m]";

/** CLI 的内置别名行（`claude --model` 的 /model 菜单五档），与后端
 *  src-tauri/src/engine/models/claude.rs 的 CLI_ALIASES 对齐。这些行经渠道
 *  override 解析时后缀可能被丢弃，所以不给 1M 开关。 */
export const CLI_MODEL_ALIASES: readonly string[] = [
  "default",
  "opus",
  "fable",
  "sonnet",
  "haiku",
];

/** 尾部是否带 `[1m]`（中段出现不算）。 */
export function hasOneM(id: string): boolean {
  return id.endsWith(ONE_M_SUFFIX);
}

/** 剥掉尾部的 `[1m]`；没有则原样返回。 */
export function bareOneM(id: string): string {
  return hasOneM(id) ? id.slice(0, -ONE_M_SUFFIX.length) : id;
}

/** 附加 / 剥除 `[1m]` 后缀；空 id 原样返回（没选具体模型时没有可标记的对象）。 */
export function withOneM(id: string, on: boolean): string {
  if (!id) return id;
  const bare = bareOneM(id);
  return on ? `${bare}${ONE_M_SUFFIX}` : bare;
}

/** 是否给当前选择显示 1M 开关：仅 Claude、已选具体模型、且不是 CLI 别名行。 */
export function showsOneMContext(engineId: string, modelId: string): boolean {
  if (engineId !== "claude") return false;
  const bare = bareOneM(modelId.trim()).toLowerCase();
  if (!bare) return false;
  return !CLI_MODEL_ALIASES.includes(bare);
}

/**
 * 会话选中值在引擎目录里的「对应行」。
 *
 * 会话 / 标签页的模型记忆可以带 `[1m]` 后缀（1M 开关），而引擎目录
 * （`modelsByEngine`）来自后端别名 / 渠道 / 自定义模型，永远没有带后缀的
 * 那一项。所以选中 `dp[1m]` 时，目录里代表它的就是 `dp` 那一行——**同一行**，
 * 只是要就地打勾并拼上 1M 标记，而不是另外多出一行。
 *
 * 精确命中（含没有后缀的情况）返回该 id 且 `tagged:false`；带后缀但目录只有
 * 裸行时返回裸行 id 且 `tagged:true`；都命中不了时原样返回选中的 id。
 */
export function matchCatalogRow(
  models: readonly { id: string }[],
  selectedId: string,
): { id: string; tagged: boolean } {
  if (models.some((model) => model.id === selectedId)) {
    return { id: selectedId, tagged: false };
  }
  if (hasOneM(selectedId)) {
    const bare = bareOneM(selectedId);
    if (models.some((model) => model.id === bare)) {
      return { id: bare, tagged: true };
    }
  }
  return { id: selectedId, tagged: false };
}
