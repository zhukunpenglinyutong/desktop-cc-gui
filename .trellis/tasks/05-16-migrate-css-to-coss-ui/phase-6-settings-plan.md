# Phase 6 — Settings: Discovery & Plan

> Status: drafted 2026-05-16 by Implement agent (Claude Code) before execution.

## Discovery summary

### Files in scope (PRD-listed)

| 文件 | 行 | Selectors | 字面值 pin? | Consumer 体量 | 处置 |
|---|---|---|---|---|---|
| `settings.css` (aggregator) | 8 | 0 (8 @imports) | 否 | — | **本 phase 处理**: 删 1 行 `@import "./settings.skills.css"` |
| `settings.skills.css` | 478 | 67 | 否 | `SkillsSection.tsx` 1289 行 / 40 className refs (单 consumer) | **本 phase 处理**: 删除 + 内联 Tailwind |
| `settings.part1.css` | 2158 | 311 | 否 | `SettingsView.tsx` 2231 行 (settings frame: shell / sidebar / nav / body / header) | **DEFER → Phase 6.7** (frame 超 PRD 1000-line tsx scope rule) |
| `settings.part1.vendor-panels.css` | 863 | 124 | 否 | vendor cluster: `VendorSettingsPanel` 747 / `GeminiVendorPanel` 339 / `CodexProviderList` 123 / `ProviderList` 177 / `CurrentClaudeConfigCard` 188 / `CurrentCodexGlobalConfigCard` 220 / `CodexProviderDialog` 229 / `CustomModelDialog` 312 / `ProviderDialog` 435 / `DeleteConfirmDialog` 62 = 2832 行 tsx | **DEFER → Phase 6.5** (vendor sub-PR; 共 11 consumer 超 PRD scope) |
| `settings.part2.css` | 2154 | 315 | **YES** — `settings-email-card-surface.test.ts` 用 `readFileSync('./settings.part2.css')` + `getCssRuleBlock` 钉死 5 条字面 CSS: `.settings-email-card` 的 `background: var(--surface-card);` / `border: 1px solid var(--border-muted);` / `.settings-email-card[data-slot="card"]::before` 的 `box-shadow: none;` / `.settings-card-switch-header` 的 `grid-template-columns: minmax(0, 1fr) auto;` / `.settings-basic-sounds-card-content` 的 `display: flex;` + 1 条 negative `not.toMatch` 保护 | `EmailSenderSettings.tsx` 461 + cross-section reaches | **DEFER → Phase 6.6** (字面值 pin + 大体量) |
| `settings.part2.basic-redesign.css` | 1044 | 156 | 否 | cross-section: `BasicAppearanceSection` 742 / `BasicBehaviorSection` 579 / `ComposerSection` 292 / `CodexSection` 1006 / `DictationSection` 242 / `Detached*` 73 / `ExperimentalToggleRow` ?? = 2900+ 行 tsx | **DEFER → Phase 6.6** (cross-section cascade through `--settings-basic-*` CSS vars + `:where()` 选择器, 不适合 inline) |
| `settings.part2.vendor-models.css` | 330 | 48 | 否 | vendor cluster: `UsageSection.tsx` / `GeminiVendorPanel` / `CodexProviderDialog` / `ProviderDialog` | **DEFER → Phase 6.5** (vendor sub-PR) |
| `settings.part3.css` | 244 | 44 | 否 | cross-section: `BasicAppearanceSection.tsx` + `BasicBehaviorSection.tsx` + 7 sections via `.settings-section-basic` 复合选择器 + `:root[data-theme="light"]` 主题覆盖 | **DEFER → Phase 6.6** (theme cascade + cross-section, 类 Phase 5 `release-notes-markdown.css` keeper 模式但需先迁 basic cluster) |
| `settings.vendor-codex-runtime.css` | 83 | 13 | 否 | vendor cluster: `VendorSettingsPanel`, `GeminiVendorPanel`, `CurrentCodexGlobalConfigCard`, `ProviderDialog` | **DEFER → Phase 6.5** (vendor sub-PR) |
| `settings.vendor-dialog.css` | 386 | 52 | 否 | vendor cluster: `ProviderDialog` 435 / `CodexProviderDialog` 229 / `CustomModelDialog` 312 / `GeminiVendorPanel` 339 / `DeleteConfirmDialog` 62 / `CurrentCodexGlobalConfigCard` 220 = 1597 行 tsx | **DEFER → Phase 6.5** (vendor sub-PR; 同时 vendor-dialog 是 dialog primitive 候选 — 应考虑用 `@coss/dialog` 结构性替换) |

