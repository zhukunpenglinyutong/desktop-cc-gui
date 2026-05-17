# 彻底迁移 CSS 架构到 coss.ui 框架

> Status: **PLAN-DRAFT** — 需求已澄清，phase 计划草案待用户最终 confirm。

## 背景

- 项目 fork 自 https://github.com/Dimillian/CodexMonitor
- 在原仓库基础上 commit 1000+ 次，技术架构未彻底重构，导致：
  - CSS 库与样式实现非常庞杂（104 个 .css，多处按 part 切分）；
  - 整体页面"非常不好看"。
- 本次目标：**100% 彻底** 用 `coss.ui` 重塑 CSS 架构 + 基础组件。Clean-slate 推倒重做。

## 项目事实基线

- 栈：React 18 + TypeScript（strict）+ Vite 5 + Tauri，alias `@/*`。
- 已存在依赖（**完美适配 coss**）：
  - `@base-ui/react ^1.2.0`
  - `@tailwindcss/vite ^4.1.18`
- 当前 CSS 资产：`src/styles/` 下 **104 个 .css 文件**。
- 质量门禁：`npm run lint && npm run typecheck && npm run test`，大文件守卫 3000 行，含 `test:layout-guard`。
- coss skill 已安装到 `.agents/skills/coss/`，覆盖 **53 个 primitive**（registry 见 `references/component-registry.md`）。
- 当前 git：`chore/bump-version-0.5` 分支，1 个未提交改动（`.claude/settings.local.json`）。

## 最终目标（已收敛）

1. 旧 `src/styles/**/*.css`（104 个文件） **彻底删除**。
2. 全部样式表达统一为 **Tailwind v4 + coss design token + `data-slot` 约定**。
3. 基础组件（Dialog/Menu/Select/Tooltip/Tabs/Switch/Toast/Popover/Form 等）全部用 coss 原语替换。
4. 视觉直接采用 coss 默认设计语言，**不引入 brand color override**（留作后续 follow-up）。
5. feature 页面的 layout/信息架构/动线 **不重做**（亦留作后续 follow-up）。
6. lint / typecheck / test / layout-guard / large-file 守卫全程不掉绿。

## 范围

- IN：`src/**`（所有 React 组件 + 配套样式）、`src/styles/**`（彻底删）、Tailwind/Vite 配置中的 CSS 入口。
- OUT：Tauri Rust 后端、IPC、业务逻辑、性能 baseline 脚本、`src/services/tauri.ts` 的 contract。

## 约束

- ~~branch：从 `main` 切 `feature/migrate-to-coss-ui`~~ → **【2026-05-16 用户调整】直接在当前 `chore/bump-version-0.5` 分支上做**（用户确认该 branch 是最先进的、领先 main 34 commits，所有后续 coss 迁移 commit 都进这个 branch；不另切 feature branch）。
- 不破坏 `.claude/settings.local.json` 中用户当前的本地权限调整（已观察到放宽为 `Bash(*)`），允许它跟随首个 phase commit 一起进库。
- 每个 phase 结束时应用必须可启动、关键流程（threads/composer/git-history/spec-hub/settings）可用。
- 复用项目规范：`.trellis/spec/frontend/**`、`.trellis/spec/guides/**`。
- 不破坏 `messages-streaming-render-contract.md`、`computer-use-bridge.md`、`claude-context-usage-display.md` 等已有契约。

## 验收条件

- [ ] `src/styles/` 目录 **不存在**（或仅留 Tailwind v4 entry + coss token 入口，单文件）。
- [ ] 全仓 grep `import.*\.css` 仅命中 Tailwind v4 entry。
- [ ] 全仓 grep `class(Name)?=".*\b(part1|part2|.*-shell)\b"` 应无遗留旧 CSS class。
- [ ] coss primitive 已覆盖项目所有基础组件场景；自定义组件统一落位 `src/components/ui/` 或对应 feature slice。
- [ ] `npm run lint && npm run typecheck && npm run test` 全绿。
- [ ] `check:large-files:gate` 不退化。
- [ ] `test:layout-guard` 通过。
- [ ] 人工 verify：启动 → threads → 进入 thread → composer → git history → spec hub → settings → file tree → diff → terminal → search palette。
- [ ] follow-up 清单已落在 `docs/migration-to-coss-ui.md`。

## 已澄清问题（决策快照）

1. ✅ 旧 CSS 允许删除（clean-slate）。
2. ✅ 重构边界 = B：样式 + 基础组件，不动 layout/IA。
3. ✅ 视觉 = coss 默认设计语言，无 brand override。
4. ✅ 节奏 = 阶段性 PR。**branch 调整**：直接在 `chore/bump-version-0.5` 上做，不另切 feature branch（用户 2026-05-16 确认）。
5. ✅ in-flight CSS task 处置（2026-05-16 复核）：
   - 3 个纯 CSS 切分（composer-rewind / git-history-branch-compare / settings-css-panel）→ archive。
   - `04-22-align-live-sticky` 含 render contract 行为需求 → archive + 需求 carry-forward 至 Phase 3 DoD。
6. ✅ coss skill 完整安装授权——已完成，53 primitive 全覆盖。

## Phase / Milestone

> 每个 phase = 1 个 PR。所有 PR 都直接在 `chore/bump-version-0.5` 上。

### Phase 0 — Preflight & Foundation （**零视觉变化、不接 Tailwind**）
- ✅ 保留 `.claude/settings.local.json` 当前改动（用户 own 的本地权限放宽），随 Phase 0 commit 一并入库。
- ✅ archive 4 个 superseded task（已完成 2026-05-16）。
- ✅ 落地 `src/components/ui/README.md`——约定 coss 组件落位规则、添加方式、禁止项。
- ✅ 落地 `docs/migration-to-coss-ui.md`——路线图、决策快照、follow-up 清单。
- ✅ coss + coss-particles skill 已装到 `.agents/skills/coss/` 与 `.agents/skills/coss-particles/`，并 symlink 到 `.claude/skills/`。
- **不**动 `src/bootstrap.ts` 的 CSS import 链。
- **不**创建 `src/styles/coss.css`（推迟到 Phase 1）。
- 理由：Tailwind v4 `@import "tailwindcss";` 会引入 preflight，可能 break 旧 CSS。Phase 0 维持 0 视觉风险，仅做脚手架。

