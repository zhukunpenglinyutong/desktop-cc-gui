# runtime-orchestrator Specification

## Purpose
TBD - created by archiving change runtime-orchestrator-pool-console. Update Purpose after archive.
## Requirements
### Requirement: Runtime Orchestrator MUST manage workspace runtimes as budgeted resources
The system MUST manage persistent workspace runtimes through a unified Runtime Orchestrator instead of implicitly binding runtime existence to workspace visibility or restore state.

This requirement applies to `Codex` and `Claude Code` managed runtimes in the first release of the orchestrator contract.

#### Scenario: non-active visible workspace does not force runtime spawn
- **WHEN** the client restores sidebar-visible workspaces on startup
- **THEN** the system MUST restore workspace/thread metadata without automatically spawning a persistent runtime for every visible workspace

#### Scenario: active turn acquires managed runtime
- **WHEN** a workspace starts a send/resume/new-thread action that requires a managed runtime
- **THEN** the Runtime Orchestrator MUST ensure a runtime is available for that `(engine, workspace)` pair before execution proceeds

### Requirement: Runtime Orchestrator MUST enforce unique active runtime per engine-workspace pair

The system MUST treat `(engine, workspace)` as the unique identity for a managed runtime instance and MUST prevent duplicate active runtimes for the same pair, including concurrent automatic recovery sources, replacement overlap, and reuse of a runtime that has already entered a stopping/manual-shutdown lifecycle.

#### Scenario: repeated ensure is idempotent

- **WHEN** the client issues repeated `connect` or `ensureRuntimeReady` requests for the same `(engine, workspace)`
- **THEN** the system MUST reuse the existing active runtime or the existing in-flight startup instead of spawning a second runtime
- **AND** a runtime already marked `manual shutdown`, `runtime ended`, or equivalent stopping-predecessor state MUST NOT be treated as that reusable active runtime

#### Scenario: concurrent automatic recovery sources reuse one guarded acquire

- **WHEN** multiple automatic recovery sources target the same `(engine, workspace)` while no healthy runtime is ready
- **THEN** the orchestrator MUST expose one in-flight guarded acquire for that pair
- **AND** later callers MUST join that acquire as waiters or receive a guarded degraded outcome instead of creating a parallel runtime

#### Scenario: replacement stops old runtime after swap

- **WHEN** the system replaces an existing managed runtime for the same `(engine, workspace)`
- **THEN** it MUST complete startup for the new runtime, swap the registry binding, and stop the old runtime through the managed shutdown path

#### Scenario: stopping predecessor is not reused for user-triggered new thread

- **WHEN** the current runtime for a `(engine, workspace)` pair has already entered manual shutdown or equivalent stopping-predecessor lifecycle
- **AND** the user starts a new thread or equivalent runtime-required foreground action
- **THEN** the orchestrator MUST treat that stopping runtime as non-reusable
- **AND** the action MUST acquire or wait for a fresh successor runtime before foreground execution proceeds

#### Scenario: replacement overlap is capped to one stopping predecessor

- **WHEN** a replacement is already in progress for a managed runtime
- **THEN** the orchestrator MUST allow at most one active successor and one stopping predecessor for that `(engine, workspace)`
- **AND** further automatic recovery sources MUST NOT start an additional replacement until the predecessor stop path has settled or timed out

### Requirement: Runtime Orchestrator MUST support pooled lifecycle tiers
The system MUST classify managed runtimes into `Hot`, `Warm`, `Cold`, and `Pinned` lifecycle tiers and MUST enforce configurable runtime budgets.

#### Scenario: warm runtime is cooled after ttl expiry
- **WHEN** a managed runtime is no longer needed for an active turn and no lease source remains except warm retention
- **THEN** the system MUST transition that runtime to `GracefulIdle` and release it after the configured warm TTL expires

#### Scenario: budget overflow evicts lowest-priority runtime
- **WHEN** the number of managed runtimes exceeds the configured budget for an engine
- **THEN** the system MUST evict the lowest-priority runtime that has no active lease according to pool tier and recency rules

### Requirement: Runtime lifecycle state MUST be explicit and observable

The system MUST expose explicit runtime lifecycle state for every managed runtime instance, including startup-vs-health classification and replacement diagnostics needed to understand Windows churn behavior.

#### Scenario: runtime snapshot includes lifecycle state and lease source

- **WHEN** the client requests a runtime pool snapshot
- **THEN** each managed runtime entry MUST include lifecycle state, lease source, last-used timestamp, and engine/workspace identity

#### Scenario: startup failure is represented as failed state

- **WHEN** runtime startup fails after the system begins acquiring a managed runtime
- **THEN** the runtime entry MUST transition to `Failed` with diagnosable error details instead of remaining implicitly connected

#### Scenario: startup-pending remains distinct from suspect-stale

- **WHEN** a managed runtime has begun startup but has not yet established a healthy ready state
- **THEN** the observable lifecycle state MUST distinguish that startup-pending condition from a post-ready stale-session suspicion
- **AND** downstream recovery logic MUST be able to tell whether a timeout happened before readiness or after health had previously succeeded

