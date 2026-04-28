## Context

当前基础外观页已经承载主题、语言、canvas width、layout mode、UI scale、字体和消息颜色等客户端外观偏好。用户这次提出的是更高层的信息密度控制：把截图红框中的面板和 icon 按钮变成可隐藏对象。

这类偏好有两个关键约束：

- 它是 client-only presentation preference，不应改动 runtime、Git、任务、Agent、文件浏览等业务状态。
- 它需要在多个 UI 区域同时生效：设置页、顶部区域、右侧 toolbar、右下活动面板和角落状态按钮。

因此本设计把它建模为统一的 `clientUiVisibility` 偏好，并由 shell 层向各区域传入可见性查询结果。

## Objective Analysis

### What is structurally simple

- Preference persistence is simple: existing `clientStorage` already supports client-only settings, and hidden/visible can be represented as sparse boolean overrides.
- Default behavior is simple: missing fields resolve to visible, so old users and invalid storage both get the current UI.
- Reset behavior is simple: clearing the stored override or writing the default-visible object returns the app to the current layout.

### What is structurally hard

- Component ownership is fragmented. The red-box targets live across top bar, shell section composition, right-side panels, and session activity surfaces. The work is mostly “find the right boundary and pass a stable query,” not complex state modeling.
- Icon-level hiding can create visual debt. Removing a single button may leave separators, grouped border radii, count badges, or keyboard hints in the wrong state.
- Hidden-but-functional semantics are easy to violate. If implementation unmounts a panel owner that also owns data collection, it may accidentally stop listeners or reset active tab state.

### What must not be optimized too early

- Per-workspace UI visibility: tempting, but it adds a second dimension to the preference model and complicates recovery.
- Layout presets: useful later, but not required for “hide noisy UI”.
- Drag/drop toolbar customization: much higher interaction complexity than binary visibility toggles.
- Backend-backed settings: unnecessary unless visibility must sync across machines later.

### Recommended implementation posture

Use a conservative frontend-only slice:

1. Build registry + normalization first.
2. Add settings UI second.
3. Wire one UI region at a time with tests.
4. Stop after the red-box targets are covered.

This keeps the feature reversible and prevents a small display preference from becoming an app-shell rewrite.

## Goals / Non-Goals

**Goals:**

- 提供统一的 UI visibility schema，覆盖 panel layer 和 control layer。
- 设置页可以查看、切换、重置这些 visibility preferences。
- 主界面按 preference 进行 conditional render，隐藏元素不参与 focus / keyboard tab order。
- 默认全量可见，异常配置全量可见 fallback。
- 最大隐藏状态仍保留聊天主路径。

**Non-Goals:**

- 不把隐藏行为做成权限、feature flag 或 backend setting。
- 不让隐藏动作触发业务状态 reset。
- 不重构主布局，不引入新布局引擎。
- 不给所有历史 UI 元素做可见性配置；只纳入 proposal 指定目标。

## Decisions

### Decision 1: Persist visibility in clientStorage, not backend AppSettings

采用新的 client-only store key，例如：

```ts
scope: "app"
key: "clientUiVisibility"
```

存储 normalized preference：

```ts
type ClientUiVisibilityPreference = {
  panels: Partial<Record<ClientUiPanelId, boolean>>;
  controls: Partial<Record<ClientUiControlId, boolean>>;
};
```

`true` 表示 visible，`false` 表示 hidden；缺失字段按默认 visible 处理。

原因：

- 用户明确要求“纯前端逻辑”，`clientStorage` 已是 renderer 侧持久化偏好的既有工具。
- 避免修改 Rust `AppSettings` struct、serde default 和 Tauri command contract。
- visibility preference 不需要被 backend 理解，也不需要参与 workspace / runtime 逻辑。

备选方案是把字段加进 `AppSettings`。它的优点是设置页已有 `onUpdateAppSettings` 流程，缺点是会把纯显示偏好推进 Rust 类型与 backend persistence，扩大不必要的 cross-layer 影响。

### Decision 2: Use a central registry for panels and controls

新增一个 registry 描述可控对象，而不是在设置页硬编码多份列表：

```ts
type ClientUiPanelId =
  | "topSessionTabs"
  | "topRunControls"
  | "topToolControls"
  | "rightActivityToolbar"
  | "bottomActivityPanel"
  | "cornerStatusIndicator";

type ClientUiControlId =
  | "topRun.start"
  | "topTool.openWorkspace"
  | "topTool.runtimeConsole"
  | "topTool.terminal"
  | "topTool.focus"
  | "topTool.rightPanel"
  | "rightToolbar.activity"
  | "rightToolbar.radar"
  | "rightToolbar.git"
  | "rightToolbar.files"
  | "rightToolbar.search"
  | "bottomActivity.tasks"
  | "bottomActivity.agents"
  | "bottomActivity.edits"
  | "bottomActivity.latestConversation"
  | "curtain.stickyUserBubble"
  | "cornerStatus.messageAnchors";
```

每个 control 记录自己的 parent panel。查询规则：

```ts
isPanelVisible(panelId) = normalized.panels[panelId] !== false
isControlVisible(controlId) =
  isPanelVisible(parentPanelId(controlId)) &&
  normalized.controls[controlId] !== false
```

这样设置页和 shell 渲染读取同一个 registry，避免 label、父子关系、默认值 drift。

备选方案是在每个组件内独立判断配置。短期修改少，但无法可靠表达父面板隐藏后子 icon 仍保留自身偏好的规则。

### Decision 3: Conditional render before CSS hiding for interactive elements

对 button / tab / toolbar entry 采用 conditional render；对只影响布局外壳的容器可辅以 className。

原因：

