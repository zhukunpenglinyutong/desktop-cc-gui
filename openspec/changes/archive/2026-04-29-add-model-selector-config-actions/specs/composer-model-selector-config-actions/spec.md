## ADDED Requirements

### Requirement: Model Selector Footer MUST Expose Add And Refresh Actions

The composer model selector MUST provide two provider-scoped footer actions when the current provider supports model configuration: left-side add model and right-side refresh config.

#### Scenario: Codex selector shows split actions
- **WHEN** the user opens the model selector while the current provider is `Codex`
- **THEN** the selector footer MUST show `添加模型` on the left
- **AND** it MUST show `刷新配置` on the right

#### Scenario: Claude Code selector shows split actions
- **WHEN** the user opens the model selector while the current provider is `Claude Code`
- **THEN** the selector footer MUST show `添加模型` on the left
- **AND** it MUST show `刷新配置` on the right

#### Scenario: Gemini selector shows split actions
- **WHEN** the user opens the model selector while the current provider is `Gemini`
- **THEN** the selector footer MUST show `添加模型` on the left
- **AND** it MUST show `刷新配置` on the right

#### Scenario: footer actions remain independent
- **WHEN** the selector footer renders both actions
- **THEN** clicking `添加模型` MUST NOT trigger config refresh
- **AND** clicking `刷新配置` MUST NOT navigate to model settings

### Requirement: Add Model Action MUST Route To Current Provider Configuration

The left footer action MUST open the model/provider configuration surface for the provider currently selected in the composer.

#### Scenario: Codex add model opens Codex configuration
- **WHEN** the current provider is `Codex`
- **AND** the user clicks `添加模型`
- **THEN** the system MUST open the Codex model/provider configuration entry
- **AND** it MUST NOT open Claude Code or Gemini configuration

#### Scenario: Claude Code add model opens Claude configuration
- **WHEN** the current provider is `Claude Code`
- **AND** the user clicks `添加模型`
- **THEN** the system MUST open the Claude Code model/provider configuration entry
- **AND** it MUST NOT open Codex or Gemini configuration

#### Scenario: Gemini add model opens Gemini configuration
- **WHEN** the current provider is `Gemini`
- **AND** the user clicks `添加模型`
- **THEN** the system MUST open the Gemini model/provider configuration entry
- **AND** it MUST NOT open Codex or Claude Code configuration

### Requirement: Refresh Config Action MUST Reload Only The Current Provider

The right footer action MUST refresh the current provider's model/config snapshot without refreshing unrelated provider catalogs.

#### Scenario: Codex refresh reloads Codex model config
- **WHEN** the current provider is `Codex`
- **AND** the user clicks `刷新配置`
- **THEN** the system MUST refresh the Codex model list and config-derived model
- **AND** it MUST NOT refresh Claude Code or Gemini model catalogs as part of that action

#### Scenario: Claude Code refresh reloads settings model overrides
- **WHEN** the current provider is `Claude Code`
- **AND** the user clicks `刷新配置`
- **THEN** the system MUST reread Claude Code model configuration from `~/.claude/settings.json` and supported CLI discovery sources
- **AND** the refreshed selector MUST include newly configured Claude models when parsing succeeds

#### Scenario: Gemini refresh reloads Gemini settings
- **WHEN** the current provider is `Gemini`
- **AND** the user clicks `刷新配置`
- **THEN** the system MUST reread Gemini model configuration from Gemini settings/vendor sources and supported CLI discovery sources
- **AND** the refreshed selector MUST include newly configured Gemini models when parsing succeeds

#### Scenario: refresh does not start a conversation
- **WHEN** the user clicks `刷新配置`
- **THEN** the system MUST NOT send a message
- **AND** it MUST NOT create a new user-visible native conversation solely because of refresh

### Requirement: Refresh Config Action MUST Be Serialized And Observable

The system MUST expose refresh progress and prevent overlapping refreshes for the same provider selector action.

#### Scenario: refresh shows progress
- **WHEN** a provider config refresh is in progress
- **THEN** the `刷新配置` action MUST enter a visible loading or disabled state
- **AND** the user MUST be able to distinguish refreshing from idle state

#### Scenario: repeated refresh does not run concurrently
- **WHEN** a provider config refresh is already in progress
- **AND** the user clicks `刷新配置` again
- **THEN** the system MUST NOT start another concurrent refresh for that provider
- **AND** the final model catalog state MUST remain deterministic

#### Scenario: refresh failure is diagnosable
- **WHEN** provider config refresh fails due to invalid config, read errors, or command failure
- **THEN** the system MUST expose a diagnosable failure reason through UI feedback or debug diagnostics
- **AND** it MUST keep the selector usable

### Requirement: Refresh MUST Preserve Valid Selection And Existing Catalog On Failure

Refreshing model config MUST be fail-safe: it MUST keep the current selection when still valid, and MUST retain the prior catalog when refresh fails.

#### Scenario: valid current selection remains selected
- **WHEN** refresh completes successfully
- **AND** the previously selected model still exists in the refreshed model catalog
- **THEN** the selector MUST keep that model selected

#### Scenario: missing current selection falls back by existing rules
- **WHEN** refresh completes successfully
- **AND** the previously selected model no longer exists in the refreshed model catalog
- **THEN** the selector MUST choose the next model using the existing default/preferred model selection rules

#### Scenario: failed refresh keeps previous catalog
- **WHEN** refresh fails
- **THEN** the selector MUST keep the previously visible model catalog
- **AND** it MUST NOT replace the catalog with an empty list solely because refresh failed

#### Scenario: failed refresh keeps current selection
- **WHEN** refresh fails
- **THEN** the selector MUST keep the current selected model value
- **AND** it MUST NOT clear the selection solely because refresh failed
