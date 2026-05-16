# Phase 4.5d — composer.part1.css Sub-PR Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 4.5d (composer.part1.css — composer cluster 收尾)
> Date: 2026-05-17
> Status: in-progress

## Discovery

| Item | Value |
|---|---|
| Primary file | `src/styles/composer.part1.css` (1749 lines) |
| Selector count | ~110 unique `.composer-*` selectors + `.app.canvas-width-wide .composer` cascade + 4 `:root[data-theme]` theme overrides |
| Import chain | `bootstrap.ts → composer.css → composer.part1.css` (composer.css 三行) |
| Layout-guard pin | 无（`__layout-guard__/cssTestHarness.ts` 不含 composer-*；`canvas-width-wide` 仅 toggle DOM class，不验 composer 样式） |
| Cross-feature consumers | `EngineSelector.tsx`（composer-select-wrap / composer-icon / composer-select-value / composer-engine-status-dot / composer-inline-select-{trigger,popup,item,item-label}）<br>`DictationWaveform.tsx`（composer-waveform / -bar / -label） |
| Cross-css cascade | `home-chat.css` `.home-chat-composer-host .composer` + `.composer > *`；`composer.part2.css` `@container composer-footer` 子句 target composer-{input-footer, input-footer-left, footer-cluster, plan-mode-toggle-label, plan-mode-toggle, mode-badge, select-value, select-wrap, select, footer-inline-dock} + `.composer-shell .composer-input`；`review-inline.css` `.composer-suggestions.review-inline-suggestions`；`kanban.css` `.kanban-rich-input .composer-ghost-text-overlay` |

## 测试字面值断言（必须保留 className 作为 no-op marker）

| Class | Test file | 用途 |
|---|---|---|
| `composer-attachment-name` | `ComposerInput.attachments.test.tsx:107` | `container.querySelectorAll(".composer-attachment-name")` |
| `composer-attachment-remove` | `ComposerInput.attachments.test.tsx:243` | querySelector |
| `composer-memory-picker-title` | `ComposerInput.manual-memory.test.tsx:215` | querySelector |

其余 `composer-*` className 不被测试字面值断言依赖。

## 死代码扫描（src/ 全局 grep 无 tsx 引用）

可直接删除的样式集群（**仅 CSS 移除，无需改 tsx**）：

| Cluster | 选择器范围 | 行数预估 |
|---|---|---|
| `.composer-kanban-strip*`（main span:last-child + main/link hover + item.is-active svg + clear + clear:hover + empty） | 148-186 | ~40 |
| `.composer-kanban-context-mode*`（base + label + btn + btn:hover + btn.is-active + check） | 188-252 | ~65 |
| `.composer-picker-backdrop/modal/header/close/search/list/item/item:hover/item.is-selected/item-meta/empty` | 746-836 | ~91 |
| `.composer-opencode-model-badges` + `composer-opencode-model-badge` + `--good/--warn/--neutral` | 930-963 | ~33 |
| `.composer-collaboration-hint` | 881-896 | ~16 |
| `.composer-link-button` + `:hover` | 867-879 | ~13 |
| `.composer-select-picker-trigger` | 658-664 | ~7 |
| `.composer-select-wrap--settings-link` + `:hover` | 844-850 | ~7 |
| `.composer-select-value--settings-link` | 916-924 | ~9 |
| `.composer-settings-link-icon` | 926-928 | ~3 |

**死代码合计：~284 行直接删除（零风险，无 tsx 改动）。**

## 可 inline 到 tsx 的活样式（必须配合 tsx 改）

| Cluster | 选择器范围（part1） | tsx 文件 | 处置 |
|---|---|---|---|
| `.composer-queue*`（base + title + list + item + text + menu + menu:hover） | 28-80 | `ComposerQueue.tsx`（94 lines） | inline Tailwind |
| `.composer-attachments` + `.composer-attachment*`（attachment + preview + thumb + name + remove + remove:hover + remove:disabled + hover/focus 显示 preview） | 964-1059 | `ComposerAttachments.tsx`（87 lines） | inline Tailwind（保留 `composer-attachment-name` / `composer-attachment-remove` className 作为 no-op marker） |
| `.composer` base + `.composer > *` + `.app.canvas-width-wide .composer*` + `.composer.is-disabled` + `.composer textarea:disabled` | 1-26, 1463-1471 | `Composer.tsx`（2310 lines, hot） | inline Tailwind 到 footer wrapper |

合计：~150 行 part1 CSS → 4 个独立 tsx，每个 tsx diff < 50 行。

## 保留 keeper（不动，原因明确）