#### Phase 0 完成状态 ✅

| Acceptance | 状态 |
|---|---|
| `npm run lint` | ✅ Pass |
| `npm run typecheck` | ⚠️ Pre-existing baseline = 3 errors（与本 phase 无关，详见下） |
| 应用启动视觉 | 不变（没动 CSS 入口或组件） |
| 新建文档可读 | ✅ |
| Trellis context 注入 | ✅ implement.jsonl 16 entries / check.jsonl 7 entries |

#### Typecheck Baseline（pre-existing，**非本 task 引入**）

stash 我的改动后 `npm run typecheck` 仍报相同 3 处错，确认与 Phase 0 无关：

1. ~~`src/components/ui/input.tsx:48`~~ — **✅ Phase 4（2026-05-16）已修复**：移除 dead `nativeInput` prop + 对应分支，单 render path 化为 `<InputPrimitive>` only。typecheck baseline 从 3 → 2 errors。
2-3. `src/services/perfBaseline/index.ts:1, 81` — `Cannot find module 'web-vitals'`
   - 性质：perfBaseline 缺依赖，与本次 coss 迁移无关。
   - 处置：列入 `docs/migration-to-coss-ui.md` follow-up；本 task 不处理。

#### Phase 0 hand-off 给用户

接下来用户需要决定：
1. **commit Phase 0 改动**（推荐——脚手架就绪，可单独 review）。Phase 0 commit message 草案：
   `refactor(coss-ui): Phase 0 脚手架与已废弃 task 归档`
2. **或**先要求修 typecheck baseline 再继续。
3. **或**让我直接进入 Phase 1（接 coss.css）。
- 落地 `src/styles/coss.css`（Tailwind v4 entry + `@theme` block + coss token import），保留旧 styles 与新 entry 并存。
- 落地 `src/components/ui/` 空目录 + README 约定。
- 起草 `docs/migration-to-coss-ui.md`（路线图 + follow-up 占位）。
- DoD：lint/typecheck/test 全绿；应用启动视觉跟主线一致（旧 CSS 仍在加载）。

### Phase 1 — coss Token 收尾与 globals.css 清理 （**Phase 0 后 spike 后重写**）

> **2026-05-16 spike 发现**：基础接入早已存在！
> - `components.json` 已配 `@coss` registry，shadcn CLI 可直接 `add @coss/<name>`。
> - `src/styles/globals.css` 已 `@import "tailwindcss"`，已含 `@theme` block 映射 coss 标准 token（`--color-background`、`--color-foreground` 等约 30+ 个）。
> - `src/styles/themes.light.css:68-75` 与 `themes.dark.css:81-88` 已定义 `--background`、`--foreground`、`--card`、`--card-foreground`、`--primary`、`--primary-foreground` 等 coss 标准 token，与项目老 `--text-*` / `--surface-*` token 并存。
> - `globals.css:46-47` 已有 `--font-sans` / `--font-mono`（指向 `--ui-font-family` 自定义变量，而非 coss 推荐 Inter / Geist Mono）。
> - `src/bootstrap.ts` 已经把 `globals.css` 作为首行 import，cascade 顺序正确。
>
> 结论：**Phase 1 不再需要"接入"，只需"收尾 + 清理"**。

实际 Phase 1 工作：

1. **审计 coss token 完整性**：
   - 比对 `themes.light.css` / `themes.dark.css` 中 coss 标准 token 是否覆盖 coss styling.md 期望（`destructive-foreground`、`success`、`warning`、`info` 系列与 `*-foreground`、`sidebar-*`、`ring`、`input`、`muted` 等完整链路）。
   - 缺失的补齐；不破坏已有定义。
2. **字体变量评估**：
   - 当前 `--font-sans` / `--font-mono` 指向 `--ui-font-family`（SF Pro Text）。
   - 评估是否替换为 coss 推荐 Inter / Geist Mono（按用户选 "coss 默认 design language" 应替换）；或继续保留 SF Pro 但补全 `--font-heading`。
3. **globals.css 责任分层**：
   - 把 globals.css 末尾的业务样式（`.proxy-status-badge*` keyframes 等）抽出到独立 `proxy-status-badge.css` 或合并入 `tabbar.css`/sidebar 区相关样式。
   - globals.css 只保留 Tailwind import / `@theme` block / cascade layer 声明三件套，符合 coss styling.md "theme entry" 责任。
4. **写一个 coss demo**：
   - 在 `src/components/ui/` 或 `src/test-fixtures/` 加一个最小 demo 页面，验证 `bg-background text-foreground border` 等 coss utility class 真的能 render 正确颜色。
   - 不直接接入主 UI，避免视觉影响。

不做的（推迟到 Phase 2-9）：
- ❌ 删除项目老 `--text-*` / `--surface-*` token（93 个旧 .css 在用，删了瞬间炸）。
- ❌ 把 themes.*.css 内 cascade 重排成 coss `:root` / `[data-theme]` block——cascade 已经正确。
- ❌ 给 Tailwind 配 cascade layer 强制低优先级——`@import "tailwindcss"` 默认行为 + 现状已经 work。

DoD：
- [x] coss styling.md 期望的 token 链路完整（21 个 token light/dark/`@theme` 三处都齐，仅补 `--font-heading`；详见 `phase-1-token-audit.md`）。
- [x] 字体策略文档化在 PRD 与 `docs/migration-to-coss-ui.md`（保守保留 SF Pro Text，Phase 2+ 视觉刷新再切 Inter / Geist Mono）。
- [x] `globals.css` 60 行（167 → 60，已剥离 `.proxy-status-badge*` 业务样式到 `proxy-status-badge.css`；60 行内容均为必需的 token 映射 + 注释，物理已无可压缩）。
- [x] coss demo 页面通过 jsdom 测试（`__coss-smoke__/CossSmokeTest.test.tsx` 5 个 case 全过；13 个 coss utility class 验证 className contract）。
- [x] lint / typecheck baseline 不增加（3 个 pre-existing 不变；smoke test 不引入新 typecheck 错）。
- [ ] `tauri dev` 旧 UI 视觉零回归（需要用户在 GUI 实测；headless 跑不出）。

#### Phase 1 完成状态（2026-05-16）

