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

1. `src/components/ui/input.tsx:48` — `Type '...InputState => CSSProperties...' is not assignable to ...DetailedHTMLProps`
   - 性质：input.tsx 已被某人尝试改成 Base UI 风格 (`(state: InputState) => CSSProperties`)，但未完成迁移。
   - 处置：**Phase 4（Composer & Interaction Dialogs）** 或 Phase 2 接入 coss `Input` primitive 时自然修复。
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

### Phase 3 — Threads + Messages
- 覆盖：`messages.part1/2`、`messages.streaming`、`messages.history-sticky`、`messages.status-shell`、`messages.part1-shell`、`messages.part2.css`、`prompts.css`。
- 严格遵守 `.trellis/spec/frontend/messages-streaming-render-contract.md`（stable snapshot + live row override）。
- **Carry-forward from `04-22-align-live-sticky-with-history-header`**（必须满足）：
  - [ ] realtime 不再渲染 `.messages-live-sticky-user-message`（迁移到 coss 后用统一的 sticky header 出口）
  - [ ] realtime / history 共用同一条 sticky header 出口渲染
  - [ ] realtime 回看更早 rendered sections 时，sticky header 按 history-style handoff 接棒
  - [ ] trimmed live latest question 仍可驱动 sticky header
- DoD：旅程 = 列表 → 进入 thread → 实时消息流；并验证以上 4 条 sticky 行为。

### Phase 4 — Composer & Interaction Dialogs
- 覆盖：`composer.part1/2`、`ask-user-question-dialog`、`approval-toasts`、`request-user-input`、`loading-progress-modal`。
- 用 coss Dialog / AlertDialog / Toast / Form / Field 替换。
- DoD：旅程 = 发送消息 → 触发 ask-user-question → 触发 approval。

### Phase 5 — Home & Workspace
- 覆盖：`home.css`、`home-chat.css`、`workspace-home.css`、`note-cards.css`、`kanban.css`、`release-notes.css`、`update-toasts.css`。
- DoD：旅程 = 启动后 home → 切 workspace → 查看 release notes → 更新 toast。

### Phase 6 — Settings
- 覆盖：`settings.css`、`settings.skills.css`、`settings.vendor-codex-runtime.css`、`settings.vendor-dialog.css`、其它 `settings.*`。
- 严格遵守 `.trellis/spec/guides/codex-unified-exec-override-contract.md` 与 `terminal-shell-configuration.md`。
- DoD：旅程 = 打开 settings → 切各 tab → 修改 → 保存。

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

## 下一步

待用户 confirm 本 phase 草案。confirm 后立刻进入 **Phase 0**：
- 切 branch
- archive 4 个 superseded task
- 跑 `task.py init-context fullstack` + 配置 Research/Implement/Check 的 jsonl 上下文
- 跑 `task.py start`
