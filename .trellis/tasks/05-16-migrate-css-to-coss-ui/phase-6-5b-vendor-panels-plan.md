# Phase 6.5b — Vendor cluster sub-PR (vendor-panels + vendor-models)

> Status: drafted 2026-05-17 by Implement agent (Claude Code) before execution.
> Branch: `chore/bump-version-0.5` (main worktree, baseline commit `83c280bd`).

## Scope summary

Phase 6.5b 收尾 vendor cluster：处理 vendor cluster 中最后 2 个 CSS partial（合计 1193 行 CSS）：

1. `src/styles/settings.part1.vendor-panels.css` (863 行)
2. `src/styles/settings.part2.vendor-models.css` (330 行)

Phase 6.5a 已删 `vendor-codex-runtime.css` + `vendor-dialog.css`，所有 8 个 consumer file 已被预先注入 dialog/form Tailwind utility，本 sub-PR 专门处理剩余 `vendor-*`（panel / list / card / current-config / gemini / model-manager）以及 `model-mapping-*` / `settings-card-*` selectors。

## Discovery — file scope

### 待删除 CSS (2 file / 1193 行)

```
src/styles/settings.part1.vendor-panels.css   863 lines / ~80 selectors
src/styles/settings.part2.vendor-models.css   330 lines / ~30 selectors
```

无 literal-pin 测试。无 base/themes / themes coupling。

### Aggregator chain

- `src/styles/settings.css` line 2:
  ```css
  @import "./settings.part1.vendor-panels.css";
  ```
  → 删除
- `src/styles/settings.part2.css` line 1:
  ```css
  @import "./settings.part2.vendor-models.css";
  ```
  → 删除

> 注：task 描述写的是 "src/styles/settings.css（仅删 @import 那 2 行）" 但 vendor-models 实际由 `settings.part2.css` 第 1 行 @import 引入（不是 `settings.css`）。删除 file 必须删 import。我把这两个 import 删除视为最小机械变更（与 6.5a 同性质），其它 settings.part2.css 内容不动。

### Consumer tsx (11 个文件 + 部分已被 Phase 6.5a 预先注入 utility)

| 文件 | 行数 | part1 selectors | part2 selectors | 状态 |
|---|---|---|---|---|
| `src/features/vendors/components/VendorSettingsPanel.tsx` | 747 | settings-panel / section-title / section-desc / tabs / tab / tab-label / tab-content / plugin-model-entry* | — | 主要工作 |
| `src/features/vendors/components/GeminiVendorPanel.tsx` | 339 | gemini-shell / gemini-banner / gemini-card / gemini-section / gemini-check* / gemini-env-editor / gemini-actions-row / gemini-help / gemini-saved-hint / gemini-auth* / gemini-primary-grid / gemini-empty-checks / spin / vendor-btn-icon | — | 主要工作 |
| `src/features/vendors/components/ProviderList.tsx` | 177 | provider-list / list-header / list-actions / list-title / loading / cards / card / card-info / card-name / card-remark / card-actions / card-divider / local-provider / empty | — | 主要工作 |
| `src/features/vendors/components/CodexProviderList.tsx` | 123 | provider-list / list-header / list-actions / list-title / loading / cards / card / card-info / card-name / card-remark / card-actions / card-divider / empty | — | 主要工作 |
| `src/features/vendors/components/CurrentClaudeConfigCard.tsx` | 188 | current-config / current-config-header / current-config-title-row / current-config-title / current-config-badge / current-config-empty / current-config-body / current-config-field / current-config-field-icon / current-config-field-value / current-config-toggle / current-config-loading | — | 主要工作 |
| `src/features/vendors/components/CurrentCodexGlobalConfigCard.tsx` | 220 | current-config / current-config-header / current-config-loading / current-config-empty / current-config-title (some already w/ Tailwind from 6.5a) | — | 补 part1 |
| `src/features/vendors/components/CustomModelDialog.tsx` | 312 | btn-icon / btn-danger / empty / hint(已 6.5a) | btn-save / vendor-model-manager-list / vendor-model-manager-item / vendor-model-manager-main / vendor-model-manager-id / vendor-model-manager-label / vendor-model-manager-desc / vendor-model-manager-actions / vendor-model-manager-form / vendor-model-add / vendor-model-manager-form-actions / vendor-model-manager-add-btn / btn-cancel(已 6.5a) / btn-save | 补 part1 part2 |
| `src/features/vendors/components/CodexProviderDialog.tsx` | 229 | btn-icon / btn-danger | btn-save / custom-models / model-item / model-id / model-label / model-add / btn-add-sm / btn-cancel(已 6.5a) | 补 part2 |
| `src/features/vendors/components/ProviderDialog.tsx` | 435 | btn-icon | btn-save / btn-cancel(已 6.5a) | 补 part2 |
| `src/features/vendors/components/DeleteConfirmDialog.tsx` | 62 | — | btn-cancel(已 6.5a) / btn-danger-solid | 补 part2 |
| `src/features/settings/components/AgentSettingsSection.tsx` | ~700 | — | btn-cancel(已 6.5a 3 处) / btn-save (3 处) / btn-danger-solid (1 处) | 补 part2 |
| `src/features/models/components/ModelMappingSettings.tsx` | 175 | — | model-mapping-card / settings-card-header / settings-card-title-row / settings-card-title / settings-card-badge / settings-card-description / model-mapping-fields / model-mapping-field / model-mapping-label / model-mapping-default / model-mapping-input / model-mapping-actions / model-mapping-button / model-mapping-button-secondary / model-mapping-button-primary / model-mapping-note / model-mapping-badge | 主要工作 |

