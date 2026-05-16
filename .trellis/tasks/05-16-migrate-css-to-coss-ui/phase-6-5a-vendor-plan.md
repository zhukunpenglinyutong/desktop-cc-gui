# Phase 6.5a — Vendor cluster sub-PR (vendor-codex-runtime + vendor-dialog)

> Status: drafted 2026-05-17 by Implement agent (Claude Code) before execution.
> Branch: `chore/bump-version-0.5` (main worktree, baseline commit `baf7f279`).

## Scope summary

Phase 6.5 原计划处理 4 个 vendor cluster CSS 文件 (1662 行 CSS / 2832 行 tsx consumer)：

1. `settings.vendor-codex-runtime.css` (83 行) — **本 PR**
2. `settings.vendor-dialog.css` (386 行) — **本 PR**
3. `settings.part1.vendor-panels.css` (863 行) — deferred → Phase 6.5b
4. `settings.part2.vendor-models.css` (330 行) — deferred → Phase 6.5b

本 sub-PR 只处理最小的 2 个（合计 469 行 CSS）。

## Discovery — file scope

### 待删除 CSS (2 file / 469 行)

```
src/styles/settings.vendor-codex-runtime.css   83 lines / 13 selectors
src/styles/settings.vendor-dialog.css         386 lines / 52 selectors
```

无 literal-pin 测试，无 base/themes coupling。

### Aggregator (settings.css)

`settings.css` line 3 + line 4：

```css
@import "./settings.vendor-codex-runtime.css";
@import "./settings.vendor-dialog.css";
```

需删除这 2 行。

> 注：task 描述写的是 "bootstrap.ts 移除对应 2 行 import"，但 bootstrap.ts 仅导入 `settings.css` 顶层 aggregator，从未直接 import 这两个 partial。Phase 6 既证 precedent 是改 `settings.css`（commit `dfbc0b07`）。本 PR 沿用既证 precedent，仅删 `settings.css` 中的 2 行 `@import`。`bootstrap.ts` 不改。

### Consumer tsx (8 个文件)

| 文件 | 行数 | vendor-codex-runtime-* | vendor-dialog* | vendor-* 其它 |
|---|---|---|---|---|
| `src/features/vendors/components/VendorSettingsPanel.tsx` | 747 | ✓ (10 className refs, line 560-624) | — | (other vendor classes) |
| `src/features/vendors/components/ProviderDialog.tsx` | 435 | — | ✓ overlay/header/body/footer/close/description | preset/security/form-group/input/required/hint/json/advanced/model-grid/btn-cancel |
| `src/features/vendors/components/CodexProviderDialog.tsx` | 229 | — | ✓ overlay/wide/header/body/footer/close | form-group/input/code-editor/hint/optional/btn-cancel |
| `src/features/vendors/components/CustomModelDialog.tsx` | 312 | — | ✓ overlay/wide/header/body/footer/close | input/hint/json-error/btn-cancel |
| `src/features/vendors/components/DeleteConfirmDialog.tsx` | 62 | — | ✓ overlay/sm/header/body/footer | btn-cancel |
| `src/features/vendors/components/GeminiVendorPanel.tsx` | 339 | — | — | form-group/input/code-editor/json-error/model-grid (no vendor-dialog primitives) |
| `src/features/vendors/components/CurrentCodexGlobalConfigCard.tsx` | 220 | — | — | codex-global-config-* / codex-sensitive-toggle |
| `src/features/settings/components/AgentSettingsSection.tsx` | ~700 | — | ✓ overlay/wide/sm/header/body/footer/close | form-group/input/code-editor/hint/json-error/btn-cancel |

合计 ≈ 3000 行 tsx，但 className mutation 集中在 cluster 内聚的 props/utility 字串。

### Test file impact

- `src/features/vendors/components/VendorSettingsPanel.test.tsx`: 仅 i18n 文本 + button role assertion，**无 CSS pin**
- `src/features/settings/components/settings-view/sections/CodexSection.test.tsx`: 完全不引用 vendor-* class（路径上不重叠）
- `src/features/settings/hooks/useAppSettings.test.ts`: 纯 hook 行为，不引用 CSS
- `src/styles/settings-email-card-surface.test.ts`: 仅读 `settings.part2.css`，不涉及本 PR