实际产出（implement agent）：
- 新增：`src/styles/proxy-status-badge.css`（119 行，从 globals.css 抽出）
- 新增：`src/components/ui/__coss-smoke__/`（`CossSmokeTest.tsx` 65 行 + 测试 57 行 + README）
- 新增：`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-1-token-audit.md`（129 行 audit）
- 修改：`src/styles/globals.css`（167 → 60，添加 `--font-heading`，剥离业务样式）
- 修改：`src/bootstrap.ts`（追加 `proxy-status-badge.css` 在 line 52）

验证：
- `npm run lint` ✅ pass
- `npm run typecheck` ✅ 仅 3 个 pre-existing baseline 错（input.tsx + perfBaseline×2），无新错
- `npx vitest run src/components/ui/__coss-smoke__/CossSmokeTest.test.tsx` ✅ 5/5 pass

后续 phase 影响：
- Phase 2-9 中如果某 feature 需要 sidebar-ring 等扩展 token，按需补到 themes.*.css。
- Phase 10 删除 `__coss-smoke__/` fixture。

### Phase 2 — Global Chrome
- 覆盖：`app-shell`、`sidebar.chrome`、`tabbar`、`panel-lock`、`panel-tabs`、`search-palette`、`compact-tablet`、`debug`。
- 用 coss Sidebar / Tabs / Command / Tooltip 等原语替换；删对应 .css。
- DoD：旅程 = 启动 → 切 tab → 命令面板。

#### Phase 2 完成状态（2026-05-16）

实际产出（implement agent）：
- 新增：`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-2-chrome-plan.md`(discovery + plan + scope decision)
- 删除 8 个 .css 文件：`tabbar.css`、`panel-tabs.css`、`panel-lock.css`、`search-palette.css`、`compact-base.css`、`compact-phone.css`、`compact-tablet.css`、`debug.css`
- 修改 8 个 .tsx 文件：`TabBar.tsx`、`PanelTabs.tsx`、`LockScreenOverlay.tsx`、`SearchPalette.tsx`、`PhoneLayout.tsx`、`TabletLayout.tsx`、`TabletNav.tsx`、`DebugPanel.tsx`、`useLayoutNodes.tsx`、`DebugPanel.tsx`
- 修改：`src/styles/base.css`（419 → 502 行，吸收 compact-base/phone/tablet 的 cross-cutting 选择器）
- 修改：`src/bootstrap.ts`（54 → 46 个 CSS import）

Scope 调整（写在 plan doc）：
- **未处理**：`sidebar.css`、`sidebar.chrome.css`、`sidebar-shell.css`。原因：sidebar.css 2448 行中 80% 是 workspace/thread/worktree 业务样式，又被 `layout-swapped-platform-guard.test.ts` 与 `sidebar-titlebar-drag-region.test.ts` 钉死字面 CSS。归 Phase 3+ 配合 Threads/Workspace 拆解时一起处理。
- **未引入 coss primitive**：本 phase 决策为「纯 styling pass」，原因详见 plan doc；`Command`（SearchPalette）与 `Dialog`（LockScreenOverlay）的结构性替换转入 Phase 4 follow-up。

验证：
- `npm run lint` ✅ pass
- `npm run typecheck` ✅ 仅 3 个 pre-existing baseline 错（input.tsx + perfBaseline×2），无新错
- `npm run test` ✅ 仅 `ComposerInput.collaboration.test.tsx` 的 3 个 pre-existing failure（已通过 `git stash` 确认与 Phase 2 无关）
- `npm run test:layout-guard` ✅ 10/10 pass
- `npm run check:large-files:gate` ✅ pass

### Phase 3 — Threads + Messages
- 覆盖：`messages.part1/2`、`messages.streaming`、`messages.history-sticky`、`messages.status-shell`、`messages.part1-shell`、`messages.part2.css`、`prompts.css`。
- 严格遵守 `.trellis/spec/frontend/messages-streaming-render-contract.md`（stable snapshot + live row override）。
- **Carry-forward from `04-22-align-live-sticky-with-history-header`**（必须满足）：
  - [x] realtime 不再渲染 `.messages-live-sticky-user-message`（迁移到 coss 后用统一的 sticky header 出口）
  - [x] realtime / history 共用同一条 sticky header 出口渲染
  - [x] realtime 回看更早 rendered sections 时，sticky header 按 history-style handoff 接棒
  - [x] trimmed live latest question 仍可驱动 sticky header
- DoD：旅程 = 列表 → 进入 thread → 实时消息流；并验证以上 4 条 sticky 行为。

#### Phase 3 完成状态（2026-05-16）

**Scope 大幅收缩** — 见 `phase-3-messages-plan.md` 的 "Final Phase 3 scope" 节。原 PRD 列出的 8 个 CSS 文件中，**6 个被 CSS-content 测试钉死**（`layout-swapped-platform-guard.test.ts` 用 `readCssWithImports` 读取整条 `messages.css` 链路并对字面文本做 `.toContain` 断言）。本 phase 仅处理 2 个无测试钉死的小文件：

实际产出（implement agent）：
- 新增：`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-3-messages-plan.md`（discovery + 6 文件 defer rationale + 2 文件 convert plan）
- 新增：`src/styles/prompts-animations.css`（54 行，仅保留 3 个 `@keyframes` + `.is-highlight` / `.prompt-editor` / `.prompt-empty-card` / `.prompt-delete-confirm` 的 `animation` 触发 + `prefers-reduced-motion` 覆写——同 Phase 1 `proxy-status-badge.css` pattern）
- 删除 2 个 .css 文件：
  - `src/styles/prompts.css`（295 行）→ 内联 Tailwind 到 `PromptPanel.tsx`；`PromptEnhancerDialog.tsx` 2 处共享 `.prompt-section` 由 `enhance-prompt.css` 自带规则兜底，仅补 `justify-between` Tailwind 兜底原 prompts.css cascade
  - `src/styles/messages.streaming.css`（15 行，含 1 条死 CSS `.thinking`）→ 内联 Tailwind 到 `MessagesRows.tsx` + `WorkspaceSessionActivityPanel.tsx` 的 `.markdown-live-streaming` / `.markdown-live-plain-text` className 拼接处
