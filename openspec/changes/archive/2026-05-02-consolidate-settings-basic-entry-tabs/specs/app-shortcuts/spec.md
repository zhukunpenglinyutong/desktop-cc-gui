## MODIFIED Requirements

### Requirement: App Shortcuts MUST Use A Shared Configurable Contract

Application-level keyboard shortcuts MUST be represented by stable action metadata and persisted settings instead of feature-local hardcoded key checks.

#### Scenario: new app shortcut has complete metadata
- **WHEN** a new application-level shortcut action is added
- **THEN** it MUST define a stable action id
- **AND** it MUST define a persisted setting key
- **AND** it MUST define an i18n label key
- **AND** it MUST define a scope such as `global`, `surface`, `editor`, or `native-menu`
- **AND** it MUST define a default shortcut or an explicit `null` default

#### Scenario: settings renders every configurable app shortcut
- **WHEN** a shortcut action is configurable
- **THEN** Settings -> Basic -> Shortcuts MUST render it in an appropriate group
- **AND** the user MUST be able to edit or clear the shortcut from that surface
- **AND** the legacy Settings -> Shortcuts section input MUST be migrated away and removed after Settings -> Basic -> Shortcuts is available

#### Scenario: shortcut display is platform-aware
- **WHEN** Settings displays a shortcut value
- **THEN** the display MUST use the shared platform formatter
- **AND** it MUST NOT hardcode macOS-only labels for non-macOS platforms
