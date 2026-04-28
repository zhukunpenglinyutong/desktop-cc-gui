## Why

当前快捷键能力已经开始进入 Settings，但新增入口仍然分散在不同 hook、menu accelerator 和局部组件里。随着 session 切换、左右对话侧栏、terminal、runtime console、files 等位置都需要快捷键，如果继续逐个加监听器，后续会出现默认值冲突、平台映射不一致、Settings 展示缺漏和 i18n drift。

这次变更要把“应用级快捷键”定义成稳定 contract：每个用户可见快捷动作都有统一 action id、默认值、Settings 可配置项、平台化显示和冲突防御。

## 目标与边界

### 目标

- 为打开的 session 提供前一个 / 后一个快速切换快捷键。
- 为左侧对话侧边栏、右侧对话/面板侧边栏提供隐藏 / 展开快捷键。
- 继续把 terminal toggle 纳入统一快捷键设置，并补齐 runtime console toggle。
- 为 files surface 增加可配置快捷入口，至少覆盖文件区域打开/聚焦这类高频动作。
- 所有新增快捷动作都必须出现在 Settings -> Shortcuts 中，可编辑、可清空、可按平台展示。
- 所有新增快捷动作都必须复用统一 shortcut parser / matcher，避免每个 hook 自己判断 `cmd` / `ctrl`。
- Settings、menu label、button title、hint、error 等用户可见 copy 必须走 i18n。

### 边界

- 本 change 只定义 app-level shortcut contract 与新增动作集合；具体视觉重排不重做 Settings 信息架构。
- 快捷键只触发已有 UI action，不新增新的业务能力。例如 runtime console 只打开/切换已有 console，不改变 runtime lifecycle。
- 默认快捷键必须经过冲突审计；如果某个动作在平台上存在高风险冲突，可以默认禁用但仍允许用户配置。
- menu accelerator 只覆盖 native menu 能表达的动作；DOM-only UI action 继续使用 React hook，但必须共享同一配置源。

## 非目标

- 不新增命令面板或全局 command palette。
- 不把所有按钮都强制快捷键化；只覆盖本 proposal 中列出的高频 app-level actions。
- 不改变现有快捷键配置持久化格式之外的 settings schema。
- 不引入第三方 hotkey 库；优先复用 `src/utils/shortcuts.ts`。
- 不实现多 key sequence（例如 `g g`）或 Vim/Emacs 模式。
- 不改动 terminal/runtime/file 面板的业务数据 contract。

## What Changes

- 新增 `app-shortcuts` capability，统一描述 configurable app shortcuts 的行为。
- 在 `AppSettings` 中扩展可配置快捷键字段，覆盖：
  - open session previous / next
  - left conversation sidebar toggle
  - right conversation sidebar toggle
  - terminal toggle（纳入统一审计，避免重复定义）
  - runtime console toggle
  - files surface open/focus/toggle action
- Settings -> Shortcuts 需要新增或调整分组，使新增动作可见、可编辑、可清空，并显示平台化默认值。
- 快捷键触发层需要按 action 类型分流：
  - native menu action 走 menu accelerator controller。
  - app-shell/layout/session/files action 走 focused React hooks。
  - editor scoped action 不得被全局 listener 误抢。
- 新增 conflict audit：默认快捷键不得与已有 app shortcut、核心 editor shortcut、平台 reserved shortcut 明显冲突。
- 新增测试覆盖 Settings 展示、shortcut matcher、session navigation、sidebar toggle、runtime console/files action wiring。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险 / 成本 | 结论 |
|---|---|---|---|---|
| A | 每个 feature 自己新增 `keydown` listener 和默认值 | 改动短，局部可快速完成 | 默认值冲突不可见；Settings 漏项概率高；平台行为会漂移 | 不采用 |
| B | 将新增动作全部纳入 `AppSettings` + Settings Shortcuts + shared matcher，各 feature 只消费配置 | 行为统一；用户可配置；测试和 i18n 可集中守住 | 需要一次性补齐 action map、默认值和测试 | 采用 |
| C | 引入第三方 hotkey manager / command registry | 能做集中调度和冲突检测 | 当前需求不需要额外依赖；会扩大重构面 | 暂不采用 |

## Capabilities

### New Capabilities

- `app-shortcuts`: 定义应用级快捷键的配置、平台化匹配、Settings 展示、冲突防御，以及 session/sidebar/terminal/runtime/files 等动作集合。

### Modified Capabilities

- 无。现有 `git-operations` 内的 Git shortcut contract、composer selector actions、file view editor shortcut 行为保持不变；本 change 新增 app-level shortcut surface。

## 验收标准

- Settings -> Shortcuts MUST 展示新增 session navigation、left/right sidebar、runtime console、files surface 快捷动作。
- 用户 MUST 能为新增动作录入新快捷键、清空快捷键，并在保存后立即影响对应触发行为。
- 打开的 session MUST 支持 previous / next 快捷切换；当没有可切换 session 时 MUST no-op 且不报错。
- 左侧对话侧栏和右侧对话/面板侧栏 MUST 支持 toggle 快捷键；重复触发 MUST 稳定展开/收起。
- terminal toggle MUST 继续可配置，且不得与新增 runtime console toggle 混淆。
- runtime console toggle MUST 只打开/关闭 runtime console surface，不创建或终止 runtime。
- files surface 快捷入口 MUST 只影响文件区域打开/聚焦/toggle，不抢占 editor scoped `find` / `save`。
- 所有新增用户可见文案 MUST 有中英文 i18n key。
- 默认快捷键 MUST 通过 conflict audit；已有用户自定义快捷键迁移后 MUST 保留。

## Impact

- Frontend:
  - `src/types.ts`
  - `src/features/settings/hooks/useAppSettings.ts`
  - `src/features/settings/components/settings-view/sections/ShortcutsSection.tsx`
  - `src/features/settings/components/settings-view/settingsViewShortcuts.ts`
  - `src/features/app/hooks/useMenuAcceleratorController.ts`
  - `src/features/app/hooks/usePrimaryModeShortcuts.ts`
  - `src/features/app/hooks/useWorkspaceActions.ts`
  - `src/features/layout/hooks/usePanelShortcuts.ts`
  - `src/features/layout/hooks/useLayoutNodes.tsx`
  - session tab / app shell section wiring around active session switching
  - files surface hooks/components where open/focus/toggle action lives
  - i18n locale files
- Backend / Tauri:
  - 不预期新增 Tauri command。
  - 如果 native menu accelerator 需要同步 menu item id，只修改 menu registration / accelerator update path，不改变 business command contract。
- Tests:
  - Settings shortcut rendering / draft update tests。
  - shortcut matcher/platform behavior tests。
  - session previous/next focused tests。
  - sidebar/runtime console/files action wiring tests。
- Dependencies:
  - 不新增第三方依赖。
- Validation:
  - `npm run typecheck`
  - `npx vitest run <focused shortcut/settings/layout/session/files tests>`
  - 涉及样式或大文件时运行 `npm run check:large-files`