- 修改：`src/styles/messages.css`（5 → 4 行，去掉 streaming `@import`）
- 修改：`src/bootstrap.ts`（line 26 `prompts.css` → `prompts-animations.css`，import 总数 46 保持不变）
- 修改：`src/features/prompts/components/PromptPanel.tsx`（46 处 `prompt-*` className 保留为 no-op semantic marker + 追加 Tailwind utility）
- 修改：`src/features/composer/components/ChatInputBox/PromptEnhancerDialog.tsx`（2 处 `.prompt-section-header` 追加 `justify-between`）
- 修改：`src/features/messages/components/MessagesRows.tsx`（3 处 `.markdown-live-streaming` / `.markdown-live-plain-text` 追加 `break-words [overflow-wrap:anywhere]` / `whitespace-pre-wrap`）
- 修改：`src/features/session-activity/components/WorkspaceSessionActivityPanel.tsx`（1 处同上）

未处理（推迟到 Phase 3.5 / 3.6 / 4）——已在 `docs/migration-to-coss-ui.md` follow-up 落档：
- `messages.css`（entry，被测试读）
- `messages.history-sticky.css`（394 行，7 条字面 CSS 断言 + `MessagesTimeline.tsx` 8 个 className + 30 个 `Messages.live-behavior` querySelector）
- `messages.part1-shell.css`（222 行，`.claude-render-safe` 字面断言）
- `messages.part1.css`（2301 行，`.messages-live-controls` + `.claude-render-safe` 字面断言）
- `messages.part2.css`（875 行，体量太大且与 part1 / status-shell 强耦合）
- `messages.status-shell.css`（533 行，含 `.claude-render-safe .working-spinner` 字面断言）

4 条 sticky carry-forward acceptance 通过 **non-intervention** 保留：`MessagesTimeline.tsx:478-530` 的 sticky header markup 完全未改；`messagesUserPresentation.ts`、`useStickyMessageSelector` 等 hook 完全未动；45 条 `Messages.live-behavior.test.tsx` 全过（含 7 条 `.messages-live-sticky-user-message` `toBeNull` 断言 + 30+ 条 `.messages-history-sticky-header` 行为断言）。

验证（同 Phase 2 baseline，无新错）：
- `npm run lint` ✅ pass
- `npm run typecheck` ✅ 仅 3 个 pre-existing baseline 错（input.tsx + perfBaseline×2），无新错
- `npm run test` ✅ 仅 `ComposerInput.collaboration.test.tsx` 的 3 个 pre-existing failure
- `npm run test:layout-guard` ✅ 10/10 pass（含 `.messages-shell.claude-render-safe` + `.messages-history-sticky-*` 字面断言全过 — 因为对应 CSS 文件未动）
- `npm run check:large-files:gate` ✅ pass（found=0）
- 单独跑 `Messages.live-behavior.test.tsx` ✅ 45/45 pass（覆盖 4 条 sticky carry-forward）
- 单独跑 `WorkspaceSessionActivityPanel.test.tsx` ✅ 54/54 pass（覆盖 `.markdown-live-streaming` className 断言）

后续 phase 影响：
- bootstrap.ts CSS import 数从 46 保持 46（prompts.css 换为 prompts-animations.css，1:1 替换）；实际删除文件 = 2 个。
- messages.css 链路从 5 imports 缩到 4。
- 3 条新 follow-up 入 `docs/migration-to-coss-ui.md`：Phase 3.5 sticky header、Phase 3.6 message bodies、Phase 4 PromptEnhancerDialog as Dialog。

### Phase 4 — Composer & Interaction Dialogs
- 覆盖：`composer.part1/2`、`ask-user-question-dialog`、`approval-toasts`、`request-user-input`、`loading-progress-modal`。
- 用 coss Dialog / AlertDialog / Toast / Form / Field 替换。
- DoD：旅程 = 发送消息 → 触发 ask-user-question → 触发 approval。

#### Phase 4 完成状态（2026-05-16）

**Scope 调整**（在 plan-time，非 execution-time）— 见 `phase-4-composer-plan.md` 的 "Discovery summary" 与 "Skip list"。原 PRD 列出的 composer.part1/part2 体量过大（5476 行 CSS / 404 个 selector / 5500+ 行 tsx consumers），单 phase 内不可行，**整体推迟到 Phase 4.5**（4 个 sub-PR：part1 / part2 / memory-picker / rewind-modal）。本 phase 实际处理 6 个 dialog/toast 文件 + 1 个 input.tsx baseline bonus fix：

实际产出（implement agent）：
- 新增：`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-4-composer-plan.md`（discovery + per-file plan + coss primitive 决策矩阵 + execution-time 结果）
- 新增：`src/styles/toast-animations.css`（68 行，保留 5 个 `@keyframes`：`update-toast-in` / `error-toast-in` / `approval-toast-in` / `ask-dialog-slide-in` / `ask-timer-pulse`——同 Phase 1 `proxy-status-badge.css` 与 Phase 3 `prompts-animations.css` pattern）
- 删除 6 个 .css 文件（共 1486 行 CSS）：
  - `loading-progress-modal.css`（117 行）→ 内联 Tailwind 到 `LoadingProgressDialog.tsx`
  - `update-toasts.css`（126 行）→ 内联到 `UpdateToast.tsx`
  - `error-toasts.css`（141 行）→ 内联到 `ErrorToasts.tsx`
  - `request-user-input.css`（230 行）→ 内联到 `RequestUserInputMessage.tsx` + `RequestUserInputSubmittedBlock.tsx`
  - `approval-toasts.css`（314 行）→ 内联到 `ApprovalToasts.tsx`
  - `ask-user-question-dialog.css`（458 行）→ 内联到 `AskUserQuestionDialog.tsx`；该文件 execution-time 验证为 dead CSS（无 bootstrap.ts 或其它 import 引用），意味着 dialog 之前在运行时是 unstyled，Phase 4 反而**恢复**了原始视觉意图
- 修改：`src/bootstrap.ts`（46 → 42 个 CSS import，−5 删除 + 1 添加 `toast-animations.css`；ask-user-question-dialog.css 不在 bootstrap 故不算）
- 修改：`src/components/ui/input.tsx`（Bonus fix：移除 dead `nativeInput` prop + 对应分支；Phase 0 baseline typecheck error 自然修复）
- 6 个 .tsx 全部沿用 `保留 class name 作为 no-op marker + 追加 Tailwind utility` pattern（与 Phase 2/3 一致）

