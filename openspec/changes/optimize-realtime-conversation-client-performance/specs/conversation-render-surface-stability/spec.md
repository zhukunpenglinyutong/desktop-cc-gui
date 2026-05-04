## ADDED Requirements

### Requirement: Three-Engine Live Rendering MUST Preserve Progressive Visible Text
Live rendering for Codex, Claude Code, and Gemini MUST preserve progressive visible assistant text while allowing bounded throttling and safe degradation.

#### Scenario: visible text growth is tracked by live assistant item
- **WHEN** any supported engine receives assistant text deltas for a live item
- **THEN** visible text diagnostics MUST be keyed by thread and item id
- **AND** the client MUST use actual rendered value growth or equivalent visible surface evidence instead of parent array render count as proof that the user saw new text

#### Scenario: completed streaming output converges locally to final Markdown
- **WHEN** a streaming assistant message completes after using throttled Markdown, staged Markdown, or plain-text live fallback
- **THEN** the local realtime render path MUST converge to final Markdown semantics
- **AND** the client MUST NOT depend on history replay or thread switching to restore headings, lists, code blocks, links, or emphasis

### Requirement: Live Render Work MUST Stay Scoped To The Active Tail When Possible
Live message rendering MUST avoid global presentation recomputation when only the active streaming tail changes.

#### Scenario: unchanged history is not reprocessed for each streaming chunk
- **WHEN** a live conversation receives high-frequency assistant, reasoning, or tool deltas
- **AND** collapsed history or live tail working-set rules allow bounded presentation
- **THEN** expensive filtering, reasoning collapse, timeline collapse, Markdown parse, and scroll work MUST remain scoped to changed live rows where possible
- **AND** unchanged history rows MUST keep stable render inputs
