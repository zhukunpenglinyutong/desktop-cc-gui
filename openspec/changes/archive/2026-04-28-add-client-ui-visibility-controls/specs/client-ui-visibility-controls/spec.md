## ADDED Requirements

### Requirement: User can configure client UI visibility from appearance settings
The system SHALL provide client UI visibility controls in the basic appearance settings surface.

#### Scenario: Visibility controls appear in basic appearance settings
- **WHEN** user opens settings and navigates to basic appearance
- **THEN** system SHALL show controls for configurable panels and icon buttons
- **AND** the controls SHALL be grouped by parent panel

#### Scenario: Default state is fully visible
- **WHEN** no client UI visibility preference exists
- **THEN** system SHALL treat every supported panel and icon button as visible

#### Scenario: Restore default visibility
- **WHEN** user activates the reset visibility action
- **THEN** system SHALL restore every supported panel and icon button to visible

### Requirement: Visibility controls support panel-level hiding
The system SHALL allow supported UI panels to be hidden without changing the underlying feature state.

#### Scenario: Hide a supported panel
- **WHEN** user hides a supported panel from appearance settings
- **THEN** system SHALL remove that panel from the active client UI
- **AND** system SHALL keep the panel's underlying feature state intact

#### Scenario: Show a hidden supported panel
- **WHEN** user shows a previously hidden supported panel
- **THEN** system SHALL render that panel again
- **AND** system SHALL restore the panel using current runtime data rather than resetting it

### Requirement: Visibility controls support icon-level hiding
The system SHALL allow supported icon buttons to be hidden independently when their parent panel is visible.

#### Scenario: Hide a single icon button
- **WHEN** user hides one supported icon button from appearance settings
- **THEN** system SHALL remove that icon button from the active client UI
- **AND** system SHALL keep sibling icon buttons visible when their own preference is visible

#### Scenario: Parent panel hidden overrides child icon visibility
- **WHEN** a parent panel is hidden
- **THEN** system SHALL hide all child icon buttons of that panel regardless of each child icon preference

#### Scenario: Child icon preference survives parent panel restore
- **WHEN** user hides a child icon button, hides the parent panel, and later shows the parent panel again
- **THEN** system SHALL keep the child icon button hidden
- **AND** system SHALL show sibling icon buttons that remain visible in preference

### Requirement: Maximum hidden mode preserves normal conversation
The system SHALL preserve the core conversation path even when all supported optional panels and icon buttons are hidden.

#### Scenario: Composer remains usable after maximum hiding
- **WHEN** user hides every supported optional panel and icon button
- **THEN** system SHALL keep the active conversation canvas visible
- **AND** system SHALL keep the composer input visible and usable
- **AND** system SHALL keep message sending available

#### Scenario: Settings remains recoverable after maximum hiding
- **WHEN** user hides every supported optional panel and icon button
- **THEN** system SHALL keep a path to settings available so the user can restore visibility

### Requirement: Hidden UI does not disable existing functionality
The system SHALL treat hidden panels and icon buttons as presentation changes only.

#### Scenario: Runtime state is retained when an activity panel is hidden
- **WHEN** user hides the bottom activity panel
- **THEN** system SHALL NOT clear task, agent, edit, or latest conversation data

#### Scenario: Shortcuts remain valid when an icon is hidden
- **WHEN** user hides an icon button that also has an existing shortcut or alternate command entry
- **THEN** system SHALL keep the shortcut or alternate command behavior unchanged

#### Scenario: Hidden interactive controls are not focusable
- **WHEN** a supported icon button is hidden
- **THEN** system SHALL remove that button from keyboard focus order and the accessibility tree

### Requirement: Visibility preference persists safely
The system SHALL persist client UI visibility preference across application restarts and recover safely from invalid stored data.

#### Scenario: Restore saved visibility preference after restart
- **WHEN** user hides supported panels or icon buttons and restarts the app
- **THEN** system SHALL restore the saved visibility preference after startup

#### Scenario: Invalid preference falls back to visible
- **WHEN** persisted visibility preference is missing, malformed, or contains unsupported values
- **THEN** system SHALL ignore invalid fields
- **AND** system SHALL treat affected panels and icon buttons as visible
- **AND** system SHALL keep the main conversation UI usable

#### Scenario: Unknown future keys are ignored
- **WHEN** persisted visibility preference contains unknown panel or icon ids
- **THEN** system SHALL ignore those unknown ids
- **AND** system SHALL continue applying known ids normally