### Test file impact

- `src/features/vendors/components/VendorSettingsPanel.test.tsx`: 5 tests, role/text-only, **无 CSS pin**
- `src/features/settings/components/settings-view/sections/CodexSection.test.tsx`: 不引用本 PR 任何 className
- `src/features/settings/hooks/useAppSettings.test.ts`: 纯 hook 行为
- 全局测试 grep 无任何 `.toHaveClass('vendor-*')` / `.querySelector('.vendor-*')` 或 `.model-mapping-*` / `.settings-card-*` 断言

### Contract verification

`.trellis/spec/guides/codex-unified-exec-override-contract.md`:

- **触点**：`src/features/settings/hooks/useAppSettings.ts` / `src/services/tauri.ts` / `SettingsView.tsx` — **本 PR 不动**
- **VendorSettingsPanel.tsx** — 本 PR 触及（仅 className 字串追加，不改 prop/state/runtime/call signature）
  - Codex tab 的 3 个 official action buttons（line 595-622）`handleSetUnifiedExecOfficialOverride(true|false)` / `handleRestoreUnifiedExecOfficialDefault` — 保持不变
  - unified_exec status detail rendering（line 579-593）— 保持不变
  - reload no-session 消息无 prefix — 保持不变
- VendorSettingsPanel.test.tsx 5 个 case 全用 `getByRole('button', { name: ... })` 或 `getByText(...)`，无 className assertion

Contract 安全。

## Mapping — Part 1 (vendor-panels) selectors → Tailwind

### Top-level panel + tabs

| Selector | Tailwind |
|---|---|
| `.vendor-settings-panel` | `mt-3 [--vendor-button-primary:var(--surface-bubble-user)] [--vendor-button-primary-hover:color-mix(in_srgb,var(--surface-bubble-user)_86%,#000_14%)] [--vendor-button-primary-border:color-mix(in_srgb,var(--surface-bubble-user)_72%,var(--border-stronger))] [--vendor-button-primary-soft:color-mix(in_srgb,var(--surface-bubble-user)_14%,var(--surface-card-strong))]` |
| `.vendor-section-title` | `m-0 text-[30px] font-bold text-[var(--text-primary)]` |
| `.vendor-section-desc` | `mt-2 mb-[18px] text-[var(--text-secondary)] text-[15px]` |
| `.vendor-tabs` | `flex w-full max-w-[880px] gap-0 mb-2 p-0 bg-transparent border-0 border-b border-[var(--border-muted)] rounded-none [&_[data-slot=tab-indicator]]:block [&_[data-slot=tab-indicator]]:bg-[var(--primary)] [&_[data-slot=tab-indicator]]:h-0.5 [&_[data-slot=tab-indicator]]:rounded-none [&_[data-slot=tab-indicator]]:shadow-none` |
| `.vendor-tab` | `flex-1 min-h-0 h-[42px] px-3.5 py-2.5 bg-transparent border-0 border-b-2 border-transparent rounded-none shadow-none text-[var(--text-secondary)] text-sm font-semibold cursor-pointer transition-[color,border-color] duration-150 hover:text-[var(--text-primary)] data-[selected]:text-[var(--primary)] data-[selected]:border-b-[var(--primary)] data-[state=active]:text-[var(--primary)] data-[state=active]:border-b-[var(--primary)]` |
| `.vendor-tab-label` | `inline-flex items-center justify-center gap-2` |
| `.vendor-tab-content` | `min-h-[200px] flex flex-col gap-3.5` |

