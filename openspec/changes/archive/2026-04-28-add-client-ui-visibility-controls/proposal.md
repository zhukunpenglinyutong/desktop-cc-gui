## Why

不同用户对桌面客户端的信息密度和工具入口有不同偏好；当前顶部会话栏、工具按钮组、右侧工具栏和右下活动面板始终可见，容易让只想保留正常对话路径的用户觉得界面过载。

本变更要在“设置 / 基础 / 外观”中提供客户端 UI 可见性控制，让用户按面板层和 icon 按钮层隐藏非核心 UI，但只影响显示，不回退、不禁用底层功能。

## 目标与边界

### 目标

- 在基础外观设置页新增“界面显示”类配置，集中管理客户端可见的面板与 icon 按钮。
- 支持面板层控制：顶部会话 Tab 面板、顶部运行/状态控制区、顶部工具控制区、右侧工具栏、右下活动面板。
- 支持 icon 级控制：在上层面板未隐藏时，用户可以单独隐藏面板内的具体 icon 按钮。
- 默认保持当前 UI 全量可见，避免升级后用户界面突然变化。
- 隐藏只影响渲染可见性，不删除状态、不取消监听、不禁用对应业务能力。
- 最大隐藏状态下仍必须保留正常对话能力：会话内容区、composer 输入区、发送按钮和基础设置入口必须可达。
- 配置应持久化并在应用重启后恢复。

### 边界

- 本变更只定义 frontend UI visibility preference；优先复用现有 client settings / clientStorage 持久化链路。
- 不改变 Tauri command、runtime session、Git diff、任务、Agent、文件面板等业务数据结构。
- 不改变右侧面板内已有 tab 的业务行为，只控制入口或容器是否显示。
- 不改变快捷键能力；即便某个 icon 被隐藏，已有快捷键和命令链路仍按原规则工作。

## 非目标

- 不做权限系统，不区分用户角色。
- 不做“功能禁用”或“模块卸载”；隐藏不是 feature flag。
- 不重构整体 layout 架构，不改变左右分栏尺寸算法。
- 不把所有页面元素都纳入控制；本轮只覆盖用户截图中红框标出的高噪声面板与 icon 入口。
- 不新增第三方依赖。

## What Changes

- 在基础外观设置页增加一组 UI 可见性配置。
- 新增一个客户端 UI visibility preference model，表达：
  - panel visibility：面板级显示/隐藏。
  - control visibility：icon / button 级显示/隐藏。
  - parent-child rule：父面板隐藏时，子 icon 直接不可见；父面板恢复后，子 icon 使用自己的可见性设置。
- 首批可控对象包括：
  - 顶部会话 Tab 面板。
  - 顶部运行/状态控制 icon 组：运行、状态/圆形按钮、Pin。
  - 顶部工具 icon 组：当前蓝色工具入口及其相邻工具按钮。
  - 右上侧工具栏 icon 组：活动/列表/Git 分支/文件夹/搜索等入口。
  - 右侧底部活动面板：任务、Agent、编辑、最新对话及其容器。
  - 右下角小圆形状态按钮。
- 设置 UI 需要提供“全部恢复默认显示”入口，防止用户隐藏过多后难以恢复。
- 主界面渲染需要读取 visibility preference 并进行 conditional render / CSS class 控制。
- 测试需要覆盖默认可见、面板隐藏、icon 单独隐藏、父子层级规则、最大隐藏仍可对话。

## 客观分析

### 用户价值

- 高价值点：让高频对话用户降低视觉噪声，把主注意力留给 conversation canvas 和 composer。
- 中价值点：让不同工作流用户保留自己常用入口，例如 Git 用户保留右上 Git / Diff，纯对话用户隐藏右侧工具。
- 低价值点：把每一个微小装饰元素都做成可配置项；这会让设置页本身变复杂，收益不成比例。

### 工程可行性

- 面板级隐藏可行性高：大多数目标都有明确容器，适合从 shell / section 边界做 conditional render。
- icon 级隐藏可行性中等：需要找到真实组件 owner，并防止隐藏某个 icon 后相邻分隔符、tooltip、badge 残留。
- “只隐藏不禁用功能”可行但必须写清楚：实现不能把 hidden 当 disabled，也不能顺手清空 active state。

### 成本结构

