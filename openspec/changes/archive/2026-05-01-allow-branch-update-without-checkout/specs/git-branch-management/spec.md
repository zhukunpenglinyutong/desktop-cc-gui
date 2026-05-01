# git-branch-management Specification Delta

## MODIFIED Requirements

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