未处理（推迟到 Phase 4.5）——已在 `docs/migration-to-coss-ui.md` follow-up 落档：
- `composer.part1.css`（1749 行）
- `composer.part2.css`（2247 行）
- `composer.memory-picker.css`（247 行，被 `composer.part2.css:1` 链式 import）
- `composer.rewind-modal.css`（1233 行，前有 archived task `04-23-split-composer-rewind-modal-styles`）
- `composer.css`（entry）

未引入 coss primitive structural swap（同 Phase 2/3 决策）——本 phase 决策为「纯 styling pass」，详见 plan doc 的 coss primitive 决策矩阵。`Dialog`（LoadingProgressDialog、AskUserQuestionDialog）、`Toast`（ErrorToasts、UpdateToast、ApprovalToasts）、`RadioGroup`/`CheckboxGroup`（option lists）的结构性替换转入 Phase 4 follow-up（需 `npx shadcn add @coss/dialog` 等新 dep + 行为契约 re-validation pass）。

验证（同 Phase 2/3 baseline，无新错；仅 input.tsx baseline 自然修复）：
- `npm run lint` ✅ pass
- `npm run typecheck` ✅ 2 个 pre-existing baseline 错（perfBaseline×2；input.tsx baseline 已修复 ⇒ 3 → 2）
- `npm run test` ✅ 仅 `ComposerInput.collaboration.test.tsx` 的 3 个 pre-existing failure（已通过 `git stash` 二次确认与 Phase 4 无关）
- `npm run test:layout-guard` ✅ 10/10 pass
- `npm run check:large-files:gate` ✅ found=0
- 单独跑 6 个 phase-4 affected component test ✅ 40/40 pass

后续 phase 影响：
- bootstrap.ts CSS import 数从 46 → 42（−5 + 1 添加）。
- 4 条新 follow-up 入 `docs/migration-to-coss-ui.md`：Phase 4.5 composer migration / Dialog primitive swap / Toast primitive swap / RadioGroup 引入。

### Phase 5 — Home & Workspace
- 覆盖：`home.css`、`home-chat.css`、`workspace-home.css`、`note-cards.css`、`kanban.css`、`release-notes.css`、`update-toasts.css`。
- DoD：旅程 = 启动后 home → 切 workspace → 查看 release notes → 更新 toast。

#### Phase 5 完成状态（2026-05-16）

**Scope 调整**（在 plan-time，非 execution-time）— 见 `phase-5-home-plan.md`。原 PRD 列出的 6 个 CSS 文件（加上 Phase 4 已 opportunistic 处理的 `update-toasts.css`），本 phase 处理 4 个；2 个 deferred：

- **DEFER `home-chat.css`** 到 Phase 5.5：6 个 CSS-literal `.toContain` 测试钉死（`HomeChat.styles.test.ts`：grayscale 规则 / codex context accents / workspace popup `data-slot` / picker search-add / selection states / trigger line-height），且 `ChatInputBoxFooter.tsx` 是 composer cluster（Phase 4.5 defer 范围）的共用 consumer。
- **DEFER `kanban.css`** 到 Phase 5.6：2071 行 CSS + 14 个 tsx consumer (5355 tsx 行) + 240+ className 引用，规模超过 composer cluster。需切成 sub-PR（5.6a/b/c），单 phase 不可行。

实际产出（implement agent）：
- 新增：`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-5-home-plan.md`（discovery + per-file plan + coss primitive 决策矩阵 + defer rationale）
- 新增：`src/styles/release-notes-markdown.css`（51 行，keeper：保留 `.release-notes-markdown :where(p, ul, ol, li, a, ...)` 的 markdown HTML 输出 cascade overrides，无法 inline 到 React className）
- 新增：`src/styles/note-cards-rich-input.css`（76 行，keeper：保留 `.workspace-note-cards-rich-input .rich-text-input*` 的 RichTextInput 内部 cascade overrides，descendant 是组件内部 markup 不在 JSX 树上）
- 新增：`src/features/tasks/utils/taskCenterClasses.ts`（54 行 helper：severity-driven Tailwind utility class strings，被 `WorkspaceHome.tsx` 和 `TaskCenterView.tsx` 共用——避免 css cascade）
- 删除 4 个 .css 文件（共 1445 行 CSS）：
  - `home.css`（85 行）→ 内联 Tailwind 到 `Home.tsx`；`home-fade-in` keyframe 换为 Tailwind `motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500`（tw-animate-css 已在 `globals.css` import）
  - `release-notes.css`（233 行）→ 内联到 `ReleaseNotesModal.tsx`；markdown cascade 拆到 `release-notes-markdown.css` keeper
  - `note-cards.css`（523 行）→ 内联到 `WorkspaceNoteCardPanel.tsx`（864 行 consumer，48+ className refs 全部保留为 no-op marker）；RichTextInput cascade 拆到 `note-cards-rich-input.css` keeper
  - `workspace-home.css`（604 行）→ 内联到 `WorkspaceHome.tsx`（163 行）+ `TaskCenterView.tsx`（244 行）；severity 调色板共用 `taskCenterClasses.ts` helper
- 修改：`src/bootstrap.ts`（42 → 40 CSS imports：删 4 个 `home/release-notes/note-cards/workspace-home`，加 2 个 keeper）
- 6 个 .tsx 全部沿用 `保留 class name 作为 no-op marker + 追加 Tailwind utility` pattern（与 Phase 2/3/4 一致）

未处理（推迟到 Phase 5.5 / 5.6）——已在 `docs/migration-to-coss-ui.md` follow-up 落档：
- `home-chat.css`（946 行）—— Phase 5.5
- `kanban.css`（2071 行）—— Phase 5.6（建议拆成 a/b/c 3 个 sub-PR）

未引入 coss primitive structural swap（同 Phase 2/3/4 决策）——本 phase 决策为「纯 styling pass」，详见 plan doc 的 coss primitive 决策矩阵。`Dialog`（ReleaseNotesModal）、`Tabs`（note-cards collection switch）、`Card`（spec-provider/guide cards）、`Button`（home primary）的结构性替换转入 Phase follow-up（需 `npx shadcn add @coss/dialog` 等新 dep + 行为契约 re-validation pass）。

发现：`WorkspaceHomeSpecModule.tsx`（160 行）使用 `workspace-home-panel` / `workspace-home-spec-module` / `workspace-home-section-header` / `workspace-home-spec-provider` / `workspace-home-guide-*` 等 class names，但 **这些 class 在任何 .css 文件都无定义**——组件渲染为 unstyled，且 `grep -rln "WorkspaceHomeSpecModule"` 结果仅文件自身（dead code，无 consumer）。Phase 5 不处理（dead code 清理超出 scope）。同 Phase 4 `ask-user-question-dialog.css` 模式。

