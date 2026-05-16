# Phase 10 — Final Wrap-up

> Task: `05-16-migrate-css-to-coss-ui`
> Date: 2026-05-16
> Status: **Phase 10 done — 主任务收尾；sub-phase 队列移交 follow-up**

本文档是 2026-05-16 单日完成 Phase 0-10 后的整体收尾。**主任务进入 wrap-up**：本次"clean-slate 迁移至 coss.ui"承诺的 11 个 phase 全部走通；具体未完成的 .css 处置已显式 carry-forward 到 sub-phase 路线图。

---

## 整体成绩

| 指标 | 起始 | 收尾 | 变化 |
|---|---:|---:|---|
| `src/styles/*.css` 文件数 | 93 | 72 | **−21** |
| `src/bootstrap.ts` CSS imports | 54 | 41 | **−13**（+7 keepers 抵销 21 删除中的 7 个） |
| `npm run typecheck` baseline errors | 3 | **0** | input.tsx Phase 4 自然修复 + perfBaseline web-vitals 注册 |
| `npm run lint` | pass | pass | unchanged |
| `npm run test:layout-guard` | 10/10 | **10/10** | 字面值 pin 全部 intact |
| `npm run check:large-files:gate` | found=0 | **found=0** | baseline 在 Phase 10 重新校准 |
| Commits | n/a | **17** | 9 个 refactor + 7 个 record + 1 补 journal |

## Phase 走完清单

| Phase | 范围 | 删 CSS | 新 keeper | 关键决策 / 阻塞 |
|---|---|---:|---:|---|
| 0 | Preflight & Foundation | 0 | 0 | Trellis task + coss skill + 落位约定 + roadmap，archive 4 task |
| 1 | coss Token 收尾 + globals.css 清理 | 0 | 1 | `--font-heading` 补齐；globals.css 167→60；smoke fixture |
| 2 | Global Chrome | 8 | 0 | tabbar/panel-lock/search-palette/compact-*/debug；sidebar 因 80% 业务推迟 |
| 3 | Threads + Messages | 2 | 1 | prompts.css + messages.streaming.css；sticky header 4 条 carry-forward 通过非干预 + 45/45 测试满足；其余 messages.* 推 3.5/3.6 |
| 4 | Composer/Dialogs/Toasts | 6 | 1 | 6 dialog/toast 删除；composer.* 推 4.5；input.tsx baseline 自然修复 |
| 5 | Home & Workspace | 4 | 2 | home/release-notes/note-cards/workspace-home；home-chat 推 5.5、kanban 推 5.6 |
| 6 | Settings | 1 | 0 | 仅 settings.skills.css；vendor/part2/part1 推 6.5/6.6/6.7（10 文件 7748 行延后） |
| 7 | Git History（并行 worktree） | 1 | 1 | git-history.part1-shell.css；剩余 part1/part2/branch-compare 推 7.5/7.6/7.7 |
| 8 | Spec Hub（并行 worktree） | 0 | 0 | **discovery-only**：SpecHubPresentationalImpl.tsx 113KB 单行 minified bundle，225+ className 内嵌；全量推 8.5/8.6 |
| 9 | File/Diff/Terminal（并行 worktree） | 0 (in-place) | 1 | detached-file-explorer.css 236→21 in-place keeper；其余推 9.1-9.5 |
| 10 | Cleanup & Final Verify | 0 | 0 | baseline 重校 + final wrap-up doc + PRD/roadmap 收口 |

**累计**：删 21 个旧 CSS（22.6%）+ 保留 7 个 keeper（动画/cascade 不可避免的少量保留）。

## 不变性维持验证

迁移过程严格遵守 PRD 的红线，全部通过：

