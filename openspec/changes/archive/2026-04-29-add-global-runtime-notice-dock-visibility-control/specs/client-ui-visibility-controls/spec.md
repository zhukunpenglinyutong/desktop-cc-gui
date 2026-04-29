## MODIFIED Requirements

### Requirement: User can configure client UI visibility from appearance settings
The system SHALL provide client UI visibility controls in the basic appearance settings surface.

#### Scenario: Visibility controls appear in basic appearance settings
- **WHEN** user opens settings and navigates to basic appearance
- **THEN** system SHALL show controls for configurable panels and icon buttons
- **AND** the controls SHALL be grouped by parent panel

#### Scenario: Global runtime notice dock appears as an independent panel entry
- **WHEN** user opens the client UI visibility list in basic appearance settings
- **THEN** system SHALL show a dedicated panel-level visibility entry for the global runtime notice dock
- **AND** that entry SHALL NOT be merged into the bottom activity panel or any unrelated child-control group

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

#### Scenario: Hide the global runtime notice dock
- **WHEN** user hides the global runtime notice dock from appearance settings
- **THEN** system SHALL remove both the minimized dock entry and expanded dock panel from the active client UI
- **AND** system SHALL keep the dock's underlying notice feed and dock mode state intact

#### Scenario: Restore the hidden global runtime notice dock
- **WHEN** user shows the global runtime notice dock again after hiding it
- **THEN** system SHALL render the dock again using current session notice data
- **AND** system SHALL restore the dock using its current minimized or expanded state instead of forcing a default mode

### Requirement: Hidden UI does not disable existing functionality
The system SHALL treat hidden panels and icon buttons as presentation changes only.

#### Scenario: Runtime state is retained when an activity panel is hidden
- **WHEN** user hides the bottom activity panel
- **THEN** system SHALL NOT clear task, agent, edit, or latest conversation data

#### Scenario: Runtime notices continue collecting when the dock is hidden
- **WHEN** user hides the global runtime notice dock and the app pushes new runtime notices
- **THEN** system SHALL continue recording those notices into the same global notice feed
- **AND** hiding the dock SHALL NOT disable runtime notice producers

#### Scenario: Shortcuts remain valid when an icon is hidden
- **WHEN** user hides an icon button that also has an existing shortcut or alternate command entry
- **THEN** system SHALL keep the shortcut or alternate command behavior unchanged

#### Scenario: Hidden interactive controls are not focusable
- **WHEN** a supported icon button is hidden
- **THEN** system SHALL remove that button from keyboard focus order and the accessibility tree
