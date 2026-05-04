# Component Guidelines（组件规范）

## 设计原则（Design Principles）

- 单一职责（Single Responsibility）优先：render / state orchestration / data mapping 分离。
- 默认使用 feature-local component，只有稳定复用后再提升到 `components/ui`。
- 大组件拆分时优先抽 hook 和 pure helper，不先抽“过度抽象”的 base component。

## 文件结构建议

1. imports（external -> internal）
2. local types
3. constants
4. pure helper
5. component implementation
6. export

## Props 约束

- 导出组件必须有明确 `Props` type/interface。
- 禁止无语义命名：`data/info/temp`。
- callback 使用 `onXxx`，并声明 payload type。
- nullable 字段显式写 `T | null`，避免隐式 optional。

## Styling 规范

- 当前项目主样式是 `src/styles/*.css` + `className`/`cn()` 组合。
- class 前缀要 feature scoped（如 `git-history-*`、`spec-hub-*`）。
- 大样式文件允许分片 `*.part1.css/*.part2.css`，但必须保持 selector contract 稳定。
- 条件 class 建议复用 `src/lib/utils.ts` 的 `cn()`。

## i18n 规范

- 用户可见文案必须走 `useTranslation().t("...")`。
- 禁止在交互界面硬编码 copy（调试日志除外）。
- 文案 key 变更要同步 `src/i18n/locales/*`。

## Accessibility 基线

- button/input 必须有可访问名称（label/aria-label/title）。
- modal/dialog 必须具备 `role="dialog"` + `aria-modal`（若为 modal）。
- 鼠标可操作项需考虑 keyboard path。

## 常见坏味道（Common Smells）

- 超长 TSX 文件里混入大量 data logic。
- 引入新组件却不加测试或行为验证。
- feature-specific 行为错误提升到 shared UI，导致耦合污染。

## Scenario: Streaming Message Visible Surface

### 1. Scope / Trigger

- Trigger：修改 live conversation message / Markdown / streaming throttle / render-safe path。
- 目标：保证 runtime delta 到达后，用户可见 assistant text 持续增长；父组件 render 不等价于真实 visible text growth。

### 2. Signatures

- `Markdown` 可暴露 `onRenderedValueChange?: (value: string) => void`，回传 throttle 后实际进入 Markdown surface 的 `renderValue`。
- `MessageRow` 可暴露 `onAssistantVisibleTextRender?: ({ itemId, visibleText }) => void`，只在 live assistant streaming path 上报。
- `StreamMitigationProfile` 可包含 `renderPlainTextWhileStreaming?: boolean`，用于临时绕过高成本 Markdown parse。
- `StreamMitigationProfile` SHOULD 允许 engine-level recovery profile（例如 `claude-markdown-stream-recovery`），用于 provider/platform 之外的 Claude long-markdown visible stall 恢复。
- `ThreadStreamLatencySnapshot` 可区分 `candidateMitigationProfile` 与 `mitigationProfile`：前者允许 UI 在 first delta 后立即使用 safe live surface，后者只能在 render lag / visible stall evidence 出现后写入。
- `MessageRow` / `MessagesRows` MAY 为 `Codex` latest assistant row 使用 staged `streamingThrottleMs`（例如 short/medium/large 三档），但 MUST 继续维持同一条 live assistant row 的 progressive reveal。
- `PresentationProfile` MUST 表达 normal baseline render cadence（例如 assistant Markdown throttle、reasoning throttle、Codex staged Markdown 开关）；provider-scoped `StreamMitigationProfile` 只能作为 evidence-triggered override。

### 3. Contracts

