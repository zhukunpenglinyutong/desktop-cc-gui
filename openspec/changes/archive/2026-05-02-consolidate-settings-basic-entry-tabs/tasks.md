## 1. Baseline And Scope

- [x] 1.1 [P0][depends:none][I: `SettingsView.tsx`, existing sidebar section list, `ShortcutsSection`, `OpenAppsSection`][O: current entry/routing inventory][V: code review notes] Confirm current left-menu entries, basic tab state, and existing section props before implementation.
- [x] 1.2 [P0][depends:1.1][I: proposal/design/specs][O: explicit scope guard][V: diff review] Ensure implementation only moves the declared consolidated groups (`基础设置`, `项目管理`, `智能体/提示词`, `运行环境`) and keeps unrelated entries outside this change untouched.

## 2. Basic Settings Tab Routing

- [x] 2.1 [P0][depends:1.2][I: `SettingsView.tsx` basic tab state][O: `basicSubTab` supports `appearance | behavior | shortcuts | open-apps`][V: `npm run typecheck`] Extend basic tab state and tab rendering without changing existing default behavior.
- [x] 2.2 [P0][depends:2.1][I: `openSettings`, `initialSection`, old child section keys][O: migrated callers for shortcuts and open-apps][V: static search for old public section callers] Migrate old shortcut/open-app entry callers to the new parent section + tab targeting contract.
- [x] 2.3 [P0][depends:2.2][I: `initialSection`, `activeSection`, `basicSubTab`][O: no compatibility mapping for `shortcuts` and `open-apps`][V: focused SettingsView test plus static search] Remove legacy `shortcuts` and `open-apps` section inputs instead of mapping them to `activeSection="basic"`.
- [x] 2.4 [P0][depends:2.3][I: settings sidebar configuration][O: left sidebar no longer renders `shortcuts` and `open-apps`][V: focused SettingsView test] Remove consolidated entries from the left menu through data/config, not CSS hiding.

## 3. Section Rehosting

- [x] 3.1 [P0][depends:2.1][I: `ShortcutsSection` props and handlers][O: Shortcuts content rendered under Basic -> Shortcuts][V: existing shortcut interactions remain tested] Rehost `ShortcutsSection` inside the basic tab surface with existing props and handlers.
- [x] 3.2 [P0][depends:2.1][I: `OpenAppsSection` props and handlers][O: Open Apps content rendered under Basic -> Open Apps][V: existing open-app interactions remain tested] Rehost `OpenAppsSection` inside the basic tab surface with existing props and handlers.
- [x] 3.3 [P1][depends:3.1,3.2][I: section wrappers and class names][O: stable visual spacing and accessibility structure][V: DOM assertions] Preserve visual structure and accessible labels after nested tab move.

## 4. Additional Parent Entry Consolidation

- [x] 4.1 [P0][depends:1.2][I: `ProjectsSection`, `SessionManagementSection`][O: `项目管理` parent entry with `分组 | 会话管理` tabs][V: focused SettingsView test] Rehost project groups and session management under the new parent entry.
- [x] 4.2 [P0][depends:1.2][I: `AgentSettingsSection`, `PromptSection`][O: `智能体/提示词` parent entry with `智能体 | 提示词库` tabs][V: focused SettingsView test] Rehost agent and prompt library sections under the new parent entry.
- [x] 4.3 [P0][depends:1.2][I: `RuntimePoolSection`, `CodexSection`][O: `运行环境` parent entry with `Runtime 池 | CLI 验证` tabs][V: focused SettingsView test] Rehost runtime pool and CLI validation under the new parent entry.
- [x] 4.4 [P0][depends:4.1,4.2,4.3][I: old child section keys][O: migrated callers for `projects`, `session-management`, `agents`, `prompts`, `runtime`, `codex`][V: static search for old public section callers] Migrate old child section callers to the new parent section + tab targeting contract.
- [x] 4.5 [P0][depends:4.4][I: Settings section types, registry, sidebar config, `initialSection` parsing][O: old child section keys removed from public Settings section contract][V: typecheck and static search] Delete legacy child section key support rather than keeping alias mappings.

## 5. Tests And Validation

- [x] 5.1 [P0][depends:2.4,3.1,3.2,4.1,4.2,4.3][I: `SettingsView.test.tsx`][O: tests for sidebar removal and all parent tabs][V: `npm exec vitest run src/features/settings/components/SettingsView.test.tsx`] Add/update tests for new tab navigation and removed left entries.
- [x] 5.2 [P0][depends:2.3,4.5][I: `SettingsView.test.tsx` and static search][O: tests/static proof old child section inputs are not supported][V: focused Vitest plus `rg`] Prove old section inputs are removed after caller migration, not silently redirected.
- [x] 5.3 [P0][depends:5.1,5.2][I: frontend source][O: type and test validation][V: `npm run typecheck` plus focused SettingsView Vitest] Run focused validation and TypeScript check.
- [x] 5.4 [P1][depends:5.3][I: touched file sizes][O: large-file governance evidence][V: `npm run check:large-files` or documented reason] Run large-file check because `SettingsView.tsx` and its test are near governance thresholds.

