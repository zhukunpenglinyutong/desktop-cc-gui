## MODIFIED Requirements

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