### Bootstrap & aggregator status

- `src/bootstrap.ts:29` imports `./styles/settings.css`
- `settings.css` aggregates 8 partials in order:
  1. `settings.part1.css`
  2. `settings.part1.vendor-panels.css`
  3. `settings.vendor-codex-runtime.css`
  4. `settings.vendor-dialog.css`
  5. `settings.part2.css` (chain-imports `settings.part2.vendor-models.css` at line 1)
  6. `settings.part2.basic-redesign.css`
  7. `settings.part3.css`
  8. `settings.skills.css`

### Test-pinned literals affecting settings.*

- `src/styles/settings-email-card-surface.test.ts` reads `settings.part2.css` and asserts 5 literal CSS rules on `.settings-email-card*` selectors → **pins `settings.part2.css`** untouched in this phase.
- `src/features/settings/components/SettingsView.test.tsx` queries `.settings-doctor-body` (defined in `settings.part1.css` / `settings.part2.css`) → DOM querySelector pin, **does not** pin CSS literals, just requires the class name to render. Inline-Tailwind no-op marker pattern (Phase 2/3/4/5 既证) can satisfy this.
- `src/features/settings/components/SkillsSection.test.tsx` does NOT use querySelector / toContain on any `settings-skills-*` class → SkillsSection inline conversion is safe.

### `layout-swapped-platform-guard.test.ts` & `sidebar-titlebar-drag-region.test.ts`

Neither test reads any `settings.*.css` file. Safe.

## Phase 6 final scope (this PR)

**IN scope**:
1. `settings.skills.css` (478 行) — delete + inline Tailwind to `SkillsSection.tsx`
2. `settings.css` aggregator — remove 1 line (`@import "./settings.skills.css"`)

**OUT of scope (deferred)** — see "Follow-ups" below.

## Rationale for the収缩

PRD Phase 6 约束 line: "单文件超过 1000 行 tsx diff → scope 收缩到 Phase 6.5"。每个 deferred CSS 文件触发该规则:

- `settings.part1.css` → `SettingsView.tsx` 2231 行 frame
- `settings.part1.vendor-panels.css` / `vendor-codex-runtime.css` / `vendor-dialog.css` / `part2.vendor-models.css` → vendor cluster 共 2832 行 tsx
- `settings.part2.css` → 字面值 pin + 大量 cross-section consumer
- `settings.part2.basic-redesign.css` → 8+ sections cross-cutting cascade
- `settings.part3.css` → cross-section + theme cascade

`SkillsSection.tsx` 1289 行虽超 1000-line 标线, 但 className 引用集中在 line 770-1289 段 (40 处), 全为单 consumer 内聚, 不 leak 到任何其它 component, 测试也无 className 钉死。这与 Phase 5 `WorkspaceNoteCardPanel.tsx` (864 行 / 48 className refs, 单 consumer) 风格完全一致, 已被 Phase 5 既证可行。

## Execution plan (this PR)

### Step 1: Inline Tailwind to `SkillsSection.tsx`

Per Phase 2/3/4/5 established pattern: 保留所有 `settings-skills-*` 与 `settings-search-field` className 作为 **no-op semantic marker** (满足 SettingsView.test.tsx 的 `data-testid` 不需要 + 任何 future querySelector debug), **追加** Tailwind utility 在同一 className 字符串末尾。

各 className 对应映射 (按 .css 文件 group):

