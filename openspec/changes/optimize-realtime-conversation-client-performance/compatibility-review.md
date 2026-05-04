# Compatibility Review

## Protocol Compatibility

- Pass. 本次实现未修改 Tauri command 名称、参数、返回 payload。
- Pass. 未修改 app-server event 名称或 provider runtime 输出协议。
- Pass. 未新增 frontend direct `invoke()`。

## Conversation Semantics

- Pass. Gemini assistant delta 只改变 dispatch cadence，不改变 delta 顺序或 final text。
- Pass. normalized assistant snapshot coalescing 仅覆盖 `itemStarted` / `itemUpdated` assistant snapshot；completion/tool/user/generated-image/review 仍保持全序。
- Pass. reasoning/tool fast path 只覆盖已存在 same-item live update；新插入、placeholder、completion、结构边界仍走 canonical derivation。

## Rollback Compatibility

- Pass. `ccgui.perf.realtimeBatching=0` 测试覆盖 Gemini immediate dispatch baseline。
- Pass. `ccgui.perf.incrementalDerivation=0` 仍回 reducer canonical path。
- Pass. stream mitigation rollback 测试保持 diagnostics 记录。

## UI / Composer Compatibility

- Pass. 本次未改变 composer source-of-truth；现有 `useDeferredValue` 和 `ChatInputBoxAdapter` comparator focused tests 通过。
- Pass. draft text、selection、IME、attachments、send payload 未进入 deferred path。

## Diagnostics Compatibility

- Pass. Gemini visible render diagnostics 纳入 thread/item evidence。
- Pass. Gemini visible stall 可分类但不会默认启用 mitigation profile。
- Pass. baseline presentation profile 不误报 mitigation。

## File Governance

- Pass. 触及大文件后已运行 `npm run check:large-files`，结果通过。
