# Phase 9.5 — opencode-panel.css coss 化 Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 9.5 (opencode-panel — Phase 9 第二个 sub-PR)
> Date: 2026-05-17
> Worktree: main, head `b280d6d2`
>
> Outcome target: 删除 `src/styles/opencode-panel.css`（915 行 / 125 selectors）；全部 panel chrome + drawer + tabs + 5 个 cluster section（onboarding / overview / provider / mcp / sessions / advanced）的样式 inline 到 `OpenCodeControlPanel.tsx` + 4 个子 section tsx 上，作为 Tailwind utility + 保留 semantic className marker。修改 `bootstrap.ts` 第 33 行删除该 css import。**无 keeper file**——全文件无 cascade-based DOM 节点（无 markdown / 无第三方 DOM 注入）、无 theme-aware override 链、无字面值 pin。

## Discovery

### CSS scope

| Item | Value |
|---|---|
| 文件 | `src/styles/opencode-panel.css` |
| 行 | 915 |
| Selectors | 125 |
| 媒体查询 | 1 个 `@media (max-width: 900px)`（含 3 条 rule） |
| `!important` 数 | 4 处（207 / 427 / 428 / 432 / 495） |
| Bootstrap | `src/bootstrap.ts:33` `import "./styles/opencode-panel.css";` |
| 字面值 pin | NO（验证：`grep -l "opencode" src/styles/*.test.*` → 0 hits） |
| Cross-file cascade | NO（验证：`grep "opencode-" src/styles/*.css` → 仅 opencode-panel.css 自身） |

### tsx consumer surface

| File | 行 | `.opencode-*` className 出现数 |
|---|---:|---:|
| `src/features/opencode/components/OpenCodeControlPanel.tsx` | 1011 | 48 |
| `src/features/opencode/components/OpenCodeProviderSection.tsx` | 72 | 9 |
| `src/features/opencode/components/OpenCodeMcpSection.tsx` | 53 | 9 |
| `src/features/opencode/components/OpenCodeSessionsSection.tsx` | 92 | 15 |
| `src/features/opencode/components/OpenCodeAdvancedSection.tsx` | 61 | 8 |

总计 5 个 tsx 文件 / **89 处 className 引用** / **0 处第三方 DOM 注入**（无 markdown、无 prism、无 xterm）。

### querySelector pin in test

`OpenCodeControlPanel.test.tsx` 仅一处 CSS-class pin：

```
172: expect(container.querySelector(".opencode-panel-toggle")).toBeNull();
```

→ **必保留** `opencode-panel-toggle` 作为 no-op semantic marker（标记按钮存在/缺席的 dock-mode 行为契约）。

`data-testid="opencode-control-panel"`（line 85）和 `data-testid="opencode-control-panel"`（ComposerEditorHelpers.test.tsx:24 mock 占位符）都是 testid，与 CSS class 无关，与本 phase 无冲突。

### 不动 cross-file（contract 保护）

- `src/features/composer/components/ComposerEditorHelpers.test.tsx:24` —— `<div data-testid="opencode-control-panel" />` mock 占位符，使用 testid 而非 className。无关。
- `src/features/threads/hooks/useThreadActions.ts:1915,1917` —— `"opencode-session-timeout"` 是 telemetry/recovery 字符串字面 ID，不是 CSS className。无关。
- 其它 `opencode/` 文件夹外含 `opencode` 关键字的 ts/tsx 文件均为 vendor / runtime / settings 业务源代码，**不消费**任何 `opencode-panel.css` 中定义的 className。

### Codex unified-exec override contract verification

按 `.trellis/spec/guides/codex-unified-exec-override-contract.md`，contract 触点：
- `src-tauri/src/types.rs` / `settings_core.rs` / `codex/config.rs` / `codex/args.rs` / `settings/mod.rs`
- `src/services/tauri.ts`
- `src/features/settings/hooks/useAppSettings.ts`
- `src/features/settings/components/SettingsView.tsx`

