## 1. Contract Audit

- [x] 1.1 [P0][depends: none][input: `ModelSelect.tsx`, `ButtonArea.tsx`, `ChatInputBoxFooter.tsx`][output: confirmed prop chain for model selector footer actions][verify: code review] Trace current `onAddModel` routing and identify the smallest prop surface for `onRefreshConfig` / `isRefreshingConfig`.
- [x] 1.2 [P0][depends: none][input: `useEngineController.ts`, `useModels.ts`, `src/services/tauri.ts`][output: provider refresh source map for Codex / Claude / Gemini][verify: notes in implementation PR] Confirm which existing refresh APIs can be reused and whether any provider needs a small adapter.
- [x] 1.3 [P1][depends: 1.1,1.2][input: i18n locale files][output: required copy keys list][verify: no missing translation keys in tests] Define i18n keys for `刷新配置`, refreshing, and refresh failure feedback.

## 2. Selector UI Implementation

- [x] 2.1 [P0][depends: 1.1][input: `ModelSelect.tsx`][output: split footer with left add model and right refresh config actions][verify: `ModelSelect.test.tsx`] Add provider-agnostic footer props and render two independent actions without service coupling.
- [x] 2.2 [P0][depends: 2.1][input: selector CSS / existing dropdown classes][output: stable two-column footer layout][verify: visual check at Codex, Claude Code, Gemini dropdown widths] Ensure both footer buttons fit without overlap and preserve keyboard/focus affordances.
- [x] 2.3 [P0][depends: 2.1][input: `ButtonArea.tsx`, `ChatInputBoxFooter.tsx`, `ChatInputBox.tsx`, `ChatInputBoxAdapter.tsx`][output: refresh callback and loading state wired from composer boundary to selector][verify: component tests] Pass the provider-scoped refresh action through the existing composer component chain.

## 3. Provider-Scoped Refresh

- [x] 3.1 [P0][depends: 1.2,2.3][input: `useEngineController.ts`][output: provider-scoped refresh helper that refreshes only the requested engine catalog][verify: `useEngineController.test.tsx`] Reuse or extend `refreshEngineModels(engineType)` so Codex / Claude / Gemini can be refreshed independently.
- [x] 3.2 [P0][depends: 3.1][input: Codex model/config refresh paths][output: Codex selector refresh reloads model list and config-derived model while preserving usable old data][verify: Codex-focused unit test or integration test] Ensure refresh does not clear catalog when runtime/config reload fails.
- [x] 3.3 [P0][depends: 3.1][input: Claude model detection path][output: Claude Code refresh rereads `~/.claude/settings.json` model overrides][verify: backend/frontend targeted test with settings override fixture] Ensure settings changes appear in the selector after manual refresh.
- [x] 3.4 [P1][depends: 3.1][input: Gemini vendor/settings path][output: Gemini refresh rereads Gemini settings/vendor-derived model data][verify: targeted test or mocked service test] Ensure Gemini selector reflects refreshed settings without affecting Codex/Claude catalogs.
- [x] 3.5 [P0][depends: 3.1-3.4][input: refresh state management][output: per-provider in-flight guard and failure surface][verify: tests for double-click serialization and failure diagnostics] Prevent overlapping refreshes and keep previous catalog/selection on failure.

## 4. Add Model Routing

- [x] 4.1 [P0][depends: 2.3][input: existing `onAddModel(providerId)` routing][output: Codex / Claude / Gemini add model clicks open matching provider configuration][verify: `ButtonArea` or adapter test] Keep add model action provider-scoped and prevent hardcoded provider routing.
- [x] 4.2 [P1][depends: 4.1][input: settings navigation behavior][output: optional focus target for provider model section when available][verify: manual UI smoke] Prefer focusing the relevant model section, but do not block the change if settings page only supports provider-level navigation.

## 5. Tests And Validation

- [x] 5.1 [P0][depends: 2-4][input: `ModelSelect.test.tsx`][output: tests for footer split actions, loading state, and independent click handlers][verify: targeted Vitest file passes] Cover all three provider labels or a provider-parametrized test.
- [x] 5.2 [P0][depends: 3][input: `useEngineController.test.tsx`][output: tests proving refresh only updates the requested engine][verify: targeted Vitest file passes] Protect against all-engine refresh regression.
- [x] 5.3 [P1][depends: 3.2-3.4][input: service mocks / backend fixtures as needed][output: tests for refresh success, refresh failure retaining old catalog, and selection preservation][verify: targeted frontend/backend tests pass] Cover fail-safe behavior from spec.
- [x] 5.4 [P0][depends: 5.1-5.3][input: final changes][output: quality gates pass][verify: `npm run lint`, `npm run typecheck`, targeted `npm run test -- --run ...`] Run focused gates before broader test if time allows. 2026-04-28: focused Vitest, full lint, full typecheck, runtime contracts, doctor strict, and Rust engine tests passed; full `npm run test` was attempted and stopped at batch 22/92 with process code -1 without printed assertion failures.
- [ ] 5.5 [P1][depends: 5.4][input: running app][output: manual smoke notes for Codex / Claude Code / Gemini dropdown footer][verify: screenshots or checklist] Confirm left add/right refresh layout matches the referenced UX on desktop.
