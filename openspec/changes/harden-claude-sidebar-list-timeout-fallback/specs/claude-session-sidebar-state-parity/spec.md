# claude-session-sidebar-state-parity Specification Delta

## ADDED Requirements

### Requirement: Claude Sidebar Listing MUST Preserve Last-Good Claude Entries When Native Listing Times Out

当 sidebar thread list 加载过程中 Claude native listing 子请求超时、返回 null、或被拒绝时，系统 MUST 保留上一轮已知良好的 Claude session 条目，并继续与其他子源（Codex / OpenCode / Catalog）的成功结果合并，而不是让 timeout 等同为"Claude 没有任何 session"。

#### Scenario: claude listing timeout preserves last-good claude entries while codex still resolves

- **WHEN** sidebar `listThreadsForWorkspace` 进入 full-catalog hydration
- **AND** `listClaudeSessionsService` 在前端 `withTimeout` 窗口内未返回（resolve 为 `null`）
- **AND** Codex catalog / OpenCode 子源仍然返回非空结果
- **THEN** 最终写入 sidebar store 的 thread 列表 MUST 包含上一轮 last-good 中所有非 archived / 非 shared 的 Claude session 条目
- **AND** Codex / OpenCode 已成功的 session 条目 MUST 同时存在于列表中
- **AND** 列表 MUST NOT 出现"看似已成功但只剩单一子源结果"的残缺态

#### Scenario: claude listing rejected preserves last-good claude entries

- **WHEN** sidebar `listThreadsForWorkspace` 进入 full-catalog hydration
- **AND** `listClaudeSessionsService` 抛出异常（`Promise.allSettled` 中 status 为 `rejected`）
- **THEN** 系统 MUST 与超时分支等价地保留 last-good Claude 条目
- **AND** 系统 MUST 通过 `rememberPartialSource("claude-session-error")` 或等价机制记录这次降级

#### Scenario: full empty fallback path is not regressed

- **WHEN** Claude / Codex / OpenCode / Catalog 全部子源均不可用或返回空
- **AND** 合并后的 `visibleSummaries.length === 0`
- **THEN** 系统 MUST 继续走 `empty-thread-list` last-good fallback 路径
- **AND** 系统 MUST NOT 在该路径下消音 partial-source 诊断

### Requirement: Sidebar Last-Good Snapshot Resolution MUST Reject Degraded State To Prevent Self-Pollution

`getLastGoodThreadSummaries` 在解析"上次良好状态"时 MUST 显式拒绝带 degraded 标记的快照，按 `current → previous → store → sidebar snapshot → []` 顺序逐级 fallback，直到拿到非 degraded 的结果或彻底回空。

#### Scenario: degraded current state is skipped in favor of clean previous state

- **WHEN** 上一轮 partial-source 兜底导致带 degraded 标记的 thread summary 被写入 store
- **AND** 下一次 sidebar refresh 触发 `getLastGoodThreadSummaries(workspaceId)`
- **THEN** 系统 MUST 跳过 `latestThreadsByWorkspaceRef.current[workspaceId]`（因其 degraded）
- **AND** 系统 MUST 优先返回 `previousThreadsByWorkspaceRef.current[workspaceId]` 中的非 degraded 快照
- **AND** 若 previous 亦 degraded，MUST 继续 fallback 到 store 与 sidebar snapshot

#### Scenario: consecutive claude timeouts do not progressively drop more sessions

- **WHEN** 同一 workspace 下连续两次 `listThreadsForWorkspace` 都让 Claude 子源 timeout
- **THEN** 第二次执行时 `getLastGoodThreadSummaries` 取到的 last-good MUST 仍包含首次 first-page 后的完整 Claude 列表
- **AND** 第二次写入 store 的 Claude 条目数 MUST 不少于第一次写入 store 的 Claude 条目数

#### Scenario: healthy non-degraded state still resolves as last-good

- **WHEN** 上一次 sidebar refresh 成功返回完整列表，未带 degraded 标记
- **AND** 触发新的 `getLastGoodThreadSummaries`
- **THEN** 系统 MUST 直接返回 `latestThreadsByWorkspaceRef.current[workspaceId]`，不退化到 previous 或 snapshot

### Requirement: Sidebar Timeout Recovery MUST Remain Observable Through Partial-Source Diagnostics

当 sidebar listing 通过 last-good seed 路径恢复显示时，系统 MUST 保留可观测的 partial-source 诊断信号，以便用户与开发者识别本次列表的真实健康度，不得因为兜底成功而消音问题。

#### Scenario: claude timeout fallback still emits partial-source signal

- **WHEN** sidebar listing 因 Claude 子源 timeout 触发 last-good seed
- **THEN** 系统 MUST 记录 `claude-session-timeout` 或等价 partial-source 值
- **AND** 系统 MUST 通过既有 `onDebug` / Debug 面板事件投递诊断
- **AND** UI 层 MUST 能据此呈现 degraded badge 或 recovery state（如已有该展示）

