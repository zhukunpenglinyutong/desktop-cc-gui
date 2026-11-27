# Issue #1562 Claude 单次工具审批测试报告

关联问题 [#1562](https://github.com/zhukunpenglinyutong/desktop-cc-gui/issues/1562)。

## 测试环境与数据

- 执行日期 2026-11-27，时区 Asia/Shanghai。
- 基线为上游 `v1.2.7` 的 `c116197d`，修复分支为 `fix/claude-tool-approval-1562`。
- macOS 27.2.1 arm64，Node.js 26.12.0，pnpm 10.29.3，Cargo 1.99.1，Claude Code 2.1.330。
- 前端使用 React 组件、模拟 IPC 和合成审批事件。Rust 集成测试使用临时目录、模拟 CLI、JSONL 协议帧和可推进时钟。真实 CLI 探测仅使用两个临时文本文件及 `Read` 工具。

## 根因与改动

应用收到 `can_use_tool` 后直接向 Claude 返回拒绝，用户无法决定该次工具调用。修复复用聊天输入区展示单次审批。后端串行处理决定并在写入 CLI 后广播结果。前端按接收顺序展示并行请求，落定后清除审批参数。同一次显式拒绝只按精确的 `tool_use_id` 合并。

## 回归用例

| 编号 | 优先级 | 前置条件与步骤 | 预期与实际结果 |
| --- | --- | --- | --- |
| R01 | P0 | 同一审批同时收到两个决定，模拟两个客户端消费广播 | CLI 只收到一个有效决定，两端状态一致，通过 |
| R02 | P0 | 显式拒绝后注入同 ID、不同 ID 和无 ID 的拒绝结果 | 仅同 ID 的重复拒绝被合并，通过 |
| R03 | P0 | 注入两个并行审批，依次处理，并模拟取消、超时和回合结束 | 按到达顺序展示，数量更新，失效请求不可再答，通过 |
| R04 | P0 | 提交允许、拒绝和含替换参数的决定，检查通知与已落定卡片 | 使用 CLI 原始参数，拒绝替换参数，通知、落定事件和记录无完整参数，通过 |
| R05 | P1 | 执行普通提问、多选、跳过、CodeBuddy、目录授权、计划审批、会话切换与中断用例 | 原有链路通过 |
| R06 | P0 | 真实 Claude CLI 并行请求读取两个临时文本文件，允许一个并拒绝另一个 | 待审批峰值为 2，只有获准文件产生内容，回合正常结束，通过 |

## 执行命令

在仓库根目录运行，Cargo 通过本机 Rust 工具链提供。

```bash
pnpm exec vitest run src/features/chat/question.test.tsx \
  src/features/chat/grant.test.tsx src/features/chat/grant.web.test.tsx \
  src/features/chat/components/session-history-selectors.test.tsx \
  src/features/chat/components/ConversationFooter.test.tsx \
  src/features/chat/store/engine-events.notifications.test.ts \
  src/features/chat/normalized-runtime-events.test.ts
cargo test --offline --manifest-path src-tauri/Cargo.toml --lib engine::
cargo test --offline --manifest-path src-tauri/Cargo.toml --test send_path --test plan_review
pnpm build
git diff --check
```

真实 CLI 探测使用 `acceptEdits`、stdio 审批、双向 stream-json 和 `Read` 的显式询问规则，并关闭自定义配置、MCP 服务和会话持久化。向 CLI 提交两个并行读取请求，在两个审批均待处理时，用收到的 `request_id` 分别回复 `allow` 和 `deny`。允许回复使用对应请求的原始 `input`。

```text
approved=1; denied=1; peak_pending=2; allowed_fixture_seen=True; denied_fixture_seen=False; result=success
```

## 执行结果

| 检查 | 通过 | 失败 | 证据 |
| --- | ---: | ---: | --- |
| 前端回归 | 73 | 0 | 7 个测试文件通过 |
| Rust 引擎单元测试 | 555 | 0 | 引擎测试汇总为 555 通过 |
| 发送与计划审批集成 | 13 | 0 | `send_path` 8 项及 `plan_review` 5 项通过 |
| 真实 CLI 协议探测 | 1 | 0 | 并行峰值 2，允许内容可见，拒绝内容未读取 |
| 前端构建与差异检查 | 通过 | 0 | TypeScript 和 Vite 构建完成，`git diff --check` 通过 |

## 终审结论

已检查权限参数来源、请求与回包关联、并行决定写入顺序、拒绝去重、回合清理和聊天事件传递。工具审批继续使用现有 Claude 进程与传输，授权范围为当前请求。回归范围内未发现阻塞提交的缺陷。