验证（同 Phase 2/3/4 baseline，无新错）：
- `npm run lint` ✅ pass
- `npm run typecheck` ✅ 2 个 pre-existing baseline 错（perfBaseline×2；input.tsx baseline 已在 Phase 4 修复 ⇒ 保持 2）
- `npm run test` ✅ 仅 `ComposerInput.collaboration.test.tsx` 的 3 个 pre-existing failure（已通过 `git stash` 三次确认与 Phase 5 无关）
- `npm run test:layout-guard` ✅ 10/10 pass
- `npm run check:large-files:gate` ✅ found=0
- `npx vitest run` 单独跑 Phase 5 affected tests ✅ PASS (21) FAIL (0)
  - `Home.test.tsx` ✅ 2/2 pass（`.home-primary-button` querySelector 保留）
  - `HomeChat.styles.test.ts` ✅ 6/6 pass（`home-chat.css` 未动，6 个 CSS-literal pin 保留）
  - `WorkspaceHome.test.tsx` ✅ 6/6 pass（`.workspace-home-path-line/path-name/branch-line` querySelector + i18n key 全保留）
  - `WorkspaceNoteCardPanel.test.tsx` ✅ 7/7 pass（`.workspace-note-cards-list` classList contain `is-empty` 保留）

后续 phase 影响：
- bootstrap.ts CSS import 数从 42 → 40（−4 删除 + 2 新增 keeper）
- 6 条新 follow-up 入 `docs/migration-to-coss-ui.md`：Phase 5.5 home-chat migration / Phase 5.6 kanban migration (a/b/c) / Dialog primitive swap (ReleaseNotesModal) / Tabs primitive swap (note-cards collection) / Card primitive swap (multiple) / WorkspaceHomeSpecModule dead-code cleanup

### Phase 6 — Settings
- 覆盖：`settings.css`、`settings.skills.css`、`settings.vendor-codex-runtime.css`、`settings.vendor-dialog.css`、其它 `settings.*`。
- 严格遵守 `.trellis/spec/guides/codex-unified-exec-override-contract.md` 与 `terminal-shell-configuration.md`。
- DoD：旅程 = 打开 settings → 切各 tab → 修改 → 保存。

#### Phase 6 完成状态（2026-05-16）

**Scope 大幅收缩**（在 plan-time，非 execution-time）— 见 `phase-6-settings-plan.md`。PRD 原列 8 个 settings CSS 文件（共 7748 行）+ aggregator，本 phase 仅处理 1 个文件 + aggregator。其余 7 个全部 defer 到 Phase 6.5 / 6.6 / 6.7。原因汇总：

| 文件 | 行 | 字面值 pin? | Consumer 规模 | 决策 |
|---|---|---|---|---|
| `settings.css` (aggregator) | 8 | 否 | — | **本 phase**: 删 1 行 `@import "./settings.skills.css"` |
| `settings.skills.css` | 478 | 否 | `SkillsSection.tsx` 1289 行 / 40 className refs（单 consumer，无字面值 pin） | **本 phase**: 删除 + 内联 Tailwind（与 Phase 5 `WorkspaceNoteCardPanel.tsx` 864/48 模式一致） |
| `settings.part1.css` | 2158 | 否 | `SettingsView.tsx` 2231 行 frame | **DEFER → Phase 6.7** |
| `settings.part1.vendor-panels.css` | 863 | 否 | vendor cluster 2832 行 tsx | **DEFER → Phase 6.5** |
| `settings.part2.css` | 2154 | **YES** — `settings-email-card-surface.test.ts` 用 `readFileSync('./settings.part2.css')` 钉死 5 条字面 CSS rule + 1 条 negative `not.toMatch` | cross-section + 字面值 pin | **DEFER → Phase 6.6** |
| `settings.part2.basic-redesign.css` | 1044 | 否 | cross-section cascade 通过 `--settings-basic-*` 影响 13+ section | **DEFER → Phase 6.6** |
| `settings.part2.vendor-models.css` | 330 | 否 | vendor cluster | **DEFER → Phase 6.5** |
| `settings.part3.css` | 244 | 否 | cross-section + `:root[data-theme="light"]` theme cascade | **DEFER → Phase 6.6** |
| `settings.vendor-codex-runtime.css` | 83 | 否 | vendor cluster | **DEFER → Phase 6.5** |
| `settings.vendor-dialog.css` | 386 | 否 | vendor cluster 1597 行 tsx | **DEFER → Phase 6.5** |

实际产出（implement agent）：
- 新增：`.trellis/tasks/05-16-migrate-css-to-coss-ui/phase-6-settings-plan.md`（discovery + per-file plan + scope decision + execution-time 结果）
- 删除 1 个 .css 文件：`settings.skills.css`（478 行）→ 内联 Tailwind 到 `SkillsSection.tsx`
- 修改：`src/styles/settings.css`（8 → 7 行，删除 1 行 `@import "./settings.skills.css"`）
- 修改：`src/features/settings/components/SkillsSection.tsx`（约 40 处 `settings-skills-*` / `settings-search-field` className 保留为 no-op semantic marker + 追加 Tailwind utility；处置含 conditional `is-active` / `is-tree-collapsed` / `is-resizing` 状态 + media query (`max-[1100px]:` arbitrary breakpoint) + splitter `::before` pseudo-element + 嵌套 selector `.settings-skills-browser.is-resizing .settings-skills-splitter::before`）
- 沿用 Phase 2/3/4/5 既证的「保留 class name 作为 no-op marker + 追加 Tailwind utility」pattern
- `src/bootstrap.ts` 未动（settings.css 仍是 entry，内部少 1 个 @import）

未引入 coss primitive structural swap（同 Phase 2/3/4/5 决策）——本 phase 决策为「纯 styling pass」，详见 plan doc 的 "Follow-ups" 节。`Splitter`（settings-skills-splitter）、`Tree`（settings-skills-tree-node）的结构性替换转入 Phase 10 follow-up。