| 旧 selector | Tailwind 替换 |
|---|---|
| `.settings-search-field` | `inline-flex items-center gap-1.5 min-w-[220px]` |
| `.settings-search-field > svg` | (parent 内部 svg) `[&>svg]:text-[var(--text-faint)]` |
| `.settings-skills-list` | `grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-2` |
| `.settings-skills-card` | `border border-[var(--border-muted)] rounded-[10px] bg-[var(--surface-card)] px-3 py-2.5 flex flex-col gap-2` |
| `.settings-skills-card-head` | `flex items-center justify-between gap-2` |
| `.settings-skills-name` | `text-[13px] text-[var(--text-strong)] font-semibold` |
| `.settings-skills-source` | `text-[11px] text-[var(--text-muted)] rounded-full border border-[var(--border-muted)] px-2 py-0.5` |
| `.settings-skills-description` | `text-[12px] text-[var(--text-subtle)]` |
| `.settings-skills-path` | `text-[11px] text-[var(--text-faint)] break-all` |
| `.settings-skills-actions` | `flex` |
| `.settings-skills-browser` | `mt-2.5 grid grid-cols-[minmax(260px,340px)_6px_1fr] gap-1` |
| `.settings-skills-browser.is-resizing` | (conditional) `cursor-col-resize` |
| `.settings-skills-browser.is-tree-collapsed` | (conditional) `gap-0` |
| `.settings-skills-head-inline` | `flex items-center justify-between gap-3 flex-nowrap` |
| `.settings-skills-head-desc` | `mb-0 flex-[0_0_auto]` |
| `.settings-skills-toolbar--inline` | `mb-0 flex-nowrap` (combined with parent `.settings-skills-toolbar`) |
| `.settings-skills-summary-strip` | `flex items-center gap-2 flex-wrap mb-2` |
| `.settings-skills-custom-dirs` | `grid grid-cols-[minmax(180px,260px)_minmax(280px,1fr)_auto] items-start gap-2.5 my-2.5 p-2.5 border border-[var(--border-muted)] rounded-lg bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)]` |
| `.settings-skills-custom-dirs-copy` | `flex flex-col gap-1` |
| `.settings-skills-custom-dirs-title` | `text-[12px] font-bold text-[var(--text-strong)]` |
| `.settings-skills-custom-dirs-input` | `min-h-[72px] font-mono text-[12px] resize-y` |
| `.settings-skills-custom-dirs-actions` | `inline-flex flex-col items-start gap-1.5` |
| `.settings-skills-summary-chip` | `inline-flex items-center gap-1.5 border border-[var(--border-muted)] rounded-full px-2.5 py-[5px] bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)] text-[var(--text-muted)] text-[11px]` |
| `.settings-skills-tree-pane` / `.settings-skills-detail-pane` | `border border-[var(--border-muted)] rounded-[10px] bg-[var(--surface-card)] min-h-[420px] flex flex-col` |
| `.settings-skills-splitter` | `w-[6px] border-0 bg-transparent p-0 relative cursor-col-resize` + 用 group + `before:` utility 模拟 splitter handle |
| `.settings-skills-pane-title` | `px-3 pt-2.5 pb-2 text-[12px] font-bold text-[var(--text-strong)] border-b border-[var(--border-muted)]` |
| `.settings-skills-pane-title--row` | `flex items-center justify-between gap-2` |
| `.settings-skills-detail-actions` | `inline-flex items-center gap-1.5 flex-wrap` |
| `.settings-skills-tree-root` | `px-3 py-2 text-[11px] text-[var(--text-muted)] border-b border-[var(--border-muted)] font-mono` |
| `.settings-skills-tree-scroll` | `overflow-auto py-2` |
| `.settings-skills-tree-node` | `w-full border-0 bg-transparent text-[var(--text-strong)] min-h-7 flex items-center gap-1.5 text-left cursor-pointer text-[12px] hover:bg-[var(--surface-hover)]` |
| `.settings-skills-tree-node--dir` | `font-semibold` |
| `.settings-skills-tree-node.is-active` | (conditional) `bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] text-[var(--text-strong)]` |
| `.settings-skills-tree-label` | `min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap` |
| `.settings-skills-tree-tag` | `inline-flex items-center gap-1 rounded-full border border-[var(--border-muted)] px-1.5 py-px text-[var(--text-muted)] text-[10px] font-medium` |
| `.settings-skills-tree-state` | `min-h-[26px] flex items-center text-[11px] text-[var(--text-muted)]` |
| `.settings-skills-detail-body` | `px-3 py-2.5 flex flex-col gap-2 min-h-0 flex-1` |
| `.settings-skills-detail-name` | `text-[15px] font-bold text-[var(--text-strong)]` |
| `.settings-skills-detail-headline` | `flex items-center gap-2 flex-wrap` |
| `.settings-skills-detail-chip` | `inline-flex items-center border border-[var(--border-muted)] rounded-full px-2.5 py-0.5 text-[11px] text-[var(--text-muted)] bg-[color-mix(in_srgb,var(--surface-card)_72%,transparent)]` |
| `.settings-skills-detail-meta` | `text-[11px] text-[var(--text-muted)] break-all` |
| `.settings-skills-detail-description` | `text-[12px] text-[var(--text-subtle)] leading-[1.5]` |
| `.settings-skills-content-wrap` | `mt-1 min-h-0 flex-1 flex flex-col overflow-auto` |
| `.settings-skills-editor-wrap` | `mt-0.5 min-h-0 flex-1 flex` |
| `.settings-skills-editor` | `flex-1 min-h-[320px] resize-y text-[12px] leading-[1.5] font-mono` |
| `.settings-skills-content` | `m-0 flex-1 min-h-[220px] overflow-auto border border-[var(--border-muted)] rounded-lg bg-[var(--surface-control)] text-[var(--text-strong)] px-3 py-2.5 text-[12px] leading-[1.45] whitespace-pre-wrap break-words font-mono` |
| `.settings-skills-markdown-preview` | `flex-1 min-h-[200px] overflow-auto border border-[var(--border-muted)] rounded-lg bg-[var(--surface-control)] px-3 py-2.5` |
| `.settings-skills-code-preview` | `flex-1 min-h-[220px] overflow-auto border border-[var(--border-muted)] rounded-lg bg-[var(--surface-control)] font-mono text-[12px]` |
| `.settings-skills-code-line` | `grid grid-cols-[56px_minmax(0,1fr)] items-baseline min-h-5` |
| `.settings-skills-code-line-number` | `inline-flex justify-end px-2.5 pr-0.5 text-[var(--text-faint)] border-r border-[var(--border-muted)] select-none` |
| `.settings-skills-code-line-content` | `inline-block min-w-0 whitespace-pre px-2.5 text-[var(--text-strong)]` |
| `.settings-skills-image-wrap` | `flex-1 min-h-[220px] border border-[var(--border-muted)] rounded-lg bg-[var(--surface-control)] flex items-center justify-center p-2.5 overflow-auto` |
| `.settings-skills-image-preview` | `max-w-full max-h-[560px] object-contain` |

