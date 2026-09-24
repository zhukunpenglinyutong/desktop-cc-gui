# Chat streaming regression

Open `/tests/browser/relay-plugin.html` for the installable Relay plugin's actual
React UI with a fake Agent transport. The plugin source is a sibling checkout at
`../ccgui-plugin/ccgui-plugin-plan-execute-relay` (dev server allows sibling
plugin repos per `vite.config.ts`); without that checkout the page cannot load.
Configure the two nodes, send two planning turns, verify that neither reply
starts execution, then approve the latest plan.
An unsent draft must disable approval. The visible request counter distinguishes
planning and execution. Test editing/version selection, stopping, and returning
to regular chat. No real model, credentials, CLI or workspace files are used.
This is not evidence of native read-only enforcement or live-model correctness.

Open `/tests/browser/process-disclosure-bounded.html` for large process groups.
The production disclosure renders 120 or 500 synthetic tools with at most 40
items per page. Previous/next/latest preserve access to every item; append while
reading an earlier page must not switch it. Arguments and results remain lazy.
This is a DOM-bound check, not a native CPU benchmark.

Open `/tests/browser/performance-diagnostics.html` for the real diagnostic dialog
with synthetic native data and the real renderer monitor. The selectable JSON
summary must be bounded to 12,000 UTF-8 bytes; full export keeps all samples in a
separate JSON file. Check the five-minute/60-sample explanation and default-on
toggle: disabling clears the preview, enabling starts a new recording window.
Clipboard refusal retains the summary for manual copy; save cancellation must
not show success. This fixture mocks preference persistence and native samples,
so it does not verify production CPU, restart persistence or cross-window IPC.

With the Vite development server running, open
`http://localhost:1420/tests/browser/stream-throttle.html`.
The page reports `PASS` after exercising actual React StrictMode commits:
completion, replacement, truncation, pending-timer cleanup, continuous Unicode
appends, coalescing and unmount. It needs no model, account or saved conversation.
The visible update count depends on browser scheduling; it is not a model-speed
or frame-rate benchmark.

Run the deterministic timing, grapheme, Markdown and store regressions with:

```sh
node --experimental-strip-types --test tests/*.test.ts
```

The presentation cursor still reveals text per frame. Markdown parses are
budgeted separately: 32ms up to 4,000 UTF-16 units, 64ms up to 16,000, and 128ms
above that. Completion bypasses the budget. These limits trade parser work
against arrival latency; they do not guarantee a frame-time bound for very
large Markdown documents. A live row that overran the budget extends its own
interval (up to 160ms) so a 200 tok/s stream cannot starve the reveal frames.

Open `/tests/browser/thinking-reveal.html` to check the live thinking panel at
provider speed: the real `ThinkingSurface` replays a 200 tok/s stream (100
characters every 144ms) and samples the rendered body once per animation
frame. The burst must be spread across frames — `largestSingleFrameStep` stays
small and `framesJumpingAtLeast 30 chars` must be 0 after the first paint —
and the page reports `PASS`. Before this fixture's behavior was fixed the
panel rendered each burst in one commit, which read as flashing text. No
model, no IPC, no saved conversation.

Open `/tests/browser/effort-layout.html` to verify the actual model menu keeps
its trigger width and popover position while cycling all five reasoning levels.
The fixture waits for fonts and the entrance animation before measuring; it
uses local React state and never changes app settings or sends a model request.

Open `/tests/browser/usage-pane.html` to check the usage page against a seeded
ledger: the same model recorded once as a relay-qualified slug
("agentrouter qunyou/deepseek-v4-flash") and once as the engine's plain id must
fold into a single row — in 详细数据 and in the chart's hover breakdown — with
the totals summed. A cache-bearing turn is seeded too, so the summary row must
read 累计 = 输入 + 输出 (输入 being the whole prompt side: fresh + cache). It
also replays a live report (`usage://changed`) to show the page growing
mid-turn. No app, no database, no saved state.
Open `/tests/browser/collapsible-message.html` to check the long-message
collapse: a user message taller than 480px clamps to 320px behind a bottom
fade into the bubble fill with a centered chevron, the chevron toggles
expand/collapse, and a short message is never clamped. No model or session.

