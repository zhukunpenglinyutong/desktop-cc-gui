# git-operations Specification

## Purpose

TBD - created by archiving change git-history-panel. Update Purpose after archive.
## Requirements
### Requirement: Pull Operation

The system SHALL allow pulling remote changes from toolbar, and toolbar pull SHALL be confirmation-first with
configurable options.

#### Scenario: Execute pull from toolbar

- **WHEN** user clicks `Pull` in toolbar and confirms in pull dialog
- **THEN** system SHALL execute pull using configured options

#### Scenario: Pull options mapping

- **WHEN** user confirms pull dialog
- **THEN** system SHALL map selected options to pull execution:
    - `remote`
    - `target remote branch`
    - strategy option (`--rebase` or `--ff-only` or `--no-ff` or `--squash`)
    - additive options (`--no-commit`, `--no-verify`)

#### Scenario: Strategy option conflict guard

- **WHEN** pull request payload includes more than one strategy option
- **THEN** system SHALL reject request before Git execution
- **AND** system SHALL return readable validation error

#### Scenario: Backward compatibility

- **WHEN** pull is triggered without explicit options
- **THEN** system SHALL preserve existing default pull behavior

#### Scenario: Pull success

- **WHEN** pull succeeds
- **THEN** system SHALL show success notification
- **AND** system SHALL refresh history and branch indicators

#### Scenario: Pull conflict

- **WHEN** pull produces conflicts
- **THEN** system SHALL show conflict error
- **AND** system SHALL keep operation in failed state with retry guidance

### Requirement: Push Operation

The system SHALL allow pushing local commits from toolbar and branch context menu, and toolbar push SHALL be
confirmation-first with configurable options.

#### Scenario: Execute push from toolbar

- **WHEN** user clicks `Push` in toolbar and confirms in push dialog
- **THEN** system SHALL execute push using configured options

#### Scenario: Push options mapping

- **WHEN** user confirms push dialog
- **THEN** system SHALL map selected options to push execution:
    - `remote`
    - `target remote branch`
    - `pushTags`
    - `runHooks`
    - `forceWithLease`
    - `pushToGerrit`
    - `topic/reviewers/cc` (when Gerrit enabled)

#### Scenario: Query outgoing commits for push preview

- **WHEN** push dialog requests preview with `source branch` and target `remote:branch`
- **THEN** system SHALL return commits reachable from source branch HEAD and not yet contained in target ref
- **AND** each entry SHALL include fields required for list rendering (sha, summary, author, time)

#### Scenario: Target ref missing indicator for first push

- **WHEN** target `remote:branch` cannot be resolved in local remote refs
- **THEN** preview response SHALL set `targetFound=false`
- **AND** client MAY switch to new-branch first-push presentation mode based on this flag

#### Scenario: Query selected outgoing commit details

- **WHEN** user selects a commit in push preview
- **THEN** system SHALL provide commit detail payload (message + changed files + file-level diff summary)
- **AND** this query SHALL be independent from push execution itself

#### Scenario: Gerrit push refspec

- **WHEN** `pushToGerrit` is enabled
- **THEN** system SHALL push to `refs/for/<branch>`
- **AND** optional `topic/reviewers/cc` SHALL be appended as Gerrit push options

#### Scenario: Backward compatibility

- **WHEN** push is triggered without explicit options
- **THEN** system SHALL preserve existing default push behavior

#### Scenario: Push rejected

- **WHEN** push is non-fast-forward rejected
- **THEN** system SHALL show `Push rejected` error
- **AND** system SHALL recommend pull or rebase workflow

### Requirement: Sync and Fetch Operations

The system SHALL provide `Sync` and `Fetch` actions, and both actions SHALL be confirmation-first from toolbar.

#### Scenario: Execute sync from toolbar

- **WHEN** user clicks `Sync` and confirms in sync dialog
- **THEN** system performs pull then conditional push and reports final status

#### Scenario: Sync intent semantics

- **WHEN** sync dialog is open
- **THEN** system SHALL describe sync as `pull -> push` combined workflow
- **AND** system SHALL not execute either step until user confirms

#### Scenario: Execute fetch from toolbar

