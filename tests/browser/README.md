# Chat streaming regression

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
large Markdown documents.

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
