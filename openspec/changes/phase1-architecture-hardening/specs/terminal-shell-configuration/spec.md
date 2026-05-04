## ADDED Requirements

### Requirement: Terminal Shell Extraction MUST Preserve Platform Fallback Semantics
第一阶段涉及 terminal shell path 或 launch helper 的抽取 MUST 保持既有平台 fallback 行为稳定。

#### Scenario: extraction preserves blank-path platform fallback
- **WHEN** terminal shell path helper、settings adapter 或 terminal launch path 被拆分到新模块
- **THEN** 空 shell path 时的 Windows 与非 Windows fallback MUST 保持不变
- **AND** 抽取 MUST NOT 隐式持久化示例路径或 platform-specific default path

#### Scenario: extraction preserves path-with-spaces behavior
- **WHEN** terminal shell 相关实现被 facade 或 adapter 收敛
- **THEN** 含空格的 shell path MUST 继续可用
- **AND** Windows 与 macOS 的 quoting / spawn 语义 MUST 保持兼容
