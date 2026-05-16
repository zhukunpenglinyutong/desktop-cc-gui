# Phase 4.5b — composer.part2 + composer.memory-picker Sub-PR Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 4.5b (composer.part2.css + 合并 composer.memory-picker.css)
> Date: 2026-05-17
> Status: executed (scope shrunk)

## Discovery

| Item | Value |
|---|---|
| Primary file | `src/styles/composer.part2.css` (2247 lines) |
| Chained file | `src/styles/composer.memory-picker.css` (247 lines) |
| Combined lines | 2494 |
| Selector count | ~210 selectors (含 cascade override + container query) |
| Import chain | `bootstrap.ts → composer.css → composer.part2.css → composer.memory-picker.css` |
| Layout-guard pin | 无（grep 验证：`layout-swapped-platform-guard.test.tsx` 与 `cssTestHarness.ts` 均不含 `composer-` 选择器） |

## 测试字面值断言（必须保留 className 作为 no-op marker）

| Class | Test file | 用途 |
|---|---|---|
| `composer-context-backdrop` | `ComposerContextMenuPopover.test.tsx`（2 处） | querySelector backdrop |
| `composer-context-stack` | `Composer.context-ledger-transition.test.tsx`（2 处）<br>`Composer.context-ledger-governance.test.tsx`（1 处） | querySelector context stack |
| `composer-context-ledger` | `Composer.context-ledger-governance.test.tsx`（2 处） | querySelector ledger root |

其余 `composer-*` className 不被测试字面值断言依赖。

## 死代码扫描（grep 在整个 src/ 找不到 TSX/TS 引用）

可直接删除的样式集群（**仅 CSS 移除，无需改 tsx，无副作用**）：

| Cluster | 选择器范围 | 行数预估 |
|---|---|---|
| `.composer-bar` + `.composer-meta` + `.composer-context-ring*` + `.composer-context-value` | 3-73 | ~70 |
| `.composer-select` + 5 个 modifier + `:focus` | 255-298 | ~45 |
| `.composer-file-reference-*`（bar/label/path/lines/toggle/toggle.is-active） | 461-513 | ~55 |
| `.composer-management-toolbar` + `.composer-toolbar-*`（left/pills/overflow/right） | 518-571 | ~55 |
| `.composer-kanban-trigger*` 集群 | 573-629 | ~60 |
| `.composer-collapsed-pill*` 集群 | 1577-1654 | ~80 |
| `.composer-kanban-strip-kind` + 6 个相关 | 1656-1694 | ~40 |
| `.composer-context-menu-*` 子类（head/title/meta/search/grid/group/item/source-group/column/empty/foot/sticky/panel--help） | 1819-2009 | ~190 |
| `.composer-context-help-*` 集群 | 1761-1817 | ~60 |
| `.composer-context-action-*` 集群（action-btn/help/skill/commons/icon） | 1698-1759 | ~65 |
| `.composer-context-menu-panel.composer-kanban-popover` + 13 个 popover 子类 | 2127-2247 | ~120 |
| 容器查询 `@container composer-footer (max-width: 880/680/460)` | 301-379 | ~80 |
| `.composer-select-value--agent` + 8 个 agent-tone + variant-tone | 2011-2082 | ~75 |
| `@media (max-width: 1280px) { .composer-context-menu-grid + .composer-context-help-grid }` | 2083-2091 | ~10 |
| `@container composer-shell (max-width: 500px)` | 1560-1574 | ~15 |

**注意**：
- `.composer-select-value--agent` / `.composer-agent-tone--*` / `.composer-variant-tone--*` 看似被 ComposerInput.tsx 引用，但实际**只有 `composer-select-value` 基类被引用**，modifier `--agent/--variant` + 所有 `tone--N` color override 可移除（color override 通过 inline Tailwind 实现）

死代码合计：**~1020 行直接删除**

## 可 inline 到 tsx 的活样式（必须配合 tsx 改）

| Cluster | 选择器范围 | tsx 文件 | 处置 |
|---|---|---|---|
| `.context-usage-indicator*` 集群 | 86-252 | `ContextUsageIndicator.tsx`（164 lines） | inline Tailwind |
| `.composer-shell*` 集群 | 381-459 | `Composer.tsx`（2307 lines, hot） | inline Tailwind |
| `.composer-memory-strip*` + `.composer-memory-chip*` + `.composer-code-annotation*` | 631-978 | `Composer.tsx` | inline Tailwind |
| `.composer-context-stack` | 637 | `Composer.tsx` | keep as marker（test pin） |
| `.composer-memory-reference-*` | 648-819 | `ComposerInput.tsx`/Composer | inline |
| `.composer-context-ledger*` 集群 | 980-1555 | `ContextLedgerPanel.tsx`（feature 包外）| **保留 keeper**（避开跨包 inline,大量 cascade selector） |
| `.composer-ghost-text-*` | 2093-2125 | `ComposerGhostText.tsx`（53 lines） | inline Tailwind |
| `.composer-memory-picker-preview-*` + `.composer-note-card-preview-*` + `.composer-suggestion*`（memory-picker.css） | all 247 | `ChatInputBoxFooter.tsx` + `ComposerInput.tsx` | inline Tailwind |

