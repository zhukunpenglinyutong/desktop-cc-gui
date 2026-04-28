## 1. Contract And Registry

- [x] 1.1 [P0][depends: none][input: proposal/design/spec + current shell/components][output: implementation audit mapping every red-box target to real component owner and test owner][verify: notes in PR or task comment] Objectively confirm which targets are cheap panel gates, which require icon-level surgery, and which may need visual gap cleanup.
- [x] 1.2 [P0][depends: 1.1][input: implementation audit][output: final supported panel/control registry with stable ids][verify: code review] Confirm the real component owners for top session tabs, top control groups, right toolbar, bottom activity panel, and corner status indicator.
- [x] 1.3 [P0][depends: 1.2][input: registry target list][output: `ClientUiPanelId`, `ClientUiControlId`, default preference, parent mapping][verify: helper unit test] Add a frontend-only registry and default-visible preference model.
- [x] 1.4 [P0][depends: 1.3][input: malformed persisted values][output: normalize helper that ignores unknown keys and falls back visible][verify: unit tests for missing/malformed/unknown keys] Implement safe normalization and visibility query helpers.

## 2. Persistence Hook

- [x] 2.1 [P0][depends: 1.4][input: `src/services/clientStorage.ts`][output: hook/service for reading and writing `app/clientUiVisibility`][verify: hook or service unit test] Persist visibility preference through existing clientStorage without adding a Tauri command.
- [x] 2.2 [P0][depends: 2.1][input: reset scenario][output: reset-to-default action][verify: test reset writes default-visible preference or clears stored override] Add a recovery action that restores every supported panel and control to visible.
- [x] 2.3 [P1][depends: 2.1][input: app startup behavior][output: loading-safe default visible state before storage is ready][verify: test shell renders normally before stored preference resolves] Ensure startup never flashes into an empty layout because preference loading is delayed.

## 3. Settings UI

- [x] 3.1 [P0][depends: 2.1][input: `BasicAppearanceSection.tsx`][output: grouped “界面显示” section with panel toggles][verify: `SettingsView.test.tsx`] Add panel-level toggles in basic appearance settings.
- [x] 3.2 [P0][depends: 3.1][input: registry parent mapping][output: child icon toggles grouped under each parent panel][verify: settings render test for parent + child controls] Add icon-level toggles while preserving child preferences when parent panel is hidden.
- [x] 3.3 [P0][depends: 3.1,3.2][input: i18n locale files][output: Chinese and English setting labels/help text][verify: no missing i18n keys in tests] Add concise copy that states hiding only affects visibility, not function.
- [x] 3.4 [P1][depends: 3.1][input: settings styles][output: compact grouped toggle layout consistent with current basic appearance cards][verify: visual smoke, `npm run check:large-files` if CSS threshold is touched] Style the section without nesting heavy card structures.

## 4. Shell And Panel Wiring

- [x] 4.1 [P0][depends: 2.1][input: app shell / top session tabs owner][output: conditional render for top session Tab panel][verify: focused shell test] Hide top session tabs while preserving active conversation state.
- [x] 4.2 [P0][depends: 2.1][input: top run/status controls owner][output: conditional render for run/status/pin controls][verify: focused component test] Hide each top run/status icon independently and honor parent panel hiding.
- [x] 4.3 [P0][depends: 2.1][input: top tool controls owner][output: conditional render for primary/tool/terminal/focus controls][verify: focused component test] Hide the top tool icon group and individual controls according to registry queries.
- [x] 4.4 [P0][depends: 2.1][input: right toolbar owner][output: conditional render for activity/list/git/files/search toolbar entries][verify: focused component test] Hide right toolbar panel and individual entries without resetting selected right-side mode.
- [x] 4.5 [P0][depends: 2.1][input: bottom activity panel owner][output: conditional render for tasks/agents/edits/latest conversation panel tabs][verify: focused component test] Hide bottom activity panel/tabs without clearing their collected data.
- [x] 4.6 [P1][depends: 2.1][input: conversation canvas presentation owner][output: conditional render for sticky user bubble and message anchors][verify: focused component or shell test] Hide curtain-area presentation controls without changing conversation state.

## 5. Safety And Regression Tests

- [x] 5.1 [P0][depends: 4.1-4.6][input: maximum hidden preference][output: regression test proving conversation canvas, composer, and send remain available][verify: focused shell/chat test] Cover the maximum-hidden normal conversation path.
- [x] 5.2 [P0][depends: 4.1-4.6][input: hidden panel/control interactions][output: tests proving hidden elements are not focusable/queryable][verify: testing-library absence assertions] Ensure hidden interactive controls are removed from DOM or accessibility tree.
- [x] 5.3 [P1][depends: 4.4,4.5][input: shortcuts/alternate entry behavior][output: tests or manual notes proving hidden entry does not disable underlying feature][verify: shortcut or command smoke] Validate presentation-only semantics for right toolbar and bottom activity areas.
- [x] 5.4 [P0][depends: 1-5][input: final implementation][output: quality gates pass][verify: `npm run lint`, `npm run typecheck`, focused `npm run test -- --run ...`] Run the standard frontend gates and targeted tests.
- [x] 5.5 [P1][depends: 5.4][input: running app][output: manual smoke checklist with default, partial hidden, maximum hidden, reset][verify: screenshot or written checklist] Manually verify the UI against the original red-box targets.

## Implementation Notes

- Target ownership: settings controls live in `BasicAppearanceSection`, persisted through the frontend `clientStorage` helper; shell visibility is consumed by `useLayoutNodes` and `useAppShellLayoutNodesSection`.
- Panel wiring: top session tabs use `PanelTabs`, top run/open-app controls use `MainHeader`, top tool shortcuts use `MainHeaderActions` props, right toolbar uses `PanelTabs`, bottom activity tabs use `StatusPanel`, and curtain-area controls use `Messages` sticky header/message anchor visibility.
- Verification run: `npm run lint`, `npm run typecheck`, `npm run check:large-files`, and focused `npx vitest run` for client UI visibility, maximum-hidden shell safety, settings, panel tabs, status panel, and header action coverage.
- Manual smoke: 5.5 passed by human running-app verification after the icon labeling and curtain sticky-user-bubble control updates.
