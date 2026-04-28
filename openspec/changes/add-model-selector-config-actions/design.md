## Context

当前 composer 的 `ModelSelect` 已经有 `onAddModel` footer action，但它是单动作布局；用户在模型下拉里发现外部配置未同步时，只能离开当前上下文等待后台刷新或去设置页找入口。Claude Code 的模型列表会读取 `~/.claude/settings.json` 中的 model/env override，但没有一个贴近模型选择器的手动刷新入口。

现有系统已经具备部分底层能力：`get_engine_models(engineType)` 可按引擎刷新模型 catalog，Codex 有 runtime config reload，Gemini 有 vendor settings/preflight commands。缺口不在于创造新的配置格式，而在于把这些已有能力收口成 provider-scoped 的 selector action contract。

## Goals / Non-Goals

**Goals:**

- 让 `ModelSelect` 底部稳定呈现左右双动作：左 `添加模型`，右 `刷新配置`。
- 让 `Codex`、`Claude Code`、`Gemini` 都复用同一个 selector UI contract。
- 让刷新行为只影响当前 provider 的模型/config snapshot，避免误刷新其他引擎。
- 保持 `ModelSelect` 主要作为 presentational component，不直接依赖 Tauri service。
- 刷新时保留旧列表和当前选择，失败可诊断。

**Non-Goals:**

- 不把 `ModelSelect` 改成供应商配置编辑器。
- 不为 `OpenCode` 增加 footer action。
- 不改变外部 config 文件格式。
- 不引入新的 persisted state schema。
- 不把 refresh 做成后台轮询；本变更只定义显式手动刷新。

## Decisions

### Decision 1: Keep ModelSelect provider-agnostic

`ModelSelect` 只新增交互 props，例如：

- `onAddModel?: () => void`
- `onRefreshConfig?: () => Promise<void> | void`
- `isRefreshingConfig?: boolean`
- `refreshConfigError?: string | null`

它负责布局、loading、disabled、aria-label 和调用回调；不在组件内部判断 Codex / Claude / Gemini 的 service 细节。

替代方案是在 `ModelSelect` 内直接 switch provider 并调用 Tauri service。这个方案短期更快，但会让 UI 组件承担 runtime/config orchestration，后续每个 provider 的差异都会污染下拉组件，测试也会变重。

### Decision 2: Refresh is routed by the current provider at the composer boundary

`ButtonArea` / `ChatInputBoxFooter` / adapter 层已经知道 `currentProvider`，适合作为 selector UI 与 engine controller 的连接点。刷新动作应按当前 provider 路由：

- `codex`: 刷新 Codex model list、config model，并在有可用 runtime 时触发已有 runtime config reload。
- `claude`: 调用 engine model refresh，让 backend 重新读取 `~/.claude/settings.json` overrides 与 CLI-discovered models。
- `gemini`: 调用 engine model refresh，让 backend 重新读取 Gemini vendor/settings-derived model 与 CLI-discovered models。

替代方案是统一调用全量 `refreshEngines()`。这会刷新所有引擎，成本更高，也可能把用户当前不关心的 provider 状态变化带入 composer。

### Decision 3: Refresh is serialized per provider and keeps stale data on failure

刷新按钮需要有本地 in-flight guard。重复点击时不并发触发第二次刷新；失败时保留旧模型列表和当前选择，只展示错误状态/调试记录。

替代方案是失败后清空列表并强制用户重新打开下拉。这个行为会把配置读取错误放大成 composer 不可用，不符合 fail-safe 目标。

### Decision 4: Selection preservation follows existing default-pick rules

刷新完成后：

1. 如果当前 selected model 仍存在于 refreshed catalog，继续保留。
2. 如果当前 selected model 不存在，再交给现有 default model / preferred model 选择逻辑。

不新增“刷新后自动选中新模型”的特殊逻辑。新模型出现不等于用户想切换；显式选择仍由用户完成。

### Decision 5: Footer layout is a split action row, not nested menu items

模型下拉底部使用一个 split row，两侧按钮宽度一致或可响应压缩，左侧 `添加模型`、右侧 `刷新配置`。两个按钮都有独立 hover/disabled/loading/focus 状态，并保持在 dropdown 内部，不再额外打开二级菜单。

理由：用户截图明确表达左右两个底部操作区；二级菜单会增加点击成本，也不利于快速刷新。

## Risks / Trade-offs

- [Risk] Codex runtime reload 与 model list refresh 语义不同，简单合并可能误报“已刷新”。
  → Mitigation: Codex 刷新结果区分 model catalog refresh 与 runtime config reload；无连接 runtime 时反馈“模型目录已刷新，runtime 下次连接生效”。

- [Risk] Claude / Gemini 的 backend detection 缓存可能导致 settings 文件修改后仍显示旧模型。
  → Mitigation: refresh path 必须绕过或更新当前 provider 的 cached model status，不能只读旧 `engineStatuses.models`。

- [Risk] 三个 provider 的配置源不一致，过度抽象会掩盖差异。
  → Mitigation: UI contract 共享，provider adapter 保留差异；不强行统一 config file schema。

- [Risk] 刷新失败 toast 太吵。
  → Mitigation: 保留 debug entry，UI 只展示轻量错误/tooltip；不阻塞模型选择器关闭或继续使用旧模型。

## Migration Plan

1. 扩展 `ModelSelect` props 与 footer layout，保留已有 `onAddModel` 兼容行为。
2. 从 `ButtonArea` 到上层 adapter 接入 `onRefreshConfig` 与 `isRefreshingConfig`。
3. 在 engine/controller 边界实现 provider-scoped refresh helper，复用 `refreshEngineModels` 和已有 Codex/Gemini config refresh 能力。
4. 补齐 i18n copy：`添加模型`、`刷新配置`、`正在刷新配置`、刷新失败提示。
5. 添加 focused tests，覆盖 Codex / Claude / Gemini footer actions、loading guard、失败保留旧列表、选择保留。

Rollback 策略：保留 `onAddModel` 单动作路径，移除 `onRefreshConfig` 接线和双按钮样式即可回到当前 UI；不涉及持久化数据迁移。

## Open Questions

- Codex 无连接 runtime 时，刷新按钮是否只显示成功轻提示，还是需要明确标出“runtime 下次连接生效”？建议实现时沿用现有 Codex config reload copy。
- `添加模型` 对 Gemini 应落到 vendor settings 的 Gemini tab，还是直接打开新增模型字段区域？本 change 只要求进入正确 provider 配置入口，具体聚焦位置可在实现中按现有设置页能力决定。