### Contract verification

`.trellis/spec/guides/codex-unified-exec-override-contract.md`:

- **触点**：
  - `src/services/tauri.ts` — 不改
  - `src/features/settings/hooks/useAppSettings.ts` — 不改
  - `src/features/settings/components/SettingsView.tsx` — 不改
  - **VendorSettingsPanel**（Codex 选项卡的 4 official action buttons 与 unified_exec status）— **本 PR 触及**（仅替换 className 字串）

- **必须保留**:
  - 3 个 action buttons：`Enable` / `Disable` / `Follow official default`（VendorSettingsPanel.tsx line 595-622）
  - `unified_exec` status detail rendering（line 579-593）
  - `handleSetUnifiedExecOfficialOverride(true|false)` / `handleRestoreUnifiedExecOfficialDefault` 调用语义不变

- **本 PR 仅改 className 字串**，不改任何 prop / state / runtime / call signature。

VendorSettingsPanel.test.tsx 5 个用例所有断言都基于 `screen.getByRole('button', { name: ... })` 或 `screen.getByText(...)`，没有任何 `.querySelector('.vendor-codex-runtime-*')` 或 `toHaveClass(...)`，contract 安全。

## Mapping — vendor-codex-runtime-* → Tailwind

| Selector | Tailwind utility |
|---|---|
| `.vendor-codex-runtime-card` | `flex items-start justify-between gap-5 px-[18px] py-4 border border-[var(--border-muted)] rounded-[14px] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--surface-card)_92%,var(--vendor-button-primary-soft))_0%,var(--surface-card)_100%)] max-[900px]:flex-col` |
| `.vendor-codex-runtime-card-copy` | `flex-1 min-w-0` |
| `.vendor-codex-runtime-card-title-row` | `flex items-center flex-wrap gap-2` |
| `.vendor-codex-runtime-card-title` | `text-base font-bold text-[var(--text-primary)]` |
| `.vendor-codex-runtime-card-badge` | `inline-flex items-center justify-center min-h-[22px] px-2 rounded-full text-[11px] font-bold text-[var(--vendor-button-primary)] bg-[color-mix(in_srgb,var(--vendor-button-primary)_12%,transparent)]` |
| `.vendor-codex-runtime-card-description` | `mt-1.5 text-[var(--text-secondary)] leading-[1.5]` |
| `.vendor-codex-runtime-card-control` | `w-[min(240px,100%)] shrink-0 max-[900px]:w-full` |
| `.vendor-codex-runtime-card-select` | `w-full min-h-[42px]` |
| `.vendor-codex-runtime-card-actions` | `mt-2.5 flex flex-wrap gap-2` |
| `.vendor-codex-runtime-card-select-popup` | `min-w-[220px]` |

Note：实际 VendorSettingsPanel 中 `vendor-codex-runtime-card-control`、`-select`、`-select-popup` 未被实际引用（grep 0 hit）。仍保留 className mapping 以备 future use，但 inline 时仅追加被实际渲染的 3 个 className 的 utility（card / copy / title-row / title / badge / description / actions）。

## Mapping — vendor-dialog* / vendor-* → Tailwind

### Dialog primitives

| Selector | Tailwind |
|---|---|
| `.vendor-dialog-overlay` | `fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]` |
| `.vendor-dialog` | `w-[min(760px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden` |
| `.vendor-dialog-wide` | overrides width → use `w-[min(600px,90vw)]` (combined with base via class merge / cn-style: append to `.vendor-dialog`) |
| `.vendor-dialog-sm` | overrides width → `w-[min(400px,90vw)]` |
| `.vendor-dialog-header` | `flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)]` |
| `.vendor-dialog-header h3` | (child) `[&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0` |
| `.vendor-dialog-close` | `bg-transparent border-0 text-[var(--text-secondary)] text-xl cursor-pointer px-1 leading-none hover:text-[var(--text-primary)]` |
| `.vendor-dialog-body` | `px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4` |
| `.vendor-dialog-description` | `m-0 text-[13px] text-[var(--text-secondary)] leading-[1.5]` |
| `.vendor-dialog-footer` | `flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]` |

### Form primitives

