# git-branch-management Specification

## Purpose

TBD - created by archiving change git-history-panel. Update Purpose after archive.
## Requirements
### Requirement: Hierarchical Branch List

The system SHALL display local and remote branches in a grouped hierarchy.

#### Scenario: Local branches first

- **WHEN** panel opens
- **THEN** local branches are listed before remote branches

#### Scenario: Remote grouping

- **WHEN** remote branches are displayed
- **THEN** branches are grouped by remote name (for example `origin/*`, `upstream/*`)

#### Scenario: Current branch indicator

- **WHEN** list is rendered
- **THEN** current branch is highlighted with clear visual marker

---

### Requirement: Ahead/Behind Indicators

The system SHALL show ahead/behind status for tracking branches.

#### Scenario: Ahead

- **WHEN** local branch has unpushed commits
- **THEN** branch row displays `↑<count>`

#### Scenario: Behind

- **WHEN** local branch is behind remote
- **THEN** branch row displays `↓<count>`

#### Scenario: Diverged

- **WHEN** branch is both ahead and behind
- **THEN** branch row displays both indicators

---

### Requirement: Branch Checkout with Dirty-Tree Protection

The system SHALL support branch checkout with explicit handling for uncommitted changes and SHALL guarantee deterministic
clean-state results after successful checkout from a clean workspace.

#### Scenario: Clean checkout keeps repository clean

- **WHEN** working tree is clean and user selects another branch
- **THEN** system SHALL execute checkout and update current branch indicator
- **AND** post-checkout `git status` SHALL contain no staged or unstaged entries

#### Scenario: Dirty checkout is blocked with guidance

- **WHEN** user attempts checkout with uncommitted changes
- **THEN** system SHALL block checkout before switching current branch indicator
- **AND** system SHALL show explicit guidance to commit/stash/discard changes first
- **AND** system SHALL NOT report operation success

#### Scenario: Checkout failure is not reported as success

- **WHEN** checkout fails
- **THEN** system SHALL show user-friendly error and optional debug details
- **AND** current branch indicator SHALL remain source branch
- **AND** system SHALL NOT report operation success

#### Scenario: Branch switching does not accumulate residual diffs

- **WHEN** user repeatedly switches between two clean branches with divergent file sets
- **THEN** every successful checkout SHALL end with a clean working tree
- **AND** system SHALL NOT leave residual staged or unstaged entries from the previous branch

---

### Requirement: Create Branch from Current or Selected Commit

The system SHALL support branch creation from explicit and user-visible source references only.

#### Scenario: Create from current HEAD

- **WHEN** user chooses `New Branch` in branch list context
- **THEN** system prompts for branch name and shows source reference as current `HEAD`
- **AND** system creates the branch only after explicit confirmation of source reference

#### Scenario: Create from selected commit

- **WHEN** user chooses `Create Branch from Here` on commit row
- **THEN** system prompts for branch name and creates branch at selected commit

#### Scenario: Branch name validation

- **WHEN** user inputs an invalid branch name
- **THEN** system rejects the input using Git ref format rules and shows validation message

#### Scenario: Prevent implicit source fallback

- **WHEN** source reference is unavailable or cannot be resolved
- **THEN** system blocks branch creation
- **AND** system SHALL NOT fallback to an implicit reference

### Requirement: Branch Rename and Delete

The system SHALL support rename/delete for local branches with safety guards.

#### Scenario: Rename local branch

- **WHEN** user selects `Rename Branch`
- **THEN** system prompts for new name and updates branch list on success

#### Scenario: Prevent deleting current branch

- **WHEN** user tries to delete current branch
- **THEN** system blocks action and shows error

#### Scenario: Delete unmerged branch

- **WHEN** user deletes branch with unmerged commits
- **THEN** system shows warning confirmation before force delete

---

### Requirement: Branch Merge Action

The system SHALL support merging a selected branch into current branch.

#### Scenario: Merge success

- **WHEN** merge completes successfully
- **THEN** system refreshes history and shows success notification

#### Scenario: Merge conflict

- **WHEN** merge has conflicts
- **THEN** system shows conflict notification and guides user to conflict resolution workflow

---

### Requirement: Branch Context Menus

The system SHALL provide right-click context actions with deterministic order, grouped presentation, and
branch-type-aware availability.

#### Scenario: Local branch menu order

- **WHEN** user right-clicks a local branch row
- **THEN** menu top SHALL display a read-only tracking summary in format `<local-branch> -> <upstream-branch>`
- **AND** `签出 (Checkout)` SHALL be the first actionable menu item
- **AND** menu SHALL include the following groups in order:
    - `从 '<branch>' 新建分支...`
    - `签出并变基到 '<current>'`
    - `与 '<current>' 比较`
    - `显示与工作树的差异`
    - `将 '<current>' 变基到 '<branch>'`
    - `将 '<branch>' 合并到 '<current>' 中`
    - `更新 (Update)`
    - `推送... (Push)`
    - `重命名...`
    - `删除`

#### Scenario: Local branch without upstream tracking

- **WHEN** user right-clicks a local branch row that has no upstream
- **THEN** menu top tracking summary SHALL render `<local-branch> -> (未设置上游分支)`
- **AND** system SHALL NOT leave tracking summary blank

