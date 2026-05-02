## ADDED Requirements

### Requirement: Performance Compatibility Mode MUST Be Opt-In And Non-Invasive

系统 MUST 提供默认关闭的低性能兼容模式，用于老旧设备上的性能兜底，并且不得改变默认用户路径。

#### Scenario: Legacy settings default to normal mode
- **WHEN** app settings 中缺少 `performanceCompatibilityModeEnabled`
- **THEN** 系统 MUST 将低性能兼容模式解析为关闭
- **AND** 默认刷新节奏、动画与现有行为 MUST 保持不变

#### Scenario: User explicitly enables compatibility mode
- **WHEN** 用户在基础-行为设置中开启低性能兼容模式
- **THEN** 系统 MUST 持久化该选择
- **AND** 已接入的非关键 UI 刷新点 MUST 使用低频或隐藏暂停策略

#### Scenario: Compatibility mode does not alter core business semantics
- **WHEN** 低性能兼容模式处于开启状态
- **THEN** 系统 MUST 保持消息发送、文件保存、Git 操作、runtime 生命周期和诊断导出语义不变
- **AND** 降级只允许影响非关键展示刷新、elapsed 文案、轮询节奏或装饰性视觉负担

### Requirement: Diagnostics Bundle Export MUST Capture General Bug Evidence

系统 MUST 允许用户手动导出通用诊断包，为性能、启动、runtime、UI 或配置类 bug 提供排障依据。

#### Scenario: User exports diagnostics from Basic Behavior settings
- **WHEN** 用户点击基础-行为中的导出诊断包动作
- **THEN** 系统 MUST 在本机生成 JSON 诊断文件
- **AND** UI MUST 显示导出成功路径或可读失败原因

#### Scenario: Diagnostics bundle includes bounded cross-layer evidence
- **WHEN** 诊断包生成成功
- **THEN** 文件 MUST 包含生成时间、app/version/platform 摘要、sanitized app settings、renderer diagnostics、runtime pool snapshot 和 client store 摘要
- **AND** 这些 evidence MUST 是有界的，不能因为长期运行无限增长

#### Scenario: Diagnostics bundle avoids sensitive payloads
- **WHEN** 系统汇总诊断包内容
- **THEN** 诊断包 MUST NOT 包含 remote backend token、邮件密码、用户消息全文、完整 auth 文件或其他密钥内容
- **AND** 必须只保留排障必要的布尔、枚举、数字、计数、状态和有限路径信息

### Requirement: Compatibility Hooks MUST Preserve Default Refresh Cadence

系统 MUST 为接入低性能兼容模式的刷新点提供明确 helper，保证关闭时不改变现有频率。

#### Scenario: Compatibility mode disabled keeps existing interval
- **WHEN** `performanceCompatibilityModeEnabled` 为 false
- **THEN** 已接入刷新点 MUST 使用现有默认间隔
- **AND** 不得因为新 helper 引入额外暂停、延迟或重复 timer

#### Scenario: Compatibility mode enabled lowers non-critical refresh work
- **WHEN** `performanceCompatibilityModeEnabled` 为 true
- **THEN** 已接入刷新点 MUST 降低非关键刷新频率或在 `document.hidden` 时暂停
- **AND** 重新可见后 MUST 能恢复并最终显示最新状态