| Selector | Tailwind |
|---|---|
| `.vendor-security-notice` | `flex items-center gap-2 px-3.5 py-3 rounded-lg border border-[color-mix(in_srgb,var(--text-accent)_42%,transparent)] bg-[color-mix(in_srgb,var(--text-accent)_14%,var(--surface-card-strong))] text-[var(--text-primary)] text-[13px] font-medium [&_svg]:text-[color-mix(in_srgb,var(--text-accent)_82%,var(--text-primary)_18%)] [&_svg]:shrink-0` |
| `.vendor-preset-group` | `flex flex-col gap-2.5` |
| `.vendor-preset-title` | `text-xs font-semibold text-[var(--text-secondary)]` |
| `.vendor-preset-buttons` | `flex flex-wrap gap-2 p-2.5 border border-[var(--border-muted)] rounded-lg bg-[var(--surface-card)]` |
| `.vendor-preset-btn` | `border border-[var(--vendor-button-primary-border,var(--border-muted))] bg-[var(--vendor-button-primary-soft,var(--surface-card-strong))] text-[var(--vendor-button-primary,var(--text-primary))] rounded-lg px-3 py-[7px] text-[13px] font-semibold cursor-pointer transition-[border-color,background,color] duration-150 hover:border-[var(--vendor-button-primary,var(--border-stronger))] hover:bg-[var(--vendor-button-primary,var(--surface-card-strong))] hover:text-white` |
| `.vendor-preset-btn.active` | (conditional, append) `!border-[var(--vendor-button-primary,var(--text-accent))] !bg-[var(--vendor-button-primary,var(--text-accent))] !text-white` |
| `.vendor-form-group` | `flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5` |
| `.vendor-required` | `text-[#ff6b6b] text-xs leading-none` |
| `.vendor-input` | `w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]` |
| `.vendor-input-row` | `flex gap-1 items-center [&_.vendor-input]:flex-1` |
| `.vendor-input-sm` | `!px-2 !py-[5px] !text-xs` |
| `.vendor-model-grid` | `grid grid-cols-2 gap-2.5 [&_label]:text-[11px] [&_label]:text-[var(--text-secondary)] [&_label]:mb-[3px] [&_label]:block` |
| `.vendor-advanced` | `border border-[var(--border-muted)] rounded-lg p-0 [&>summary]:px-3 [&>summary]:py-2 [&>summary]:text-xs [&>summary]:font-medium [&>summary]:text-[var(--text-secondary)] [&>summary]:cursor-pointer [&>summary]:hover:text-[var(--text-primary)]` |
| `.vendor-json-section` | `px-3 pb-3` |
| `.vendor-json-toolbar` | `flex justify-end mb-1.5 [&_button]:px-2.5 [&_button]:py-[3px] [&_button]:bg-transparent [&_button]:border [&_button]:border-[var(--border-muted)] [&_button]:rounded [&_button]:text-[var(--text-secondary)] [&_button]:text-[11px] [&_button]:cursor-pointer [&_button]:hover:text-[var(--text-primary)] [&_button]:hover:border-[var(--border-stronger)]` |
| `.vendor-json-editor`, `.vendor-code-editor` | `w-full px-2.5 py-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] font-[var(--font-code)] text-xs leading-[1.5] resize-y outline-none box-border focus:border-[var(--text-accent)]` |
| `.vendor-json-error` | `text-[#e55] text-[11px] mt-1` |
| `.vendor-hint` | `text-[11px] text-[var(--text-secondary)] mt-0.5` |
| `.vendor-json-description` | `mb-2` |
| `.vendor-optional` | `font-normal text-[var(--text-secondary)] text-[11px]` |
| `.vendor-btn-cancel` | `px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150` |

### Codex global config card

