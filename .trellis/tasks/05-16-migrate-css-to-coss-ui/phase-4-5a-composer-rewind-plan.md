# Phase 4.5a — composer.rewind-modal Sub-PR Plan

> Task: `05-16-migrate-css-to-coss-ui`
> Phase: 4.5a (composer.rewind-modal — 第一个 composer sub-PR)
> Date: 2026-05-17
> Status: in-progress

## Discovery

| Item | Value |
|---|---|
| File | `src/styles/composer.rewind-modal.css` |
| Lines | 1233 |
| Selectors | 68 (含 diff-token theme cascade override) |
| Single TSX consumer | `src/features/composer/components/ClaudeRewindConfirmDialog.tsx` (880 lines) |
| Test file | `src/features/composer/components/Composer.rewind-confirm.test.tsx` (1770 lines) |
| Test selectors | 全部 `data-testid="claude-rewind-*"` 形式 — CSS 字面值无 pin |
| Layout-guard pin | 无（已 grep 验证 `layout-swapped-platform-guard.test.ts` 与 `__layout-guard__/*` 均不含 `rewind` / `composer.rewind`） |
| Import chain | `bootstrap.ts → styles/composer.css → composer.rewind-modal.css` |

## CSS 内部结构分层

| Range | 内容 | 处理 |
|---|---|---|
| 1-595 | layout + structural（modal frame、header、backdrop、impact grid、mode option radio、file rail、diff panel layout） | **inline Tailwind**，保留 className 作为 no-op marker |
| 596-820 | `.claude-rewind-modal-diff-theme .token.X` cluster — prismjs token color override，cascade-based | **保留 keeper**（DiffBlock 渲染 prism token node，不能 inline） |
| 822-850 | `.claude-rewind-modal-diff-content .diff-line-*` cascade-based override | **保留 keeper** |
| 852-942 | full-diff overlay + raw（structural） | **inline Tailwind** |
| 944-1057 | `:root[data-theme="light/dark/system"]` theme override（含 prefers-color-scheme） | **保留 keeper**（theme cascade，与 dark mode token mapping 紧绑） |
| 1059-1142 | store-feedback + actions footer（structural） | **inline Tailwind** |
| 1144-1233 | `@media (max-width: 820px/560px)` responsive | **inline Tailwind**（用 `max-md:` / `max-sm:` variant） |

## 策略：split & shrink

**本次 PR 范围**：
- Inline Tailwind 到 tsx：modal frame、header、kicker、heading、impact-grid、mode-list、target-card、file-rail、diff-panel（layout-only）、full-diff overlay frame、store-feedback、actions footer、responsive media queries
- 保留 keeper `composer.rewind-modal.css`：仅 diff-theme cluster + theme overrides + cascade-driven diff-line color overrides
- `composer.css` 的 `@import "./composer.rewind-modal.css"` 保留（链式 import 不动）
- 不动 `composer.part1.css` / `composer.part2.css` / `composer.memory-picker.css`（推 4.5b/c/d）

**预期 keeper 行数**：~450 行（diff theme + cascade + theme overrides + 必要保留），减少 ~780 行（~63%）。
**预期 tsx diff**：~150-250 行（每个 className 字符串接 Tailwind utility，无结构性 markup 改动）。

## 关键 Token 映射

| 旧 token | coss / Tailwind |
|---|---|
| `var(--surface-card)` | `bg-card` |
| `var(--surface-popover, var(--surface-card))` | `bg-popover` |
| `var(--text-strong)` | `text-foreground` |
| `var(--text-muted)` | `text-muted-foreground` |
| `var(--text-faint)` | `text-[var(--text-faint)]`（无 coss 对应，arbitrary） |
| `var(--border-subtle)` | `border-border` |
| `var(--border-stronger)` | `border-[var(--border-stronger)]`（arbitrary） |
| `#2563eb` 系列（blue-600 brand） | `bg-blue-600` / Tailwind palette |
| `rgba(8, 12, 20, 0.68)` backdrop | `bg-[rgb(8_12_20/.68)]` |

Diff theme variable 内层（`--diff-line-add-bg` 等）保留在 keeper，不进 Tailwind（因为是 cascade 注入到 DiffBlock 内部 prism token）。

## 测试不变性

- 所有 `data-testid` 不动
- 所有 `.claude-rewind-modal-*` className 保留（作为 no-op marker，与 diff-theme cascade selector 共用）
- `is-selected` / `is-error` / `is-success` / `is-add` / `is-del` 状态 class 保留（cascade selector 仍依赖）
- `data-impact-count`、`data-diff-style` attribute 不动

## 验证

```bash
npm run lint
npm run typecheck
npm run test:layout-guard
npm run check:large-files:gate
npx vitest run src/features/composer/components/Composer.rewind-confirm.test.tsx
```

## After Phase 4.5a

- bootstrap.ts: 不变（chained import 链 intact）
- composer.css: 不变
- composer.rewind-modal.css: 1233 → ~450 行（keeper only diff-theme + theme overrides）
- ClaudeRewindConfirmDialog.tsx: +Tailwind utility 在 className 字符串

## Follow-up

- Phase 4.5b: composer.part2.css（含 chained memory-picker.css）
- Phase 4.5c: composer.memory-picker.css
- Phase 4.5d: composer.part1.css
- 后续若把 DiffBlock token theme 也迁移到 coss palette，可清掉本 keeper 剩余部分。
