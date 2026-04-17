## Context

当前 rewind preview 的文件集合是在前端聚合出来的：`Composer` 中的 `buildLatestRewindPreview(...)` 会先定位目标用户消息锚点，再基于该锚点之后的尾部消息区间收集 tool 层文件事实，并与消息级 fallback 文件集合进行 merge。

现状问题有四个：

1. `extractFileChangeSummaries(...)` 为了兼容历史 tool card 和弱结构化 payload，会从 `detail/output/args` 中尽可能推断文件路径；这对 status panel / activity panel 是有价值的，但对 rewind 这种“高风险确认”场景过宽。
2. `extractFallbackAffectedFilesFromImpactedMessages(...)` 会从用户消息中的 `@mention` 与自然语言意图里推断文件路径与状态；它本来用于弥补删除文件、弱结构化 payload 或无 diff 场景，但在缺少 mutation 过滤时，也可能把只读上下文文件带进 rewind preview。
3. 如果文件收集先在全会话范围做，再按路径/status 过滤，就有机会把锚点之前读过但不属于本次回溯尾部区间的文件错误牵连进来。
4. 当前 UI 只有一个“回退工作区文件”toggle，对应的执行模型本质上只是 `messages-and-files` 与 `messages-only` 两态，无法表达“只回退文件，不回退消息”。
5. 当前 rewind review surface 不区分“Git 仓库但 working tree clean”和“非 Git 仓库”两种上下文，导致 Git clean 场景仍会展示 mutation 文件列表，与用户当前工作区状态不一致。

本变更不仅收敛 rewind preview / export 的输入事实源，还把执行策略从布尔开关扩展为显式三态模式，让 UI 展示与实际执行语义保持一一对应。

约束：

- `Claude` 与 `Codex` 必须共用同一套“锚点尾部区间 + mutation-only + 三态策略”规则。
- 不能破坏现有 `OperationFileChangeSummary` / `filePath` 聚合主键约定。
- 不能影响 status panel、activity panel 等非 rewind 场景对宽松文件推断的既有使用价值。
- 不能改变 rewind 以“目标用户消息作为锚点”的现有时间边界，只能在该尾部区间内收集候选文件。
- `files-only` 必须是一个真正独立的执行分支：只恢复文件，不触发消息 rewind / fork / truncation。
- 对 delete / rename / bash create-delete / apply_patch 这类 mutation，但没有 inline diff 的情况，仍要保留 recoverable 行为。

## Goals / Non-Goals

**Goals:**

- 为 rewind preview 引入独立的 mutation-only 候选文件构建规则，而不是直接复用“尽量推断所有文件路径”的宽松聚合结果。
- 将 rewind 文件收集边界固定在目标用户消息锚点开始的尾部区间，防止向前越界牵连更早上下文。
- 用三态单选策略取代现有 toggle，让 UI 明确表达三种执行模式。
- 保留当前 `filePath` 归一化、dedupe、status merge 的共享行为，避免重新发明一套 rewind 文件身份模型。
- 让 preview 与 export 使用同一批 mutation 候选文件，消除“UI 展示了但不会导出/回退”的只读噪音条目。
- 保留消息级 fallback 的必要价值，但要求它只能服务于 mutation 场景补洞，不能独立把只读路径抬升为 rewind 候选文件。
- 在 review surface 增加 Git clean 显示规则：Git 仓库且无变更时隐藏文件区，非 Git 仓库保持当前 mutation-only 文件展示。
- 在 review surface 文件列表渲染前增加显示级去重，避免同一文件因绝对/相对路径等弱规范化差异重复出现。

**Non-Goals:**

- 不改 `ClaudeRewindConfirmDialog` 的主体布局、diff 组件或文件审查结构。
- 不改 `export_rewind_files` 的目录结构、manifest 字段或后端路径解析逻辑。
- 不改 `status panel`、`activity panel`、普通 tool card 的文件推断策略。
- 不做按文件粒度的用户手动筛选。
- 不把 `files-only` 抽象成全局独立工具入口；它只存在于 rewind 确认流程中。
- 不新增新的 Git 状态查询链路；优先复用现有 workspace `gitStatus` 结果。

## Decisions

### Decision 1: 为 rewind 引入场景化筛选，而不是直接收紧全局 `extractFileChangeSummaries`

- 方案 A：直接把 `extractFileChangeSummaries(...)` 改成只返回 mutation 文件。
  - 优点：规则统一，调用方更简单。
  - 缺点：会影响 status panel、activity panel、历史回放等依赖宽松推断的现有场景，回归面太大。
