## 1. Event Contract

- [x] 1.1 [P1][depends: design/specs][I: `thread/compacting|compacted` params][O: frontend payload keeps optional `auto/manual` flags][V: useAppServerEvents targeted tests] Extend app-server event routing types for compaction source flags.

## 2. Message Surface

- [x] 2.1 [P1][depends: 1.1][I: Codex `/compact` lifecycle][O: deduped conversation item for compaction start/completion][V: reducer targeted tests] Add reducer action for Codex compaction message upsert.
- [x] 2.2 [P1][depends: 2.1][I: `useThreadTurnEvents` compaction handlers][O: Codex auto/manual lifecycle writes visible message; non-Codex unchanged][V: hook targeted tests] Wire compaction source guard in thread turn handlers.

## 3. Copy And Validation

- [x] 3.1 [P1][depends: 2.2][I: visible user copy][O: zh/en i18n keys for auto compaction start/completion][V: typecheck] Add localized copy.
- [x] 3.2 [P1][depends: 1-3.1][I: changed frontend files][O: targeted tests and typecheck pass][V: `npm run test -- <targeted>` + `npm run typecheck`] Run validation.
