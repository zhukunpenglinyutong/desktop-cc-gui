## 1. Updater Hook State Machine

- [x] 1.1 [P0][Depends: proposal/design/spec][Input: `src/features/update/hooks/useUpdater.ts` current check flow][Output: `CheckForUpdatesOptions` with `interactive` and `announceNoUpdate`][Verify: TypeScript compile catches all call sites] Add explicit check intent to `checkForUpdates`.
- [x] 1.2 [P0][Depends: 1.1][Input: background `check()` failure][Output: debug entry + `idle` state without error toast][Verify: hook test covers silent background failure] Implement non-blocking background failure behavior.
- [x] 1.3 [P0][Depends: 1.1][Input: interactive `check()` failure / no-update][Output: visible `error` on failure and timed `latest` on no update][Verify: hook tests cover manual failure and manual latest auto-dismiss] Implement interactive check feedback behavior.
- [x] 1.4 [P0][Depends: 1.1][Input: concurrent update checks, dismiss, unmount][Output: request id guard + stale handle cleanup][Verify: hook tests cover stale failure, stale no-update, dismiss invalidation, stale handle close] Add latest-request-wins protection.

## 2. Entry Point Wiring

- [x] 2.1 [P0][Depends: 1.1][Input: `src/features/app/hooks/useUpdaterController.ts` menu event][Output: menu check calls `checkForUpdates({ announceNoUpdate: true, interactive: true })`][Verify: targeted test or static assertion via hook behavior] Make menu-triggered update check interactive.
- [x] 2.2 [P0][Depends: 1.3][Input: `startUpdate()` without cached `updateRef`][Output: interactive check that shows latest/error feedback][Verify: existing `startUpdate` tests updated for new semantics] Make update/retry action interactive when it first needs to check.

## 3. Regression Tests

- [x] 3.1 [P0][Depends: 1.x][Input: `src/features/update/hooks/useUpdater.test.ts`][Output: tests for background silent failure, interactive visible failure, interactive no-update, stale request guard][Verify: `npm exec vitest run src/features/update/hooks/useUpdater.test.ts`] Update updater hook tests.
- [x] 3.2 [P1][Depends: 2.x][Input: `src/features/update/components/UpdateToast.test.tsx` existing toast coverage][Output: no required component changes or updated assertions if behavior changes affect toast tests][Verify: `npm exec vitest run src/features/update/components/UpdateToast.test.tsx`] Confirm toast component coverage still matches state contract.

## 4. Validation

- [x] 4.1 [P0][Depends: 3.x][Input: frontend updater changes][Output: targeted updater tests passing][Verify: `npm exec vitest run src/features/update/hooks/useUpdater.test.ts src/features/update/components/UpdateToast.test.tsx`] Run targeted Vitest.
- [x] 4.2 [P0][Depends: 4.1][Input: TypeScript sources][Output: typecheck clean][Verify: `npm run typecheck`] Run TypeScript validation.
- [x] 4.3 [P0][Depends: proposal/design/spec/tasks][Input: OpenSpec artifacts][Output: strict change validation passing][Verify: `openspec validate fix-updater-check-fallback --type change --strict --no-interactive`] Validate OpenSpec change.
