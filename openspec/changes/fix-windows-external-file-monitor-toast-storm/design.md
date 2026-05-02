## Context

Detached file external sync is implemented in the React hook `useFileExternalSync`. In watcher mode it performs a startup refresh and reacts to `detached-external-file-change` events; in polling mode it periodically calls `readWorkspaceFile`. The backend `readWorkspaceFile` canonicalizes the workspace file path and returns `Failed to open file: {err}` when the path cannot be resolved.

The current frontend classifier treats `os error 2`, `ENOENT`, and no-such-file text as missing-file states. Windows can return `os error 3` when the parent directory or full path is missing. That error is currently classified as a non-missing monitor refresh failure, so repeated watcher startup sync, watcher fallback, or polling ticks can cross the toast threshold and repeatedly show `External file monitor is unavailable`.

## Goals / Non-Goals

**Goals:**

- Classify Windows path-not-found failures as stale/missing path refresh results.
- Keep the existing missing-file silent behavior and non-missing error toast threshold.
- Add focused frontend automation for the Windows `os error 3` regression.
- Avoid changing backend command signatures, Tauri event payloads, or persisted settings.

**Non-Goals:**

- No backend watcher rewrite.
- No global toast de-duplication system.
- No structured Rust error-code migration in this hotfix.
- No navigation/tab stale-state redesign.

## Decisions

### Decision 1: Fix classification at the frontend toast boundary

`useFileExternalSync` already owns the user-facing decision of whether a refresh failure should toast. Extending its missing-file classifier is the smallest correct fix because the backend error string is already normalized into a frontend message before toast thresholding.

Alternative considered: change Rust `readWorkspaceFile` to return structured error codes. That would be cleaner long term, but it changes IPC contracts and requires broader service/type/test updates. This issue is a Windows toast storm hotfix, so the scoped classifier fix is more appropriate.

### Decision 2: Treat Windows path-not-found `os error 3` as missing/stale path

`os error 3` means path not found on Windows, but a bare numeric error code is too broad for cross-platform frontend classification. The hook should only treat `os error 3` as missing/stale when the message also contains path-not-found text such as `The system cannot find the path specified` or `系统找不到指定的路径`. That keeps the Windows fix targeted while preserving diagnostics for unrelated macOS/Linux or backend failures that happen to include the same numeric code.

Alternative considered: show a different “file no longer exists” toast. That still risks repeated noise because the monitor can retry the same stale path. The current product behavior for missing files is silent, so parity is safer.

### Decision 3: Preserve real non-missing monitor unavailable toasts

The existing threshold/cooldown remains for non-missing errors. Permission/locking-like transient errors remain non-noisy. This keeps the monitor diagnosable without treating stale files as infrastructure failures.

## Risks / Trade-offs

- [Risk] String matching may miss future localized Windows error text.  
  Mitigation: cover English and Chinese path-not-found text and require path semantics when using `os error 3`.

- [Risk] A real monitor problem could include path-not-found text.  
  Mitigation: path-not-found means the target path cannot be resolved; for the active file refresh this should not be surfaced as monitor-unavailable.

- [Risk] Global toast storm can still happen for other repeated error classes.  
  Mitigation: keep this change narrow; propose global toast de-duplication separately if more cases appear.

## Migration Plan

1. Extend missing/stale path classification in `useFileExternalSync`.
2. Add/adjust Vitest coverage for Windows `os error 3`.
3. Run focused FileViewPanel or hook tests.
4. Run `openspec validate fix-windows-external-file-monitor-toast-storm --strict` and TypeScript checks.

Rollback strategy: revert the classifier and test changes. No persisted data or IPC migration is involved.

## Open Questions

- Should a future structured error-code contract replace string classification across `readWorkspaceFile` and external sync? This is valuable but outside the hotfix.
