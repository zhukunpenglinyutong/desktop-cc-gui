## 1. Error Classification

- [x] 1.1 [P0][depends: none][input: `src/features/files/hooks/useFileExternalSync.ts`][output: Windows path-not-found messages classified as missing/stale path][verify: focused Vitest] Extend missing-file classification to cover `os error 3`, English path-not-found text, and Chinese `系统找不到指定的路径`.
- [x] 1.2 [P0][depends: 1.1][input: existing transient error handling][output: permission/resource busy/sharing violation behavior unchanged][verify: code review plus existing tests] Preserve non-noisy transient file access classification.
- [x] 1.3 [P1][depends: 1.1][input: monitor unavailable threshold logic][output: non-missing repeated errors still eligible for existing toast threshold][verify: automated regression test or existing coverage] Confirm real monitor refresh failures are not silently swallowed.

## 2. Automated Tests

- [x] 2.1 [P0][depends: 1.1][input: `src/features/files/components/FileViewPanel.test.tsx` or hook test][output: Windows `os error 3` regression coverage][verify: `npm exec vitest run src/features/files/components/FileViewPanel.test.tsx`] Add a test proving repeated `Failed to open file: 系统找不到指定的路径。 (os error 3)` refresh failures do not show `External file monitor is unavailable`.
- [x] 2.2 [P1][depends: 2.1][input: existing `os error 2` test][output: existing missing-file behavior remains covered][verify: focused Vitest] Keep or update the existing no-such-file regression test so both Windows and generic missing-file paths are covered.
- [x] 2.3 [P1][depends: 2.1][input: mac/win compatibility review][output: bare `os error 3` remains diagnosable][verify: focused Vitest] Add a reverse regression test proving non-path-not-found `os error 3` still triggers the monitor-unavailable threshold.

## 3. Validation

- [x] 3.1 [P0][depends: 1-2][input: OpenSpec artifacts][output: change validates strictly][verify: `openspec validate fix-windows-external-file-monitor-toast-storm --strict`] Run strict OpenSpec validation.
- [x] 3.2 [P0][depends: 1-2][input: frontend implementation][output: focused file external sync tests pass][verify: `npm exec vitest run src/features/files/components/FileViewPanel.test.tsx`] Run focused automated tests.
- [x] 3.3 [P1][depends: 1-2][input: TypeScript project][output: type contracts remain valid][verify: `npm run typecheck`] Run TypeScript typecheck.
