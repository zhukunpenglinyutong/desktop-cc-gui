## MODIFIED Requirements

### Requirement: App MUST Provide A Global Runtime Notice Dock In The Bottom-Right Corner

系统 MUST 在 `client-ui-visibility-controls` 允许显示时提供一个 app-global 的右下角提示入口，并将其固定在客户端右下角；该入口不属于任何单独页面、thread 或 workspace 子面板。

#### Scenario: global notice entry remains available across pages

- **WHEN** global runtime notice dock 的 visibility preference 为 visible，且用户在客户端内切换首页、对话区、设置页或其他已支持页面
- **THEN** 系统 MUST 保持右下角 notice 入口可见
- **AND** 该入口 MUST NOT 因页面切换而丢失或重新挂载成页面内局部组件

#### Scenario: first phase stays independent from status panel and runtime console

- **WHEN** 第一阶段接入全局右下角提示框
- **THEN** 系统 MUST 将其作为独立的 global notice dock 提供
- **AND** MUST NOT 把该能力收编为现有 `status panel` tab 或 `runtime console` 子视图

#### Scenario: appearance visibility can hide the dock

- **WHEN** 用户在基础外观页隐藏 global runtime notice dock
- **THEN** 系统 MUST 从 active UI 中移除最小化入口与展开态 panel
- **AND** MUST NOT 通过页面级特判或替代容器继续渲染该 dock

## ADDED Requirements

### Requirement: Hidden Dock MUST Preserve Notice Producers And Restore Continuity

隐藏 global runtime notice dock 只影响 presentation surface，并 MUST NOT 中断 notice feed 的 producer、buffer 或 dock mode continuity。

#### Scenario: producers continue pushing while the dock is hidden

- **WHEN** global runtime notice dock 处于 hidden 状态且系统产生新的 bootstrap、runtime lifecycle 或关键错误 notice
- **THEN** 系统 MUST 继续把这些 notice 追加到同一个 bounded feed
- **AND** hidden 状态 MUST NOT 禁用或绕过现有 global notice producer

#### Scenario: restoring the dock resumes the current feed

- **WHEN** 用户重新显示先前被隐藏的 global runtime notice dock
- **THEN** 系统 MUST 展示当前 session 已累积的 notice feed，而不是从空态重新开始
- **AND** MUST 恢复 dock 当前的最小化或展开状态，而不是强制回到默认最小化态
