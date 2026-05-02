# runtime-pool-console Specification

## Purpose
TBD - created by archiving change runtime-orchestrator-pool-console. Update Purpose after archive.
## Requirements
### Requirement: Settings MUST expose a runtime pool console

The system MUST provide a settings tab under `运行环境 -> Runtime 池` that exposes the current runtime pool state and runtime budget configuration.

#### Scenario: runtime pool console lives under runtime environment tabs
- **WHEN** the user browses the Settings sidebar
- **THEN** the system MUST show the `运行环境` parent entry
- **AND** the system MUST NOT show an independent `Runtime 池` top-level entry

#### Scenario: settings shows engine pool summary
- **WHEN** the user opens `运行环境 -> Runtime 池`
- **THEN** the panel MUST display current managed runtime counts by engine and the configured runtime budget values

#### Scenario: settings shows runtime instance rows
- **WHEN** the runtime pool console renders managed runtime entries
- **THEN** each row MUST display workspace identity, engine, lifecycle state, and lease source information

### Requirement: Runtime pool console MUST surface process diagnostics for managed runtimes

The runtime pool console MUST expose enough continuity diagnostics to explain whether a Codex runtime is truly executing resumed work, merely retained, stalled while waiting for fusion continuation to settle, or recently stalled after a `resume-pending` timeout has already been settled.

#### Scenario: runtime row distinguishes stalled fusion continuation from retained idle

- **WHEN** a runtime has no current turn or stream lease
- **AND** the same `workspace + engine` still has a queue-fusion continuation in pending or stalled foreground continuity
- **THEN** the runtime pool console MUST expose that row as stalled foreground continuation rather than plain idle or generic retained busy
- **AND** the row MUST show the stalled continuation reason separately from pinned / warm retention metadata

#### Scenario: runtime row clears stalled fusion continuity after terminal settlement

- **WHEN** the corresponding fusion continuation later receives completed, error, runtime-ended, or equivalent terminal settlement
- **THEN** the runtime pool console MUST clear the stalled fusion continuity marker
- **AND** the row MUST converge to the ordinary settled runtime state without stale busy residue

#### Scenario: runtime row releases current active-work protection after resume-pending timeout

- **WHEN** a Codex runtime row was protected only by a `resume-pending` foreground continuity chain
- **AND** that chain has already been settled into stalled / degraded due to timeout
- **THEN** the runtime pool console MUST stop representing the row as current active-work protected or current `resume-pending`
- **AND** the row MUST fall back to ordinary settled / retained classification according to remaining leases and retention rules

#### Scenario: recent stalled timeout remains visible after current protection is released

- **WHEN** a Codex runtime row is no longer current active-work protected because `resume-pending` timeout settlement has completed
- **THEN** the console MUST still expose recent stalled timeout evidence for that chain
- **AND** that evidence MUST remain semantically distinct from current busy / active-work protection

### Requirement: Runtime pool console MUST allow controlled manual intervention
The system MUST allow users to manually intervene in idle or retained managed runtimes from the runtime pool console.

#### Scenario: user closes idle runtime
- **WHEN** the user triggers close on a non-busy managed runtime
- **THEN** the system MUST stop that runtime through the managed shutdown path and refresh the pool snapshot

#### Scenario: busy runtime close requires confirmation
- **WHEN** the user triggers close on a busy managed runtime
- **THEN** the system MUST require explicit confirmation before attempting shutdown

#### Scenario: user pins runtime without duplicating instance
- **WHEN** the user marks a runtime as pinned
- **THEN** the system MUST retain that runtime under the pinned policy without spawning a duplicate runtime for the same `(engine, workspace)`

### Requirement: Runtime pool console MUST allow budget and retention tuning
The settings surface MUST allow users to configure runtime budget and retention parameters for managed runtimes without changing the survival contract of actively protected work.

#### Scenario: user adjusts runtime budget
- **WHEN** the user changes the configured hot or warm runtime budget
- **THEN** the system MUST persist the new budget and apply it to subsequent runtime orchestration decisions

#### Scenario: reducing budget does not clone or instantly duplicate runtimes
- **WHEN** the user lowers a runtime budget value
- **THEN** the system MUST apply the new limit through orchestrator eviction/release rules instead of creating new runtime instances