#### Scenario: Tracking summary is non-actionable

- **WHEN** context menu is open
- **THEN** tracking summary row SHALL be read-only and non-clickable
- **AND** keyboard action focus SHALL start from `签出 (Checkout)`

#### Scenario: Compare with current branch produces visible result

- **WHEN** user clicks `与 '<current>' 比较` on a local branch menu
- **THEN** system SHALL open a branch comparison workspace (IDEA-style)
- **AND** workspace SHALL show two directional commit lists:
    - `target \ current`
    - `current \ target`
- **AND** compare action SHALL NOT degrade to only changing selected branch state

#### Scenario: Compare action is effective when branch already selected

- **WHEN** target branch is already selected in branch list
- **AND** user clicks `与 '<current>' 比较`
- **THEN** system SHALL still present compare results
- **AND** user SHALL receive visible feedback instead of a no-op

#### Scenario: Select commit in compare workspace

- **WHEN** user selects a commit from either directional list
- **THEN** system SHALL show commit summary and changed files for that commit
- **AND** details SHALL correspond to the selected side and selected commit

#### Scenario: Open single-file change preview from compare details

- **WHEN** user clicks one changed file in selected commit details
- **THEN** system SHALL open a single-file diff preview dialog
- **AND** preview content SHALL correspond to selected commit and selected file
- **AND** closing preview SHALL return to compare workspace without resetting selected commit

#### Scenario: Directional list empty state

- **WHEN** one comparison direction has no exclusive commits
- **THEN** system SHALL show explicit empty-state text for that direction
- **AND** the opposite direction (if non-empty) SHALL still be fully browsable

#### Scenario: Current branch guardrails

- **WHEN** user right-clicks the current branch row
- **THEN** `Checkout` action SHALL be disabled
- **AND** `删除` action SHALL be disabled
- **AND** disabled actions SHALL present readable reason hints

#### Scenario: Tracked non-current local branch exposes update action

- **WHEN** user right-clicks a non-current local branch row with valid upstream tracking
- **THEN** `更新 (Update)` action SHALL be enabled when no conflicting workspace-level operation is running
- **AND** selecting that action SHALL target the chosen local branch instead of the current branch

#### Scenario: Non-current local branch without upstream disables update

- **WHEN** user right-clicks a non-current local branch row without upstream tracking
- **THEN** `更新 (Update)` action SHALL be disabled
- **AND** disabled reason SHALL explain that no upstream branch is configured

#### Scenario: Remote branch context actions

- **WHEN** user right-clicks a remote branch row
- **THEN** menu SHALL only include actions valid for remote branches
- **AND** actions requiring local writable branch state SHALL be hidden or disabled

#### Scenario: Remote branch update action fetches remote only

- **WHEN** user right-clicks a remote branch row with a resolvable remote name
- **THEN** `更新 (Update)` action SHALL remain available when no conflicting workspace-level operation is running
- **AND** selecting that action SHALL fetch the corresponding remote instead of updating the current local branch

#### Scenario: Menu accessibility and dismissal

- **WHEN** context menu is open
- **THEN** user SHALL be able to navigate actions via keyboard
- **AND** pressing `Esc` SHALL close the menu without side effects

### Requirement: Fetch Action in Branch Context

The system SHALL support fetching branch metadata without merge.

#### Scenario: Fetch all remotes

- **WHEN** user clicks `Fetch` in branch area toolbar
- **THEN** system executes fetch and refreshes remote branch state

#### Scenario: Fetch specific remote

- **WHEN** user triggers `Fetch` on a remote group
- **THEN** system fetches only that remote and updates affected branches

### Requirement: Branch Row Actions Are Context-Menu First

The system SHALL remove persistent row-end branch action buttons and expose branch actions through a context menu entry
point.

#### Scenario: Branch row renders without inline checkout button

- **WHEN** branch list is rendered
- **THEN** each branch row SHALL NOT display a persistent `checkout` button
- **AND** branch name, branch state badges, and ahead/behind indicators remain visible

#### Scenario: Right-click opens branch action menu

- **WHEN** user right-clicks a branch row
- **THEN** system SHALL open the branch context menu anchored to pointer position

#### Scenario: Left-click keeps selection behavior

- **WHEN** user left-clicks a branch row
- **THEN** system SHALL keep existing selection/highlight behavior
- **AND** SHALL NOT execute branch actions implicitly

### Requirement: Delete Branch Handles Worktree-Occupied Error with Self-Healing Retry

The system SHALL provide deterministic handling for branch delete failures caused by worktree occupancy.

#### Scenario: Stale worktree metadata can be auto-healed

- **WHEN** delete local branch fails with `cannot delete branch ... used by worktree`
- **THEN** backend SHALL run one `git worktree prune` attempt
- **AND** backend SHALL retry branch delete once automatically

#### Scenario: Active worktree occupancy remains protected

- **WHEN** retry still fails because branch is actively used by a linked worktree
- **THEN** system SHALL keep delete action failed
- **AND** UI SHALL show actionable guidance to switch or remove the occupying worktree first

#### Scenario: Non-worktree delete errors keep original failure path

- **WHEN** delete branch fails for reasons unrelated to worktree occupancy
- **THEN** system SHALL skip prune-retry path
- **AND** system SHALL return original error classification and message mapping