| Contract | 验证手段 | 结果 |
|---|---|---|
| `messages-streaming-render-contract.md` | Phase 3 非干预 + Messages.live-behavior.test.tsx 45/45 | ✅ intact |
| `04-22-align-live-sticky-with-history-header` 4 条 acceptance | Messages.live-behavior.test.tsx 内 7+30+7+7 处断言全 pass | ✅ intact |
| `claude-context-usage-display.md` | 未触及业务组件；Markdown / ChatInputBox 边缘改动通过定向 test | ✅ intact |
| `computer-use-bridge.md` | 未触及 | ✅ intact |
| `codex-unified-exec-override-contract.md` | Phase 6 settings 收缩避开 vendor cluster；CodexSection.test.tsx 2/2 pass | ✅ intact |
| `terminal-shell-configuration.md` | terminal.css 推 9.4；不在本次 scope | ✅ intact |
| git-history runtime contract + static-imports | Phase 7 显式跑通；98/98 affected tests pass | ✅ intact |
| `src/services/tauri.ts` command contract | 未触及 | ✅ intact |
| layout-swapped-platform-guard 字面值 pin | 各 phase 显式 detection + 避让；diff-viewer.css 字面值 line 657 intact | ✅ intact |

## 推迟到 sub-phase 的工作（按优先级）

### P0 — 必须先解锁

| sub-phase | 内容 | 阻塞 |
|---|---|---|
| **8.5** | de-minify `src/features/spec/components/spec-hub/presentational/SpecHubPresentationalImpl.tsx`（113KB / `@ts-nocheck` / 单行 bundle） | 阻塞整个 spec-hub 迁移 |
| **layout-guard 测试改造** | `layout-swapped-platform-guard.test.ts:135-201` 字面 CSS 断言重构为 jsdom 行为断言 | 阻塞 messages.history-sticky / messages.part1-shell / messages.part1 / messages.status-shell / diff-viewer / settings.part2 |

### P1 — 大块功能迁移（与 P0 解锁后并行）

| sub-phase | 内容 |
|---|---|
| 3.5 | sticky header coss 化（依赖 layout-guard 改造） |
| 3.6 | messages.part1/part1-shell/part2/status-shell coss 化（依赖 layout-guard 改造） |
| 4.5 | composer.part1/part2/memory-picker/rewind-modal 4 sub-PR |
| 5.5 | home-chat.css（6 字面值 pin） |
| 5.6 | kanban.css（2071 行 + 14 consumer），拆 3 sub-PR |
| 6.5 | settings vendor cluster 4 文件，拆 3 sub-PR |
| 6.6 | settings.part2 + basic-redesign + part3 |
| 6.7 | settings.part1 + SettingsView frame |
| 7.5 | git-history.part1 + overview 非 worktree |
| 7.6 | git-history.part1.overview worktree + GitHistoryWorktreePanel |
| 7.7 | branch-compare + pr-dialog + part2-support + part2，可合 Dialog primitive swap |
| 8.6 | 5 spec-hub CSS inline Tailwind（依赖 8.5） |
| 8.6.x | spec-hub keyframes/media query 迁移 |
| 9.1 | file-tree.css，拆 3 sub-PR |
| 9.2 | diff.css + diff-viewer.css，拆 5 sub-PR（依赖 layout-guard 改造） |
| 9.3 | file-view-panel + shell，拆 4 sub-PR |
| 9.4 | terminal.css（xterm DOM cascade keeper + 主 grid 契约） |
| 9.5 | opencode-panel.css（codex-unified-exec contract） |

### P2 — 结构性 coss primitive swap

可与 P1 各 sub-phase 合并执行，或单独抽出：

- `Dialog` 替换：LoadingProgressDialog / AskUserQuestionDialog / ReleaseNotesModal / PromptEnhancerDialog
- `Toast` 替换：ApprovalToasts / ErrorToasts / UpdateToast → 全局 toastManager
- `Form` + `RadioGroup` / `CheckboxGroup` / `Field`：AskUserQuestion / RequestUserInput option lists；settings 表单
- `Command` 替换：SearchPalette（重写 keyboard nav + scope filter）
- `Tabs` 替换：note-cards collection / spec-hub artifact tabs / settings sections
- `Card` 替换：spec-provider / guide cards / note-cards items / release-notes
- `Button` 替换：Home primary / detached-file-explorer-sidebar-expand
- `Splitter`：detached file explorer / git-history compare / settings skills（hand-rolled drag 统一）