- **WHEN** user clicks `Fetch` and confirms in fetch dialog
- **THEN** system fetches remotes without merge and refreshes ahead/behind indicators

#### Scenario: Fetch intent semantics

- **WHEN** fetch dialog is open
- **THEN** system SHALL describe fetch as remote reference update without merge
- **AND** system SHALL not execute fetch until user confirms

#### Scenario: Fetch scope default

- **WHEN** user confirms fetch dialog without custom scope override
- **THEN** system SHALL execute fetch with default scope `all remotes`

### Requirement: Cherry-Pick and Revert

The system SHALL support commit-level write actions from history context.

#### Scenario: Cherry-pick commit

- **WHEN** user executes `Cherry-Pick` on commit
- **THEN** system runs cherry-pick and refreshes history on success

#### Scenario: Revert commit confirmation

- **WHEN** user executes `Revert Commit`
- **THEN** system asks confirmation before creating revert commit

#### Scenario: Action conflict

- **WHEN** cherry-pick or revert causes conflict
- **THEN** system shows conflict error with next-step guidance

---

### Requirement: Operation Progress and Locking

The system SHALL provide clear progress state and avoid conflicting parallel writes.

#### Scenario: Disable conflicting actions

- **WHEN** one write operation is running in same workspace
- **THEN** pull/push/sync/cherry-pick/revert/reset buttons are disabled

#### Scenario: Progress state

- **WHEN** operation is in progress
- **THEN** toolbar shows spinner and status text

### Requirement: Retry and Error Detail

The system SHALL support retry and controlled error details.

#### Scenario: Retry failed action

- **WHEN** operation fails and is retryable
- **THEN** notification offers `Retry`

#### Scenario: Copy error details

- **WHEN** user clicks `Copy Details`
- **THEN** system copies sanitized debug message

---

### Requirement: Cancellation Semantics

The system SHALL support cancellation at request level for long-running operations.

#### Scenario: Cancel in-progress request

- **WHEN** user clicks `Cancel` in operation status
- **THEN** UI stops waiting and marks request cancelled

#### Scenario: Ignore stale completion

- **WHEN** a cancelled request completes later in backend
- **THEN** stale response SHALL NOT override latest UI state

---

### Requirement: Keyboard Shortcuts

The system SHALL provide optional shortcuts for core operations.

#### Scenario: Pull shortcut

- **WHEN** user presses `Cmd/Ctrl + Shift + P` and panel focus is active
- **THEN** pull operation is triggered

#### Scenario: Push shortcut

- **WHEN** user presses `Cmd/Ctrl + Shift + U` and panel focus is active
- **THEN** push operation is triggered

#### Scenario: Sync shortcut

- **WHEN** user presses `Cmd/Ctrl + Shift + S` and panel focus is active
- **THEN** sync operation is triggered

#### Scenario: Fetch shortcut

- **WHEN** user presses `Cmd/Ctrl + Shift + F` and panel focus is active
- **THEN** fetch operation is triggered

### Requirement: Update Operation from Branch Context Menu

The system SHALL provide `更新 (Update)` action in branch context menu for local branches and SHALL preserve current
branch update compatibility while supporting safe background update for non-current tracked local branches.

#### Scenario: Update current branch from context menu

- **WHEN** user triggers `更新 (Update)` on current local branch
- **THEN** system SHALL execute update workflow for the active branch
- **AND** system SHALL show in-progress and completion feedback

#### Scenario: Update non-current tracked local branch without checkout

- **WHEN** user triggers `更新 (Update)` on a non-current local branch with valid upstream tracking
- **THEN** system SHALL update the target local branch without switching current `HEAD`
- **AND** system SHALL NOT modify current working tree files
- **AND** system SHALL refresh branch tracking status after update completes

#### Scenario: Background update uses fast-forward only

- **WHEN** user triggers `更新 (Update)` on a non-current local branch that is behind its upstream and has no local-only commits
- **THEN** system SHALL fetch the upstream reference first
- **AND** system SHALL fast-forward the local branch ref to the fetched upstream commit
- **AND** system SHALL use expected-old commit comparison when writing the local branch ref
- **AND** system SHALL report success only after the target local branch ref has advanced

