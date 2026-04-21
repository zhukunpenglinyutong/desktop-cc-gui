## ADDED Requirements

### Requirement: History Browsing SHALL Pin The Current Ordinary User Question As A Section Header
The conversation canvas SHALL keep the ordinary user question for the current history section fixed at the top of the message viewport while the user browses completed conversation history.

#### Scenario: downward scrolling keeps the current section question pinned
- **WHEN** the user scrolls downward through completed conversation history
- **AND** the viewport is currently within the response section that belongs to an ordinary user question
- **THEN** that ordinary user question SHALL remain pinned at the top of the message viewport
- **AND** assistant, reasoning, and tool content for the same section SHALL continue scrolling underneath it

#### Scenario: upward scrolling restores the previous section question
- **WHEN** the user scrolls upward into a previous completed history section
- **THEN** the ordinary user question for that previous section SHALL become the pinned top header again
- **AND** the pinning rule SHALL remain symmetrical with downward scrolling

### Requirement: Sticky Handoff SHALL Follow Physical Scroll Position Only
History section-header pinning SHALL switch only when the next ordinary user question reaches the top boundary of the message viewport.

#### Scenario: next user question takes over only after reaching the top boundary
- **WHEN** a later ordinary user question is visible lower in the viewport
- **AND** that later question has not yet reached the top boundary of the message viewport
- **THEN** the currently pinned ordinary user question SHALL remain pinned
- **AND** the system SHALL NOT switch the sticky header early based on semantic prediction or viewport heuristics

#### Scenario: next user question takes over after touching the top boundary
- **WHEN** a later ordinary user question scrolls to the top boundary of the message viewport
- **THEN** that later ordinary user question SHALL take over as the pinned top header
- **AND** the previous question SHALL leave the sticky position through normal section-header handoff behavior

### Requirement: History Sticky Pinning SHALL Exclude Non-Ordinary User Rows
Only ordinary user questions SHALL participate in history section-header pinning.

#### Scenario: pseudo-user rows do not become sticky headers
- **WHEN** the history timeline contains agent task notification rows, memory-only injected user payloads, or empty user payloads
- **THEN** those rows SHALL remain normal scroll content
- **AND** they SHALL NOT become the pinned history section header

#### Scenario: hidden history rows do not create phantom sticky headers
- **WHEN** earlier history items are still collapsed or not rendered in the current message window
- **THEN** only rendered ordinary user questions SHALL be eligible for sticky pinning
- **AND** the system SHALL NOT pin a hidden user question that is not currently rendered in the DOM

### Requirement: History Sticky Pinning SHALL Remain Presentation-Only And Respect Realtime Priority
History section-header pinning SHALL remain a display-layer capability and SHALL NOT override the existing realtime latest-question pinning contract.

#### Scenario: realtime processing keeps the live sticky contract
- **WHEN** the active conversation is still processing in realtime
- **THEN** the existing realtime latest-user-question pinning contract SHALL remain authoritative
- **AND** history section-header pinning SHALL NOT introduce multiple simultaneous sticky user headers for the active turn

#### Scenario: history sticky pinning does not change data contracts
- **WHEN** history section-header pinning is active
- **THEN** the system SHALL NOT require new Tauri commands, runtime events, storage fields, or history loader payload fields
- **AND** copy actions SHALL remain bound to the original displayed user message text