验证：
```bash
$ grep -rn "codex_unified_exec\|codexUnifiedExec\|useAppSettings" src/features/opencode --include="*.ts" --include="*.tsx"
# 0 hits
```

→ **本 phase 完全不触及 contract**。OpenCode 与 codex vendor 在 settings 层有独立 `opencodeEnabled` 布尔 flag（`useAppSettings.ts:141,300`），但本 phase 不动 settings 任一文件，opencode-panel.css 也不会影响 vendor settings 渲染。Contract 自然保留。

### `terminal-shell-configuration.md` sanity check

`.trellis/spec/guides/terminal-shell-configuration.md` 覆盖 `AppSettings.terminalShellPath` / `terminal_open` —— 与 opencode CLI 启动相关。但 opencode 的 CLI 启动通过 `OpenCodeProviderSection.onConnectProvider` 触发，是 hook 行为而非 CSS。本 phase 不动 hook 或 terminal 启动代码。Contract 不受影响。

### `--oc-*` token 起源

`opencode-panel.css:1-26` 内部定义 27 个 `--oc-*` CSS custom property，全部基于：
- 现有全局 token（`--surface-card` / `--surface-item` / `--text-strong` / `--border-subtle` 等）作为 `var(...)` 第一参
- **硬编码 fallback 颜色** 作为 `var(...)` 第二参（如 `#fff` / `#1d4ed8` / `#dcfce7`）

**重要**：`--status-success-bg/-fg/-dot`、`--status-error-bg/-fg/-dot`、`--status-warning-bg/-fg/-dot`、`--interactive-primary` 在 `themes.light.css` / `themes.dark.css` / `globals.css` 中均**未定义**（已 grep 验证），仅由 opencode-panel.css 通过硬编码 fallback 提供。因此 inline 时可直接使用 fallback 字面颜色（与原渲染等价），无需引入新的 global token。

仍存在的全局 token 依赖（inline 时直接 `var(--xxx)`）：
- `--surface-card` / `--surface-item` / `--surface-control-hover` —— theme 切换敏感，保留 `var()`
- `--text-strong` / `--text-muted` / `--text-accent` —— theme 切换敏感，保留 `var()`
- `--border-subtle` / `--border-strong` / `--border-accent-soft` / `--border-accent` —— theme 切换敏感，保留 `var()`

## CSS 内部分簇

