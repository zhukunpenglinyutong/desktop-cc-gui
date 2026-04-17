## 1. Rewind Mutation Candidate Builder (P0)

- [x] 1.1 在 `Composer` 的 rewind preview 构建链路中先固定“目标用户消息 + 后续事实”的尾部区间（依赖: design/specs；输入: `buildLatestRewindPreview(...)` 与 rewind candidate 锚点；输出: 锚点之前的消息/工具不再参与文件收集；验证: 代码审查可见文件收集不会向前越过目标用户消息）
- [x] 1.2 在上述尾部区间内引入 mutation-only 文件筛选步骤（依赖: 1.1；输入: `extractFileChangeSummaries(...)` 当前输出；输出: rewind 仅消费 mutation 候选文件集合；验证: 代码审查可见只读文件不再直接进入 `affectedFiles`）
- [x] 1.3 调整 rewind merge 逻辑，使 message fallback 仅用于 mutation 补洞而非独立造集合（依赖: 1.2；输入: `extractFallbackAffectedFilesFromImpactedMessages(...)`、`mergeRewindAffectedFiles(...)`；输出: fallback 只能补充已存在或可判定 mutation 的路径；验证: 单测可断言纯 `@mention` 只读路径不会进入 rewind preview）
- [x] 1.4 保持路径归一化、dedupe 与 status merge 兼容（依赖: 1.2, 1.3；输入: `OperationFileChangeSummary`、rewind path normalization 逻辑；输出: mutation-only 过滤后仍复用现有 `filePath/status/diff` 结构；验证: TypeScript 编译通过且现有调用方无需改数据结构）

## 2. Strategy UI And State Plumbing (P0)

- [x] 2.1 将 `ClaudeRewindConfirmDialog` 中的文件回退 toggle 替换为三个互斥单选策略（依赖: proposal/specs；输入: 当前 dialog 控件区；输出: `messages-and-files / messages-only / files-only` 三选一 UI；验证: 组件测试能读到三个选项且旧 toggle 消失）
- [x] 2.2 在 `Composer` 中新增 rewind mode 状态，并在每次打开弹层时重置为 `messages-and-files`（依赖: 2.1；输入: 当前 rewind dialog 生命周期；输出: 三态 mode state；验证: reopen 测试断言默认模式重置正确）
- [x] 2.3 将 `onConfirm` 调用链参数从布尔开关扩展为显式 mode（依赖: 2.2；输入: `Composer` 与 `useThreadActions` 调用边界；输出: message/file rewind 语义改由 mode 驱动；验证: 单测断言下游收到正确 mode）

## 3. Preview And Execution Alignment (P0)

- [x] 3.1 确保 `ClaudeRewindConfirmDialog` 继续只消费 preview 中的最终 mutation 文件集合（依赖: 1.x；输入: `RewindPreviewState.affectedFiles`；输出: dialog 不再自行放宽文件集合；验证: 组件交互中首个选中文件与文件计数仅来自锚点尾部区间内的 mutation 集合）
- [x] 3.2 确保 rewind 导出链路仅使用 mutation-only `preview.affectedFiles`（依赖: 1.x；输入: `Composer` 中 `onStoreChanges` / export payload；输出: preview 与 export 共用同一集合；验证: 导出参数断言中不包含只读文件路径或锚点之前路径）
- [x] 3.3 在 Claude 执行链路中实现三态分支：完整 rewind、只回退消息、只回退文件（依赖: 2.3；输入: 现有 Claude rewind + 文件恢复逻辑；输出: `files-only` 不再触发消息 rewind；验证: hook 测试分别断言三种分支行为）
- [x] 3.4 在 Codex 执行链路中实现三态分支：完整 rewind、只回退消息、只回退文件（依赖: 2.3；输入: 现有 Codex rewind + 文件恢复逻辑；输出: `files-only` 不再触发消息 rewind；验证: codex hook 测试分别断言三种分支行为）
- [x] 3.5 保留无 inline diff 的 mutation 文件空态行为（依赖: 3.1；输入: delete/rename/bash create-delete/apply_patch 无 diff 场景；输出: 这类文件仍显示在 preview 中但允许空态；验证: UI 测试或状态断言中保留文件行且 diff 区为空态）
- [x] 3.6 在 Git 仓库且 working tree clean 时隐藏 rewind 文件相关显示区块，非 Git 仓库保持现状（依赖: 3.1；输入: 当前 workspace `gitStatus` 与 rewind review surface；输出: Git clean 不显示文件区；验证: 组件测试区分 Git clean / non-git 两种上下文）

