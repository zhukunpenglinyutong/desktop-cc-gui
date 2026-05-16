# Phase 3.5 — messages.history-sticky.css coss 化 discovery + scope-shrink

## Discovery 汇总

### CSS 文件

- `src/styles/messages.history-sticky.css` 394 行
- import 入口：`src/styles/messages.css:1`（链式入口；不在 `bootstrap.ts` 直接 import）

### tsx consumer

唯一渲染处：`src/features/messages/components/MessagesTimeline.tsx` line 478-530，8 个 className 引用：

- `.messages-history-sticky-header[data-history-sticky-collapsed]`（root）
- `.messages-history-sticky-header-inner`
- `.messages-history-sticky-header-content`
- `.messages-history-sticky-header-bubble` + `is-collapsed`
- `.messages-history-sticky-header-toggle`
- `.messages-history-sticky-header-leading`
- `.messages-history-sticky-header-text`
- `.messages-history-sticky-header-peek`

### 测试 pin

#### A. `Messages.live-behavior.test.tsx` 21 处（sticky carry-forward 行为契约）

只 query DOM class，不依赖 CSS rule 存在。Tailwind 内联 + 保留 className 字符串即可保持 45/45 通过。

#### B. `layout-swapped-platform-guard.test.ts` 9 个 test（lines 346-458，强 pin）

P0 commit `1384e9f4` 把字面 `toContain` 重构成 cssRules introspection，**但仍要求 CSS rule 物理存在**：

| Test 行 | 断言依赖 | 删除 .css 后 |
|---|---|---|
| 368-373 | `getComputedStyle(header).marginRight` 含 `main-panel-padding` | ❌ |
| 375-378 | wide-canvas marginRight `=== "-25px"` | ❌ |
| 380-383 | collapsed inner paddingRight `=== "0px"` | ❌ |
| 385-388 | collapsed content justifyContent `=== "flex-end"` | ❌ |
| 390-395 | bubble width 含 `peek-width` | ❌ |
| 397-407 | `findRuleBySelector(".messages-history-sticky-header-content")` 含 `--messages-history-sticky-peek-width: 16px` | ❌ |
| 409-428 | peek rule 有 `border-radius: 0` / `clip-path: none` | ❌ |
| 430-437 | `findRuleBySelector(".messages-history-sticky-header-peek::before")` width=5px height=26px | ❌ |
| 439-457 | cssRules 索引序：`canvas-width-wide` 在 collapsed override 之前 | ❌ |

直接删除 .css 会让上述 9 个 test 全 fail，违反 "test:layout-guard 46/46" 验证要求。

## Phase 3 carry-forward 4 条 baseline 验证

| Carry-forward | 实现位置 | 本次是否触及 |
|---|---|---|
| realtime 不渲染 `.messages-live-sticky-user-message` | `messagesUserPresentation.ts` + MessagesTimeline class 永远不会渲染该 class | ❌ 不动 |
| realtime/history 共用 sticky 出口 | `MessagesTimeline.tsx:478` `activeStickyHeaderCandidate` 唯一渲染点 | ❌ 不动 |
| realtime 回看 → history-style handoff | `useStickyMessageSelector` + `messagesLiveWindow` hooks | ❌ 不动 |
| trimmed live latest question 驱动 sticky | `messagesUserPresentation.ts` 计算 | ❌ 不动 |

baseline 验证：

- `npx vitest run src/features/messages/components/Messages.live-behavior.test.tsx` → **45/45 pass**
- `npm run test:layout-guard` → **46/46 pass**

## 阻塞分析

P0 commit `1384e9f4` 自述 "解锁 messages.history-sticky.css 等 sub-phase 删除"，但实际只把字面文本 `toContain` 改为 cssRules introspection。**rule 删除依然会被 detect**。要让 layout-guard 真正 "不 pin .css 文件本身"，必须再做一步把 sticky-section 9 个 test 改造为 React-mount 行为断言。

## 选项分析