| 行段 | Selectors | 内容 | 处理 |
|---|---:|---|---|
| 1-37 | 1 | `.opencode-panel` root + 27 个 `--oc-*` 变量定义 + border / padding / margin / background gradient | inline 到 `OpenCodeControlPanel.tsx` section root；27 个 `--oc-*` 不再需要（合并 fallback 直接用），减少间接层 |
| 39-83 | 8 | `.opencode-panel.is-embedded` / `.opencode-panel.is-dock` 状态变体 + 子选择器 cascade | inline 到 `OpenCodeControlPanel.tsx` 的条件 className（`${embedded ? ... : ""}${dock ? ... : ""}`） |
| 85-125 | 4 | header / actions / toggle / title / grid 基础布局 | inline 到 header / button / title 元素 |
| 127-148 | 2 | summary 容器 + summary-pill 基础 | inline 到对应元素 |
| 150-210 | 9 | connection-indicator + connection-dot + 状态变体（is-ok / is-runtime / is-fail）+ dock-mode 复合 cascade（5 条 `.opencode-panel.is-dock .opencode-connection-indicator...`） | inline 到 indicator/dot 元素；dock-mode 复合选择器在 tsx 通过条件 className 拼接（dock=true 时追加 utility） |
| 212-298 | 7 | drawer-layer / drawer / drawer-header / drawer-title / drawer-close / drawer-tabs / drawer-tab + tab-active 状态 + drawer-content | inline 到 drawer-layer/aside/header/button/div 元素 |
| 300-345 | 7 | onboarding-card + onboarding 元素 (h4 / p / metrics / chip + chip-open 状态) | inline 到 OpenCodeControlPanel 的 onboarding section |
| 347-433 | 14 | auth-expand + auth-line + tone 变体 + key/value/vendors/vendor-tag + tag-hover + tag-selected + provider-status-hint + onboarding-next-step | inline 到 auth-expand 内的元素 |
| 435-485 | 8 | overview-layout + panel-item + 状态变体（is-session / is-hero / is-control）+ summary-pill 状态变体（is-ok / is-fail / is-runtime） | inline 到 overview section + summary-pill 元素 |
| 487-524 | 5 | control-icon-label + panel-item strong + panel-select + provider/mcp/sessions/advanced section spacing | inline 到 icon-label span + select 元素 + 4 个 section root |
| 526-606 | 12 | provider-head / provider-title / provider-status + tones / provider-meta / provider-connect / provider-select-wrap / provider-picker-trigger / provider-picker-caret / provider-search | inline 到 OpenCodeProviderSection.tsx 元素 |
| 608-689 | 9 | provider-modal-backdrop / provider-modal / provider-modal-header / provider-modal-close / provider-modal-list / provider-modal-group-title / provider-option + hover + selected | **目前 OpenCodeProviderSection 已 simplified 不渲染 provider modal**（line 26-71 仅渲染 connect button + hint + feedback），但 className 字面在 css 中存在；视作 unused 直接删除 |
| 691-741 | 9 | provider-connect-btn + provider-hint + provider-test + connect-btn/test svg 尺寸 + provider-feedback | inline 到 OpenCodeProviderSection 的 button / hint / feedback 元素 |
| 743-781 | 7 | toggle / mcp-list / mcp-row / mcp-name / mcp-status / mcp-empty / panel-error | inline 到 OpenCodeMcpSection 元素 + OpenCodeControlPanel 的 error 元素 |
| 783-863 | 9 | session-filters / filter-btn + active / session-search / session-list / session-row / session-fav + is-favorite icon / session-main / session-title / session-meta | inline 到 OpenCodeSessionsSection 元素 |
| 865-892 | 4 | advanced-toggle + svg transition + svg open / advanced-content | inline 到 OpenCodeAdvancedSection 元素 |
| 894-915 | 4 | `@media (max-width: 900px)` —— panel-header wrap + panel-actions margin-left + drawer responsive + summary-pill max-width | inline 用 Tailwind `max-[900px]:` arbitrary breakpoint |

## 策略：一次性 split & delete（无 keeper）

PRD 9.5 plan 套路建议 in-place trim 或全删。本 phase 评估：

- 全文件 0 cascade-based DOM 节点
- 全文件 0 theme override 链（theme 切换通过 `var(--surface-*)` 等全局 token 自动生效，不需要 opencode-* selector 内置 `:root[data-theme]` 块）
- 全文件 0 字面值 pin
- 全文件 0 第三方 DOM 注入
- 唯一 cross-file 依赖：1 个 querySelector pin（`opencode-panel-toggle`），通过保留 className 作为 no-op marker 即可

→ **全删 + inline，无 keeper file**。与 Phase 9.4 terminal.css 不同（terminal 有 xterm DOM + main-grid contract），opencode-panel 完全自包含可以一次性删除。

### tsx diff 预估

| File | className 引用数 | 估算 diff |
|---|---:|---:|
| OpenCodeControlPanel.tsx | 48 | ~80 行 |
| OpenCodeProviderSection.tsx | 9 | ~25 行 |
| OpenCodeMcpSection.tsx | 9 | ~20 行 |
| OpenCodeSessionsSection.tsx | 15 | ~30 行 |
| OpenCodeAdvancedSection.tsx | 8 | ~15 行 |

合计约 ~170 行 tsx diff，远低于 1500 行 prompt 阈值 → 一次性合并所有子文件 inline。

## Token 映射表