| Cluster | 选择器范围 | 不动原因 |
|---|---|---|
| `.composer-input` + `.composer-input.is-resizing` + `:focus-within` + `.composer-input-area` + `.composer-resize-handle*` | 82-142 | part2.css `@container` + `.composer-shell .composer-input` cascade override 必须沿用；ComposerInput.tsx 已含 144 处 className，inline 后单文件 diff > 600 行 → 收缩 |
| `.composer-textarea*`（wrapper + base） | 254-270 | 同上，ComposerInput.tsx 已超 1600 行 |
| `.composer-input-footer*` + `.composer-footer-cluster*` + `.composer-footer-inline-dock` + `.composer-attach*` + `.composer-plan-mode-toggle*` + `.composer-plan-mode-switch` + `.composer-mode-badge*` | 272-391, 344-371, 373-390, 1061-1102 | 全是 part2.css `@container composer-footer (max-width: ...)` 子句 target；inline 会破坏 container query cascade |
| `.composer-select-wrap*` + `.composer-icon` + `.composer-select` + `.composer-select-value` + `.composer-engine-status-dot` + `.composer-inline-select-*` + `.composer-opencode-model-indicator` + `:root[data-theme]` overrides | 392-725, 838-863, 909-928 | EngineSelector.tsx 跨 feature 包；按 file-scope 规则不动；同时 `:root[data-theme]` cascade 大量主题 override 不易 Tailwind 化 |
| `.composer-action*` + `:root[data-theme]` overrides + `@media (prefers-color-scheme)` + `composer-action--mic*` + `composer-action.is-stop*` + `composer-action-spinner` + `composer-action-stop-square` + `@keyframes composer-action-spin` | 1104-1503 | 大量 cascade theme override（~390 行），ComposerInput.tsx 单一消费者已大；keeper |
| `.composer-waveform*` + `.composer-dictation-*` | 1356-1425 | DictationWaveform.tsx 跨 feature 包；不在 scope |
| `.composer-usage-popover*` + `.composer-usage-tooltip*` + `.composer-usage-row*` + `.composer-usage-progress-*` + `.composer-usage-reset` | 1120-1212 | ComposerInput.tsx 单一消费者，包含 `::after` 伪元素 + `attr()`-driven dynamic content；keeper |
| `.composer-suggestions*` + `.composer-memory-picker*` + `.composer-note-card-picker-thumb` | 1511-1748 | 1) ChatInputBoxFooter + ComposerInput 多消费者；2) memory-picker 大集群已在 4.5b keeper；3) `.composer-memory-picker-title` 是测试 pin |
| `.composer-textarea wrap` cluster 中的 `composer-textarea-wrapper` | 254-256 | 同 input cluster |

**Keeper 合计：~1315 行（占比 75%）。**

## 策略 split

### 本次 PR 范围（4.5d）

**3 步骤**：

**Step A — 死 CSS 清扫（零风险）**
- 删除前述 10 个死类簇（~284 行）
- 不改 tsx
- 验证：lint / typecheck / 全 composer 测试套通过

**Step B — 小 tsx inline（ComposerQueue + ComposerAttachments）**
- `composer-queue*` 全集群 inline 到 ComposerQueue.tsx，保留语义 className 作为 marker（home-chat 等 cascade 无 queue 依赖，但保留 marker 防 future regression）
- `composer-attachment*` + `composer-attachments` 集群 inline 到 ComposerAttachments.tsx，保留 `composer-attachment-name` / `composer-attachment-remove` 作为测试字面值 marker

**Step C — composer footer base inline**
- `composer` base + `.composer > *` + `.app.canvas-width-wide .composer*` + `.composer.is-disabled` + `.composer textarea:disabled` inline 到 Composer.tsx footer 元素
- 用 conditional Tailwind 替代 `.app.canvas-width-wide` cascade（通过 conditional className 或 `[.canvas-width-wide_&]:` arbitrary selector variant）
- `composer textarea:disabled` 用 `[&_textarea:disabled]:` arbitrary variant 

### 不做（推后到 follow-up）

- ComposerInput.tsx 大文件 inline（composer-input / footer / select / action / usage 集群）— 单文件 diff > 600 行 + EngineSelector 跨 feature
- composer-memory-picker / memory-picker-card 大集群 — 多 tsx 消费者 + chained 至 part2
- composer-action 主题 cascade — 大量 `:root[data-theme]` 覆盖
- composer-waveform / composer-dictation-* — 跨 feature（DictationWaveform.tsx）

## 关键 Token 映射