#### Scenario: successful refresh clears prior degraded marking

- **WHEN** 后续一次 sidebar listing 中 Claude 子源成功返回非空结果
- **THEN** 新写入 store 的 Claude 条目 MUST NOT 继续携带上一次的 degraded 标记
- **AND** 此次 `getLastGoodThreadSummaries` 的下次调用 MUST 把当前状态视为 healthy

### Requirement: Last-Good Claude Seed MUST Survive Codex Catalog Re-Composition

当 Claude 子源被 last-good 条目 seed 进 mergedById 后，后续 Codex catalog 重组（`mergeCodexCatalogSessionSummaries`）MUST 不洗掉已 seed 的 Claude 条目；若架构限制使 seed 必须重复，系统 MUST 在 catalog 重组之后再补一次 seed。

#### Scenario: codex catalog refresh preserves seeded claude entries

- **WHEN** Claude 子源 timeout 触发 last-good seed
- **AND** Codex catalog 子源同一轮返回非空 sessions 并触发 `mergeCodexCatalogSessionSummaries`
- **THEN** 重组后的 mergedById MUST 仍包含 seed 阶段写入的 Claude 条目
- **AND** Codex catalog sessions 与 Claude seed 条目 MUST 按 `updatedAt desc` 共同存在于最终列表

#### Scenario: archived claude session is not resurrected by last-good seed

- **WHEN** last-good 列表中含有已 archived 的 Claude session 条目
- **AND** Claude 子源 timeout 触发 seed
- **THEN** 已 archived 的条目 MUST NOT 被 seed 进 mergedById
- **AND** archive state 的 source-of-truth 仍由 `applySessionArchiveState` 维护

### Requirement: Claude Sidebar Listing MUST Treat Successful Empty Results As Authoritative Only When Attribution Is Complete

当 Claude native listing 成功返回空数组时，系统 MUST 区分"真实没有 Claude session"与"扫描/归属不确定导致暂时没有命中"。只有后端或 catalog 明确提供完整、无 partial、无 attribution ambiguity 的结果时，successful empty 才能覆盖 last-good Claude entries。

#### Scenario: successful empty with uncertain attribution preserves last-good claude entries

- **WHEN** sidebar `listThreadsForWorkspace` 进入 full-catalog hydration
- **AND** `listClaudeSessionsService` 成功返回空数组
- **AND** 当前 workspace 存在上一轮 last-good Claude entries
- **AND** 本轮 listing 或 catalog projection 暴露 partial source、scan ambiguity、workspace family ambiguity、或 attribution uncertainty
- **THEN** 系统 MUST 把该空数组视为 degraded empty
- **AND** 最终 sidebar store MUST 保留 last-good Claude entries
- **AND** 系统 MUST 通过 debug / partial-source 机制记录 successful-empty fallback 原因

#### Scenario: authoritative empty may clear last-good claude entries

- **WHEN** `listClaudeSessionsService` 成功返回空数组
- **AND** 后端确认当前 workspace scan 完整且无 attribution ambiguity
- **AND** catalog / archive / shared filters 均未报告 partial source
- **THEN** 系统 MAY 将 Claude entries 更新为空
- **AND** 该更新 MUST NOT 带 degraded fallback 标记

### Requirement: Claude Session Attribution MUST Prefer Exact Child Workspace Ownership Over Parent Scope

当父 workspace 与子文件夹 workspace 同时存在时，Claude session 的 owner MUST 由最精确的 workspace path / transcript cwd / direct Claude project dir 决定。父 workspace、git root family、parent scope fallback 或 encoded-prefix scan MUST NOT 抢占 exact child workspace 所拥有的 Claude session。

#### Scenario: child workspace cwd remains owned by child projection

- **WHEN** workspace `parent` path 为 `/repo`
- **AND** workspace `child` path 为 `/repo/sub`
- **AND** Claude transcript `cwd` 为 `/repo/sub` 或其子路径
- **THEN** 该 Claude session 的 matched workspace MUST 是 `child`
- **AND** child sidebar projection MUST 显示该 session
- **AND** parent sidebar projection MUST NOT 将该 session 当作 parent-owned native session

#### Scenario: parent scope fallback does not override longer child match

- **WHEN** Claude project directories include both parent encoded path and child encoded path candidates
- **AND** transcript cwd matches both by prefix but child path is longer
- **THEN** longest child match MUST win over parent match
- **AND** parent-scope / git-root inference MUST NOT downgrade this exact child ownership into inferred parent ownership

#### Scenario: ambiguous sibling child matches remain degraded instead of choosing parent

- **WHEN** multiple child workspaces under the same parent can plausibly match a Claude session
- **AND** no exact cwd or direct child project dir evidence disambiguates the owner
- **THEN** the session MUST NOT be silently assigned to the parent workspace as authoritative truth
- **AND** the system MUST expose attribution ambiguity through partial-source, degraded state, or equivalent diagnostics