- live assistant text 的诊断必须基于实际可见文本长度或 rendered value，而不是 `items/renderedItems` 数组变化。
- visible text growth 必须按 `itemId` 隔离；不得用全局 last length 比较不同 assistant message item。
- visible text length 进入 diagnostics 前必须 sanitize 成有限非负整数，避免 `NaN` / `Infinity` 污染 snapshot。
- engine/platform mitigation 必须有明确 guard，例如 `activeEngine === "claude" && platform === "windows"`；不得因 provider/model 未匹配而阻塞 engine-level 修复。
- 当新证据已经证明问题属于 Claude engine-level 而非单一平台时，visible-stall recovery MUST NOT 继续被写死为 Windows-only。
- first delta 只能 prime candidate profile，不得直接记录 `stream-latency/mitigation-activated`；激活诊断必须来自 evidence-based path。
- plain-text live surface 只允许用于 streaming 中间态；turn 完成后必须回到完整 Markdown 渲染，保持 final output 语义。
- `Codex` realtime assistant snapshot SHOULD 优先使用 staged Markdown throttle，而不是默认退回 plain-text live surface；只有已有 mitigation profile 显式要求时才可强制 plain-text。
- realtime 末段的 Markdown throttle / staged rendering MUST 在 turn 完成时收敛到同一条 final Markdown 语义；不得依赖 history reconcile 才恢复结构。
- `Claude` / `Gemini` normal Markdown 与 reasoning pacing MUST come from baseline `PresentationProfile` first; mitigation activation MUST require render lag / visible stall evidence and MUST NOT be inferred from baseline profile selection alone.
- 当用户正在 composer 中输入时，live message render MAY 进一步 defer 或降频，但 MUST 保持可见 assistant text 单调增长，且 final output 语义不变。
- rollback flag 只能关闭 active mitigation，不应关闭 diagnostics 记录。

### 4. Validation & Error Matrix

| 场景 | 必须行为 | 禁止行为 |
|---|---|---|
| first delta 后继续收到 delta | visible text length 持续增长或触发 visible-stall diagnostics | 只更新 spinner，正文停在首几个字 |
| Windows native Claude | 可启用 engine-level profile，无需 Qwen/provider fingerprint | 把 provider/model 当根因 gate |
| macOS Claude / non-Claude | 保持 baseline render path | 泄漏 Windows Claude mitigation |
| Codex large streaming | 允许 staged Markdown throttle，结构可渐进出现 | streaming 中默认整段退回 plain text，直到 completion 才恢复结构 |
| Claude/Gemini baseline profile | 使用 baseline throttle，保持 row cardinality 不变 | 把正常 profile 激活记录成 mitigation |
| Codex streaming + active typing | composer 输入仍可操作，幕布更新可适度 defer | 输入框与幕布同步卡死，必须等尾段 render 完成才能继续输入 |
| rollback flag 开启 | active profile 不进入 UI，diagnostics 仍记录 | 直接吞掉 evidence |

### 5. Good / Base / Bad Cases

- Good：live Markdown 通过 `onRenderedValueChange` 上报 throttle 后真实值；当 Claude Windows candidate 或 Claude engine-level visible stall recovery 命中时，用 plain text live surface 维持 progressive reveal，final message 再回 Markdown。
- Base：`Codex` large streaming 使用分档 `streamingThrottleMs`，既保住结构渐进出现，也避免每个 snapshot 都触发高成本 Markdown parse。
- Bad：为了追求顺滑，把 `Codex` realtime 一律降成 plain text，再在 completion 或 history reconcile 时突然恢复完整 Markdown。
- Bad：只在父组件 `useEffect([renderedItems])` 里记录 visible render，然后断言用户看到了最新文本。

### 6. Tests Required

- diagnostics：覆盖 `visible-output-stall-after-first-delta`，断言不依赖 provider/model。
- render：覆盖 profile 传到 `Messages -> MessagesTimeline -> MessageRow -> Markdown/plain-text surface`。
- render：覆盖 `Codex` short / medium / large streaming throttle 分档与 latest assistant live row 行为。
- interaction：覆盖用户输入活跃时，streaming row 允许 deferred render 但不丢失 final Markdown 结构。
- boundary：覆盖 non-Claude 与 macOS Claude 不激活 Windows profile。
- rollback：覆盖 disabled flag 下 diagnostics 保留、active mitigation 被 resolver 抑制。

### 7. Wrong vs Correct

#### Wrong

```tsx
useEffect(() => {
  noteThreadVisibleRender(threadId, { visibleItemCount: renderedItems.length });
}, [renderedItems, threadId]);
```

#### Correct

```tsx
<Markdown
  value={displayText}
  streamingThrottleMs={streamingThrottleMs}
  onRenderedValueChange={(visibleText) => {
    noteThreadVisibleTextRendered(threadId, {
      itemId,
      visibleTextLength: visibleText.length,
    });
  }}
/>
```