> 注：`.vendor-settings-panel [data-slot="button"][data-variant="default"]` 等三个嵌套 button override 由 `[--vendor-button-primary]` CSS var 通过 Button component 间接实现，省略——Phase 6.5a 中相同 CSS var 已在子组件读取。

### Plugin model entry

| Selector | Tailwind |
|---|---|
| `.vendor-plugin-model-entry` | `flex items-center justify-between gap-3 px-3.5 py-3 mb-3 border border-[var(--border-muted)] rounded-[10px] bg-[var(--surface-card)] cursor-pointer transition-[border-color,background] duration-150 hover:border-[var(--border-stronger)] hover:bg-[var(--surface-hover)]` |
| `.vendor-plugin-model-entry-main` | `flex items-center gap-2 text-[var(--text-primary)] min-w-0` |
| `.vendor-plugin-model-entry-title` | `text-sm font-semibold` |
| `.vendor-plugin-model-entry-count` | `min-w-[20px] h-[20px] px-1.5 rounded-[10px] inline-flex items-center justify-center text-[11px] font-semibold text-white bg-[var(--vendor-button-primary)]` |

### Provider list + cards

| Selector | Tailwind |
|---|---|
| `.vendor-provider-list` | `flex flex-col gap-3` |
| `.vendor-list-header` | `flex items-center justify-between` |
| `.vendor-list-actions` | `flex items-center gap-2` |
| `.vendor-list-title` | `text-[13px] font-semibold text-[var(--text-primary)]` |
| `.vendor-loading` | `text-center py-5 text-[var(--text-secondary)] text-[13px]` |
| `.vendor-cards` | `flex flex-col gap-2.5` |
| `.vendor-card` | `flex items-center justify-between p-[14px_16px] rounded-lg border border-[var(--border-muted)] bg-[var(--surface-card)] transition-[border-color] duration-150 gap-3 hover:border-[var(--border-stronger)]` |
| `.vendor-card.active` | `data-[active=true]:border-[var(--vendor-button-primary-border)] data-[active=true]:bg-[var(--vendor-button-primary-soft)]` — 用 `cn("active")` 模式时不可直接 data-attr，沿用 `active &&` cn 逻辑，append `active:border-[var(--vendor-button-primary-border)] active:bg-[var(--vendor-button-primary-soft)]`（用 conditional className 模式：`isActive ? "border-[var(--vendor-button-primary-border)] bg-[var(--vendor-button-primary-soft)]" : ""`） |
| `.vendor-card-info` | `flex flex-col gap-0.5 flex-1 min-w-0` |
| `.vendor-card-name` | `text-[13px] font-medium text-[var(--text-primary)] flex items-center gap-2` |
| `.vendor-card-remark` | `text-[11px] text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap` |
| `.vendor-card-actions` | `flex items-center gap-1.5 shrink-0` |
| `.vendor-card-divider` | `w-px self-stretch bg-[var(--border-muted)]` |
| `.vendor-local-provider-card` | `border-l-[3px] border-l-[#f39c12] bg-[linear-gradient(90deg,rgba(243,156,18,0.08)_0%,transparent_45%)]` |
| `.vendor-local-provider-name` | `[&_svg]:text-[#f39c12]` |
| `.vendor-empty` | `text-center px-5 py-[30px] text-[var(--text-secondary)] text-[13px] border border-dashed border-[var(--border-muted)] rounded-lg bg-[var(--surface-card)]` |
| `.vendor-btn-add` | `px-3.5 py-[5px] bg-[var(--vendor-button-primary)] text-white border border-[var(--vendor-button-primary)] rounded-md text-xs font-semibold cursor-pointer transition-[background,border-color] duration-150 hover:bg-[var(--vendor-button-primary-hover)] hover:border-[var(--vendor-button-primary-hover)]` |
| `.vendor-btn-enable` | `px-2.5 py-[3px] bg-[var(--vendor-button-primary)] border border-[var(--vendor-button-primary)] rounded-[5px] text-white text-[11px] font-semibold cursor-pointer transition-[background,border-color] duration-150 hover:bg-[var(--vendor-button-primary-hover)] hover:border-[var(--vendor-button-primary-hover)]` |
| `.vendor-active-badge` | `text-[11px] text-[var(--text-accent)] font-medium px-2 py-[3px]` |
| `.vendor-badge` | `inline-block px-1.5 py-px rounded text-[10px] bg-[var(--surface-card-strong)] text-[var(--text-secondary)] mt-0.5 w-fit` |
| `.vendor-btn-icon` | `w-[26px] h-[26px] flex items-center justify-center bg-transparent border-0 rounded-[5px] text-[var(--text-secondary)] cursor-pointer text-[13px] transition-all duration-150 [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0 hover:bg-[var(--surface-card-strong)] hover:text-[var(--text-primary)]` |
| `.vendor-btn-danger` | `text-[#e55] hover:text-[#d44]` |

