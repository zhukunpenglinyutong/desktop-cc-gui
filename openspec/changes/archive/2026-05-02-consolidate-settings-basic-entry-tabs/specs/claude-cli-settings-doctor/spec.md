## MODIFIED Requirements

### Requirement: Settings MUST Expose A Unified CLI Validation Surface

系统 MUST 在 `运行环境 -> CLI 验证` tab 中提供统一 CLI 验证与诊断能力，并在同一面板内通过 tabs 承载不同 CLI 的验证与诊断能力。

#### Scenario: cli validation lives under runtime environment tabs
- **WHEN** 用户浏览设置页左侧导航
- **THEN** 系统 MUST 显示 `运行环境` 父级入口
- **AND** 系统 MUST NOT 显示独立的 `CLI 验证` 一级入口

#### Scenario: panel switches between codex and claude tabs
- **WHEN** 用户进入 `运行环境 -> CLI 验证`
- **THEN** 系统 MUST 提供 `Codex` 与 `Claude Code` 两个 tabs
- **AND** 用户 MUST 能在不离开当前面板的情况下切换两个 CLI 的设置与 doctor surface
- **AND** 当前 tab 的 path editor、doctor action 与结果展示 MUST 与所选 CLI 对应