Media query (`@media (max-width: 1100px)`) → 用 Tailwind `max-[1100px]:` arbitrary breakpoint utility 表达 inline。

### Step 2: Remove file & update aggregator

- `rm src/styles/settings.skills.css`
- `settings.css` line 8 (`@import "./settings.skills.css";`) → 删除

### Step 3: Verify

跑 standard 5 命令套 + 定向 SkillsSection 测试。

## Follow-ups (deferred to subsequent phases)

新增到 `docs/migration-to-coss-ui.md`:

- **Phase 6.5 (vendor cluster)** — 4 文件 / 1662 行 CSS / 2344+ 行 tsx vendor consumer:
  - `settings.vendor-codex-runtime.css` (83 行)
  - `settings.vendor-dialog.css` (386 行)
  - `settings.part1.vendor-panels.css` (863 行)
  - `settings.part2.vendor-models.css` (330 行)
  - **Contract constraint**: 必须严格遵守 `.trellis/spec/guides/codex-unified-exec-override-contract.md` 的 vendor settings UI 约束 (4 个 action buttons / no tri-state selector / payload type signatures)
  - 建议 sub-split: 6.5a vendor-dialog (cluster 入口) / 6.5b vendor-panels / 6.5c vendor-models + vendor-codex-runtime
- **Phase 6.6 (basic + part2 + part3)** — 3 文件 / 3442 行 CSS / cross-section cascade through `--settings-basic-*` CSS vars:
  - `settings.part2.css` (2154 行) — **字面值 pin × 5** in `settings-email-card-surface.test.ts`. 必须先拆解 email-card cascade 到 `EmailSenderSettings.tsx` inline, 再调整 pin test
  - `settings.part2.basic-redesign.css` (1044 行) — 跨 13 section consumer
  - `settings.part3.css` (244 行) — keeper 候选 (theme cascade `:root[data-theme="light"]`), 但需配合 6.6 整体
- **Phase 6.7 (settings frame)** — 1 文件 / 2158 行 CSS / `SettingsView.tsx` 2231 行 frame:
  - `settings.part1.css` — settings shell / sidebar / nav / header / body 骨架
  - **Contract constraint**: 必须严格遵守 `.trellis/spec/guides/terminal-shell-configuration.md` 的 `terminalShellPath` placeholder text 不能被 CSS truncate (placeholder examples 是 guidance only, not persisted)
- **coss primitive structural swap (Phase 6+ follow-up)**:
  - `vendor-dialog.css` → `@coss/dialog` primitive
  - settings tabs → `@coss/tabs` primitive (Phase 2/3 类似决策, 推迟到 follow-up)

## Expected outcomes

- bootstrap.ts CSS import 数: 40 → 40 (settings.css 仍是 entry, 内部少 1 个 @import)
- settings.css line count: 8 → 7
- 删除文件: 1 (`settings.skills.css`)
- 修改文件: 2 (`SkillsSection.tsx` 1289 行 + `settings.css` 8 行)
- typecheck baseline: 保持 2 errors (perfBaseline×2)
- lint / test / layout-guard / large-files baseline: 不退化
