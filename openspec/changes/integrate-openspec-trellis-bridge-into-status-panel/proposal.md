## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。原始提案中的“双向同步、写回 tasks.md、文件 watcher、StatusPanel 新 tab”过重，且会让客户端修改治理工件。收敛后，本 change 只做**只读 governance evidence bridge**。

## Why

当前客户端已经有多条治理证据来源：

- `package.json` 中的 `check:*` scripts。
- `.github/workflows/large-file-governance.yml` 与最终整体收口阶段的 noise sentry。
- `openspec/changes/*/tasks.md` 的任务状态。
- `.trellis/workspace/*` 的 session record。
- StatusPanel 已承载 checkpoint/cost/budget 等运行态治理信息。

但这些证据散落在 CLI、workflow 与文档里，缺少一个只读投影契约供后续 UI 或 check 脚本消费。

中文一句话：**先把治理证据读出来、归一化、显示为只读状态；不要让客户端反向写 OpenSpec/Trellis 文件。**

## What Changes

- Add OpenSpec capability `openspec-trellis-status-panel-bridge` covering:
  - OpenSpec change inventory 只读解析。
  - Trellis session/task 只读解析。
  - check script evidence 只读归一化。
  - 可选 StatusPanel 展示入口，但不得写回文件。
  - 显式 Non-Goal：不双向同步、不自动勾选 tasks、不新增文件 watcher、不改 OpenSpec/Trellis schema。

## Scope

### In Scope

- Read-only parsers for OpenSpec and Trellis governance artifacts.
- Normalized `GovernanceEvidence` DTO.
- MVP evidence sources: OpenSpec task progress, known package check scripts, and workflow presence for large-file/heavy-test gates.
- Defensive handling for missing directories, malformed markdown, incomplete changes, and external spec roots.
- Optional minimal StatusPanel read-only surface.

### Out of Scope

- No writes to `openspec/**`.
- No writes to `.trellis/**`.
- No task checkbox synchronization.
- No file watcher.
- No new Tauri command unless existing read APIs are insufficient.
- No cross-workspace aggregate.

## Engineering Constraints

- All path handling MUST be workspace-relative and cross-platform.
- Malformed artifacts MUST produce degraded evidence, not throw.
- Large markdown content MUST be summarized, not rendered wholesale.
- MVP MUST be useful without executing scripts; script evidence may report configured/present/unknown before runtime execution is wired.
- Tests MUST use temp fixtures and stay silent.
- Stage validation intentionally skips the full noise sentry for future incremental edits; run it only during final harness-wide integration closure.
- Large file governance gate is mandatory: changes MUST remain compatible with `.github/workflows/large-file-governance.yml`, including `node --test scripts/check-large-files.test.mjs`, `npm run check:large-files:near-threshold`, and `npm run check:large-files:gate`.
- Windows/macOS/Linux compatibility is mandatory: readers MUST normalize workspace-relative paths, avoid shell-only assumptions, tolerate CRLF/LF markdown, and avoid case-sensitive filename assumptions.

## Impact

- OpenSpec:
  - `openspec/changes/integrate-openspec-trellis-bridge-into-status-panel/**`
- Expected future code:
  - `src/features/governance/evidence/`
  - optional `src/features/status-panel/components/GovernanceEvidenceSection.tsx`

## Validation

```bash
npm run typecheck
node --test scripts/check-large-files.test.mjs
npm run check:large-files:near-threshold
npm run check:large-files:gate
openspec validate integrate-openspec-trellis-bridge-into-status-panel --strict --no-interactive
```
