## Context

当前 `clientUiVisibility` 已经覆盖顶部会话栏、顶部工具、右侧活动工具栏、底部活动面板和幕布 presentation controls，但右下角 `GlobalRuntimeNoticeDock` 由 `useLayoutNodes` 独立挂载，并未接入 registry。结果是：

- 设置语义不完整：用户无法通过“界面显示”隐藏右下角悬浮球。
- spec 与 code 漂移：旧 proposal 明确把右下角入口列为目标，但当前 registry 漏接。
- 容易出现错误修补：若把 dock 临时塞进别的 panel，会污染既有 panel 语义。

本次改动是纯 frontend contract 补齐，不涉及 Tauri / Rust / storage schema 变更，但会同时触及 settings、layout 与 notice dock 三个模块，所以保留单独 design 文档更稳妥。

## Goals / Non-Goals

**Goals:**

- 用最小增量把 `GlobalRuntimeNoticeDock` 纳入现有 `clientUiVisibility` 体系。
- 保持 dock 作为独立 global surface 的产品语义，不错误归类到 `bottomActivityPanel`。
- 隐藏 dock 时继续保留 runtime notice feed 的 producer、buffer 与 minimized/expanded continuity。

**Non-Goals:**

- 不改变 dock 的 notice producer whitelist、bounded buffer、status 语义或 UI 布局。
- 不合并 `globalRuntimeNoticeDock.visibility` 与 `clientUiVisibility` 持久化结构。
- 不顺带治理其他 floating panels 或 toast surface。

## Decisions

### Decision 1: 把 dock 建模为独立 panel `globalRuntimeNoticeDock`

采用在 `CLIENT_UI_PANEL_REGISTRY` 中新增独立 panel id 的方案，而不是把它挂在 `bottomActivityPanel` 或伪装成某个 child control。

原因：

- dock 是 app-global fixed surface，不属于右下方 activity tabs。
- panel 级语义更贴近用户认知，设置页展示也更直接。
- 后续若还要纳入更多 floating surface，可以继续沿用独立 panel 模式，避免 registry 退化成杂项控制集合。

备选方案：

- 复用 `bottomActivityPanel`：会把两个不同 surface 错绑在一起，隐藏底部活动面板时顺手隐藏 dock，语义错误。
- 建成 `bottomActivity.runtimeNoticeDock` child control：dock 没有真实父 panel，会制造假层级。

### Decision 2: 仅 gate `GlobalRuntimeNoticeDock` render，不停止 `useGlobalRuntimeNoticeDock()`

在 `useLayoutNodes` 中继续调用 `useGlobalRuntimeNoticeDock()`，只在最终 `globalRuntimeNoticeDockNode` 处按 `clientUiVisibility.isPanelVisible("globalRuntimeNoticeDock")` 决定是否渲染组件。

原因：

- 这样不会中断全局 notice producer 与 feed 累积。
- minimized / expanded 状态仍然由既有 hook 与 `globalRuntimeNoticeDock.visibility` key 管理，不会因为 UI 隐藏而被重置。
- 改动面最小，不需要拆 hook 或增加新的中间 store。

备选方案：

- 隐藏时不调用 hook：会停止 feed 同步，违背“只隐藏不禁用”。
- 把 hook 提升到更高层 provider：能工作，但会引入本次需求不需要的新抽象。

### Decision 3: 保持 dock 自身 visibility state 与 `clientUiVisibility` 分层

`clientUiVisibility` 只负责“这个 surface 是否参与渲染”，而 dock 内部的 `minimized | expanded` 状态继续保留在 `globalRuntimeNoticeDock.visibility`。

原因：

- 两者职责不同：一个是 surface-level display preference，一个是 dock 自身 UI mode。
- 避免把一个稳定的单字段 local preference 强行嵌进更大的 registry，增加 migration 风险。
- 当用户重新显示 dock 时，可以直接恢复当前 dock mode，而不是额外做双向映射。

### Decision 4: 设置页为 dock 提供独立 icon 与文案，不复用现有底部活动描述

settings row 会使用独立的 panel label / description，强调这是“全局右下角运行时提示入口”，避免用户误以为它是 `status panel` 或 `bottom activity panel` 的一部分。

原因：

- 能直接对齐用户截图和 mental model。
- 避免把“dock 隐藏”误解成“底部状态 tab 隐藏”。

## Risks / Trade-offs

- [Risk] 新增 panel id 会改变 `clientUiVisibility` normalize 行为。
  → Mitigation: 补 util test，确保旧数据缺字段时默认 visible，未知 key 继续忽略。

- [Risk] 隐藏 dock 后，未来维护者误以为 hook 也该停掉。
  → Mitigation: 在 spec 和实现里明确“render gate only”，并通过测试锁住 hidden 时不渲染、但不修改 hook contract。

- [Risk] settings 文案不清楚，用户会把 dock 误认成底部 activity 面板的一部分。
  → Mitigation: 使用独立 panel 名和描述，强调“全局右下角”。

## Migration Plan

1. 新增 OpenSpec delta，补齐 capability contract。
2. 扩展 `clientUiVisibility` panel registry、类型、normalize 与 i18n。
3. 在 settings 显示新 panel toggle。
4. 在 `useLayoutNodes` 对 dock 增加 render gate，同时保留 hook 持续运行。
5. 补 focused tests 并跑 targeted validation。

Rollback：

- 删除 `globalRuntimeNoticeDock` panel registry、settings row 和 render gate，即可恢复现状。
- 已落盘的 `clientUiVisibility.panels.globalRuntimeNoticeDock` 会被旧版本当 unknown key 忽略，不阻塞启动。

## Open Questions

- 无。当前需求边界清晰，不需要新增 design-time 决策。