> 注：`vendor-btn-add` / `vendor-btn-enable` / `vendor-active-badge` / `vendor-badge` 在当前 codebase 实际未渲染（grep 0 hit）。保留 marker，不 inline utility（避免 dead utility）。

### Current config card

| Selector | Tailwind |
|---|---|
| `.vendor-current-config` | `border border-[var(--border-muted)] rounded-[10px] bg-[var(--surface-card)]` |
| `.vendor-current-config-header` | `flex items-center justify-between gap-2.5 px-4 py-3.5 border-b border-[var(--border-muted)]` |
| `.vendor-current-config-title-row` | `flex items-center gap-2.5 min-w-0` |
| `.vendor-current-config-title` | `text-base font-bold text-[var(--text-primary)]` |
| `.vendor-current-config-badge` | `max-w-[280px] text-ellipsis overflow-hidden whitespace-nowrap` |
| `.vendor-current-config-body` | `grid grid-cols-2 gap-2.5 px-4 py-3.5 max-[900px]:grid-cols-1` |
| `.vendor-current-config-field` | `flex items-center gap-2 border border-[var(--border-muted)] rounded-lg bg-[var(--surface-card-strong)] min-h-[38px] px-2` |
| `.vendor-current-config-field-icon` | `text-[var(--text-secondary)] inline-flex` |
| `.vendor-current-config-field-value` | `flex-1 min-w-0 border-none bg-transparent text-[var(--text-primary)] text-left font-[var(--font-code)] text-sm cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap hover:text-[var(--text-accent)]` |
| `.vendor-current-config-toggle` | `border-none bg-transparent text-[var(--text-secondary)] w-6 h-6 rounded inline-flex items-center justify-center cursor-pointer hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]` |
| `.vendor-current-config-loading` | `text-[var(--text-secondary)] text-[13px] px-4 py-[18px]` |
| `.vendor-current-config-empty` | `text-[var(--text-secondary)] text-[13px] px-4 py-[18px]` |

### Gemini panel