**严格 contract 遵守验证**：
- `codex-unified-exec-override-contract.md` 触点 `useAppSettings` / `SettingsView` / `tauri.ts` 未被改动 → contract 不破坏
- `terminal-shell-configuration.md` 触点 `terminalShellPath` settings field 未在 SkillsSection 范围 → 无影响

字面值 pin 报告：
- `settings-email-card-surface.test.ts` 读取 `settings.part2.css` 验证 5 条字面 CSS rule → **本 phase 完全没动 `settings.part2.css`**，pin 自动保留
- `SettingsView.test.tsx` 仅 querySelector `.settings-doctor-body`（DOM presence pin，非 CSS literal），其源 class 由 `settings.part1.css` / `settings.part2.css` 提供，本 phase 不动 → pin 自动保留

验证（同 Phase 2/3/4/5 baseline，无新错）：
- `npm run lint` ✅ pass
- `npm run typecheck` ✅ 2 个 pre-existing baseline 错（perfBaseline×2；Phase 0 baseline 保持 2）
- `npm run test` ✅ 仅 `ComposerInput.collaboration.test.tsx` 的 3 个 pre-existing failure（通过 `git stash` + `git stash pop` 第六次确认与 Phase 6 无关，完全一致 Phase 2/3/4/5 记录）
- `npm run test:layout-guard` ✅ 10/10 pass
- `npm run check:large-files:gate` ✅ pass（found=0）
- 单独跑 Phase 6 affected tests ✅ PASS (78) FAIL (0):
  - `SkillsSection.test.tsx` ✅ 1/1 pass（无 settings-skills className 钉死，inline 处理安全）
  - `settings-email-card-surface.test.ts` ✅ 1/1 pass（settings.part2.css 字面值 pin 保留）
  - `SettingsView.test.tsx` ✅ 47/47 pass（.settings-doctor-body 等 querySelector 全部保留）
  - `CodexSection.test.tsx` ✅ 2/2 pass（codex-unified-exec-override-contract 行为不变）
  - `useAppSettings.test.ts` ✅ 22/22 pass（settings field 契约不变）
  - `VendorSettingsPanel.test.tsx` ✅ 5/5 pass（vendor panel 行为不变）

后续 phase 影响：
- bootstrap.ts CSS import 数从 40 保持 40 (settings.css 仍是 entry, 内部少 1 个 @import)
- settings.css 内部 import 数从 8 → 7
- 3 条新 follow-up 入 `docs/migration-to-coss-ui.md`：Phase 6.5 vendor cluster (4 文件 / 1662 行 CSS / 2344+ tsx) / Phase 6.6 part2 + basic-redesign + part3 (3 文件 / 3442 行 CSS / 字面值 pin + cross-section cascade) / Phase 6.7 settings frame (1 文件 / 2158 行 CSS / SettingsView 2231 tsx)

### Phase 7 — Git History
- 覆盖：`git-history.part1/2` + 所有 sub（`branch-compare`、`pr-dialog`、`shell`、`support`）。
- DoD：旅程 = 打开 git history → 切换分支 → branch compare → PR dialog。

### Phase 8 — Spec Hub
- 覆盖：`spec-hub.controls`、`spec-hub-header`、`spec-hub.reader-layout`。
- DoD：旅程 = 打开 spec hub → reader → controls。

### Phase 9 — File / Diff / Terminal
- 覆盖：`file-tree`、`diff`、`terminal`、`detached-file-explorer`、`opencode-panel`。
- DoD：旅程 = 打开 file tree → 选文件 → 查看 diff → terminal。

### Phase 10 — Cleanup & Final Verify
- 删除 `src/styles/` 下所有剩余 .css（应当只剩 `coss.css` 这唯一 entry，或彻底空）。
- 全仓 grep 验证（验收条件 1-3）。
- 跑完整 `npm run lint && npm run typecheck && npm run test && npm run check:large-files:gate && npm run test:layout-guard`。
- 人工 verify 全旅程。
- 整理 `docs/migration-to-coss-ui.md` follow-up 清单（brand color override、layout 重做、动效等）。
- DoD：所有验收条件勾完。

### 工作量预估
- Phase 0+1：1-1.5 天
- Phase 2-9：8 个 slice × 1-2 天 = 8-16 天
- Phase 10：0.5 天
- **总计：约 10-18 工作日**（按单人节奏；可被中途其它 fix 任务穿插）

## 风险与对冲

| 风险 | 对冲 |
|---|---|
| coss 某个 primitive API 与项目预期不符 | implement agent 先读 `references/primitives/<name>.md` + 至少一个 particle，再写 |
| 中间 phase 出现旧 CSS + 新 token 视觉错乱 | 允许中间 phase 视觉过渡丑，但功能必须可用；每 phase PR review 看截图 |
| message streaming / context usage 等契约破坏 | 触及 messages/composer/settings 的 phase 必须读对应 spec 并跑相关 contract test |
| 大文件 baseline 突然 fail | Phase 0 先跑 `check:large-files:baseline` 确立新 baseline，每 phase 后跑 `check:large-files` 看 delta |
| 与他人 in-flight task merge 冲突 | feature branch 长开期间不主动 rebase 旁路 task；他们 merge 后再 `git merge main` 回灌 |
| `npm run test` 长跑 | 按本仓既有 `test:batched` 已规避；不另起策略 |

## Phase 完成后必做（每 phase）

1. 跑 lint/typecheck/test。
2. 跑该 phase 对应的 contract test（若有）。
3. `tauri dev` 跑一遍关键旅程，截图保留在 PR。
4. commit message 用 `refactor(coss-ui): <phase 描述>` 中文动宾短句，遵循 `.claude/rules/git.md`。
5. `python3 ./.trellis/scripts/task.py` 更新 task 状态。
6. 用户人工 confirm 后再进入下一 phase。

---

## Phase 11 — Primitive Structural Swap（2026-05-17 追加）

### 背景

- Phase 2-10 完成了「CSS 内联到 Tailwind」+ 「class name 保留为 no-op marker」+ 「styling pass」。
- 但**真正用上 coss primitive 这步还没做**：截图页面看上去和 coss.ui 官网示例不一样，根因是核心 feature 组件几乎全是手写 `<div>` + Tailwind，没用 `Combobox` / `Popover` / `Menu` / `Tabs` 等原语。
- 抽查全仓 `@/components/ui/*` 引用次数：`Button` 18 / `Input` 6 / `Select` 4 / `Popover` 3 / `Tooltip` 2 / `Tabs` 2，其他 0-2 次。
- 同时发现 `src/components/ui/` 下有 **3 个旧 shadcn/radix 残留组件**：`button.tsx` / `popover.tsx` / `dropdown-menu.tsx` 用的是 `radix-ui` 而不是 `@base-ui/react`（coss 底层），与项目整体 coss 风格不一致。

