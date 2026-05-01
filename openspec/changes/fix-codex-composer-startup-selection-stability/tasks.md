## 1. OpenSpec 回写

- [x] 1.1 整理本次 PR#480 后续修复的目标、边界与非目标，明确本 change 只覆盖 Codex composer 线程作用域启动恢复稳定性。
- [x] 1.2 新增 `codex-composer-startup-selection-stability` capability spec，沉淀冷启动、线程恢复、无效值自愈与 `pending -> canonical` 迁移约束。

## 2. 当前实现对齐

- [x] 2.1 以当前实现对齐 spec：`useModels` 同步派生模型列表，确保 `modelsReady` 与真实 catalog 内容一致。
- [x] 2.2 以当前实现对齐 spec：AppShell 线程级 selection 自愈仅在 `modelsReady` 后执行，并对全局默认值持久化使用有效 model / effort。
- [x] 2.3 以当前实现对齐 spec：Codex 无效线程 model / effort 在进入发送链前收敛为有效值。

## 3. 回归验证

- [x] 3.1 补齐并运行 AppShell 启动回归，覆盖已有线程恢复、无活动线程默认值恢复、无效线程选择自愈与 `pending -> canonical` finalize。
- [x] 3.2 运行最小相关质量门禁：`vitest` 定向集、`lint`、`typecheck`、`check:large-files`、`check:runtime-contracts`、`check:heavy-test-noise`。

## 4. 后续独立事项

- [ ] 4.1 单独修复 `doctor:strict` 当前暴露的 branding 遗留，确保该 change 回写后仓库重新满足严格健康检查。