| 选项 | 内容 | 评估 |
|---|---|---|
| A 完整迁移 | Tailwind 内联 + 删 .css + 删 @import | ❌ layout-guard 9 个 test fail，违反 46/46 |
| B 折中（保留 .css 子集） | 把 layout-guard pin 的 9 条 rule 留在 .css，其它内联 Tailwind | ❌ 双源真值，与 "good taste" 冲突；维护负担 |
| C 修改 layout-guard test | 改成 React-mount 断言后再删 .css | ⚠️ layout-guard test 文件在 `src/styles/` 未明确属允许或禁止，但本次 PRD 文字 emphasis 在 "messages 相关 file scope"，refactor layout-guard 属于独立 sub-phase 工作量 |
| D scope-shrink + plan doc | 不动 .css，留 follow-up | ✅ 安全、诚实、不触碰 scope 红线 |

## 决策：选项 D（scope-shrink）

理由：

1. **task 严格 verification 要求 `test:layout-guard 46/46`**。任何让 9 个 layout-guard test fail 的改动都违反此条
2. **task 允许文件清单未列 layout-guard test**。即便不在显式禁止清单，refactor 它属于独立工作量（spike + 9 个断言 case-by-case 迁移），属于另一个 sub-phase
3. **Phase 3.5 真正前置条件没满足**：P0 commit 的"解锁"实际只换了断言形式，没解除 rule-existence 依赖。必须先做一个 **Phase 3.5-pre** 把 sticky 9-test 改造为 mount 断言，才能让 .css 删除真正不被 pin
4. **本会话不破坏任何已有契约**：sticky 4 条 carry-forward 全部不动，45/45 + 46/46 baseline 保留

## 后续推进路径

### Phase 3.5-pre（建议新 sub-phase）

把 `layout-swapped-platform-guard.test.ts` lines 346-458 的 9 个 sticky test 从 cssRules introspection 改为：

**推荐方案：data-* 属性 + 行为断言**

- 验证 `data-history-sticky-collapsed="true"` 时 bubble 元素 className 含 `is-collapsed`
- 视觉细节（peek-width=16px、peek::before=5×26、cascade 顺序）下放到 Playwright 视觉回归或单独 component story
- 优点：依赖更少；缺点：失去 CSS-level 断言 → 由视觉回归补足

**备选方案：React Testing Library mount + getComputedStyle**

- mount 真 `<MessagesTimeline>` props 包含 `activeStickyHeaderCandidate` + `isStickyHeaderCollapsed=true`
- 读 `getComputedStyle` 验证 Tailwind class 解析值
- 风险：MessagesTimeline 依赖大量 hooks，mount 成本高

### Phase 3.5 正式落地（在 3.5-pre 完成后）

1. Tailwind 内联 MessagesTimeline.tsx line 478-530（保留 className 字符串为 querySelector marker）
2. 删除 `src/styles/messages.history-sticky.css`
3. 删除 `src/styles/messages.css:1` `@import` 行
4. 验证 `Messages.live-behavior.test.tsx` 45/45 + layout-guard 维持总数 pass

## 本会话产出

- **改动文件**：仅本份 plan doc（新建）
- **未改动**：`messages.history-sticky.css` / `messages.css` / `bootstrap.ts` / `MessagesTimeline.tsx`
- **baseline 验证**：`Messages.live-behavior.test.tsx` 45/45、`test:layout-guard` 46/46

## Follow-up（orchestrator 处理）

1. **Phase 3.5-pre**（新 sub-phase）：layout-guard sticky 9-test 改造为方案 1 风格。预估 1 会话完成
2. **Phase 3.5**（recurse）：本会话报告的迁移内容落地。预估 1 会话完成
3. 其它 messages.* 文件（part1/part2/part1-shell/status-shell）的迁移依然 deferred，需要类似 pre-phase 拆解（同样被 layout-guard `.claude-render-safe` / `.messages-live-controls` 等 selector pin）
