# git-operations Specification Delta

## MODIFIED Requirements

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
