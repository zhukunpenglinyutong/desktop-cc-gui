## Why

当前 rewind 确认弹层把“访问过的文件”和“实际会被回退的文件”混在同一个受影响文件列表里。像 `read_file`、`batch_read` 这类只读操作会被错误展示为待回退文件，导致风险提示失真、diff 预览噪音增加，也削弱了用户对回溯动作的判断准确性。

同时，现有 UI 只有一个“回退工作区文件”开关，只能表达“两种模式”：
- 回退消息 + 文件
- 只回退消息

它无法表达“只回退文件，不回退消息”的独立诉求，导致回溯策略与用户真实意图之间仍有空档。

## 目标与边界

### 目标

- 将 rewind preview 的受影响文件集合收敛为 **mutation-only**：仅统计真正会改变 workspace 语义的文件操作。
- 保留 `edit/create/delete/rename` 及等价 `fileChange` 事实作为回溯候选文件来源。
- 明确排除 `read_file`、`batch_read`、搜索、列表等只读访问文件，避免它们出现在“将被回退”的文件列表中。
- 统一 `Claude` 与 `Codex` rewind review surface 的文件筛选语义，避免引擎分叉。
- 将 rewind 文件收集范围限制为“目标用户消息本身 + 其后的 assistant/tool 事实”，不得跨越锚点向前牵连更早的上下文读取文件。
- 将当前二元开关扩展为三态策略选择，让用户显式选择：
  - 回退消息 + 相关文件
  - 只回退消息
  - 只回退文件
- 当当前 workspace 是 Git 仓库且 working tree clean 时，rewind 确认弹层不再展示文件列表/文件 diff；非 Git 仓库保持现有 mutation-only 文件展示逻辑。

### 边界

- 不改变 diff 渲染器与导出目录协议；本次只收敛 preview / export 输入文件集合的来源，并扩展 rewind 执行策略选择。
- 不新增“只读访问文件”独立展示区块；首版直接从受影响文件列表中剔除。
- 不引入按文件粒度勾选回退。

## 非目标

- 不为只读工具新增新的 activity / 审计模型。
- 不改变 `filePath` 作为 rewind 文件聚合主键的既有身份契约。
- 不引入按工具类型自定义展示过滤器或用户偏好开关。
- 不把“只回退文件”扩展成新的通用批处理文件恢复入口；它仍然是 rewind 确认弹层内的策略分支。

## What Changes

- rewind preview 在构建 `affectedFiles` 时，只能消费 mutation 类文件事实，不再把只读工具涉及的文件路径纳入候选集合。
- 共享文件聚合逻辑需要区分“只读访问”与“实际文件变更”，并仅对后者生成 rewind review surface、导出与后续 workspace restore 所需的文件列表。
- rewind 文件收集的时间/消息边界必须固定为目标用户消息锚点开始的尾部区间；锚点之前的读取痕迹不得因为路径重合或上下文引用被带入候选集合。
- rewind 确认弹层取消当前单一 toggle，改为三选一策略：
  - `messages-and-files`: 回退消息 + 相关文件
  - `messages-only`: 只回退消息，不回退文件
  - `files-only`: 只回退文件，不回退消息
- rewind 确认弹层在 Git 仓库且未检测到变更时，必须隐藏文件相关显示区块；非 Git 仓库不适用这条隐藏规则。
- Claude/Codex 执行链路都必须支持上述三种模式，并保持行为一致：
  - `messages-and-files`：保持当前完整 rewind 语义
  - `messages-only`：仅回退会话，不改写工作区文件
  - `files-only`：仅恢复工作区文件，不执行会话 rewind / fork / truncation
- `delete`、`rename`、Bash 创建/删除、`apply_patch` 等已经产生文件语义变更的记录，仍必须继续进入 rewind 候选文件集合。
- 对于没有 inline diff 的 mutation 文件，仍按现有恢复语义允许展示空态或导出；但只读文件不得再制造“无可用 diff 预览”的伪受影响项。
- 增加回归测试，覆盖“锚点之前的读取文件不进入 rewind preview”“读过但未改的文件不出现在 rewind preview”“删除/创建文件仍保留在 rewind preview”以及“三种执行策略行为正确”四类边界。