| 旧 token | coss / Tailwind |
|---|---|
| `var(--surface-card)` | `bg-card` |
| `var(--surface-messages)` | `bg-[var(--surface-messages)]` arbitrary |
| `var(--surface-item)` | `bg-[var(--surface-item)]` arbitrary |
| `var(--border-muted)` | `border-[var(--border-muted)]` arbitrary（无 coss 对应） |
| `var(--border-subtle)` | `border-border` |
| `var(--text-strong)` | `text-foreground` |
| `var(--text-muted)` | `text-muted-foreground` |
| `var(--text-faint)` / `--text-fainter` / `--text-quiet` | arbitrary `text-[var(...)]` |
| `var(--text-stronger)` | `text-foreground hover:text-foreground` 或 arbitrary |
| `var(--main-panel-padding)` | arbitrary `px-[var(--main-panel-padding)]` |
| `var(--surface-quiet)` | arbitrary `bg-[var(--surface-quiet)]` |
| `rgba(0,0,0,0.24)` | `shadow-[0_12px_28px_rgba(0,0,0,0.24)]` |

## 大文件 baseline 影响评估

| File | Before | After (估) | warn/fail |
|---|---:|---:|---|
| Composer.tsx | 2310 | ~2325 | 2400 / 2800 |
| ComposerQueue.tsx | 94 | ~125 | 2600 / 3000 |
| ComposerAttachments.tsx | 87 | ~130 | 2600 / 3000 |
| composer.part1.css | 1749 | ~1310 (keeper) | 2200 / 2800 |

Composer.tsx +15 行可控；其余 < 50 行 delta。

## 收缩条件

- 若 Composer.tsx 单文件 diff > 50 行 → 把 `.app.canvas-width-wide .composer` 保留为 keeper（小到不值得 inline）
- ComposerQueue.tsx / ComposerAttachments.tsx 单文件 diff > 150 行 → 简化 inline 粒度（合并多个 className 到 base 字符串）

## 测试不变性

- 全部 `data-testid` 不动
- 测试字面值 pin 的 className 保留：`composer-attachment-name`、`composer-attachment-remove`、`composer-memory-picker-title`
- 其余 className 保留为 no-op marker（避免漏掉未发现的字面值断言）

## 验证

```bash
npm run lint
npm run typecheck
npm run test:layout-guard
npm run check:large-files:gate
npx vitest run src/features/composer/
```

## Follow-up

- composer-input / footer / select / action / usage 集群 inline — 独立 sub-PR（涉及 ComposerInput.tsx 1634 行 + EngineSelector 跨 feature）
- composer-memory-picker 大集群 inline — 独立 sub-PR
- composer-action 主题 cascade Tailwind 化 — 独立 sub-PR
- DictationWaveform.tsx composer-waveform 重命名为 dictation-waveform，独立 sub-PR

---

## Execution Outcome (2026-05-17)

### 实际处置

**Step A 完成（纯死代码清扫，零风险）**：
- 删除 `composer-kanban-strip*` cluster（148-186 行原 part1）
- 删除 `composer-kanban-context-mode*` cluster（188-252）
- 删除 `composer-picker-*` cluster（picker-backdrop/modal/header/close/search/list/item/item:hover/item.is-selected/item-meta/empty，746-836）
- 删除 `composer-select-picker-trigger` 及关联 `is-opencode-model-picker` cluster
- 删除 `composer-select-wrap--settings-link` 系列
- 删除 `composer-link-button` + hover
- 删除 `composer-collaboration-hint`
- 删除 `composer-select-value--settings-link` + `composer-settings-link-icon`
- 删除 `composer-opencode-model-badge` + `--good/--warn/--neutral` + badges container

**Step B 完成（小 tsx inline）**：
- `composer-queue*` 全集群 → ComposerQueue.tsx（94 → 99 行，保留语义 className 作为 marker）
- `composer-attachments` + `composer-attachment*` cluster 含 hover-preview cascade 改为 Tailwind `group` + `group-hover:` → ComposerAttachments.tsx（87 → 95 行，保留 `composer-attachment-name` / `composer-attachment-remove` 作为测试字面值 marker）

**Step C 完成（composer footer base inline）**：
- `.composer` base + `.composer > *` + `.composer.is-disabled` + `.composer textarea:disabled` 全部 inline 到 Composer.tsx footer wrapper（2310 → 2312 行，+2 行）
- 用 Tailwind `[&>*]:` + `[&_textarea:disabled]:` 系列 arbitrary variant 替代后代选择器
- **`.app.canvas-width-wide .composer` cascade 保留为 keeper**：仅 6 行 CSS，ancestor `.app` 在 root，Tailwind arbitrary variant 等效但 noiser，按"收缩条件"保留

