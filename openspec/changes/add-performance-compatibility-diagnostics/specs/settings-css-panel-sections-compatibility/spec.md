## ADDED Requirements

### Requirement: Basic Behavior Settings MUST Host Performance Compatibility Controls

设置页基础-行为区域 MUST 承载低性能兼容模式与诊断导出入口，同时保持现有设置页结构与样式契约稳定。

#### Scenario: Basic behavior renders compatibility and diagnostics controls
- **WHEN** 用户打开设置页的基础-行为 tab
- **THEN** 系统 MUST 显示低性能兼容模式开关
- **AND** 系统 MUST 显示手动导出诊断包动作

#### Scenario: Existing basic behavior controls remain available
- **WHEN** 新增性能兼容与诊断入口后
- **THEN** 现有发送快捷键、流式输出、终端 Shell、代理和通知声音设置 MUST 仍可访问
- **AND** 新入口 MUST NOT 改变现有 class selector 和 card 结构的基本语义

#### Scenario: Diagnostics export result is visible and bounded
- **WHEN** 用户触发诊断导出
- **THEN** 设置页 MUST 显示成功路径或失败消息
- **AND** UI MUST NOT 因导出失败而关闭设置页或丢失未保存输入