| 旧 `--oc-*` 内部变量 | 字面映射 | Tailwind 写法（建议） |
|---|---|---|
| `--oc-surface` | `var(--surface-card, #fff)` | `bg-[var(--surface-card,#fff)]` |
| `--oc-surface-subtle` | `var(--surface-item, #f8fafc)` | `bg-[var(--surface-item,#f8fafc)]` |
| `--oc-surface-hover` | `var(--surface-control-hover, #eff6ff)` | `bg-[var(--surface-control-hover,#eff6ff)]` |
| `--oc-border` | `var(--border-subtle, #d7dce8)` | `border-[color:var(--border-subtle,#d7dce8)]` |
| `--oc-border-strong` | `var(--border-strong, #bfdbfe)` | `border-[color:var(--border-strong,#bfdbfe)]` |
| `--oc-text` | `var(--text-strong, #111827)` | `text-[color:var(--text-strong,#111827)]` |
| `--oc-text-muted` | `var(--text-muted, #6b7280)` | `text-[color:var(--text-muted,#6b7280)]` |
| `--oc-text-accent` | `var(--text-accent, var(--interactive-primary, #1d4ed8))` | `text-[color:var(--text-accent,#1d4ed8)]`（fallback 简化为最终颜色） |
| `--oc-shadow` | `color-mix(in srgb, #0f172a 28%, transparent)` | `shadow-[0_24px_56px_color-mix(in_srgb,#0f172a_28%,transparent)]` |
| `--oc-backdrop` | `color-mix(in srgb, #0f172a 16%, transparent)` | `bg-[color-mix(in_srgb,#0f172a_16%,transparent)]` |
| `--oc-status-ok-bg` | `#dcfce7`（global 未定义） | `bg-[#dcfce7]` |
| `--oc-status-ok-fg` | `#166534` | `text-[#166534]` |
| `--oc-status-fail-bg` | `#fee2e2` | `bg-[#fee2e2]` |
| `--oc-status-fail-fg` | `#991b1b` | `text-[#991b1b]` |
| `--oc-status-runtime-bg` | `#fffbeb` | `bg-[#fffbeb]` |
| `--oc-status-runtime-fg` | `#92400e` | `text-[#92400e]` |
| `--oc-status-ok-dot` | `#22c55e` | `bg-[#22c55e]` |
| `--oc-status-fail-dot` | `#ef4444` | `bg-[#ef4444]` |
| `--oc-status-runtime-dot` | `#f59e0b` | `bg-[#f59e0b]` |
| `--oc-button-primary-bg/border/text` | 派生于 `--oc-border-accent-soft/border-accent` 与 `--oc-surface` | 同上 fallback 字面值（精确字面色保留） |

按 PRD 决策 = **不引入 brand color override**（留 follow-up），inline 时优先保留 token，缺失的 status/-interactive token 用字面 fallback。

## Files changed (this PR)

1. **Deleted** `src/styles/opencode-panel.css` —— 915 行删除。
2. **Modified** `src/bootstrap.ts` —— 第 33 行 `import "./styles/opencode-panel.css";` 删除（仅这 1 行）。
3. **Modified** `src/features/opencode/components/OpenCodeControlPanel.tsx` —— 48 处 className 字符串增补 Tailwind utility；markup 树不变；保留 `opencode-panel-toggle` 作为 no-op marker（test pin 依赖）。
4. **Modified** `src/features/opencode/components/OpenCodeProviderSection.tsx` —— 9 处 className 字符串增补。
5. **Modified** `src/features/opencode/components/OpenCodeMcpSection.tsx` —— 9 处。
6. **Modified** `src/features/opencode/components/OpenCodeSessionsSection.tsx` —— 15 处。
7. **Modified** `src/features/opencode/components/OpenCodeAdvancedSection.tsx` —— 8 处。
8. **New** `.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-9-5-opencode-panel-plan.md` —— 本 plan。

## Verification

| Command | Expected |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | 2 个 pre-existing baseline 错（perfBaseline×2），不增加 |
| `npm run test:layout-guard` | 46/46（opencode 不在 guard 范围） |
| `npm run check:large-files:gate` | pass（无 large file 退化；删 915 行 css） |
| `npx vitest run src/features/opencode/components/OpenCodeControlPanel.test.tsx` | 5/5 pass（含 `.opencode-panel-toggle` pin） |
| `npx vitest run src/features/opencode/` | 8/8 pass (含 modelMetadata 3 + ControlPanel 5) |
| `npx vitest run src/features/settings/components/settings-view/sections/CodexSection.test.tsx` | 2/2 pass（codex-unified-exec contract 不变） |
| `npx vitest run src/features/settings/hooks/useAppSettings.test.ts` | 22/22 pass（settings 契约不变；opencodeEnabled flag 不变） |
| `npx vitest run src/features/composer/components/ComposerEditorHelpers.test.tsx` | 6/6 pass（`data-testid="opencode-control-panel"` mock 占位符不变） |