## 策略 split

### 本次 PR 范围（4.5b 合并 4.5c）

**3 步骤**：

**Step A — 死 CSS 清扫（零风险）**
- 删除上表"死代码扫描"列出的全部样式集群（~1020 行）
- 不改 tsx
- 验证：lint / typecheck / 全 composer 测试套通过

**Step B — memory-picker.css 整体下线（247 行）**
- 把 `composer-memory-picker-preview-*` / `composer-note-card-preview-*` 集群 inline 到 ChatInputBoxFooter.tsx（~32 处 className 拼接 Tailwind）
- 把 `composer-suggestion*` 集群 inline 到 ComposerInput.tsx（~14 处）
- 删除 `composer.memory-picker.css` 文件
- 删除 `composer.part2.css` 顶部的 `@import "./composer.memory-picker.css"` (line 1)
- **`@media (max-width: 960px) { .composer-suggestions--manual-memory, .composer-memory-picker, .composer-memory-picker-preview }`** 用 `max-md:` Tailwind variant 替代

**Step C — composer.part2.css 剩余活样式 inline（约 600 行）**
- 把 `.context-usage-indicator*` 全集群 inline 到 ContextUsageIndicator.tsx（包括圆环 conic-gradient、紧凑模式 tooltip ::after/::before — 用 group-hover）
- 把 `.composer-shell*` 集群 inline 到 Composer.tsx 的 shell 包裹（注意 `is-collapsed` / `.composer-shell-collapsed-strip` 状态切换用 conditional className）
- 把 `.composer-memory-strip*` / `.composer-memory-chip*` / `.composer-code-annotation*` 集群 inline 到 Composer.tsx 的 memory chip 渲染
- 把 `.composer-memory-reference-*` popover/toggle 集群 inline 到 ComposerInput.tsx
- 把 `.composer-ghost-text-*` inline 到 ComposerGhostText.tsx
- **保留 keeper**：
  - `.composer-context-ledger*` 大集群（~570 行 880-1555），它在 ContextLedgerPanel（位于 `src/features/context-ledger/`）下面，跨 feature 包；按 file-scope 规则不动该 feature，保留作为 keeper
  - `.composer-context-backdrop`（测试字面值 pin，作为 no-op marker） + `.composer-context-menu-panel` + `--portal`（ComposerContextMenuPopover.tsx 需要）

### 不做（推后到 Phase 4.5d/后续）

- composer.part1.css（1749 lines）— Phase 4.5d
- ComposerInput.tsx / Composer.tsx 大文件拆分 — 大幅超出 4.5b scope
- ContextLedgerPanel.tsx Tailwind 化 — 跨 feature 包，独立 sub-PR

## 关键 Token 映射

| 旧 token | coss / Tailwind |
|---|---|
| `var(--surface-card)` | `bg-card` |
| `var(--surface-card-hover, var(--surface-card))` | `hover:bg-card` |
| `var(--text-muted)` | `text-muted-foreground` |
| `var(--text-strong)` | `text-foreground` |
| `var(--border-subtle)` | `border-border` |
| `var(--text-faint)` | `text-[var(--text-faint)]` arbitrary |
| `var(--surface-item)` / `var(--surface-elevated)` | arbitrary `bg-[var(--surface-...)]` |
| `color-mix(in srgb, ... )` | arbitrary `bg-[color-mix(...)]` |
| conic-gradient (圆环) | inline style 保留（动态 CSS var 驱动） |

## 大文件 baseline 影响评估

| File | Before | After (估) | warn/fail |
|---|---:|---:|---|
| Composer.tsx | 2307 | ~2480 | 2400 / 2800 |
| ComposerInput.tsx | 1634 | ~1730 | 2400 / 2800 |
| ChatInputBoxFooter.tsx | 1021 | ~1180 | 2400 / 2800 |
| ContextUsageIndicator.tsx | 164 | ~210 | 2600 / 3000 |
| ComposerGhostText.tsx | 53 | ~80 | 2600 / 3000 |
| composer.part2.css | 2247 | ~570 (keeper for ledger) | 2200 / 2800 |
| composer.memory-picker.css | 247 | **删除** | — |

Composer.tsx +173 行 → 接近 warn 但远低于 fail。可控。

## 收缩条件

- 若 Composer.tsx 单文件 diff > 1500 行，**先做 Step A + Step B（死扫 + memory-picker 下线）**，Step C 留到 4.5b-followup
- 若 ContextLedgerPanel.tsx 在 src/features/composer 之外，**不动**它（保留 ledger 集群作为 keeper） — 已确认