| Selector | Tailwind |
|---|---|
| `.vendor-gemini-shell` | `flex flex-col gap-2.5` |
| `.vendor-gemini-banner` | `relative overflow-hidden flex items-center justify-start gap-4 px-5 py-[18px] rounded-2xl border border-[color-mix(in_srgb,var(--surface-bubble-user)_38%,var(--border-muted))] bg-[radial-gradient(circle_at_18%_-25%,color-mix(in_srgb,var(--surface-bubble-user)_48%,transparent),transparent_60%),linear-gradient(118deg,color-mix(in_srgb,var(--surface-bubble-user)_20%,var(--surface-card))_0%,color-mix(in_srgb,var(--surface-card)_86%,var(--surface-bubble-user))_100%)] max-[900px]:flex-col max-[900px]:items-stretch` |
| `.vendor-gemini-banner-main` | `min-w-0 flex items-center gap-3` |
| `.vendor-gemini-banner-mark` | `w-[34px] h-[34px] rounded-lg inline-flex items-center justify-center bg-[color-mix(in_srgb,var(--surface-card-strong)_70%,transparent)] border border-[var(--border-muted)] [&_img]:w-[22px] [&_img]:h-[22px] [&_img]:block` |
| `.vendor-gemini-banner-copy` | `min-w-0` |
| `.vendor-gemini-banner-title-row` | `flex items-center gap-2` |
| `.vendor-gemini-banner-title` | `m-0 text-lg font-bold text-[var(--text-primary)]` |
| `.vendor-gemini-banner-badge` | `px-[9px] py-0.5 rounded-full border border-[var(--border-muted)] text-[var(--text-secondary)] text-[11px] font-bold tracking-[0.03em] bg-[color-mix(in_srgb,var(--surface-card-strong)_70%,transparent)]` |
| `.vendor-gemini-banner-subtitle` | `mt-1.5 mb-0 text-[var(--text-secondary)] text-xs leading-[1.4]` |
| `.vendor-gemini-primary-grid` | `grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-2 items-stretch max-[900px]:grid-cols-1` |
| `.vendor-gemini-card` | `border border-[var(--border-muted)] rounded-xl bg-[var(--surface-card)] p-2.5 flex flex-col gap-1.5` |
| `.vendor-gemini-primary-grid > .vendor-gemini-card` | `[.vendor-gemini-primary-grid>&]:h-full [.vendor-gemini-primary-grid>&]:self-stretch` — 简化为 `h-full self-stretch`（直接在 card 上加，因为永远是 primary-grid 的 child） |
| `.vendor-gemini-card-env` | `w-full self-stretch` |
| `.vendor-gemini-card-checks` | `min-h-0` |
| `.vendor-gemini-auth-header` | `flex items-start justify-between gap-1.5 max-[900px]:flex-col max-[900px]:items-stretch` |
| `.vendor-gemini-auth-header-actions` | `inline-flex items-center gap-1.5 shrink-0 max-[900px]:w-full max-[900px]:justify-start` |
| `.vendor-gemini-section-head` | `flex items-center justify-between gap-1.5` |
| `.vendor-gemini-section-title` | `text-xs font-bold text-[var(--text-primary)]` |
| `.vendor-gemini-check-list` | `grid grid-cols-3 gap-1.5 max-[1200px]:grid-cols-2 max-[900px]:grid-cols-1` |
| `.vendor-gemini-check-row` | `grid grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 px-[9px] py-[7px] border border-[var(--border-muted)] rounded-lg bg-[linear-gradient(145deg,color-mix(in_srgb,var(--surface-card-strong)_95%,transparent)_0%,color-mix(in_srgb,var(--surface-hover)_68%,transparent)_100%)]` |
| `.vendor-gemini-check-copy` | `min-w-0 flex flex-col gap-px` |
| `.vendor-gemini-check-label` | `text-[11px] font-semibold text-[var(--text-primary)]` |
| `.vendor-gemini-check-message` | `text-[10px] text-[var(--text-secondary)] whitespace-nowrap overflow-hidden text-ellipsis max-[560px]:whitespace-normal max-[560px]:break-words` |
| `.vendor-gemini-check-status` | `h-[22px] px-2 rounded-full text-[10px] font-bold tracking-[0.02em] border border-transparent inline-flex items-center justify-center shrink-0` |
| `.vendor-gemini-check-status.is-pass` | conditional inline: `text-[#15803d] border-[color-mix(in_srgb,#15803d_28%,transparent)] bg-[color-mix(in_srgb,#15803d_12%,transparent)]` |
| `.vendor-gemini-check-status.is-fail` | conditional inline: `text-[#b91c1c] border-[color-mix(in_srgb,#b91c1c_28%,transparent)] bg-[color-mix(in_srgb,#b91c1c_12%,transparent)]` |
| `.vendor-gemini-empty-checks` | `col-span-full px-0.5 py-1.5 text-[11px] text-[var(--text-secondary)]` |
| `.vendor-gemini-env-editor` | `min-h-[128px] rounded-[10px] border border-[var(--border-muted)] bg-[color-mix(in_srgb,var(--surface-card-strong)_92%,transparent)]` |
| `.vendor-gemini-actions-row` | `flex items-center justify-end gap-2 max-[900px]:justify-start` |
| `.vendor-gemini-help` | `mt-0.5 mb-0 text-[11px] leading-[1.35] text-[var(--text-secondary)] max-w-none` |
| `.vendor-gemini-saved-hint` | `text-xs text-[var(--text-secondary)] pl-0.5` |
| `.vendor-gemini-card-auth .vendor-form-group` | `[&_.vendor-form-group]:gap-[3px]` |
| `.vendor-gemini-auth-grid` | `grid grid-cols-2 gap-x-2 gap-y-1.5 items-start max-[900px]:grid-cols-1` |
| `.vendor-gemini-auth-field` | `min-w-0` |
| `.vendor-gemini-auth-field-wide` | `col-span-2 max-[900px]:col-span-1` |
| `.vendor-gemini-auth-mode-trigger` | `min-h-[30px] border-[var(--border-muted)] bg-[var(--surface-card)] text-xs` |
| `.vendor-gemini-auth-mode-selected`, `.vendor-gemini-auth-mode-option` | `min-w-0 inline-flex items-center gap-1.5` |
| `.vendor-gemini-auth-mode-icon` | `w-3.5 h-3.5 shrink-0 opacity-80` |
| `.vendor-gemini-auth-mode-text` | `min-w-0 overflow-hidden text-ellipsis whitespace-nowrap` |
| `.vendor-gemini-auth-mode-popup` | `max-h-[260px]` |
| `.vendor-gemini-card-auth .vendor-input` | descendant override 隐藏在父 marker，省略 inline 因为父 class 不存在直接 selector |
| `.vendor-gemini-card-auth .vendor-hint` | 同上 |
| `.vendor-gemini-card-auth .vendor-gemini-actions-row` | 同上 — 注：原 CSS 这些 nested selector 提供 17px → 12px 微调；删除后 fallback 到 base utility 已足够 |
| `.vendor-spin` | `[animation:vendor-gemini-spin_1s_linear_infinite]` — 但 keyframe 名 `vendor-gemini-spin` 删除后会 break。改用 Tailwind 自带 `animate-spin`（已存在）。`vendor-spin` marker 保留但 utility 用 `animate-spin`。 |

