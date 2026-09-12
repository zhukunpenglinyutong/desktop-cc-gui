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