### Scope 收缩理由

| 跳过 | 原因 |
|---|---|
| `composer-input` / `composer-textarea*` / `composer-resize-handle*` | part2.css `.composer-shell .composer-input` cascade + ComposerInput.tsx 1634 行已含 144 处 className，inline 会推高 tsx > 600 行 diff |
| `composer-input-footer*` / `composer-footer-cluster*` / `composer-attach*` / `composer-plan-mode-toggle*` / `composer-mode-badge*` | 全是 part2.css `@container composer-footer (max-width: ...)` 子句的 cascade target，inline 会破坏 container query override（cascade hierarchy 微妙） |
| `composer-select-wrap*` / `composer-icon` / `composer-select-value` / `composer-select` / `composer-engine-status-dot` / `composer-inline-select-*` / `composer-opencode-model-indicator` | EngineSelector.tsx + ComposerInput.tsx 多消费者；EngineSelector 在 `src/features/engine/`，跨 feature 包不在 scope；含 `:root[data-theme]` overrides ~250 行 |
| `composer-action*` 系列 + `:root[data-theme]` overrides + `@media (prefers-color-scheme)` + `@keyframes composer-action-spin` | ~390 行主题 cascade，独立 sub-PR 处理（涉及 Light/Dark/Dim/prefers-color-scheme 多个 axis） |
| `composer-waveform*` / `composer-dictation-*` | DictationWaveform.tsx 跨 feature 包，不在 scope |
| `composer-usage-popover*` / `composer-usage-tooltip*` / `composer-usage-progress-*` 圆环 + 提示 | ComposerInput.tsx 消费者；包含 `::after` 伪元素三角箭头，inline 需要拆分子组件 |
| `composer-suggestions*` / `composer-memory-picker*` 大集群 | 多 tsx 消费者（ChatInputBoxFooter + ComposerInput），`composer-memory-picker-title` 测试 pin；与 4.5b memory-picker.css keeper cascade 联动 |
| `.app.canvas-width-wide .composer` cascade | 仅 6 行，inline cost > 收益 |

### 实际行数

| File | Before | After | Delta |
|---|---:|---:|---:|
| composer.part1.css | 1749 | 1258 | **-491 (-28%)** |
| composer.part2.css | 1188 | 1188 | 0（不动） |
| composer.memory-picker.css | 247 | 247 | 0（不动） |
| composer.rewind-modal.css | 422 | 422 | 0（不动） |
| composer.css | 3 | 3 | 0（不动） |
| Composer.tsx | 2310 | 2312 | +2 |
| ComposerQueue.tsx | 94 | 99 | +5 |
| ComposerAttachments.tsx | 87 | 95 | +8 |

合计 tsx delta: **+15 行**；CSS delta: **-491 行**；净 -476 行。

### 验证

- `npm run lint`：clean
- `npm run typecheck`：clean
- `npm run test:layout-guard`：46/46 passed
- `npm run check:large-files:gate`：1 baseline retained（SpecHubPresentationalImpl），delta=0
- `npx vitest run src/features/composer/`：453/453 passed

### 测试 pin 保留验证

- `composer-attachment-name` (ComposerInput.attachments.test.tsx:107) → ComposerAttachments.tsx 保留 ✓
- `composer-attachment-remove` (ComposerInput.attachments.test.tsx:243) → ComposerAttachments.tsx 保留 ✓
- `composer-memory-picker-title` (ComposerInput.manual-memory.test.tsx:215) → memory-picker keeper 保留（未触及）✓

### 跨包不变性

- `EngineSelector.tsx` 跨 feature 包：未触及，相关 `composer-select-wrap*` / `composer-icon` / `composer-select-value` / `composer-engine-status-dot` / `composer-inline-select-*` 全部 keeper ✓
- `DictationWaveform.tsx` 跨 feature 包：未触及，相关 `composer-waveform*` / `composer-dictation-*` 全部 keeper ✓
- `home-chat.css` `.home-chat-composer-host .composer` cascade：通过 `composer` className 保留 → cascade 继续生效 ✓
- `kanban.css` `.kanban-rich-input .composer-ghost-text-overlay`：不在 part1，未触及 ✓
- `review-inline.css` `.composer-suggestions.review-inline-suggestions`：composer-suggestions 是 keeper，cascade 继续生效 ✓
- `composer.part2.css` `@container composer-footer` 子句 + `.composer-shell .composer-input` cascade：全部 keeper 类保留 → cascade 继续生效 ✓