#### Scenario: user adjusts warm ttl
- **WHEN** the user updates the warm retention TTL in the runtime pool console
- **THEN** the system MUST persist the new TTL and use it for subsequent cooling decisions

#### Scenario: warm ttl never overrides an active lease

- **WHEN** a managed runtime still has an active turn lease or stream lease
- **THEN** warm retention TTL and budget overflow rules MUST NOT evict that runtime
- **AND** the console MUST continue to represent the runtime as active-work protected rather than merely warm

### Requirement: Runtime pool console MUST expose restore and cleanup policy toggles
The settings surface MUST expose the key lifecycle policy toggles that affect runtime startup and shutdown behavior.

#### Scenario: user enables restore metadata without runtime restore
- **WHEN** the user selects the policy to restore workspace/thread metadata without restoring runtimes
- **THEN** the system MUST preserve UI/session restore behavior while leaving managed runtime acquisition to explicit runtime-required actions

#### Scenario: user enables orphan sweep on launch
- **WHEN** the user enables orphan sweep on launch
- **THEN** the system MUST attempt launch-time cleanup of recorded stale managed runtimes before the next pool snapshot is marked complete

### Requirement: Runtime Process Diagnostics MUST Not Block Claude Stream Hot Paths

The runtime diagnostics contract MUST allow bounded stale process information so user-visible Claude streaming remains low latency.

#### Scenario: Claude stream path does not wait for process diagnostics freshness
- **WHEN** a Claude realtime stream delta is being forwarded
- **THEN** runtime pool process diagnostics freshness MUST NOT be required before the stream delta is delivered
- **AND** the runtime row MAY temporarily retain the previous diagnostics snapshot while background refresh continues

#### Scenario: runtime row still shows active work while diagnostics refresh is pending
- **WHEN** a Claude runtime has active turn or stream protection
- **AND** process diagnostics refresh is pending, stale, or timed out
- **THEN** the runtime pool console MUST still represent the runtime as active-work protected
- **AND** stale process diagnostics MUST NOT cause the row to appear idle or evictable

#### Scenario: diagnostics freshness is observable without forcing synchronous refresh
- **WHEN** runtime pool console displays process diagnostics that came from cache, stale fallback, or timeout fallback
- **THEN** operators MUST have traceable freshness evidence through diagnostics metadata, runtime logs, or equivalent surface
- **AND** opening the console MUST NOT force Claude stream delta delivery to wait for a full Windows process snapshot

#### Scenario: Claude wrapper launch risk is diagnosable without becoming a stream prerequisite
- **WHEN** Claude launch metadata is already available from CLI resolution, command construction, or runtime row state
- **AND** the runtime was launched through a Windows wrapper such as `.cmd` or `.bat`, or with hidden-console process flags
- **THEN** runtime diagnostics MUST expose the available launch evidence such as `resolved_bin`, `wrapper_kind`, launch path classification, or hidden-console risk metadata
- **AND** the system MUST NOT run additional synchronous CLI probing or process-tree probing from the stream hot path solely to fill this wrapper metadata
- **AND** missing wrapper evidence MUST degrade to unknown diagnostics rather than changing runtime active-work protection

### Requirement: Runtime Pool Manual Intervention MUST Preserve Shutdown Attribution

Runtime Pool actions MUST distinguish explicit user intervention from internal runtime cleanup so diagnostics and reconnect-card eligibility remain accurate.

#### Scenario: user close is attributed as user manual shutdown

- **WHEN** the user closes a Codex runtime from Runtime Pool
- **THEN** the stop path MUST attribute the shutdown as user-requested manual intervention
- **AND** if that close interrupts active foreground work, the resulting diagnostic MUST remain eligible for recoverable reconnect or resend UI

#### Scenario: release to cold is attributed separately from replacement cleanup

- **WHEN** the user releases a Codex runtime to cold from Runtime Pool
- **THEN** the stop path MUST preserve a manual release attribution distinct from internal replacement or stale-session cleanup
- **AND** Runtime Pool diagnostics MUST be able to show that the stop came from manual release when exit evidence is recorded

