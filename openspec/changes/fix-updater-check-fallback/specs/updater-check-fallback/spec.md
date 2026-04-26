## ADDED Requirements

### Requirement: Background Update Check Failures MUST Stay Non-Blocking

The system MUST treat updater checks that are not explicitly user-initiated as background checks. Background check failures MUST be recorded for diagnostics and MUST NOT render an update failure toast.

#### Scenario: automatic check fails silently

- **WHEN** the app performs a background update check and the updater plugin rejects the check
- **THEN** the system MUST record a debug entry describing the updater error
- **AND** the updater UI state MUST return to `idle`
- **AND** the system MUST NOT render the update failure toast

#### Scenario: automatic check discovers an update

- **WHEN** the app performs a background update check and the updater plugin returns an available update
- **THEN** the system MUST render the available update state with the discovered version

### Requirement: Interactive Update Checks MUST Preserve User Feedback

The system MUST treat checks triggered by explicit user actions as interactive checks. Interactive check failures MUST render an update failure state, and interactive checks with no update MUST render an up-to-date acknowledgement.

#### Scenario: menu-triggered check failure is visible

- **WHEN** the user triggers update check from the application menu
- **AND** the updater plugin rejects the check
- **THEN** the system MUST render the update failure state
- **AND** the user MUST be able to dismiss or retry from the toast

#### Scenario: interactive check finds no update

- **WHEN** the user triggers an interactive update check
- **AND** the updater plugin reports that no update is available
- **THEN** the system MUST render the `latest` state
- **AND** the system MUST automatically return to `idle` after the existing latest-toast duration unless a newer updater action supersedes it

#### Scenario: update button without cached handle performs interactive check

- **WHEN** the user clicks the update or retry action while no cached update handle is available
- **THEN** the system MUST perform an interactive update check
- **AND** failures from that check MUST remain visible to the user

### Requirement: Updater Check Results MUST Be Latest-Request Wins

The system MUST prevent stale updater check results from overwriting state produced by newer updater actions.

#### Scenario: stale failure does not overwrite latest state

- **WHEN** an older update check is still pending
- **AND** a newer update check completes and renders `latest` or `available`
- **AND** the older check later fails
- **THEN** the older failure MUST NOT overwrite the newer updater UI state

#### Scenario: stale no-update result does not overwrite available update

- **WHEN** an older update check is still pending
- **AND** a newer update check discovers an available update
- **AND** the older check later reports no update
- **THEN** the system MUST keep the available update state

#### Scenario: dismiss invalidates pending checks

- **WHEN** the user dismisses the updater toast while an update check is still pending
- **AND** that pending check later completes
- **THEN** the pending result MUST NOT restore a stale updater toast state

#### Scenario: stale update handle is closed

- **WHEN** a stale update check returns an update handle after a newer updater action has superseded it
- **THEN** the system MUST close the stale update handle
- **AND** the stale handle MUST NOT become the cached update handle