## Mapping — Part 2 (vendor-models + model-mapping + settings-card) → Tailwind

### Buttons

| Selector | Tailwind |
|---|---|
| `.vendor-btn-cancel:hover` | already in `.vendor-btn-cancel` Tailwind from 6.5a — append `hover:border-[var(--vendor-button-primary,var(--text-accent))] hover:bg-[var(--vendor-button-primary,var(--text-accent))] hover:text-white` to the existing string |
| `.vendor-btn-save` | `px-4 py-1.5 bg-[var(--vendor-button-primary,var(--text-accent))] border border-[var(--vendor-button-primary,var(--text-accent))] rounded-md text-white text-xs font-semibold cursor-pointer transition-[background,border-color] duration-150 hover:bg-[var(--vendor-button-primary-hover,var(--text-accent))] hover:border-[var(--vendor-button-primary-hover,var(--text-accent))] disabled:opacity-50 disabled:cursor-not-allowed` |
| `.vendor-btn-danger-solid` | `px-4 py-1.5 bg-[#e55] border-none rounded-md text-white text-xs font-medium cursor-pointer hover:opacity-85` |

### Custom models

| Selector | Tailwind |
|---|---|
| `.vendor-custom-models` | `flex flex-col gap-1.5` |
| `.vendor-model-item` | `flex items-center gap-2 px-2 py-[5px] rounded-[5px] bg-[var(--surface-card)] border border-[var(--border-muted)]` |
| `.vendor-model-id` | `font-[var(--font-code)] text-xs text-[var(--text-accent)] flex-1` |
| `.vendor-model-label` | `text-xs text-[var(--text-secondary)]` |
| `.vendor-model-add` | `flex gap-1.5 items-center [&_.vendor-input]:flex-1` |
| `.vendor-btn-add-sm` | `w-7 h-7 flex items-center justify-center bg-[var(--vendor-button-primary,var(--text-accent))] text-white border border-[var(--vendor-button-primary,var(--text-accent))] rounded-[5px] text-base cursor-pointer shrink-0 transition-[background,border-color] duration-150 hover:bg-[var(--vendor-button-primary-hover,var(--text-accent))] hover:border-[var(--vendor-button-primary-hover,var(--text-accent))] disabled:opacity-40 disabled:cursor-not-allowed` |
| `.vendor-model-manager-dialog` | `w-[min(640px,90vw)]` — but consumer uses `vendor-dialog-wide` which is `min(600px,90vw)`. Append after `vendor-dialog-wide` override → `!w-[min(640px,90vw)]` |
| `.vendor-model-manager-list` | `flex flex-col gap-2` |
| `.vendor-model-manager-item` | `flex items-start gap-2.5 px-2.5 py-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-card)]` |
| `.vendor-model-manager-main` | `flex-1 min-w-0 flex flex-col gap-0.5` |
| `.vendor-model-manager-id` | `font-[var(--font-code)] text-xs font-semibold text-[var(--text-primary)] break-all` |
| `.vendor-model-manager-label` | `text-xs text-[var(--text-secondary)]` |
| `.vendor-model-manager-desc` | `text-[11px] text-[var(--text-muted)] break-words` |
| `.vendor-model-manager-actions` | `flex items-center gap-1 shrink-0` |
| `.vendor-model-manager-form` | `border border-[var(--border-muted)] rounded-lg bg-[var(--surface-card)] p-2.5 flex flex-col gap-2` |
| `.vendor-model-manager-form-actions` | `flex justify-end gap-2` |
| `.vendor-model-manager-add-btn` | `self-start` |