- 方案 B：保留共享函数的宽松能力，在 rewind preview 入口增加 mutation-only 过滤层（采用）。
  - 优点：影响面集中在 rewind 相关链路；其他 surface 保持现状。
  - 缺点：需要在 rewind 聚合链额外维护一层场景语义。

取舍：采用方案 B。rewind 是高风险动作，场景化收紧比全局改语义更稳。

### Decision 2: rewind 文件集合必须先受锚点尾部区间约束

- 方案 A：先在全会话范围收集文件，再按路径或状态过滤。
  - 优点：可复用现有宽松聚合结果。
  - 缺点：会把锚点之前的读取上下文也带进来，违背 rewind 只回退尾部事实的语义。
- 方案 B：先截取“目标用户消息 + 后续事实”的尾部区间，再在该区间内做 mutation-only 过滤（采用）。
  - 优点：文件集合与 rewind 真正删除的消息区间一致，不会前向牵连。
  - 缺点：要求 preview builder 对 anchor 边界更敏感。

取舍：采用方案 B。rewind 的文件候选集必须先 obey anchor boundary，再谈 mutation boundary。

### Decision 3: 用显式三态 mode 取代布尔 toggle

- 方案 A：继续沿用 `restoreWorkspaceFiles: boolean`，并对 `false` 做更多隐式解释。
  - 优点：参数改动少。
  - 缺点：无法表达 `files-only`；布尔值无法承载三种互斥策略。
- 方案 B：引入显式 `rewindMode` 枚举，例如 `messages-and-files | messages-only | files-only`（采用）。
  - 优点：UI、状态、执行语义一一对应；代码可读性更高。
  - 缺点：需要改 dialog state、Composer callback、thread action 参数与测试。

取舍：采用方案 B。高风险操作不适合继续依赖布尔值推断意图。

### Decision 4: `files-only` 必须短路消息 rewind 链路，而不是“先 rewind 再补回”

- 方案 A：先执行消息 rewind，再尝试在前端恢复消息状态，模拟“只回退文件”。
  - 优点：复用现有执行路径。
  - 缺点：会污染真实会话历史，且回滚复杂，语义错误。
- 方案 B：`files-only` 直接只走 workspace 文件恢复分支，不调用消息 rewind / fork / truncation（采用）。
  - 优点：语义清晰，副作用最小。
  - 缺点：需要将文件恢复能力从完整 rewind 分支中明确拆出可单独执行的入口。

取舍：采用方案 B。`files-only` 必须是正交分支，而不是完整 rewind 的变体。

### Decision 5: mutation 候选资格由“显式 change kind 或可判定 mutation 语义”决定

- 方案 A：只有 `item.changes` 里显式存在 `add/delete/rename/modified` 才算 mutation。
  - 优点：规则最硬，误判最少。
  - 缺点：会丢掉 delete file、bash create/delete、弱结构化 apply_patch 等已经被现有逻辑恢复出的真实 mutation。
- 方案 B：显式 `changes` 优先；没有结构化 changes 时，允许现有 inference 继续识别 mutation，但必须能落到 mutation status，而不是仅凭 read/search/list 路径命中（采用）。
  - 优点：兼容现有弱结构化历史与命令型文件变更。
  - 缺点：需要更明确地区分 mutation hints 与 read-only hints。

取舍：采用方案 B。目标不是只信最强结构化数据，而是让“真实改过的文件”尽量保留，同时排除纯只读来源。

### Decision 6: 消息级 fallback 只能补洞，不能单独创造 rewind 文件集合

- 方案 A：继续把 `extractFallbackAffectedFilesFromImpactedMessages(...)` 的结果无条件 merge 进最终列表。
  - 优点：实现最少。
  - 缺点：用户消息里的 `@mention` 很容易代表“查看一下这个文件”，不是“回头要回退这个文件”。
- 方案 B：fallback 只在同一路径已经存在 mutation 记录，或能与 delete / rename 等缺 diff mutation 明确关联时生效（采用）。
  - 优点：保留对删除文件、弱结构化变更的补洞能力，同时避免只读 mention 污染 rewind 候选集。
  - 缺点：需要在 merge 阶段显式表达“主来源”和“补充来源”。

取舍：采用方案 B。消息文本不是 rewind 候选文件的真值来源，只能作为 mutation 事实缺口时的辅助信息。

### Decision 7: export 与 preview 共享同一 mutation 集合，而不是各自独立再过滤

- 方案 A：preview 先过滤，export 继续接收原始 `affectedFiles` 自行判断。
  - 优点：改动局部。
  - 缺点：容易产生 preview/export 语义漂移，重新引入“界面一个集合，导出另一个集合”的问题。
- 方案 B：在 `buildLatestRewindPreview(...)` 阶段就产出最终 mutation-only `affectedFiles`，后续 dialog 展示和 export 都只消费这一份（采用）。
  - 优点：单一事实源，测试矩阵简单。
  - 缺点：要求 preview 构建逻辑职责更明确。