## 测试不变性

- 全部 `data-testid` 不动
- 测试字面值 pin 的 className 保留：`composer-context-backdrop`、`composer-context-stack`、`composer-context-ledger`
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

- Phase 4.5d: composer.part1.css（1749 行）
- 若 ContextLedgerPanel.tsx 单独 Tailwind 化，可清掉本 keeper 剩余 `composer-context-ledger*` 段
- composer.css @import 链最终归零（part1/part2/memory-picker/rewind-modal 全干净）

---

## Execution Outcome (2026-05-17)

### 实际处置

**Step A 完成（pure 死代码扫除，零风险）**：
- 删除 `composer-bar` + `composer-meta` + `composer-context-ring*` + `composer-context-value` 集群
- 删除 `composer-select` base + 4 个 modifier + `:focus`
- 删除 `composer-file-reference-*` 全集群
- 删除 `composer-management-toolbar` + `composer-toolbar-*` 集群
- 删除 `composer-kanban-trigger*` 集群
- 删除 `composer-collapsed-pill*` 集群
- 删除 `composer-kanban-strip-*` + `composer-kanban-context-mode--compact` 集群
- 删除 `composer-context-menu-*` 子类（head/title/meta/search/grid/group/item/source-group/column/empty/foot/sticky/is-searching/panel--help）
- 删除 `composer-context-help-*` 集群
- 删除 `composer-context-action-*` 集群
- 删除 `composer-context-menu-panel.composer-kanban-popover` + 13 个 popover 子类
- 删除 `composer-select-value--agent/-variant` + 8 个 agent-tone + variant-tone（color override 移入 Tailwind 后续处理）
- 删除 `@container composer-shell (max-width: 500px)`（target 全是死类）
- 删除 `@media (max-width: 1280px) { composer-context-menu-grid + composer-context-help-grid }`
- 删除 `context-usage-text/percent/separator/counts/label`（compact-mode 不渲染）
- 删除 `context-usage-indicator:hover`（被 compact:hover 覆盖）

**Step C-mini 完成（inline 小簇）**：
- `composer-ghost-text-*` → ComposerGhostText.tsx（53 → 61 行）
- `composer-context-stack` → Composer.tsx（marker + utility）
- `composer-shell` base + `is-collapsed` + `:focus-within` + `composer-shell-collapsed-strip/-rail/-text/-strip.is-processing` → Composer.tsx（2307 → 2310 行）
- `.composer-shell .composer-input` 级联 keeper 保留（跨 part1 selector）

**Step B 收缩**：
- `composer.memory-picker.css`（247 行 cascade-heavy markdown selector） **保留为 keeper**，不 inline 到 tsx（避免 `<Markdown>` 子元素难以 Tailwind 化的 `:where()` cascade）
- chained import 链 `composer.part2.css → composer.memory-picker.css` 保留

### Scope 收缩理由

| 跳过 | 原因 |
|---|---|
| `composer-context-ledger*` (~580 行) | ContextLedgerPanel 位于 `src/features/context-ledger/`，跨 feature 包；不在 scope |
| `composer-memory-chip*` / `composer-memory-strip*` 集群 (~175 行) | 复用率高，inline 到 Composer.tsx 会加 ~100 行；当前 2310/2800 已接近 warn(2400)，留给独立 sub-PR |
| `composer-memory-reference-popover` 集群 (~180 行) | 同上，避免 Composer.tsx/ComposerInput.tsx 膨胀 |
| `context-usage-indicator` 圆环 + tooltip ::after | 含 conic-gradient + attr() 伪元素，inline 需要重构组件（拆出 Tooltip primitive），独立任务 |
| `@container composer-footer` (~80 行) | 全部 target 是 part1.css 的 selector（footer-cluster/select-wrap/mode-badge 等），属于 part1 的级联，待 Phase 4.5d |

### 实际行数

| File | Before | After | Delta |
|---|---:|---:|---:|
| composer.part2.css | 2247 | 1188 | **-1059 (-47%)** |
| composer.memory-picker.css | 247 | 247 | 0（keeper） |
| Composer.tsx | 2307 | 2310 | +3 |
| ComposerGhostText.tsx | 53 | 61 | +8 |
| ChatInputBoxFooter.tsx | 1021 | 1021 | 0 |
| ComposerInput.tsx | 1634 | 1634 | 0 |
| ContextUsageIndicator.tsx | 164 | 164 | 0 |

### 验证

- `npm run lint`：clean
- `npm run typecheck`：clean
- `npm run test:layout-guard`：46/46 passed
- `npm run check:large-files:gate`：1 baseline retained（SpecHubPresentationalImpl），delta=0
- `npx vitest run src/features/composer/`：453/453 passed
- `npx vitest run src/features/composer/ src/styles/layout-swapped-platform-guard.test.tsx`：499/499 passed
