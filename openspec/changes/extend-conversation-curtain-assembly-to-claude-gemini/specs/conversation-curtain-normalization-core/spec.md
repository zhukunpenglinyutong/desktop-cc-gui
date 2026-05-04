## MODIFIED Requirements

### Requirement: Realtime And History Hydrate SHALL Share One Normalization Contract

conversation curtain 在消费 realtime observations 与 history hydrate snapshots 时 MUST 使用同一套 normalization / merge contract，避免相同语义内容在两条路径上被不同规则处理。该 contract MUST 覆盖 `Codex`、`Claude Code` 与 `Gemini` 的主 conversation-visible observations；engine-specific wrapper、provider metadata 或 history replay carrier 只能影响 canonical metadata，不得改变等价语义判断。

#### Scenario: equivalent user observation converges across realtime and history

- **WHEN** 同一条 user message 先以 optimistic 或 queued handoff 形式出现在幕布中
- **AND** 稍后 authoritative history 或 canonical payload 以等价语义到达
- **THEN** 系统 MUST 将二者收敛为单条 user bubble
- **AND** 用户可见 row 数量 MUST 保持稳定

#### Scenario: equivalent assistant observation converges across completed and history hydrate

- **WHEN** 同一条 assistant reply 已在 realtime completed settlement 中形成可见正文
- **AND** 稍后 history hydrate 以等价语义再次提供该 reply
- **THEN** 系统 MUST 复用同一 normalization 规则判断二者等价
- **AND** 系统 MUST NOT 再新增一条主体重复的 assistant bubble

#### Scenario: claude history replay does not duplicate realtime assistant or approval rows

- **WHEN** `Claude Code` realtime path 已经显示 assistant 正文、`ExitPlanMode` 卡片或 approval-derived file changes 卡片
- **AND** history replay 以 JSONL carrier、resume marker 或 structured history item 再次提供等价 observation
- **THEN** normalization MUST 将其视为同一 semantic observation
- **AND** 系统 MUST NOT 追加第二条主体重复 assistant row、plan row 或 approval row

#### Scenario: gemini history replay preserves reasoning and tool cardinality

- **WHEN** `Gemini` realtime path 已经显示 reasoning 或 tool snapshot
- **AND** history hydrate 以等价 reasoning/tool payload 再次提供该 observation
- **THEN** normalization MUST 使用共享 equivalence 规则收敛
- **AND** visible row cardinality MUST 保持稳定

### Requirement: Assistant Settlement Canonicalization MUST Collapse Equivalent Replay

conversation curtain 对 assistant reply 的 completed settlement MUST 能收敛 `stream delta`、`completed replay`、`history hydrate` 等多来源中的等价正文，避免主体文本重复拼接。该收敛 MUST 对 `Codex`、`Claude Code` 与 `Gemini` 生效；provider-specific completion carrier 不得绕过 shared assistant comparator。

#### Scenario: completed replay with streamed prefix converges before history refresh

- **WHEN** assistant 已通过 realtime delta 显示了可读正文前缀
- **AND** terminal completed payload 又以 `prefix + full final snapshot` 或等价 replay 形式到达
- **THEN** 系统 MUST 在本地 settlement 阶段将该 replay 收敛为单条 assistant message
- **AND** MUST NOT 依赖后续 history refresh 才去掉重复正文

#### Scenario: short duplicate reply renders once

- **WHEN** 任一支持引擎对简短输入返回短句型回复
- **AND** stream / completed / history 三种来源中存在等价重复
- **THEN** 最终幕布 MUST 只显示一条 assistant reply
- **AND** MUST NOT 出现整句重复拼接

#### Scenario: claude long markdown completion does not append final snapshot twice

- **WHEN** `Claude Code` 正在 streaming 长 Markdown
- **AND** terminal completion 或 history hydrate 提供等价 full Markdown snapshot
- **THEN** shared assistant settlement MUST replace or canonicalize the live row
- **AND** MUST NOT 将 streamed prefix 与 final snapshot 重复拼接

#### Scenario: gemini assistant replay stays canonical

- **WHEN** `Gemini` streaming output 与 history hydrate output 在 normalized text 后等价
- **THEN** 系统 MUST 保留一条 canonical assistant message
- **AND** history hydrate MAY only backfill ids、timestamps、metadata 或 structured facts

### Requirement: Reasoning Snapshot Equivalence MUST Use Shared Rules

reasoning snapshot 在 realtime append 与 history hydrate 中 MUST 使用同一套等价规则，避免两条链路对相同 reasoning 正文得出不同 duplicate 结论。该规则 MUST 支持 `Codex`、`Claude Code` 与 `Gemini` 的 reasoning / thinking / summary carrier，并允许 engine profile 决定展示标题，但不得改变 semantic duplicate 判断。

#### Scenario: repeated reasoning snapshot collapses to one row

- **WHEN** 同一 reasoning 内容先后以多个 snapshot 或 hydrate 形式到达
- **THEN** 系统 MUST 将其收敛为单条 reasoning row
- **AND** 后到 observation 只可更新 canonical text / metadata，不得新增重复 row

#### Scenario: non-equivalent reasoning remains distinct

- **WHEN** 两条 reasoning observation 在共享 normalization 规则下不等价
- **THEN** 系统 MUST 将其保留为不同 reasoning step
- **AND** MUST NOT 因共享前缀或局部相似而误合并不同 reasoning 内容

#### Scenario: gemini adjacent reasoning merge uses shared comparator

- **WHEN** `Gemini` history parser 或 realtime adapter 发现相邻 reasoning fragments
- **THEN** merge / dedupe decision MUST use shared reasoning equivalence semantics
- **AND** loader-local helper MUST NOT diverge from curtain normalization behavior