## 4. Regression Coverage (P0)

- [x] 4.1 为 `Composer.rewind-confirm` 增加“锚点之前的读取文件不进入 rewind preview”的回归测试（依赖: 1.x；输入: 锚点前含 read、锚点后含 mutation 的会话样本；输出: 新增 anchor-boundary 测试；验证: `vitest` 断言受影响文件列表不含锚点前读取路径）
- [x] 4.2 为 `Composer.rewind-confirm` 增加“read/batch read 文件不进入 rewind preview”的回归测试（依赖: 1.x；输入: 含只读工具与 rewind 锚点的会话样本；输出: 新增 failing-then-passing 测试；验证: `vitest` 断言受影响文件列表不含只读路径）
- [x] 4.3 为 `Composer.rewind-confirm` 增加“三态策略渲染与提交”的回归测试（依赖: 2.x；输入: dialog 交互样本；输出: 新增 mode UI 测试；验证: 断言三种选择均可提交且 payload 正确）
- [x] 4.4 为 `Composer.rewind-confirm` 增加“delete/create/rename/bash create-delete 仍保留”的回归测试（依赖: 1.x, 3.5；输入: mutation 无 diff 或弱结构化样本；输出: 新增覆盖缺 diff mutation 的测试；验证: 断言这些文件仍出现在 rewind preview）
- [x] 4.5 为共享聚合逻辑增加“同一路径既 read 又 edit 时 mutation 优先”的测试（依赖: 1.3；输入: 同路径只读 + mutation 混合样本；输出: 新增 dedupe/priority 测试；验证: 最终仅保留 1 条 mutation 记录）
- [x] 4.6 为导出链路增加“preview/export 使用同一集合”的测试（依赖: 3.2；输入: 混合只读与 mutation 的 rewind preview；输出: 导出 payload 测试；验证: export 文件集合与 preview 文件集合完全一致）
- [x] 4.7 为 Claude/Codex hook 增加 `files-only` 不触发消息 rewind 的回归测试（依赖: 3.3, 3.4；输入: 两引擎执行样本；输出: 新增 mode 分支测试；验证: 断言消息 rewind API 未被调用）
- [x] 4.8 为 rewind review surface 增加“Git clean 隐藏文件区、非 Git 保持现状”的回归测试（依赖: 3.6；输入: Git clean / non-git 两种 workspace 上下文；输出: 新增显示规则测试；验证: `vitest` 断言文件区显隐正确）
- [x] 4.9 为 rewind review surface 增加“绝对/相对路径重复时列表只显示一条”的回归测试（依赖: 3.1；输入: 同一文件的多形态路径；输出: 新增显示级去重测试；验证: `vitest` 断言文件 rail 中仅保留 1 条）

## 5. Verification And Implementation Readiness (P1)

- [x] 5.1 运行 rewind 相关前端测试集并记录结果（依赖: 4.x；输入: `Composer.rewind-confirm`、hook 与相关聚合测试；输出: 通过的测试结果；验证: 目标 `vitest` 集合通过）
- [x] 5.2 运行类型检查确认三态 mode 改造未破坏现有调用方（依赖: 2.x, 3.x；输入: frontend 代码变更；输出: 类型检查通过；验证: `npm run typecheck` 通过）
- [x] 5.3 执行一次手工回归：验证三种策略与文件列表边界（依赖: 5.1, 5.2；输入: 一条包含锚点前 read、锚点后 edit/delete 混合操作的真实或构造会话；输出: 可执行人工检查结论；验证: 锚点前只读文件不显示，三种模式各自行为正确）