取舍：采用方案 B。rewind preview state 本来就是弹层与导出链路共享的数据模型，应在这里完成收敛。

### Decision 8: Git clean 场景只收紧“显示”，不改非 Git 场景的文件候选语义

- 方案 A：只要当前没有检测到 Git 变更，就统一隐藏文件区。
  - 优点：规则简单。
  - 缺点：会把非 Git 仓库也一起隐藏，违背“非 Git 保持现状”的要求。
- 方案 B：仅当 workspace 被判定为 Git 仓库且 `git status` clean 时隐藏文件区；非 Git 仓库继续显示 mutation-only 文件集合（采用）。
  - 优点：和用户心智一致，避免把“缺少 Git 能力”和“Git clean”混为一谈。
  - 缺点：需要把现有 `gitStatus` 上下文透传给 rewind review surface。

取舍：采用方案 B。这里要表达的是“当前 Git working tree 没有需要审查的本地变更”，不是“所有环境都没有文件信息”。

## Risks / Trade-offs

- [Risk] 锚点边界处理错误，导致锚点之前的读文件被错误带入，或锚点之后的 mutation 被误丢弃  
  → Mitigation：在 `buildLatestRewindPreview(...)` 所在链路先做尾部区间截取，并增加 anchor-boundary 回归测试。

- [Risk] `files-only` 误触发消息 rewind，导致用户历史被意外截断  
  → Mitigation：将 `files-only` 分支在参数层与执行层显式短路，不得调用消息 rewind API。

- [Risk] 三态 UI 与底层执行参数未对齐，出现“选项有了但行为还是旧逻辑”  
  → Mitigation：在 `Composer` 与 `useThreadActions` 增加 mode 断言测试，分别覆盖三种分支。

- [Risk] mutation 过滤过严，导致某些弱结构化 delete / rename 文件从 rewind preview 消失  
  → Mitigation：保留现有 command/payload inference，但要求它必须产出 mutation status；补充删除、Bash 创建/删除、apply_patch 无 diff 回归用例。

- [Risk] fallback 约束后，部分历史数据在 Claude/Codex 上表现不一致  
  → Mitigation：把过滤逻辑放在 shared rewind aggregation 层，而不是 engine-specific 分支；增加 Claude/Codex 对照测试。

- [Risk] preview 过滤了只读文件，但 export 仍意外导出旧集合  
  → Mitigation：export 只消费 `preview.affectedFiles`，不再重新扫描原始 impacted items。

- [Risk] 将 Git clean 与非 Git 仓库混淆，导致非 Git 工作区文件区被错误隐藏  
  → Mitigation：复用现有 non-git error 判定，只在“明确是 Git 仓库且无变更”时隐藏文件相关 UI。

## Migration Plan

1. 在 rewind preview 构建链路先固定“目标用户消息 + 后续事实”的尾部区间，再在该区间内引入 mutation-only 过滤步骤，优先放在 `buildLatestRewindPreview(...)` 附近，避免改动非 rewind surface。
2. 将 dialog 的布尔 toggle 替换为三态 mode state，并在每次打开弹层时重置为安全默认值 `messages-and-files`。
3. 将 `Composer -> onConfirm -> useThreadActions` 的执行参数从布尔值扩展为显式 mode。
4. 将完整 rewind 中已有的 workspace 文件恢复步骤拆成可被 `messages-and-files` 与 `files-only` 复用的能力，但 `files-only` 不得调用消息 rewind 链路。
5. 将 tool summary 与 message fallback 的 merge 改为“mutation 主集 + fallback 补洞”模型，而不是当前无差别 union。
6. 保持 `OperationFileChangeSummary`、路径归一化、status merge 与 dedupe 逻辑兼容，避免改动 dialog 和 export 的输入结构。
7. 增加回归测试：
   - 锚点之前的读取文件不进入 rewind preview
   - read / batch read 文件不进入 rewind preview
   - delete / create / rename / bash create-delete 仍保留
   - `messages-and-files / messages-only / files-only` 三种模式行为正确
   - Git 仓库 clean 时隐藏文件区，非 Git 仓库保持现状
   - preview 与 export 消费同一集合
8. 若上线后出现异常，可临时回退到 `messages-and-files` 默认单一路径，但保留 mutation-only 文件集合收敛；这属于前端执行策略层回滚，不影响底层文件身份规则。

## Open Questions

- 当前无需新增阻塞性开放问题。若实现时发现 `files-only` 需要额外的用户确认文案或与导出动作冲突，再在 UI 层局部补充，不需要扩展 spec 范围。