## 技术方案对比

### 方案 A：保留现有 toggle，只在执行层做隐式分支

- 优点：UI 改动最小。
- 缺点：无法表达“只回退文件”；用户心智仍然不完整，而且执行结果不可见。

### 方案 B：改为三态单选策略，并按“锚点尾部区间 + mutation-only”规则构建文件候选集（采用）

- 优点：策略完整、语义显式；Claude/Codex preview、导出、消息 rewind、文件 restore 候选集都能保持同一事实源。
- 缺点：需要扩展 UI、前端状态机、执行参数与测试矩阵。

取舍：采用方案 B。rewind 确认弹层属于高风险动作，策略必须显式，文件列表必须表达“会被回退的事实”，而不是“会话里曾访问过的上下文”。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `claude-rewind-review-surface`: 调整受影响文件的选择规则，并将 UI 从文件回退 toggle 扩展为三态 rewind 策略选择。
- `codex-rewind-review-surface`: 调整受影响文件的选择规则，并将 UI 从文件回退 toggle 扩展为三态 rewind 策略选择。
- `conversation-tool-card-persistence`: 补充 rewind preview 聚合来源约束，明确只读工具文件路径与锚点之前的路径不得被提升为 rewind file identity 候选集。

## Impact

- Frontend
  - `src/features/composer/components/Composer.tsx`
  - `src/features/composer/components/ClaudeRewindConfirmDialog.tsx`
  - `src/features/threads/hooks/useThreadActions.ts`
  - 共享 file-change / rewind 聚合辅助模块（以实际实现落点为准）
- Tests
  - `src/features/composer/components/Composer.rewind-confirm.test.tsx`
  - `src/features/threads/hooks/useThreadActions.test.tsx`
  - `src/features/threads/hooks/useThreadActions.codex-rewind.test.tsx`
  - 共享 file-change 聚合或 history replay 相关测试
- Contracts
  - rewind preview -> export manifest 的输入文件集合语义会更严格，但不改变 `sourcePath` 字段结构
  - rewind 前端执行参数需要从布尔开关扩展为显式 mode

## 验收标准

- rewind preview MUST NOT 将 `read_file`、`batch_read`、搜索或列表类只读工具涉及的文件展示为受影响文件。
- rewind preview MUST 继续保留 `edit/create/delete/rename` 与等价 mutation `fileChange` 事实对应的文件。
- 当同一路径同时存在只读访问与 mutation 记录时，系统 MUST 以 mutation 事实保留该文件，而不是因为只读来源产生重复或错误分类。
- Claude 与 Codex rewind review surface MUST 对同一批历史事实得到一致的受影响文件集合。
- 导出与预览使用的文件集合 MUST 保持一致，不得出现“预览里有但实际不会导出/回退”的只读文件。
- rewind preview MUST 仅基于目标用户消息及其后的 assistant/tool 事实收集文件，不得跨越锚点向前吸纳更早消息中的读取文件。
- rewind 确认弹层 MUST 展示三个互斥单选策略，而不是文件回退 toggle。
- 当 workspace 是 Git 仓库且 `git status` 未检测到变更时，rewind 确认弹层 MUST NOT 展示文件列表或 diff 预览。
- 当 workspace 不是 Git 仓库时，rewind 确认弹层 MUST 保持现有 mutation-only 文件展示行为，不得因为缺少 Git 状态而隐藏文件区。
- `messages-and-files` MUST 同时执行消息 rewind 与文件恢复。
- `messages-only` MUST 仅执行消息 rewind，不得改写当前 workspace 文件。
- `files-only` MUST 仅执行文件恢复，不得改写会话消息历史。