- 被隐藏 icon 不应出现在 accessibility tree 或 tab order。
- 避免 `display:none` 残留 focus trap、tooltip、快捷键提示或 hover hit area。
- React conditional render 更容易用 testing-library 断言不存在。

备选方案是全局 CSS 隐藏。它适合一次性视觉试验，但不适合 icon 粒度和可访问性约束。

### Decision 4: Hidden means visually unavailable, not functionally disabled

隐藏动作只影响入口是否显示：

- 不停止任务/Agent/session activity 采集。
- 不清空 Git diff、right panel state 或 active tab。
- 不取消已有 keyboard shortcut。
- 不关闭当前 session 或 composer。

当用户通过快捷键、菜单或其他入口触发被隐藏区域对应功能时，功能仍按现有逻辑执行；如果该功能必须依赖可见 panel，现有打开/展开逻辑可以临时显示目标或保留当前 fallback，但本 change 不定义功能禁用。

### Decision 5: Settings UI uses grouped toggles with reset

基础外观页新增一个“界面显示” group：

- 第一层展示 panel toggle。
- 展开或缩进展示该 panel 下的 control toggles。
- 父 panel hidden 时，子 control toggle 保持可编辑或弱化展示，但需要明确它们会在父 panel 恢复后生效。
- 提供“恢复默认显示”按钮，把所有 panels / controls 重置为 visible。

这里不用复杂的 drag/drop 或 layout preset，避免把一个隐藏需求扩展成布局编辑器。

## Target Mapping

首批 registry 对应截图红框目标：

| Layer | ID | 描述 |
|---|---|---|
| Panel | `topSessionTabs` | 顶部多会话 Tab 面板 |
| Panel | `topRunControls` | 顶部运行/状态控制 icon 组 |
| Control | `topRun.start` | 运行/播放按钮 |
| Panel | `topToolControls` | 顶部中间工具 icon 组 |
| Control | `topTool.openWorkspace` | 打开工作区应用入口 |
| Control | `topTool.runtimeConsole` | Runtime console 快捷入口 |
| Control | `topTool.terminal` | 窗口/终端类入口 |
| Control | `topTool.focus` | 聚焦/定位类入口 |
| Control | `topTool.rightPanel` | 右侧面板开关 |
| Panel | `rightActivityToolbar` | 右上侧活动 toolbar |
| Control | `rightToolbar.activity` | 活动/波形入口 |
| Control | `rightToolbar.radar` | 雷达/列表入口 |
| Control | `rightToolbar.git` | Git 分支入口 |
| Control | `rightToolbar.files` | 文件夹入口 |
| Control | `rightToolbar.search` | 搜索入口 |
| Panel | `bottomActivityPanel` | 右下活动面板 |
| Control | `bottomActivity.tasks` | 任务 tab |
| Control | `bottomActivity.agents` | Agent tab |
| Control | `bottomActivity.edits` | 编辑 tab |
| Control | `bottomActivity.latestConversation` | 最新对话 tab |
| Panel | `cornerStatusIndicator` | 幕布区域 presentation controls |
| Control | `curtain.stickyUserBubble` | 幕布顶部用户气泡吸顶条 |
| Control | `cornerStatus.messageAnchors` | 幕布消息锚点栏 |

实现时如果源码里实际命名与截图语义不同，应以现有组件名为准，但 registry id 应保持稳定，避免后续持久化 key churn。

## Risks / Trade-offs

- [Risk] Component owner discovery takes longer than the state model.
  → Mitigation: Start with an implementation audit and map each target to its real owner before writing visibility conditionals.

- [Risk] 可控对象太细导致设置页噪声高。
  → Mitigation: 使用面板分组和折叠/缩进，默认只强调 panel toggle，icon toggle 作为细节层。

- [Risk] 某些 icon 同时承担状态展示和入口功能，隐藏后用户误以为功能停止。
  → Mitigation: 设置文案明确“仅隐藏入口，不关闭功能”；测试确认后台状态不 reset。

- [Risk] 配置字段未来重命名导致用户偏好丢失。
  → Mitigation: registry id 使用语义稳定名称；normalize 忽略未知 key，缺失 key visible fallback。

- [Risk] 右侧底部 panel 被隐藏后，相关 keyboard shortcut 打开状态与视觉状态冲突。
  → Mitigation: 本 change 要求隐藏不禁用功能；实现时需要在打开类操作中检查是否应展示替代入口或保持 panel hidden，不得直接 reset 数据。

- [Risk] 最大隐藏状态通过测试但实际操作不舒服。
  → Mitigation: Manual smoke 必须覆盖“隐藏全部 -> 发送一条消息 -> 打开设置 -> reset all”，而不是只做 DOM 断言。

## Migration Plan

1. 新增 `clientUiVisibility` registry、default preference、normalize helper 和 hook。
2. 设置页基础外观 section 接入 hook，渲染 panel/control toggles 和 reset。
3. shell 层读取 hook，向顶部/右侧/底部区域传递 `isPanelVisible` / `isControlVisible` 查询结果。
4. 对目标 panel/control 做 conditional render。
5. 添加 focused tests 覆盖默认、隐藏、父子规则、reset 和最大隐藏聊天保底。

Rollback 策略：

- 删除设置页 group 和 shell conditional render 接线即可恢复全量显示。
- 保留或忽略 `clientStorage.app.clientUiVisibility` 均不影响旧版本启动，因为 backend 不读取该 key。

## Open Questions

- Resolved: 幕布相关 presentation controls 使用 `cornerStatusIndicator` virtual panel 承载；UI title 展示为“幕布区域”，内部控制 `curtain.stickyUserBubble` 与 `cornerStatus.messageAnchors`。
- 父 panel hidden 时，子 control toggle 是否允许编辑？建议允许编辑并显示“父面板恢复后生效”的轻提示，避免用户必须反复打开父级才能预设细节。