Open `/tests/browser/changelog-dialog.html` to check the version-history
dialog layout (Settings → About → 版本记录): the release-notes body must
scroll (ModalShell's inner Dialog passes the flex height through), the footer
pager stays inside the modal, the header carries the Star button instead of
the old banner strip, and paging reaches the oldest entry. No app or backend.

Open `/tests/browser/file-search-overlay.html` to check the file panel's
workspace search (tree right-click → 搜索文件) inside the panel's own 280px
column: the scope buttons stand in for the right-clicked folder, and the store
readout below the panel shows what the overlay asked the store to do. Typing
`store` under scope **src** must list `src/features/files/store.ts`; typing
`sibling` under scope **src** must show 无匹配文件 while the same query under
**工作区根** finds `src-extra/sibling.ts` — a folder scope may not sweep in a
sibling whose name shares its prefix. Arrow keys move the highlighted row,
Enter opens the file (the readout then shows it under `openFiles` and
`read_file` in `invoked`), Escape closes the overlay. The index and the file
read come from a stubbed `list_file_index` / `read_file`; no app, no database.

Open `/tests/browser/retry-progress.html` to check the tail indicator's
provider-retry chip. The buttons cycle no-retry, claude `api_retry 3/10`,
codex `Reconnecting 1/5` and an omp retry with no reported ceiling: the chip
must read `重试中 x/y` (or `重试中 x` when the CLI reports no max) in the
warning tone at the end of the meta row, carry the provider's own reason as
its tooltip, and be absent entirely when nothing is being retried. No model,
no IPC, no saved conversation.

Open `/tests/browser/touch-scroll-follow.html` in a **touch-emulated** viewport
(390x844) to check the timeline's tail-follow intent on a phone, where the
web-remote UI runs. Swipe up into history and the fixture's refs must read
`following: false`; growing the list (the `grow` button stands in for streaming
and tool rows) must then leave the viewport where the reader left it, not pull
it back to the tail. Swiping back down to the bottom resumes following, and the
next growth pins to the tail again. Both hooks under test (`useScrollFollow`,
`useTailPin`) are the production ones; the rows are static, so no model, no IPC
and no saved conversation. Note the refs are not reactive — read them through
the `window.__live()` probe, not the rendered readout.

Open `/tests/browser/workspace-drag.html` to check the sidebar workspace
drag with synthetic pointer gestures against the real AiChatSidebar:
dropping a row onto another group's container reports
`onDropWorkspaceToSection` with the group id, dropping onto 已归档 reports
the archived sentinel, dropping onto the ungrouped block reports null, a
single-member section still has a working grip, empty groups mount only
mid-drag and accept a drop there, and a plain in-section drag still commits
`onReorderWorkspaces` without also firing a section drop. Static props, no
app, no backend.

Open `/tests/browser/sidebar-collapse.html` to check the sidebar's worktree
disclosures frame by frame: collapsing the「WORKTREES · n」group, re-expanding
it and expanding one worktree child row must each pass through intermediate
region heights (a real grid-template-rows transition) instead of jumping
between two values, and the rows must still be in the DOM while the region
clips shut. The fixture drives the real AiChatSidebar and reports PASS with
the sampled start/end heights and intermediate frame count; a broken version
reads `0 intermediate frames`. Static props, no app, no backend.

Open `/tests/browser/agent-prompt-menus.html` to check the composer's `#`
agent picker and `!` prompt picker against seeded stores: the agent menu
groups 我的智能体 then one section per enabled built-in division (flat when
filtering), and the prompt menu rows carry 工作区/全局 scope badges; both
end in a fixed "new" row that jumps to Settings. No app, no backend.

Open `/tests/browser/delete-confirm-popover.html` to check the session-delete
confirmation: right-clicking the thread row and picking 删除 must open a
pointer-anchored popover (not the centered modal) next to the click point
with 确认 focused; Escape and outside press cancel without deleting, 确认
fires the store's deleteSession once. Real AiChatSidebar, ThreadContextMenu
and ChatPageDialogs; only deleteSession is stubbed. No app, no backend.

Open `/tests/browser/side-panel-overlay.html` to check the right-hand file
panel on a narrow remote viewport, where it used to spill past the screen and
only render half-visible. The real ChatSidePanel renders in overlay mode
inside a 412px row (a stub panel tab stands in for files/changes, so no IPC):
its right edge must sit on the row's right edge with its left edge inside the
row, and the document must not scroll horizontally. No app, no backend.

Open `/tests/browser/cli-channel-dropdown.html` to check the composer's
provider picker with a dozen relays. The flyout must show the current channel
as one dropdown row — no provider names in the DOM until it is opened — and
the opened list must be height-capped (clientHeight ≤ 200 with a taller
scrollHeight). The header's channel filter must narrow that list to the
matching rows while holding it open, and a pick must clear the filter and
close the list. With Claude first and Codex active, a focused channel pick
must leave the Codex panel mounted and return focus to its channel trigger.
The fixture drives the real CliMenu with controlled selection state and reports
PASS/FAIL with measured heights and focus. No app, no backend.

Open `/tests/browser/branch-picker.html` to check the changes-panel branch
dropdown: filtering to `1.0.6` and clicking the `v1.0.6` row must run the
store's checkout for `v1.0.6` while the panel displays
`fix/git-changes-preview-layout` as current. Regression for the stale
`isCurrent` no-op: the cached branch list used to decide "current" from a
snapshot that lagged behind external (CLI) checkouts, silently swallowing
the click. Real ChangesPanelHeader; only the store's checkout is stubbed.
No app, no backend.

Open `/tests/browser/thinking-layout.html` to verify full live thinking text.
Click `Replay thinking` to grow from 2,100 to 8,100 characters, alternating
long wrapped paragraphs and short code-like lines. The production thinking
surface must retain `[row-000]`, never shrink from dropping earlier lines,
and eventually display the exact received text. The result reports PASS,
`prefixRetained: true`, `maxShrink: 0` and `complete: true`. Ordinary upward
movement from newly appended lines is reported separately, not treated as
proof of flicker. The existing manual fold and end-of-thinking fold setting
are unaffected by removing the live 2,000-character window.

Open `/tests/browser/tail-pin.html` for high-rate streaming scroll regression.
Click `Replay 100 chars / 144ms`: the production Markdown renderer, virtualizer,
and follow hooks receive 100-character bursts every 144ms (a synthetic burst
profile, not a measured model token rate), including Chinese, emoji, bold,
inline code and a late tool-sized row. The output must report PASS, zero tail
gaps at resize delivery, and `complete: true` after settling. Scroll upward
during replay to pause follow; `Resume follow` must return to the tail.
This checks browser layout/reveal synchronization, not native IPC latency.
Reload after changing hook implementations to avoid Fast Refresh artifacts.

Open `/tests/browser/git-performance.html` for the Git panel performance
regression. It mounts the production `ChatSidePanel` with 10,001 synthetic
changed files and mocked Git actions. Initial Files view must show zero Git
fetches and zero mounted file rows. Show changes, scroll through the list,
and verify only the visible window plus overscan is mounted. Opening a file
or staging it updates `lastAction` without touching a repository. Write a
commit draft, switch to Files or collapse the sidebar, then return: the draft
must survive, hidden rows must be removed, and the list must still scroll to
the final file. The metrics output reports requests, mounted rows and actions.

Open `/tests/browser/plugin-detail-rail.html` to check the plugin detail page
at a desktop width (1145x731 in the verification run, with the app's 40px tab
strip and 28px status bar around the real `PluginDetailPage`): a README fence
whose single PowerShell line is 922px wide inside a 728px column must scroll
horizontally inside that column, and the expanded 22-permission rail must end
inside the viewport with its own scrollbar, so `aside.scrollTop` reaches the
链接 rows while the page stays put. Both were reported broken: the code line
painted ~190px across the rail, and the pinned 1042px rail could only be read
by scrolling the README to its end. The readout reports PASS plus the measured
boxes, `clientHeight`/`scrollHeight` and the page's scrollTop. No app shell,
no backend, no saved state.