#### Scenario: Stale local ref blocks background update

- **WHEN** user triggers `更新 (Update)` on a non-current local branch
- **AND** the target local branch ref changes after relation check but before ref write
- **THEN** system SHALL block the background update
- **AND** system SHALL NOT overwrite the newer local branch ref
- **AND** system SHALL show readable feedback that branch state changed and user should refresh or retry

#### Scenario: Remote branch update preserves fetch-only semantics

- **WHEN** user triggers `更新 (Update)` on a remote branch row
- **THEN** system SHALL fetch the corresponding remote
- **AND** system SHALL NOT merge into any local branch
- **AND** system SHALL NOT move any local branch ref

#### Scenario: Branch update implementation is platform-compatible

- **WHEN** system executes Git commands for branch update
- **THEN** system SHALL pass branch names, remote names, ref names, and paths as structured command arguments rather than shell-concatenated strings
- **AND** system SHALL avoid POSIX-only path assumptions so the same update behavior is valid on macOS and Windows

#### Scenario: Branch already up to date

- **WHEN** user triggers `更新 (Update)` on a non-current local branch and the local branch already matches its upstream
- **THEN** system SHALL return a no-op result
- **AND** system SHALL show readable feedback that no update is required

#### Scenario: Local branch is ahead of upstream only

- **WHEN** user triggers `更新 (Update)` on a non-current local branch that has local-only commits and is not behind upstream
- **THEN** system SHALL return a no-op result
- **AND** system SHALL show readable feedback that the branch is already ahead or does not require remote update

#### Scenario: Diverged branch is blocked from background update

- **WHEN** user triggers `更新 (Update)` on a non-current local branch that is both ahead of and behind its upstream
- **THEN** system SHALL block background update
- **AND** system SHALL show guidance that user must checkout that branch and resolve merge or rebase manually

#### Scenario: Branch occupied by another worktree is blocked

- **WHEN** user triggers `更新 (Update)` on a non-current local branch that is currently checked out by another worktree
- **THEN** system SHALL block background update
- **AND** system SHALL show readable guidance identifying that another worktree is using the branch

#### Scenario: Update unavailable branch state

- **WHEN** selected local branch has no valid update path (for example no tracking configuration)
- **THEN** system SHALL disable `更新 (Update)` action
- **AND** system SHALL provide readable reason hint

#### Scenario: Update failure feedback

- **WHEN** update execution fails because fetch, authentication, network, or Git command execution fails
- **THEN** system SHALL show user-facing failure reason
- **AND** system SHALL keep retry entry available when error is retryable

### Requirement: Branch Comparison Query

The system SHALL provide directional commit-set queries for branch-to-branch comparison (IDEA-style compare workspace).

#### Scenario: Query target-only commits

- **WHEN** compare action is triggered with `target` and `current`
- **THEN** system SHALL return commits reachable from `target` but not from `current`
- **AND** each entry SHALL include commit identity and basic metadata needed for list rendering

#### Scenario: Query current-only commits

- **WHEN** compare action is triggered with `target` and `current`
- **THEN** system SHALL return commits reachable from `current` but not from `target`
- **AND** each entry SHALL include commit identity and basic metadata needed for list rendering

#### Scenario: Query selected commit details

- **WHEN** user selects a commit in either direction list
- **THEN** system SHALL return detail payload for that commit (summary + changed files + per-file diff preview data)
- **AND** detail loading SHALL be independent from the other direction list

### Requirement: Reset Current Branch to Selected Commit

The system SHALL support resetting the current branch HEAD to a selected commit from commit history entry points.

#### Scenario: Open reset dialog

- **WHEN** user triggers `Reset Current Branch to Here...`
- **THEN** system SHALL open a confirmation dialog with branch name, target short hash, subject, and author
- **AND** dialog SHALL provide reset modes `soft`, `mixed`, `hard`, and `keep`
- **AND** default selected mode SHALL be `mixed`

#### Scenario: Confirm mixed reset

