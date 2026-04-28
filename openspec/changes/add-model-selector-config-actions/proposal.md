## Why

用户在外部配置文件中新增或修改模型后，当前模型选择器不会立即给出“添加模型 / 刷新配置”的清晰入口；尤其是 Claude Code 的 `settings.json` 需要等待后台重新读取，用户无法判断新模型何时进入下拉列表。

这次变更要把模型选择下拉的底部动作做成稳定 contract：左侧进入当前引擎的添加模型入口，右侧立即刷新当前引擎配置，并覆盖 `Codex`、`Claude Code`、`Gemini` 三条链路。

## 目标与边界

### 目标

- 在模型选择下拉底部提供双操作区：左侧 `添加模型`，右侧 `刷新配置`。
- 三个 provider 一致支持：`Codex`、`Claude Code`、`Gemini`。
- `添加模型` 必须进入当前 provider 对应的模型/供应商配置入口，不能跳到错误引擎。
- `刷新配置` 必须立即重新读取当前 provider 的模型配置源，并刷新下拉模型列表。
- 刷新过程必须有可见 loading / disabled 状态，避免重复点击造成竞态。
- 刷新成功后必须保留仍然有效的当前模型选择；仅当当前模型已不存在时才按现有默认选择规则回退。

### 边界

- 仅处理 composer 模型选择器中的 provider-scoped footer actions。
- 刷新配置只更新模型目录、settings/config-derived model 显示和当前引擎状态快照；不自动发送消息、不创建新 session。
- 每个 provider 继续使用自己的 source of truth：
  - `Codex`: runtime/model list 与 `~/.codex/config.toml` / custom model catalog。
  - `Claude Code`: `~/.claude/settings.json` 中的 model/env override 与 CLI 可发现模型。
  - `Gemini`: `~/.gemini/settings.json` / Gemini vendor settings 与 CLI 可发现模型。
- 实现优先复用现有 `get_engine_models`、Codex runtime reload、vendor settings refresh 与 app-shell `refreshEngineModels` 链路。

## 非目标

- 不新增第四个引擎，也不处理 `OpenCode` 模型选择器。
- 不重做供应商管理页面的信息架构。
- 不把刷新按钮做成“保存配置”；用户仍需在配置页完成保存。
- 不修改外部 CLI 的官方配置格式。
- 不在刷新失败时清空现有模型列表或当前可用 session。

## What Changes

- `ModelSelect` 底部从单个 `添加模型` 操作升级为左右双按钮：
  - 左侧：`添加模型`。
  - 右侧：`刷新配置`。
- `ButtonArea` / composer adapter 需要向 `ModelSelect` 传入当前 provider 的刷新回调和刷新状态。
- provider-scoped refresh 行为需要统一：
  - `Codex`: 重读 Codex runtime/config model 与模型列表；当前无连接时仍刷新本地 custom/built-in catalog，并给出“下次连接生效”语义。
  - `Claude Code`: 立即重新读取 `~/.claude/settings.json` model override，并刷新 Claude 模型 catalog。
  - `Gemini`: 立即重新读取 Gemini settings/vendor env，并刷新 Gemini 模型 catalog。
- 刷新失败时，UI 必须保留旧列表并显示可诊断错误，不能把下拉变成空态。
- 模型选择器测试需要覆盖三引擎 footer action、刷新 loading、失败保留旧列表、刷新后 dedupe 与当前选择保留。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险 / 成本 | 结论 |
|---|---|---|---|---|
| A | 在 `ModelSelect` 内按 provider 直接调用各自 service | 改动短、看似直接 | UI 组件耦合 Tauri/service，测试困难；后续 provider 增加会继续膨胀 | 不采用 |
| B | 由上层传入 `onAddModel`、`onRefreshConfig`、`isRefreshingConfig`，`ModelSelect` 只负责布局与交互 | 组件纯净；provider 行为留在 app-shell / engine hook；符合现有 props pattern | 需要补齐跨层回调接线和状态命名 | 采用 |
| C | 只在设置页增加刷新按钮，不改模型下拉 | 不碰 composer UI | 不能解决用户在选择模型时发现配置未更新的主问题 | 不采用 |

## Capabilities

### New Capabilities

- `composer-model-selector-config-actions`: 定义模型选择器底部 `添加模型 / 刷新配置` 双动作，以及 Codex / Claude Code / Gemini 的 provider-scoped 刷新 contract。

### Modified Capabilities

- 无。现有 `codex-external-config-runtime-reload` 与 `vendor-gemini-settings` 的底层配置读取语义保持不变，本变更只新增 composer 下拉入口与共享 UI contract。

## 验收标准

- 打开 `Codex` 模型下拉时，底部 MUST 显示左侧 `添加模型`、右侧 `刷新配置`。
- 打开 `Claude Code` 模型下拉时，底部 MUST 显示左侧 `添加模型`、右侧 `刷新配置`。
- 打开 `Gemini` 模型下拉时，底部 MUST 显示左侧 `添加模型`、右侧 `刷新配置`。
- 点击左侧 `添加模型` MUST 进入当前 provider 的模型/供应商配置入口，不能固定跳到 Claude 或 Codex。
- 点击右侧 `刷新配置` MUST 只刷新当前 provider 的模型配置与 catalog，不影响其他 provider 的模型缓存。
- 刷新进行中 MUST 禁用刷新按钮并展示 loading 状态；重复点击不得并发触发多次刷新。
- 刷新成功后，新增或修改后的模型 MUST 出现在下拉列表中。
- 刷新失败后，旧模型列表 MUST 保留，当前选择 MUST 不被清空，并且错误 MUST 可见或可诊断。
- 如果当前选择在刷新后仍存在，系统 MUST 保留该选择。
- 如果当前选择在刷新后已不存在，系统 MUST 使用现有默认模型选择规则回退。

## Impact

- Frontend:
  - `src/features/composer/components/ChatInputBox/selectors/ModelSelect.tsx`
  - `src/features/composer/components/ChatInputBox/ButtonArea.tsx`
  - `src/features/composer/components/ChatInputBox/ChatInputBoxFooter.tsx`
  - `src/features/composer/components/ChatInputBox/ChatInputBox.tsx`
  - `src/features/composer/components/ChatInputBox/ChatInputBoxAdapter.tsx`
  - `src/features/engine/hooks/useEngineController.ts`
  - i18n locale files for `models.refreshConfig` / loading / error copy
- Backend / Tauri:
  - 优先复用现有 `get_engine_models`、Codex config reload、Gemini vendor settings command。
  - 若 Claude/Gemini 缺少显式 refresh command，则在现有 engine model refresh 路径内补齐，不新增不必要 command。
- Tests:
  - `ModelSelect` / `ButtonArea` / `useEngineController` focused tests。
  - 必要时补充 `src/services/tauri.test.ts` 参数映射测试。
- Dependencies:
  - 不新增第三方依赖。
- Validation:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test -- --run src/features/composer/components/ChatInputBox/selectors/ModelSelect.test.tsx src/features/composer/components/ChatInputBox/ButtonArea.test.tsx src/features/engine/hooks/useEngineController.test.tsx`