#### Scenario: pin controls intent not only live row state

- **WHEN** the user pins or unpins a runtime from Runtime Pool
- **THEN** that action MUST update the orchestrator's pin intent for the `(engine, workspace)` pair
- **AND** the visible row MUST reflect the current pin intent after runtime removal and recreation

### Requirement: Runtime pool console MUST distinguish bootstrap-in-progress from true empty state
The runtime pool console MUST NOT present an empty runtime snapshot as a stable empty state until initial snapshot loading, runtime visibility bootstrap, and any bounded fallback refresh have settled.

#### Scenario: existing runtime rows render without bootstrap
- **WHEN** the user opens the runtime pool console on any supported platform
- **AND** the initial runtime pool snapshot contains one or more rows
- **THEN** the console MUST render those rows immediately after snapshot loading
- **AND** it MUST NOT trigger runtime visibility bootstrap or fallback refresh for that initial render

#### Scenario: initial runtime snapshot is empty during bootstrap
- **WHEN** the user opens the runtime pool console
- **AND** the first runtime pool snapshot contains no rows
- **AND** runtime visibility bootstrap is still pending
- **THEN** the console MUST present a transient loading or bootstrap state
- **AND** the console MUST NOT present the empty runtime message as final truth

#### Scenario: bootstrap eventually surfaces runtime rows
- **WHEN** the initial snapshot is empty
- **AND** the runtime visibility bootstrap or bounded fallback refresh later returns one or more runtime rows
- **THEN** the console MUST render those rows
- **AND** the console MUST clear the transient empty/loading state

#### Scenario: empty state is shown only after bootstrap settles
- **WHEN** runtime visibility bootstrap has completed or was skipped because no eligible workspace exists
- **AND** the bounded fallback refresh has completed or was not needed
- **AND** the latest runtime pool snapshot still contains no rows
- **THEN** the console MUST present the true empty state

#### Scenario: unmount cancels pending fallback refresh
- **WHEN** the user leaves the runtime pool console while bootstrap or fallback refresh is pending
- **THEN** the console MUST cancel timers or ignore late async completions
- **AND** it MUST NOT update unmounted React state

### Requirement: Runtime pool console MUST bound initial refresh fallback
The runtime pool console MUST use bounded fallback refresh only as a short initial-load tail-latency guard, not as a permanent polling mechanism.

#### Scenario: fallback refresh stops after runtime row appears
- **WHEN** bootstrap has completed
- **AND** fallback refresh is running because the latest snapshot is empty
- **AND** a later fallback snapshot contains one or more rows
- **THEN** the console MUST stop the fallback refresh loop
- **AND** the console MUST render the returned runtime rows

#### Scenario: fallback refresh stops after maximum attempts
- **WHEN** bootstrap has completed
- **AND** every fallback refresh attempt returns an empty snapshot
- **THEN** the console MUST stop fallback refresh after the configured bounded attempt limit
- **AND** the console MUST present the true empty state

#### Scenario: manual refresh remains independent
- **WHEN** the user triggers the runtime pool refresh action manually
- **THEN** the console MUST perform a snapshot refresh without starting an unbounded bootstrap loop
- **AND** manual refresh MUST NOT bypass the initial bootstrap in-flight guard

### Requirement: Runtime pool console initial-load fix MUST preserve cross-platform compatibility
The runtime pool console MUST implement initial-load bootstrap as a platform-compatible fallback path that preserves existing successful snapshot rendering on macOS, Linux, and Windows.

#### Scenario: non-Windows non-empty snapshot is unaffected
- **WHEN** the runtime pool console opens on macOS or Linux
- **AND** the initial snapshot contains one or more runtime rows
- **THEN** the console MUST preserve the existing direct row rendering behavior
- **AND** it MUST NOT delay the first render behind runtime readiness bootstrap

#### Scenario: platform differences do not change empty-state contract
- **WHEN** the runtime pool console opens on any supported platform
- **AND** the initial snapshot is empty
- **THEN** the console MUST apply the same bounded bootstrap and true-empty-state contract
- **AND** the implementation MUST NOT rely on a Windows-only frontend code path to decide whether an empty state is final