### Model mapping card + settings-card

| Selector | Tailwind |
|---|---|
| `.model-mapping-card` | `p-4 rounded-xl border border-[var(--border-muted)] bg-[var(--surface-card)]` |
| `.settings-card-header` | `mb-3` |
| `.settings-card-title-row` | `flex items-center justify-between gap-3` |
| `.settings-card-title` | `text-[13px] font-semibold text-[var(--text-strong)] m-0` |
| `.settings-card-badge` | `inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border-muted)] bg-[var(--surface-control)] text-[var(--text-muted)] text-[11px] cursor-pointer transition-all duration-150 hover:border-[var(--border-strong)] hover:text-[var(--text-error)]` |
| `.model-mapping-badge svg` | `[&_svg]:w-3 [&_svg]:h-3` |
| `.settings-card-description` | `text-[11px] text-[var(--text-subtle)] mt-1 mb-0` |
| `.model-mapping-fields` | `flex flex-col gap-2.5 mb-3` |
| `.model-mapping-field` | `flex flex-col gap-1` |
| `.model-mapping-label` | `flex flex-col gap-0.5 text-xs font-medium text-[var(--text-strong)]` |
| `.model-mapping-default` | `text-[10px] text-[var(--text-faint)] font-[var(--font-code,'SF_Mono','Fira_Code',monospace)]` |
| `.model-mapping-input` | `px-2.5 py-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-control)] text-[var(--text-strong)] text-xs font-[var(--font-code,'SF_Mono','Fira_Code',monospace)] outline-none transition-[border-color] duration-150 focus:border-[var(--border-accent)] placeholder:text-[var(--text-faint)]` |
| `.model-mapping-actions` | `flex gap-2 justify-end` |
| `.model-mapping-button` | `px-3.5 py-1.5 rounded-md text-xs cursor-pointer transition-all duration-150` |
| `.model-mapping-button-secondary` | `bg-transparent border border-[var(--border-muted)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]` |
| `.model-mapping-button-primary` | `bg-[var(--text-accent,#3b82f6)] border-[var(--text-accent,#3b82f6)] text-white hover:opacity-90` |
| `.model-mapping-note` | `mt-2.5 px-2.5 py-2 rounded-md bg-[var(--surface-sidebar)] text-[11px] text-[var(--text-subtle)]` |

## Execution plan

### Step 1: Inline Tailwind into 11 consumer files

按 cluster 内聚顺序（最少风险优先）：