- **WHEN** user confirms reset with mode `mixed`
- **THEN** system SHALL move current branch HEAD to selected commit
- **AND** system SHALL reset index to target commit state
- **AND** system SHALL keep working tree file content

#### Scenario: Confirm hard reset

- **WHEN** user confirms reset with mode `hard`
- **THEN** system SHALL show destructive warning before execution
- **AND** on final confirm system SHALL reset HEAD, index, and working tree to target commit

#### Scenario: Confirm keep reset

- **WHEN** user confirms reset with mode `keep`
- **THEN** system SHALL attempt to move HEAD while preserving local modifications
- **AND** if preservation cannot be guaranteed system SHALL fail with readable guidance

#### Scenario: Reset failure feedback

- **WHEN** reset command fails
- **THEN** system SHALL show readable failure reason
- **AND** system SHALL provide retry entry without forcing panel reload

### Requirement: Non-Interactive Execution and Timeout Guard for Network Git Commands

The system SHALL execute `pull`, `sync`, and `fetch` with non-interactive command environment and bounded timeout to
prevent hidden credential prompts from blocking indefinitely.

#### Scenario: Pull runs with bounded timeout

- **WHEN** user confirms `Pull`
- **THEN** backend SHALL run pull in non-interactive mode
- **AND** backend SHALL fail the command when timeout threshold is reached

#### Scenario: Sync and fetch run with bounded timeout

- **WHEN** user confirms `Sync` or `Fetch`
- **THEN** backend SHALL run the network Git command in non-interactive mode
- **AND** backend SHALL fail the command when timeout threshold is reached

#### Scenario: Timeout failure is actionable

- **WHEN** command fails due to timeout or authentication interaction requirement
- **THEN** system SHALL return stable error type for i18n mapping
- **AND** UI SHALL show retry guidance instead of generic unknown error

### Requirement: Workspace Lock Release Before Long-Running Network Git Commands

The system SHALL release workspace-level lock before launching long-running network Git operations to reduce lock
contention.

#### Scenario: Pull/sync/fetch avoids lock amplification

- **WHEN** backend is about to execute long-running `pull`, `sync`, or `fetch`
- **THEN** workspace lock SHALL NOT be held for the full external command lifetime
- **AND** subsequent operations SHALL observe reduced blocked-wait time compared with holding lock throughout

### Requirement: PR Workflow Backend Contract

The system SHALL provide stable backend contracts for PR defaults detection and workflow execution.

#### Scenario: Detect defaults from repository context

- **WHEN** client requests PR defaults
- **THEN** backend SHALL return upstream/base/head/title/body/comment defaults
- **AND** backend SHALL return `canCreate` and `disabledReason` for UI gating

#### Scenario: Execute workflow with deterministic stage contract

- **WHEN** client starts PR workflow
- **THEN** backend SHALL return stage-based result for `precheck/push/create/comment`
- **AND** stage status SHALL use normalized values (`pending/running/success/failed/skipped`)

### Requirement: Token Isolation and Transport Fallback

The workflow SHALL apply command execution hardening for Git/GitHub CLI calls.

#### Scenario: Token-isolated command execution

- **WHEN** workflow invokes git/gh commands
- **THEN** commands SHALL run with token-isolated environment (`env -u GH_TOKEN -u GITHUB_TOKEN`)
- **AND** command output SHALL be available for diagnostic summary

#### Scenario: HTTP2 push failure fallback

- **WHEN** push fails with HTTP2 framing or equivalent transport signatures
- **THEN** workflow SHALL retry once with `http.version=HTTP/1.1`
- **AND** retry outcome SHALL be reflected in push stage detail

### Requirement: Preconditions and Range Gate

The workflow SHALL validate operational readiness before PR creation.

#### Scenario: GitHub CLI readiness

- **WHEN** workflow enters precheck stage
- **THEN** backend SHALL verify `gh --version` and `gh auth status`
- **AND** readiness failure SHALL return actionable message, not generic unknown error

#### Scenario: Upstream range gate

- **WHEN** workflow validates diff scope
- **THEN** backend SHALL evaluate `upstream/<base>...HEAD`
- **AND** abnormal scope SHALL block workflow before create stage with clear guidance