| Selector | Tailwind |
|---|---|
| `.vendor-codex-global-config-path` | `text-xs text-[var(--text-secondary)] bg-[color-mix(in_srgb,var(--surface-card-strong)_82%,transparent)] border border-[var(--border-muted)] rounded-lg px-2 py-0.5` |
| `.vendor-codex-global-config-section + .vendor-codex-global-config-section` | sibling-only cascade → 在 second `.vendor-codex-global-config-section` 上加 `[&:not(:first-child)]:border-t [&:not(:first-child)]:border-[var(--border-muted)]`（CurrentCodexGlobalConfigCard 上下两段 section，将 border-top 加在第二个 section instance） |
| `.vendor-codex-global-config-toggle` | `border-0 bg-transparent text-[var(--text-primary)] p-0 m-0 inline-flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-accent)]` |
| `.vendor-codex-global-config-header-actions` | `inline-flex items-center gap-2` |
| `.vendor-codex-sensitive-toggle` | `border border-[var(--border-muted)] rounded-[7px] bg-[var(--surface-card-strong)] text-[var(--text-secondary)] px-2 py-[3px] text-[11px] cursor-pointer hover:text-[var(--text-primary)] hover:border-[var(--border-stronger)]` |
| `.vendor-codex-global-config-body` | `px-4 py-3.5 flex flex-col gap-2` |
| `.vendor-codex-global-config-content` | `m-0 max-h-[260px] overflow-auto border border-[var(--border-muted)] rounded-lg bg-[var(--surface-card-strong)] text-[var(--text-primary)] font-[var(--font-code)] text-xs leading-[1.5] px-3 py-2.5` |

## Execution plan

### Step 1: Inline Tailwind to 8 consumer files

各 consumer file 内：保留所有 `vendor-*` className 作为 **no-op semantic marker**，**追加** Tailwind utility 在同一 className 字串末尾。沿用 Phase 2/3/4/5/6 既证 precedent。

文件改动顺序（按 cluster 内聚 + 测试覆盖率）：
1. `src/features/vendors/components/VendorSettingsPanel.tsx` — 仅 6 个 `vendor-codex-runtime-*` className，行 560-624
2. `src/features/vendors/components/DeleteConfirmDialog.tsx` — 最小 dialog，6 个 vendor-dialog className
3. `src/features/vendors/components/CodexProviderDialog.tsx` — middle complexity
4. `src/features/vendors/components/CustomModelDialog.tsx` — middle complexity
5. `src/features/vendors/components/ProviderDialog.tsx` — full dialog with preset / form / json
6. `src/features/vendors/components/GeminiVendorPanel.tsx` — form-group / code-editor only
7. `src/features/vendors/components/CurrentCodexGlobalConfigCard.tsx` — codex-global-* classes
8. `src/features/settings/components/AgentSettingsSection.tsx` — large file，dialog 4 处 + form/input/code-editor

### Step 2: Remove files & update aggregator

- `rm src/styles/settings.vendor-codex-runtime.css`
- `rm src/styles/settings.vendor-dialog.css`
- Edit `src/styles/settings.css`：删除 line 3 + line 4 的 2 个 `@import`

### Step 3: Verify

跑：
- `npm run lint`
- `npm run typecheck`
- `npm run check:large-files:gate`
- `npm run test -- src/features/vendors/components/VendorSettingsPanel.test.tsx src/features/settings/hooks/useAppSettings.test.ts src/features/settings/components/settings-view/sections/CodexSection.test.tsx`
- `npm run test -- src/styles/layout-swapped-platform-guard.test.ts`

## Expected outcomes

- bootstrap.ts CSS import 数：40 → 40（不变）
- settings.css line count：7 → 5（删 2 行 `@import`）
- 删除文件：2（vendor-codex-runtime.css + vendor-dialog.css，共 469 行）
- 修改 tsx：8 文件（含 className 追加 Tailwind utility）
- lint / typecheck / test baseline：不退化
- VendorSettingsPanel.test.tsx 5/5 pass，CodexSection.test.tsx 2/2 pass，useAppSettings.test.ts 全 pass

## Follow-ups (Phase 6.5b)

剩余 2 个 vendor cluster CSS 文件：

- `settings.part1.vendor-panels.css` (863 行)
- `settings.part2.vendor-models.css` (330 行)

Phase 6.5b consumer 体量 ≈ 2500+ 行 tsx（同样的 vendor cluster + UsageSection.tsx 等），独立 sub-PR 提交。

`AgentSettingsSection.tsx` 是 27.5KB 文件，体量较大但本 PR 仅触及 dialog className（4 处 dialog overlay block，~30 处 vendor-* className 追加），属于风险可控的局部 mutation。