#### Scenario: replacement diagnostics expose stopping predecessor state

- **WHEN** a managed runtime has already swapped to a new active successor while an old predecessor is still stopping
- **THEN** the observable snapshot MUST preserve that stopping predecessor condition and the last replacement reason
- **AND** operators MUST be able to tell that the extra process tree belongs to bounded replacement overlap rather than an unbounded duplicate spawn

### Requirement: Runtime eviction MUST be lease-gated
The system MUST prevent runtime eviction while any turn lease or stream lease is active.

#### Scenario: long stream is protected from ttl eviction
- **WHEN** a runtime is emitting stream deltas for an active turn and the elapsed time exceeds warm TTL
- **THEN** eviction MUST be blocked until stream lease and turn lease are both released

#### Scenario: reconcile loop skips lease-active candidate
- **WHEN** the reconcile loop scans runtime candidates under budget pressure
- **THEN** runtimes with any active lease MUST be excluded from eviction candidates

### Requirement: Reconciler MUST NOT directly terminate runtime processes
The reconcile loop MUST only mark candidates and MUST delegate process termination to the lifecycle coordinator.

#### Scenario: reconcile produces candidate only
- **WHEN** a runtime meets budget/ttl eviction criteria
- **THEN** reconcile MUST record an evict candidate marker and MUST NOT invoke direct stop/kill

#### Scenario: coordinator performs termination with pre-stop recheck
- **WHEN** lifecycle coordinator starts termination for an evict candidate
- **THEN** it MUST re-check active leases before stop and abort termination when lease becomes active

### Requirement: Managed runtime shutdown MUST be tree-safe and unified across exit paths
The system MUST use a unified shutdown path for managed runtimes on reconnect, workspace removal, app exit, and launch-time orphan cleanup.

#### Scenario: app exit drains managed runtimes
- **WHEN** the application begins shutdown
- **THEN** the system MUST stop accepting new runtime acquisitions and drain all managed runtimes through the shared shutdown coordinator

#### Scenario: launch-time orphan sweep cleans stale managed runtime
- **WHEN** the application starts and finds a previously recorded managed runtime that was not cleaned up
- **THEN** the system MUST classify it as an orphan candidate and attempt cleanup before marking startup diagnostics complete

### Requirement: Windows termination MUST preserve process-tree semantics for managed runtimes
The system MUST terminate managed runtimes on Windows using process-tree-safe semantics that account for wrapper and child processes.

#### Scenario: cmd-wrapper runtime is terminated as a tree
- **WHEN** a managed runtime launched from a Windows wrapper chain (`.cmd`, `cmd.exe`, `node`, sandbox) is stopped
- **THEN** the system MUST attempt process-tree termination semantics for the full runtime tree instead of only killing the root handle

#### Scenario: termination result remains diagnosable after tree kill failure
- **WHEN** process-tree termination fails or partially fails on Windows
- **THEN** the system MUST retain runtime diagnostics including pid, wrapper kind, and failure outcome for later inspection

### Requirement: Startup-time node processes MUST be attributable
The system MUST expose enough diagnostics to explain startup-time `node` processes as managed runtime, child resume/runtime helper, or orphan residue.

#### Scenario: startup diagnostics classify visible node processes
- **WHEN** the application finishes startup diagnostics on a machine where multiple `node` processes are visible
- **THEN** the system MUST be able to classify each known startup-time process into a runtime source category instead of leaving it as an unknown process burst

### Requirement: Managed Shutdown Source MUST Be Explicit And Reuse-Safe

The Runtime Orchestrator MUST retain explicit shutdown-source attribution for managed Codex runtime stop paths so reuse, replacement, diagnostics, and recovery can distinguish expected lifecycle cleanup from user-visible interruption.

#### Scenario: shutdown source is recorded before process termination

- **WHEN** the system stops a Codex managed runtime through Runtime Pool close, manual release, replacement cleanup, stale-session cleanup, settings restart, idle eviction, or app exit
- **THEN** the runtime session MUST be marked with a source-specific shutdown attribution before process termination begins
- **AND** later EOF or process-exit diagnostics MUST be able to include that source attribution

#### Scenario: stopping runtime is rejected as reusable foreground target

- **WHEN** a runtime has already been marked for source-specific shutdown
- **AND** a new foreground action needs a Codex runtime for the same workspace
- **THEN** the orchestrator MUST treat the stopping runtime as non-reusable
- **AND** the action MUST acquire or await a fresh successor instead of binding new foreground work to the stopping runtime

#### Scenario: internal replacement cleanup does not clear successor lifecycle evidence

- **WHEN** an old Codex runtime is stopped after a replacement successor has been registered
- **THEN** cleanup of the predecessor MUST NOT erase the successor row's ready state, replacement reason, or stopping-predecessor diagnostics
- **AND** predecessor runtime-ended handling MUST NOT use the successor row's active-work signal to emit a thread-facing diagnostic
- **AND** the stopping-predecessor marker MUST clear only after the predecessor stop path settles or times out

