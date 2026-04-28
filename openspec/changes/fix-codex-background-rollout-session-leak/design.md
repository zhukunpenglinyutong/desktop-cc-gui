# Design: Fix Codex Background Rollout Session Leak

## Problem Model

The observed issue is a visibility and acquisition-boundary bug, not a script execution bug.

1. Codex and companion tools may create local rollout JSONL files for background work.
2. `local_usage` scans those files and feeds them into unified Codex thread projection.
3. Existing filters hide known title/metadata/OpenSpec helper prompts, but not memory consolidation prompts.
4. Selecting an unloaded Codex session calls `resumeThreadForWorkspace`; for Codex this can call backend `resume_thread`, which first runs `ensure_codex_session`.

So the system can both expose background sessions and acquire runtime during what feels like passive switching.

## Chosen Approach

### 1. Shared frontend classifier

Create one TypeScript classifier for Codex background helper previews. Use it from:

- thread list filtering
- `thread/started` event suppression

The classifier uses exact prefix markers and multi-marker memory prompt signatures to avoid hiding normal user conversations that merely mention memory writing.

### 2. Backend list filter

Filter Codex helper sessions in `merge_unified_codex_thread_entries`:

- Skip live rows whose preview/title/name is a known helper.
- Skip local fallback rows whose summary is a known helper.
- Skip live rows whose id aliases match a local helper summary.

This prevents helper rollouts from leaking even if a frontend surface forgets to apply its own filter.

### 3. Local-first passive Codex history loading

Add an explicit `preferLocalHistory` mode to the Codex history loader. When enabled, `loadCodexSession` runs first; if it produces visible history items, the loader returns that snapshot without calling `resumeThread`.

Only passive selection uses this mode. Runtime-required paths keep using remote verification.

## Alternatives

| Option | Outcome | Rejected Reason |
|---|---|---|
| Only add keepalive / TTL | Reduces stale runtime frequency | Does not stop helper rollout visibility or passive resume spawn |
| Only frontend filter | Hides common sidebar leak | Backend API can still leak helper sessions to other surfaces |
| Delete background rollout files | Removes symptom | Unsafe; destroys source data and breaks analytics/debugging |

## Verification

- OpenSpec strict validation for this change.
- Vitest for Codex history local-first behavior and frontend helper filtering.
- Rust tests for unified backend projection filtering.