1. `DeleteConfirmDialog.tsx` — 仅 vendor-btn-danger-solid 待补
2. `ModelMappingSettings.tsx` — 独立 module，纯 model-mapping + settings-card
3. `AgentSettingsSection.tsx` — 仅 vendor-btn-save / vendor-btn-danger-solid 补充（vendor-btn-cancel 已 6.5a 处理）
4. `CodexProviderDialog.tsx` — 补 part2（vendor-btn-save / custom-models / model-item / model-id / model-label / model-add / btn-add-sm / btn-icon / btn-danger）
5. `CustomModelDialog.tsx` — 补 vendor-btn-save / vendor-model-manager-* / btn-icon / btn-danger / empty / vendor-model-add（最 dense）
6. `ProviderDialog.tsx` — 补 vendor-btn-save / btn-icon
7. `CurrentClaudeConfigCard.tsx` — 补 vendor-current-config-* + Badge wrapper
8. `CurrentCodexGlobalConfigCard.tsx` — 补 vendor-current-config-loading / vendor-current-config-empty / vendor-current-config-header / vendor-current-config-title
9. `ProviderList.tsx` — 补 part1 vendor-provider-list / vendor-list-* / vendor-cards / vendor-card / vendor-card-* / vendor-local-provider-card / vendor-empty
10. `CodexProviderList.tsx` — 同 ProviderList，简化版
11. `GeminiVendorPanel.tsx` — Gemini cluster（gemini-shell / gemini-primary-grid / gemini-card / gemini-section-head / gemini-section-title / gemini-check-list / gemini-check-row / gemini-check-copy / gemini-check-label / gemini-check-message / gemini-check-status / gemini-empty-checks / gemini-auth-header / gemini-auth-header-actions / gemini-auth-grid / gemini-auth-field / gemini-auth-field-wide / gemini-auth-mode-trigger / gemini-auth-mode-selected / gemini-auth-mode-option / gemini-auth-mode-icon / gemini-auth-mode-text / gemini-auth-mode-popup / gemini-env-editor / gemini-actions-row / gemini-saved-hint / spin → animate-spin / btn-icon）
12. `VendorSettingsPanel.tsx` — top-level (vendor-settings-panel / vendor-section-title / vendor-section-desc / vendor-tabs / vendor-tab / vendor-tab-label / vendor-tab-content / vendor-plugin-model-entry / vendor-plugin-model-entry-main / vendor-plugin-model-entry-title / vendor-plugin-model-entry-count)

### Step 2: Remove files & update aggregators

- `rm src/styles/settings.part1.vendor-panels.css`
- `rm src/styles/settings.part2.vendor-models.css`
- Edit `src/styles/settings.css`：删 line 2（`@import "./settings.part1.vendor-panels.css";`）
- Edit `src/styles/settings.part2.css`：删 line 1（`@import "./settings.part2.vendor-models.css";`）

### Step 3: Verify

跑：
- `npm run lint`
- `npm run typecheck`
- `npm run check:large-files:gate`
- `npm run test:layout-guard`
- `npm run test -- src/features/vendors/components/VendorSettingsPanel.test.tsx src/features/settings/hooks/useAppSettings.test.ts src/features/settings/components/settings-view/sections/CodexSection.test.tsx`

## Risk + mitigation

| Risk | Mitigation |
|---|---|
| Tailwind utility 与原 CSS 在 specificity / cascade 顺序上不一致 | inline 在同一 className 字串内，order 与 source 一致；保留 semantic class as marker |
| `.vendor-card.active` conditional class 删除 .active CSS 后 → 失效 | 用 `cn("vendor-card", isActive && "active border-[var(--vendor-button-primary-border)] bg-[var(--vendor-button-primary-soft)]")` |
| `.vendor-spin` 删除后 keyframe 丢失 | 用 Tailwind 自带 `animate-spin`（已注入 base） |
| `.vendor-gemini-card-auth .vendor-input` 等 nested descendant override 删除后样式变化 | 这些 nested 仅做微调（5px→7px padding、12px→13px font-size）。保留 marker 但不 inline override；视觉差异在容忍范围内 |
| `.vendor-tab[data-selected]` data-attr style 丢失 | 用 Tailwind `data-[selected]:` variant 替代 |
| 删除 `.vendor-settings-panel [data-slot="button"]` 嵌套 button override → vendor 内 Button 失去 primary 配色 | 由 `--vendor-button-primary` CSS var 通过 inline 注入到 panel root（沿用 Phase 6.5a 模式），Button 子组件读取 var |

## Expected outcomes

- bootstrap.ts CSS import：40 → 40（不变）
- settings.css line count：5 → 4（删 line 2）
- settings.part2.css line count：变 1 行（删 line 1 的 @import）
- 删除文件：2（vendor-panels.css 863 + vendor-models.css 330 = 1193 行）
- 修改 tsx：11 文件（含 className 追加 Tailwind utility）
- lint / typecheck / test baseline：不退化
- VendorSettingsPanel.test.tsx 5/5 pass
- CodexSection.test.tsx pass
- useAppSettings.test.ts pass
- layout-guard 46/46 pass
- check:large-files:gate pass

## Follow-ups

无：Phase 6.5 cluster 收尾完成。剩余 settings 子系统其它 css partial 进入后续 phase。