### Phase 11 目标

把「primitive structural swap」从 Phase 10 follow-up 提升为正式 phase，**按截图页面优先级分块推进**，每个文件作为独立子 phase 一次落地一个 commit。

### Phase 11.1 — MainHeader 试点（**首发**）

**范围**（`src/features/app/components/MainHeader.tsx`，当前 809 行）：

| 子块 | 行号 | 替换映射 |
|---|---|---|
| 项目下拉（带搜索 + 分组） | 302-413 | 手写 popover + input → **coss `Combobox` + `ComboboxGroup` + `ComboboxEmpty`** |
| worktree info popover | 424-570 | 手写 popover + rename input + cd command + 图标按钮 → **coss `Popover` + `Field` + `Button` size=icon + `Tooltip`** |
| 分支搜索 + 创建 | 572-720 | 手写 popover + search + branch list + create btn → **coss `Combobox` + 自定义 footer (`Button`)** |
| session tabs slot | 723-740 | 保留（外部 props 透传） |
| 右侧动作区 | 741-806 | 保留（LaunchScriptButton / OpenAppMenu 独立单元，下一 phase 单独处理） |

**预期净行数**：~809 → ~700 行（净 -100）。

### Phase 11.1 准备工作

1. `npx shadcn@latest add @coss/combobox` — 新装（项目缺失）
2. `npx shadcn@latest add @coss/popover` — 把 `popover.tsx` 从 radix 升级到 coss base-ui（顺手做，本任务一并解决「3 个 shadcn 旧版残留」之一）
3. `npx shadcn@latest add @coss/button` — 把 `button.tsx` 从 radix Slot 升级到 coss base-ui（同上，可选 bonus）

> 注：dropdown-menu.tsx 由于影响面更大（多个 feature 在用），不在本 phase 处理，留 Phase 11.x 单独追踪。

### Phase 11.1 测试约束

| 测试 | 钉死的约束 | 处理 |
|---|---|---|
| `MainHeader.branch-reveal.test.tsx` | `.workspace-title-line` / `.workspace-project-menu` className + hover 250ms/500ms 延迟显示 | 保留 className 作 no-op marker；hover 延迟逻辑保留在外层 div |
| `MainHeader.workspace-switch-regression.test.tsx` | `getByRole("menuitem")` | 改 1 行：`menuitem` → `option`（Combobox 子项 W3C 标准角色） |
| `MainHeader.topbar-session-tabs.test.tsx` | `.main-header-session-tabs-slot/-interactive/-drag-lane` | 不动 ⑤ 块，无影响 |
| `main.worktree-info-theme.test.ts` | main.css 中 `.worktree-info-copy/-reveal/-input/-confirm` 含 theme token | 保留 className 作 marker；main.css 规则不动 |

**原则（用户已 confirm 2026-05-17）**：
- 以 coss 默认行为为准，必要时改业务/测试
- 行为偏离时优先用 coss `render` prop / `*Primitive` 底层组合保留 Tauri drag region 等特殊属性

### Phase 11.1 DoD

- [ ] 3 个手写 popover 全部用 coss primitive 替换（Combobox × 2 + Popover × 1）
- [ ] `src/components/ui/popover.tsx` 不再 import `radix-ui`
- [ ] `src/components/ui/button.tsx` 不再 import `radix-ui`（可选）
- [ ] MainHeader 测试 4 个文件全绿
- [ ] 全仓 lint / typecheck / test / layout-guard / large-file 守卫全绿
- [ ] Tauri dev 跑一遍：项目切换 / 分支切换 / worktree rename / cd 拷贝 / reveal in finder 5 个旅程都正常
- [ ] commit message：`refactor(main-header): <子块描述>`，每个子块独立 commit

### Phase 11.1 工时

- 总计 1-2 工作日，4-5 个原子 commit
- 子步骤：装 primitive (0.5h) / 项目下拉 (2-3h) / worktree popover (2-3h) / 分支菜单 (2-3h) / 测试 + 回归 (1h)

### Phase 11.x — 后续排队（按截图页面相关性 + 行数升序）

| 子 phase | 文件 | 行数 | 关键替换 |
|---|---|---|---|
| 11.2 | `MainHeaderActions.tsx` + `OpenAppMenu.tsx` + `LaunchScriptButton.tsx` | ~500 | Menu / Popover / Button |
| 11.3 | `StatusPanel.tsx` (right bottom panel tab 切换) | 728 | `Tabs` |
| 11.4 | `ComposerInput.tsx` (底部输入框) | 1634 | `Textarea` / `Select` / `Badge` / `Progress` / `Combobox` (autocomplete) |
| 11.5 | `FileTreePanel.tsx` (右侧文件树) | 2288 | `Collapsible` / `Button` / `Popover` |
| 11.6 | `Sidebar.tsx` (左侧) | 2415 | `Menu` (right-click) / `Collapsible` (worktree section) |
| 11.7 | `Messages.tsx` (消息流) | 2217 | `Card` / `Collapsible` / `Badge` |
| 11.8 | `dropdown-menu.tsx` shadcn → coss `Menu` 全仓替换 | 跨文件 | 全仓 `DropdownMenu*` → `Menu*` |

> 11.2 - 11.8 顺序可调整；每个子 phase 都要按 11.1 同样流程：用户先 confirm 方案 → implement → check → commit。

### 与原 PRD 范围的关系

- 原 PRD「最终目标 3：基础组件全部用 coss 原语替换」**通过 Phase 11.x 真正落地**。
- 原 PRD「最终目标 1：旧 CSS 文件彻底删除」**保持原计划**（Phase 10 已完成大部分，剩余 follow-up）。
- 原 PRD「最终目标 2：Tailwind v4 + coss token + data-slot」**已基本达成**（Phase 2-6 内联）。

### 下一步

立即进入 **Phase 11.1**：
- 安装 3 个 coss primitive
- 重写 MainHeader.tsx 3 个 UI 块
- 调整 4 个测试
- 跑回归
- 4-5 个原子 commit
