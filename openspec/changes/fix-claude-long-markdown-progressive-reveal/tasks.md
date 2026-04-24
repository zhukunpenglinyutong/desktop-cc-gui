## 1. Diagnose And Scope

- [x] 1.1 [P0] 通过本地 Claude CLI / backend 等价测试确认长 Markdown 正文 `text_delta` 真实存在，不是只能 completed 才输出。
- [x] 1.2 [P0] 判断该问题不应继续追加到 `fix-claude-windows-streaming-visibility-stall`，而是独立为新 change。

## 2. Engine-Level Recovery

- [x] 2.1 [P0] 保留现有 Windows candidate/render-lag mitigation，不回退既有修复。
- [x] 2.2 [P0] 新增 `claude-markdown-stream-recovery`，用于 Claude engine-level visible stall recovery。
- [x] 2.3 [P0] 将 `visible-output-stall-after-first-delta` timer / activation 从 Windows-only 放宽到 Claude engine-level evidence path。
- [x] 2.4 [P0] 调整 Claude live middle-step collapse：在首个 assistant chunk 前保留 latest reasoning row，并避免 `WorkingIndicator` 把它变成唯一可见文案。

## 3. Backend Snapshot Dedup

- [x] 3.1 [P0] 修正 Claude parser，让 `stream_event text_delta` 与后续 `assistant` cumulative snapshot 共用同一 emitted-text tracker。
- [x] 3.2 [P0] 补充 Rust 回归测试，覆盖“先 streamed delta、后 final assistant snapshot”时只发真实增量。
- [x] 3.3 [P0] 补充 reducer completed merge 兜底，避免已有 live markdown 再被 completed 主体整段拼接一次。
- [x] 3.4 [P0] 让 Claude turn completed 后按 Codex 模式调度一次 history reconcile，并修正 `refreshThread()` 对 Claude 的 force reload 空转问题。
- [x] 3.5 [P0] 拆分 Claude realtime reasoning / assistant render item id，避免 provider 复用原生 item id 时在幕布层互相覆盖。

## 4. Spec Sync

- [x] 4.1 [P1] 新建 OpenSpec change，记录本次问题边界、决策与风险。
- [x] 4.2 [P1] 修改稳定 spec，使其明确 long-markdown visible stall 可切到 temporary plain-text live surface，并在 completed 后回归 Markdown。
- [x] 4.3 [P1] 同步记录 Claude cumulative snapshot dedupe 与 completed duplicate collapse 行为。
- [x] 4.4 [P1] 同步记录 Claude same-id cross-kind realtime item 不得在 conversation curtain 中互相覆盖。

## 5. Validation

- [x] 5.1 [P0] 运行 targeted Vitest：`streamLatencyDiagnostics` + `MessagesRows.stream-mitigation` + `Messages` live behavior + completed duplicate collapse。
- [x] 5.2 [P0] 运行 targeted `cargo test`，覆盖 Claude streamed delta / final snapshot 收敛。
- [x] 5.3 [P1] 运行 `npm run typecheck`。
- [x] 5.4 [P1] 人工桌面检查 Claude 长对话：确认中后段不再长期停在短文案，末尾不再整段重复，completed 后仍回到最终 Markdown。