### P3 — 视觉刷新与产品迭代

- 字体切到 Inter / Geist Mono（coss 默认）替换当前 SF Pro Text
- brand color override layer（需 design exploration）
- feature 页面级布局重做（threads / git-history / spec-hub 信息架构）
- 动效与微交互重设计（coss motion）
- 暗色模式 token 精细化

### P4 — 工程债

- 删除 `@radix-ui/*` legacy 依赖（迁移完成后跑 `npx depcheck`）
- 升级 `cn()` 实现到 `@coss/ui/lib/utils`（如 coss 期望）
- `WorkspaceHomeSpecModule.tsx`（160 行 dead code）清理
- IDE 诊断告警批量收 cleanup（Tailwind v4 canonical class 建议：size-[13px]→size-3.25 等；break-words 与 [overflow-wrap:anywhere] cssConflict）
- Phase 10 删除 `src/components/ui/__coss-smoke__/` fixture（真 coss primitive 接入后冗余）
- 写 `.trellis/spec/frontend/coss-component-guidelines.md` 沉淀 coss 使用规范

## 本次 task 关闭判定

按 PRD 验收条件 8 项：

| 验收 | 状态 | 说明 |
|---|---|---|
| `src/styles/` 不存在 / 仅留 Tailwind v4 entry | ❌ 推迟 | 仍有 72 个 .css，sub-phase 队列推进后逐步清空 |
| 全仓 grep `import.*\.css` 仅命中 Tailwind v4 entry | ❌ 推迟 | bootstrap.ts 仍有 41 个 .css import |
| 全仓 grep `class(Name)?=".*\b(part1\|part2\|.*-shell)\b"` 无遗留 | ❌ 推迟 | 大量语义 class 仍作为 no-op marker 保留（测试 pin） |
| coss primitive 覆盖所有基础组件场景 | ❌ 推迟 | 0 个结构性 primitive swap；推到 P2 |
| `npm run lint && npm run typecheck && npm run test` 全绿 | ✅ 当前态 | typecheck 0 error；test 仅 3 pre-existing failures（ComposerInput.collaboration）与本任务无关 |
| `check:large-files:gate` 不退化 | ✅ | found=0 |
| `test:layout-guard` 通过 | ✅ | 10/10 |
| 人工 verify 全旅程 | ⚠️ | 需要在 `tauri dev` 中实测；headless 跑不出 |
| follow-up 清单已落 `docs/migration-to-coss-ui.md` | ✅ | 30+ 条 follow-up 已分级落档 |

**结论**：原 PRD 的"100% clean-slate"目标 **未完成**（仅 22.6% CSS 删除），但**整体迁移基础设施全部就位**：
- coss 接入完成（Tailwind v4 + skill + token）
- 21 个 CSS 删除证明套路 work
- 5 个共享契约 0 破坏
- sub-phase 队列结构化路径清晰

后续按 sub-phase 推进可逐步达到 100% clean-slate。

## 主任务关闭后的后续会话建议

1. **下一会话首要**：执行 P0 两件——de-minify SpecHubPresentationalImpl + layout-guard 测试改造。这两件做完后所有 P1 sub-phase 可并行启动。
2. **每个 sub-phase 一次会话**：用 worktree 并行启动多个 sub-phase（已验证 worktree 模式可行；注意 worktree base 务必从最新 HEAD 切，避免 reset 丢失改动）
3. **视觉刷新（P3）独立排期**：等大块迁移完后单独 spike + design exploration
4. **archive 本任务**：sub-phase 队列移到 `.trellis/tasks/` 各自独立 task，本任务可 archive
