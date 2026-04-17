## MODIFIED Requirements

### Requirement: Claude Child Process Termination MUST Be Cross-Platform and Tree-Safe
Managed runtime termination MUST use a unified child termination primitive that is deterministic across platforms, safe for already-exited processes, and reusable by the broader runtime shutdown coordinator.

#### Scenario: already-exited child is treated as no-op
- **WHEN** termination is requested for a managed child process that has already exited
- **THEN** runtime MUST return success without forcing extra kill attempts
- **AND** runtime MUST avoid reporting false failure for this path

#### Scenario: windows termination cleans process tree
- **WHEN** runtime terminates a managed child process on Windows
- **THEN** runtime MUST attempt process-tree termination semantics (equivalent to `taskkill /T /F`)
- **AND** runtime MUST wait for process completion or return diagnosable failure

#### Scenario: non-windows or fallback path remains deterministic
- **WHEN** runtime executes non-Windows termination or Windows fallback
- **THEN** runtime MUST perform kill + wait semantics deterministically
- **AND** failure result MUST include actionable error text

#### Scenario: shutdown coordinator reuses shared termination primitive
- **WHEN** the application shutdown coordinator drains managed runtimes during exit or orphan cleanup
- **THEN** it MUST reuse the same cross-platform tree-safe termination primitive instead of inventing a separate ad-hoc stop path
