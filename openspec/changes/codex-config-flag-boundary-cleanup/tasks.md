## 1. Rust Config Ownership Refactor

- [x] 1.1 收口 `src-tauri/src/codex/config.rs`，将 private feature flags 与 official `unified_exec` passthrough 分离，禁止再批量暴露 `collab` / `collaboration_modes` / `steer` / `collaboration_mode_enforcement`
- [x] 1.2 修改 `src-tauri/src/shared/settings_core.rs`，移除四个 private flags 的 external read/write 覆盖，只保留 app-local settings source-of-truth
- [x] 1.3 确认 `src-tauri/src/shared/codex_core.rs`、`src-tauri/src/codex/session_runtime.rs`、`src-tauri/src/shared_sessions.rs` 仍从 app settings 读取 `codex_mode_enforcement_enabled`，不依赖 external config

## 2. Settings Surface Cleanup

- [x] 2.1 清理 `experimentalCollabEnabled` 的产品能力面暴露，移除或降级“多代理”假开关，确保它不再参与真实行为与 external config 同步
- [x] 2.2 更新 `src/features/settings/components/SettingsView.tsx` 与 i18n 文案，明确 app-local 开关和 official Codex config passthrough 的边界
- [x] 2.3 校验 collaboration modes / steer / enforcement 相关前端 wiring 仍只依赖 app-local settings，不受 external historical flags 影响

## 3. Official Passthrough Preservation

- [x] 3.1 为 `experimentalUnifiedExecEnabled` 保留显式 passthrough 路径，并在实现中单列 ownership，避免继续复用旧的批量 feature 同步模型
- [x] 3.2 校验 external config reload、settings restore 与 config path 相关流程对 `unified_exec` 的行为一致性

## 4. Verification

- [x] 4.1 补 Rust / TypeScript targeted tests，覆盖：
  - private flags 不再写入 `config.toml`
  - historical private flags 不再反向覆盖 app settings
  - `unified_exec` 仍可按显式路径透传
- [x] 4.2 运行 `npm run lint`、`npm run typecheck`、相关 `vitest` 与 `cargo test`，记录结果
- [x] 4.3 验证设置页与 `~/.codex/config.toml` 写回效果：
  - 切换 collaboration modes / steer / enforcement 后不再出现私有字段写回
  - 切换 unified exec 后仅该官方字段发生预期变化

## 5. 实施结果

- [x] 5.1 已完成代码落地：
  - Rust config bridge 仅保留 `unified_exec` external passthrough
  - private flags 已从 `settings_core` external read/write 中移除
  - `experimentalCollabEnabled` 已收口为 inert legacy field，设置页不再展示 “Multi-agent” 假开关
  - experimental 文案已改为明确区分 official passthrough 与 desktop-local settings
- [x] 5.2 已完成定向自测：
  - `npm run typecheck`
  - `npm run lint`（0 error，存在仓库既有 `react-hooks/exhaustive-deps` warnings）
  - `cargo test --manifest-path src-tauri/Cargo.toml settings_core`
  - `cargo test --manifest-path src-tauri/Cargo.toml get_app_settings_core_ignores_private_external_feature_flags`
  - `cargo test --manifest-path src-tauri/Cargo.toml update_app_settings_core_only_syncs_unified_exec_to_external_config`
  - `npx vitest run src/features/settings/components/SettingsView.test.tsx -t "removes the dead multi-agent toggle and explains local-vs-official ownership" src/features/collaboration/hooks/useCollaborationModes.test.tsx`
- [x] 5.3 已完成 code-level 写回验证：
  - `update_app_settings_core_only_syncs_unified_exec_to_external_config` 断言 `config.toml` 仅写入 `unified_exec`
  - `get_app_settings_core_ignores_private_external_feature_flags` 断言历史 private flags 不会反向覆盖 app-local settings
- [x] 5.4 已记录当前残余测试噪音：
  - `SettingsView.test.tsx` 中存在 3 个与本次改动无关的 session catalog 旧脆弱用例，报错点位于 `useWorkspaceSessionCatalog.ts` 的 `response.data` 处理链