## Execution result (2026-05-17)

实际产出（implement agent）：
- 新增：`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-9-5-opencode-panel-plan.md`（本 plan）
- 删除：`src/styles/opencode-panel.css`（915 行 / 125 selectors）
- 修改：`src/bootstrap.ts`（41 → 40，删除 `import "./styles/opencode-panel.css";`）
- 修改：`src/features/opencode/components/OpenCodeControlPanel.tsx`（1011 → 1095，+84 行；48+ className 字符串增补 Tailwind utility；保留 `opencode-panel-toggle` 等所有 className 作为 no-op semantic marker；将 4 个 drawer-tab 重构为 `(["provider","mcp","sessions","advanced"] as const).map(...)` 减少重复样板）
- 修改：`src/features/opencode/components/OpenCodeProviderSection.tsx`（72 → 81，+9 行）
- 修改：`src/features/opencode/components/OpenCodeMcpSection.tsx`（53 → 63，+10 行）
- 修改：`src/features/opencode/components/OpenCodeSessionsSection.tsx`（92 → 117，+25 行）
- 修改：`src/features/opencode/components/OpenCodeAdvancedSection.tsx`（61 → 65，+4 行）

总 tsx diff ~132 行（远低于 1500 行 prompt 阈值）；CSS 净删除 915 行。

验证结果（执行后）：
- `npm run lint` ✅ pass
- `npm run typecheck` ✅ pass（exit code 0，比 Phase 4 留下的 baseline 2 错更少；perfBaseline 错似乎在中间 Phase 自然修复）
- `npm run test:layout-guard` ✅ 46/46 pass
- `npm run check:large-files:gate` ✅ pass（found=1 retained baseline，delta=0）
- `npx vitest run src/features/opencode/components/OpenCodeControlPanel.test.tsx` ✅ 5/5 pass（含 dock-mode `.opencode-panel-toggle` 缺席 pin）
- `npx vitest run src/features/opencode/` ✅ 8/8 pass
- `npx vitest run src/features/settings/components/settings-view/sections/CodexSection.test.tsx` ✅ 2/2 pass
- `npx vitest run src/features/settings/hooks/useAppSettings.test.ts` ✅ 22/22 pass
- `npx vitest run src/features/composer/components/ComposerEditorHelpers.test.tsx` ✅ 6/6 pass

后续 phase 影响：
- bootstrap.ts CSS import 数从 41 → 40（净 −1）。
- Phase 9 还剩：`detached-file-explorer.css`、`diff.css`、`messages.history-sticky.css` cluster 等（按 PRD Phase 9 + 10 收尾）。

## Out of scope / follow-up

- `provider-modal*` 系列 CSS 已是死代码（OpenCodeProviderSection 已 simplified 至 CLI flow，不渲染 modal）—— 直接删除。如未来恢复 modal 渲染，可用 coss `Dialog` primitive 替代。
- `opencode-panel-toggle` / `opencode-drawer-tab` / `opencode-filter-btn` / `opencode-advanced-toggle` 等 toggle/tab/button 模式 → 可统一替换为 coss `Tabs` / `Toggle` / `Button` primitive（Phase 10 follow-up，需 `npx shadcn add @coss/tabs` 等新 dep + 行为契约 re-validation）。
- `opencode-drawer` 模态 + escape key + click-outside-to-close 行为 → 可替换为 coss `Dialog` primitive（Phase 10 follow-up）。
- 字面 hex 颜色（status / brand）保留为 follow-up「brand color override」议题，按 PRD Phase 10 处理。
