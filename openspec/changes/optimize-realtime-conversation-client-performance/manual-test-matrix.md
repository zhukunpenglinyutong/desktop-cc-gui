# Manual Test Matrix

## Preconditions

- 使用同一工作区分别开启 Codex、Claude Code、Gemini 会话。
- DevTools performance 面板可选；至少打开 renderer diagnostics 或应用内 debug 面板。
- 回滚 flags 可通过 localStorage 设置：
  - `ccgui.perf.realtimeBatching=0`
  - `ccgui.perf.incrementalDerivation=0`
  - `ccgui.perf.reducerNoopGuard=0`
  - `ccgui.debug.streamMitigation.disabled=true`

## Cases

### 1. Gemini Assistant Streaming

- 输入：让 Gemini 输出 1000 字以上总结，包含列表与小标题。
- 期望：输出持续增长，输入框可继续打字；无整段卡住到 completion 才出现。
- 诊断：visible text diagnostics 有 Gemini thread/item evidence；无默认 mitigation activation。

### 2. Gemini Reasoning + Assistant

- 输入：触发 Gemini reasoning 后再输出 assistant answer。
- 期望：reasoning 顺序稳定，不被 assistant 覆盖；迟到 reasoning 插入规则不变。
- 诊断：reducer 不应随每个 same-item reasoning chunk 完整派生。

### 3. Claude Code Long Markdown

- 输入：让 Claude Code 输出长 Markdown plan，包含标题、列表、代码块。
- 期望：streaming 期间可见文本增长；completion 后本地恢复最终 Markdown 结构。
- 回归：Claude render-safe class 仍只按 Claude desktop processing 生效，不泄漏到 Gemini/Codex。

### 4. Codex Tool Output

- 输入：让 Codex 执行会持续输出多行日志的命令。
- 期望：tool output 增长顺滑，terminal settlement 正常，completion 后 tool status 正确。
- 诊断：已有 tool item 的 output delta 不应每 chunk 完整派生；新 placeholder 插入仍 canonical。

### 5. Composer Responsiveness

- 输入：任一引擎 streaming 时，在 composer 内持续输入中文 IME、移动光标、添加附件。
- 期望：draft text、selection、IME、attachments 不回退、不延迟、不被 streaming status 覆盖。
- 回归：status/context/rate-limit 可轻微滞后，但 completion 后收敛。

### 6. Rollback Flags

- 设置 `ccgui.perf.realtimeBatching=0` 后重复 Gemini assistant streaming。
- 期望：事件回到 immediate dispatch baseline，最终输出语义不变。
- 设置 `ccgui.perf.incrementalDerivation=0` 后重复 reasoning/tool output。
- 期望：回到 canonical derivation，最终输出语义不变。
- 设置 `ccgui.debug.streamMitigation.disabled=true` 后触发 visible stall。
- 期望：diagnostics 保留，active mitigation 被抑制。

## Pass Criteria

- Codex / Claude Code / Gemini 三引擎均能完成长流式输出。
- 无 Tauri/provider payload 变更依赖。
- 无 conversation row ordering、terminal lifecycle、final Markdown、composer source-of-truth 回归。
- 回滚 flags 均能恢复 baseline-compatible path。