- 主要成本不是 storage，而是跨组件接线和回归验证。
- 如果在每个组件里散落判断，后续新增按钮会快速 drift；central registry 是必要复杂度。
- 最大隐藏保底测试必须做，否则这个功能最容易把“干净界面”做成“不可恢复界面”。

### 风险排序

1. 最高风险：隐藏设置入口或恢复路径，导致用户无法恢复默认显示。
2. 高风险：右侧/底部 panel 隐藏时误清理业务状态，违背“只隐藏不禁用”。
3. 中风险：icon 级隐藏后留下空白 gap、分隔符、hover hit area。
4. 低风险：持久化格式本身；按默认 visible fallback 即可控制。

### 推荐 MVP

- 第一阶段只做截图红框中的 panel + icon。
- 第一阶段必须包含 reset all、默认全 visible、异常 fallback、最大隐藏仍可对话。
- 第一阶段不做 layout preset、不做拖拽排序、不做 per-workspace visibility；这些会把“洁癖隐藏”扩展成“布局编辑器”，不符合当前需求边界。

## 技术方案对比与取舍

| 方案 | 描述 | 优点 | 风险 / 成本 | 结论 |
|---|---|---|---|---|
| A | 在各组件内部各自新增 localStorage key 控制显示 | 改动短，单点实现快 | key 分散，设置页难以统一管理；父子规则容易 drift；测试成本高 | 不采用 |
| B | 新增统一 `clientUiVisibility` preference，由设置页管理，主布局和各 toolbar 读取同一对象 | 契约清晰；默认值和 migration 可集中处理；便于测试父子层级 | 需要定义 visibility schema 与若干接线点 | 采用 |
| C | 用 CSS 全局 selector 强行隐藏红框区域 | 无需穿透 props，改动表面最小 | 容易造成 focus/aria/布局残留；无法可靠做到 icon 粒度；状态不可诊断 | 不采用 |

## Capabilities

### New Capabilities

- `client-ui-visibility-controls`: 定义客户端面板与 icon 按钮的显示/隐藏偏好、默认可见、父子层级规则、持久化恢复和最大隐藏下的对话保底能力。

### Modified Capabilities

- 无。现有 `client-global-ui-scaling`、主题、布局模式、Git 面板、任务面板和 runtime 能力不改变语义；本变更只新增可见性控制 contract。

## 验收标准

- 打开“设置 / 基础 / 外观”时，用户 MUST 能看到 UI 显示/隐藏配置入口。
- 首次升级或没有旧配置时，所有纳入控制的面板和 icon MUST 默认可见。
- 用户隐藏某个面板后，该面板及其子 icon MUST 从主界面消失。
- 用户只隐藏某个 icon 时，父面板 MUST 继续显示，其他 icon MUST 不受影响。
- 父面板隐藏后再恢复时，子 icon MUST 按各自保存的 visible/hidden 设置恢复，而不是全部强制显示。
- 隐藏顶部会话 Tab 面板后，当前对话内容和 composer MUST 仍可正常输入、发送。
- 隐藏右侧底部活动面板后，任务/Agent/编辑/最新对话数据 MUST 不被清空。
- 隐藏右上侧工具栏 icon 后，相关功能状态 MUST 不被 reset；通过其他入口或快捷键触发时仍按原逻辑工作。
- 用户 MUST 能一键恢复默认显示。
- 应用重启后，visibility preference MUST 按上次保存的状态恢复。
- 若持久化数据缺失、字段未知或格式异常，系统 MUST 回退到全量可见，不能导致空白主界面。

## Impact

- Frontend:
  - `src/features/settings/components/settings-view/sections/BasicAppearanceSection.tsx`
  - 设置页相关 container / hook / i18n 文案。
  - 主布局 shell、顶部 toolbar、右侧 toolbar、右下活动 panel 的 conditional render 接线。
  - 可能新增 `clientUiVisibility` 类型、默认值和 normalize helper。
- Storage:
  - 优先复用现有 `AppSettings` 或 `clientStorage` 持久化路径；最终实现前需确认更适合放在 app settings 还是 client-only store。
- Backend / Tauri:
  - 预期不需要新增 command。
- Tests:
  - 设置页渲染与保存测试。
  - visibility normalize helper 单元测试。
  - 主 shell / toolbar focused tests，覆盖隐藏与恢复。
- Dependencies:
  - 不新增第三方依赖。
- Validation:
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test -- --run <settings-and-shell-focused-tests>`
  - 涉及 CSS 或大文件时补跑 `npm run check:large-files`
