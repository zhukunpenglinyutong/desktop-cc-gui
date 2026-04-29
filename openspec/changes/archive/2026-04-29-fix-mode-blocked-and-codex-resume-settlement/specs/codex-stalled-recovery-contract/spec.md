## MODIFIED Requirements

### Requirement: Codex Stalled Recovery Diagnostics MUST Be Correlatable Across Runtime And Thread Surfaces

针对同一条 Codex fusion stalled chain 与 `resume-pending` user-input resume timeout，thread-facing diagnostics、runtime diagnostics 与 runtime pool console MUST 共享一致的相关维度，并明确区分“当前仍活跃”与“最近一次 stalled”。

#### Scenario: stalled fusion exposes shared correlation dimensions

- **WHEN** 系统识别到 Codex fusion continuation 进入 stalled / degraded state
- **THEN** 诊断事实 MUST 至少包含 `workspaceId`、`threadId`、`turnId`（可用时）、engine、continuation source 与 timeout stage
- **AND** thread 与 runtime pool MUST 使用语义一致的 stalled reason 表达同一条异常链

#### Scenario: resume-pending timeout keeps correlatable recent stalled evidence after release

- **WHEN** 系统将一条 Codex `resume-pending` user-input resume chain 结算为 stalled / degraded
- **THEN** 诊断事实 MUST 继续包含 `workspaceId`、`threadId`、`turnId`（可用时）、engine、continuation source 与 timeout stage
- **AND** runtime 与 thread surfaces MUST 能将该事实关联为最近一次 stalled timeout
- **AND** 该事实 MUST NOT 单独被解释为当前仍在执行的 foreground work

### Requirement: General Codex Turn Silence MUST Settle To Recoverable Liveness State

Codex stalled recovery MUST cover any foreground Codex turn that exceeds a bounded no-progress window, including `requestUserInput` 提交后的 `resume-pending` 恢复 gap, not only queue fusion continuation.

#### Scenario: no progress evidence enters stalled state
- **WHEN** a Codex foreground turn has been started or requested
- **AND** the system receives no terminal event, stream delta, tool event, user-input request, approval request, or equivalent progress evidence within the bounded no-progress window
- **THEN** the turn MUST transition to `stalled`, `dead-recoverable`, or an equivalent recoverable liveness state
- **AND** the thread MUST NOT remain indefinitely in normal processing state

#### Scenario: resume-pending timeout releases current foreground continuity
- **WHEN** a Codex foreground turn is waiting on a `requestUserInput` resume chain in `resume-pending` or equivalent state
- **AND** the bounded no-progress window expires without new terminal or progress evidence
- **THEN** the turn MUST transition to `stalled`, `dead-recoverable`, or an equivalent recoverable liveness state
- **AND** the old resume-pending chain MUST release current foreground continuity / active-work protection

#### Scenario: active execution uses extended no-progress window
- **WHEN** a Codex foreground turn has an active command, tool, file-change, or equivalent execution item
- **AND** the execution item has not emitted a terminal completion event
- **THEN** the base no-progress window MUST NOT settle the turn as stalled
- **AND** the turn MAY only transition to a recoverable stalled state after an execution-active no-progress window that is long enough for normal quiet tool execution

#### Scenario: execution completion releases extended window with partial payload
- **WHEN** a Codex execution item was previously observed with a stable item id
- **AND** a later completion event carries that item id but omits the item type
- **THEN** the execution item MUST be removed from active execution tracking
- **AND** subsequent no-progress settlement MUST use the base no-progress window unless another execution item is still active

#### Scenario: recent stalled diagnostics remain observable after continuity release
- **WHEN** a Codex `resume-pending` timeout has already released current foreground continuity
- **THEN** runtime diagnostics MUST be allowed to preserve recent stalled timeout metadata for that chain
- **AND** preserved timeout metadata MUST NOT reclassify the runtime as currently active or still `resume-pending`

#### Scenario: late progress can revive only matching turn identity
- **WHEN** a stalled Codex turn later receives progress evidence
- **THEN** the system MUST only revive or settle the turn if thread identity, turn id when available, and runtime generation still match the active liveness chain
- **AND** stale late evidence MUST be recorded as diagnostic evidence rather than mutating the active successor thread

#### Scenario: stalled state exposes user-safe actions
- **WHEN** a Codex turn enters stalled or dead-recoverable state
- **THEN** the conversation surface MUST expose safe actions such as stop, retry same verified thread, reconnect and retry, or continue fresh according to available liveness evidence
- **AND** unavailable actions MUST be disabled or explained instead of silently doing nothing