## 6. Final Review

- [x] 6.1 [P0][depends:5.3][I: OpenSpec artifacts][O: strict OpenSpec validation][V: `openspec validate consolidate-settings-basic-entry-tabs --strict`] Validate the change strictly.
- [x] 6.2 [P0][depends:6.1][I: implementation diff][O: review notes confirming no storage/backend behavior change][V: code review] Confirm no AppSettings schema, Tauri command, shortcut matcher, or open-app execution logic changed.
- [x] 6.3 [P1][depends:6.2][I: desktop app][O: manual smoke notes][V: recorded result] Manually verify Settings open/close, parent tabs, shortcut editor, open-app editor, project/session tabs, agent/prompt tabs, runtime/CLI tabs, and existing provider deep link.
  - 2026-05-02 human note: desktop smoke passed for Settings open/close, consolidated parent tabs, and existing provider deep-link behavior.

## 7. Tab Visual Alignment

- [x] 7.1 [P0][depends:4.1,4.2,4.3][I: `SettingsView.tsx`, consolidated parent tab markup][O: icons on every basic and consolidated parent tab][V: focused SettingsView test] Add semantic icons to shortcut, open-app, project, session, agent, prompt, runtime, and CLI validation tabs without changing accessible names.
- [x] 7.2 [P0][depends:7.1][I: `settings.part2.basic-redesign.css`][O: consolidated parent tabs share Basic Settings tab styling and width behavior][V: visual diff review plus focused SettingsView test] Reuse Basic Settings tab visual rules for consolidated parent tabs and make tab buttons flex-fill the available width.
- [x] 7.3 [P0][depends:7.2][I: theme variables and light/dark overrides][O: custom theme, dark theme, and light theme compatible tab colors][V: CSS review plus `npm run typecheck`] Ensure tab styling uses existing CSS variables and light-theme scoped overrides rather than hard-coded one-theme colors.

## 8. Follow-up Consolidation Request

- [x] 8.1 [P0][depends:7.3][I: `SettingsView.tsx`, `UsageSection`][O: `项目管理` parent entry with `分组 | 会话管理 | 使用情况` tabs][V: focused SettingsView test] Rehost usage analytics under `项目管理 -> 使用情况` and remove the old `usage` left-menu entry.
- [x] 8.2 [P0][depends:7.3][I: `SettingsView.tsx`, `WebServiceSettings`, `EmailSenderSettings`][O: `基础设置` parent entry with `Web 服务` and `邮件发送` tabs][V: focused SettingsView test] Rehost Web Service and Email Sender settings under Basic Settings tabs and remove old left-menu entries.
- [x] 8.3 [P0][depends:8.1,8.2][I: `SettingsSection`, `initialHighlightTarget`, `openSettings` callers][O: old `usage`, `web-service`, and `email` public section keys removed][V: `rg` static search plus typecheck] Delete old child section key support and expose only parent section + tab highlight targets.
- [x] 8.4 [P0][depends:8.3][I: `SettingsView.test.tsx`, OpenSpec artifacts][O: tests and specs updated for added tabs][V: focused Vitest and `openspec validate consolidate-settings-basic-entry-tabs --strict`] Update validation coverage and strict OpenSpec status for the added consolidation.

## 9. MCP / Skills Entry Consolidation

- [x] 9.1 [P0][depends:8.4][I: `SettingsView.tsx`, `McpSection`, `SkillsSection`][O: `MCP / Skills` parent entry with `MCP 服务器 | Skills` tabs][V: focused SettingsView test] Rehost Skills under the MCP parent surface and keep MCP server inventory under a dedicated tab.
- [x] 9.2 [P0][depends:9.1][I: `SettingsSection`, `useSettingsModalState`, sidebar config][O: standalone `skills` public section key removed][V: typecheck plus static search] Delete the old standalone Skills settings section contract and expose tab targeting through the `mcp` parent section.
- [x] 9.3 [P0][depends:9.2][I: `SettingsView.test.tsx`, OpenSpec artifacts][O: tests and specs updated for MCP/Skills consolidation][V: focused Vitest plus `openspec validate consolidate-settings-basic-entry-tabs --strict`] Update validation coverage and change artifacts for the new parent tabbed entry.
- [x] 9.4 [P1][depends:9.3][I: desktop app][O: manual smoke notes][V: recorded result] Manually verify `MCP / Skills` opens as one sidebar entry, tab switching works, MCP inventory remains reachable, and Skills browser/file actions remain reachable.
  - 2026-05-02 human note: `MCP / Skills` desktop smoke passed for single-entry navigation, `MCP 服务器` reachability, and `Skills` browser/file actions.