### Requirement: Runtime Pin Intent MUST Survive Row Recreation

The Runtime Orchestrator MUST preserve user pin intent for a `(engine, workspace)` pair independently from the transient runtime row lifecycle.

#### Scenario: pin survives runtime row removal

- **WHEN** a user pins a Codex runtime for a workspace
- **AND** the current runtime row is later removed because the process was stopped or recreated
- **THEN** the orchestrator MUST retain the pin intent for that `(engine, workspace)` pair
- **AND** the next runtime row for the same pair MUST be hydrated as pinned

#### Scenario: unpin clears future row hydration

- **WHEN** a user unpins a `(engine, workspace)` pair
- **THEN** subsequent runtime row creation for that pair MUST NOT reapply the old pin intent

### Requirement: Runtime panel bootstrap MUST preserve launch-time metadata-only restore semantics
The Runtime Orchestrator MUST allow a user-initiated runtime panel bootstrap to request runtime readiness for eligible workspaces without changing the application launch restore policy.

#### Scenario: launch restore still avoids bulk runtime spawn
- **WHEN** the application launches with metadata-only runtime restore enabled
- **THEN** workspace and thread metadata restore MUST NOT bulk-spawn managed runtimes for every visible workspace
- **AND** the runtime panel bootstrap contract MUST NOT change that launch-time behavior

#### Scenario: runtime panel entry is an explicit readiness source
- **WHEN** the user explicitly opens the runtime pool console
- **AND** the client identifies connected workspaces that are eligible for runtime visibility using currently available workspace metadata
- **AND** the initial runtime pool snapshot did not already contain runtime rows
- **THEN** the system MUST allow the client to request runtime readiness through the existing orchestrator acquisition path
- **AND** the orchestrator MUST treat that request as a bounded explicit source rather than launch-time bulk restore

#### Scenario: non-empty snapshot does not request readiness
- **WHEN** the runtime pool console opens on any supported platform
- **AND** the initial runtime pool snapshot already contains one or more runtime rows
- **THEN** the client MUST NOT request runtime readiness solely because the panel opened
- **AND** the orchestrator MUST NOT receive an additional runtime-panel bootstrap request for that initial render

#### Scenario: repeated runtime panel bootstrap remains idempotent
- **WHEN** multiple runtime panel bootstrap attempts target the same engine-workspace pair while startup is already in progress
- **THEN** the orchestrator MUST reuse the existing active runtime or guarded in-flight acquire
- **AND** it MUST NOT spawn a duplicate active runtime for the same engine-workspace pair

#### Scenario: runtime panel bootstrap source is diagnosable
- **WHEN** runtime panel bootstrap initiates or joins runtime acquisition
- **THEN** any runtime row or diagnostic metadata that records recovery source MUST identify the source as runtime-panel bootstrap or an equivalent explicit runtime-console source
- **AND** this diagnostic source MUST NOT be required for the runtime readiness request to remain idempotent

### Requirement: Runtime Execution Telemetry SHALL Be Projectable Into Task Runs

Runtime Orchestrator MUST 能把 thread/runtime 侧执行信号投影为 task-run telemetry，而不成为第二套 task truth source。Kanban execution launch path MUST use existing runtime control paths while recording TaskRun lifecycle boundaries.

#### Scenario: task center consumes runtime execution phases as run projection

- **WHEN** runtime / thread 发出 planning、running、waiting-input、failure 或 completion 相关信号
- **THEN** 系统 SHALL 能将这些信号归一化投影到 task run lifecycle
- **AND** runtime orchestrator 本身 SHALL NOT 被重写为 task-run store

#### Scenario: task-center action routes through existing runtime control path

- **WHEN** 用户在 Task Center 发起 retry、resume 或 cancel
- **THEN** 系统 SHALL 继续复用既有 thread/runtime control path
- **AND** run state SHALL 通过回流的 runtime/thread signal 更新，而不是前端本地伪完成

#### Scenario: kanban launch lifecycle is recorded without new runtime contract

- **WHEN** Kanban execution 通过现有 workspace connect、thread create 与 message send path 启动
- **THEN** 系统 SHALL 记录对应 TaskRun lifecycle boundary
- **AND** 该记录 SHALL NOT require a new Tauri command or Rust runtime store

#### Scenario: processing completion settles active task run

- **WHEN** 某条已绑定 thread 的 active TaskRun 经过 `threadStatusById` 观察到 processing 结束
- **AND** 该 run 之前处于 `planning`、`running` 或 `waiting_input`
- **THEN** 系统 SHALL 将该 run 收敛到合适的 settled state
- **AND** latest output summary、diagnostics 与 artifacts SHALL 从现有 thread timeline observable data 中提取

#### Scenario: task run telemetry remains frontend-first projection

- **WHEN** Task Center 更新 run 的 completion、diagnostics 或 artifact summary
- **THEN** 系统 SHALL 继续基于 frontend 可观察状态 patch 既有 TaskRun store
- **AND** 该更新 SHALL NOT require a new Tauri command or Rust runtime store
