## 0. 实施批次

### Batch A [P0] 基础模式开放

- [x] A.1 去掉 Claude 模式初始化时的强制 `full-access` 覆盖，保证 mode selection 是真实 runtime input
- [x] A.2 调整 Claude mode gating：开放 `plan` / `bypassPermissions`，后续再逐步开放其余模式
- [x] A.3 校准 Claude 模式中英文文案，避免把未完成能力描述成稳定能力
- [x] A.4 补 UI mode -> payload mapping -> CLI flag 回归测试

### Batch B [P0] Claude synthetic approval bridge

- [x] B.1 为 Claude `default` 文件权限阻塞生成 synthetic approval request，并接入现有 approval 主链
- [x] B.2 前端 approval 弹窗支持逐条审批和“本次全部操作”批量审批
- [x] B.3 审批后用 `--resume` 继续原会话，而不是停在审批摘要
- [x] B.4 多文件审批只在最后一个请求完成时 finalize turn，避免执行中断
- [x] B.5 reducer 使用完整 approval identity 处理去重/移除，修复只按 `request_id` 的竞态
- [x] B.6 审批历史去噪：resume marker 不直接暴露给用户，历史恢复为结构化 `File changes` 卡片

### Batch C [P0] synthetic local apply 边界修复

- [x] C.1 支持 `Write` / `CreateFile` / `CreateDirectory` 的本地 apply
- [x] C.2 处理缺失父目录创建，避免批准后因目录不存在导致落盘失败
- [x] C.3 修复 Windows / nested path 路径归一化与 workspace 越界校验
- [x] C.4 为 unknown request id、空路径、缺 tool metadata 等异常输入增加拒绝路径

### Batch D [P1] 大文件治理

- [x] D.1 将 `src-tauri/src/engine/claude.rs` 中 approval / manager / stream tests 按职责拆分
- [x] D.2 新增 `src-tauri/src/engine/claude/approval.rs`
- [x] D.3 新增 `src-tauri/src/engine/claude/manager.rs`
- [x] D.4 新增 `src-tauri/src/engine/claude/tests_stream.rs`
- [x] D.5 通过 `check:large-files:gate`，确保 `claude.rs` 回到 3000 行门禁内

### Batch E [P1] 后续阶段

- [ ] E.1 继续收敛 Claude 原生命令审批 shape，避免非文件工具仍退化
  - [x] E.1.a 已识别的 command execution / shell / native command denial 先统一映射到 `modeBlocked` 诊断链，并补齐工具名与安全阻塞文案变体识别
  - [x] E.1.b 补齐嵌套 `toolUseResult` / `tool_use_result` error payload、顶层 string error 与缺失 `is_error` 标记时的 shell/native command permission shape 识别
  - [ ] E.1.c 评估哪些非文件工具可以安全进入下一阶段 synthetic bridge
    - 当前评估见 `openspec/docs/claude-mode-rollout-non-file-approval-bridge-evaluation-2026-04-17.md`
    - 当前结论：generic `Bash/shell/native command` 不建议进入 bridge；结构化 file-change tool 已补齐 `Edit/Rewrite/MultiEdit/Delete` 本地 apply，`NotebookEdit` 仍待评估
  - [x] E.1.d 收敛 Claude inline approval surface：审批卡增强结构识别、移到底部承接，并隐藏大段正文类字段
  - [x] E.1.e 收敛 `ExitPlanMode` 执行承接：卡片内显式选择“默认审批模式 / 全自动”，并同步 selector 后再执行
  - [x] E.1.f 修复历史 Claude 会话中切到 `plan` 后仍沿用可写 access mode 的状态泄漏
- [x] E.2 校验并对齐 `acceptEdits` 的真实 CLI 语义
- [ ] E.3 在语义确认后开放 Claude `acceptEdits`

## 1. 验证门禁

- [x] V.1 `npm run check:large-files:gate`
- [x] V.2 `npm run typecheck`
- [x] V.3 `npm run test`
- [ ] V.4 Claude 手测矩阵补齐：
  - 手测矩阵见 `openspec/docs/claude-mode-rollout-v4-manual-test-matrix-2026-04-17.md`
  - `plan` 模式只读执行
  - `full-access` 不进入审批链
  - `default` 触发单文件审批、批量审批、审批后继续执行
  - 历史重开后仍能恢复 `File changes` 卡片
  - `default` 命中 command execution / shell 权限阻塞时进入 `modeBlocked` 诊断
  - inline approval 卡片位于消息幕布底部，且视觉上明显区别于普通 toast
  - approval detail 默认不展示 `content` / patch / diff 正文
  - `ExitPlanMode` 卡片展示“已确认计划。接下来执行需要离开规划模式”
  - 点击“切到默认审批模式并执行”后，selector 从 `plan` 切到执行态并以 `default` 继续执行
  - 点击“切到全自动并执行”后，selector 从 `plan` 切到执行态并以 `full-access` 继续执行
  - 历史 Claude 会话手动切到 `plan` 后继续发送编辑请求时，runtime access mode 必须是 `read-only`，不得再出现创建/修改审批卡
  - `acceptEdits` 在开放前保持禁用

## 2. 回滚策略

- [ ] R.1 如果 Claude synthetic approval bridge 回归异常，先回退 `default` 对外开放，但保留 `plan/full-access`
- [ ] R.2 如果 resume continuity 不稳定，优先保守回退到“审批后结束 turn”，避免写入成功但线程挂死
- [ ] R.3 如果 large-file 门禁再次失败，继续按职责拆分 `claude.rs`，禁止重新堆回单文件
