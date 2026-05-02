## Purpose

定义 Claude CLI settings、doctor 触发、诊断展示、app/daemon 探测一致性与向后兼容存储的行为契约。
## Requirements
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

### Requirement: Claude Code Tab MUST Expose Claude CLI Path And Doctor Controls

系统 MUST 在 `CLI 验证` 面板的 `Claude Code` tab 中提供默认 `Claude CLI` 路径编辑能力与 `Run Claude Doctor` 触发入口，并与 `Codex` tab 并存。

#### Scenario: claude controls are visible in the claude code tab

- **WHEN** 用户打开设置页中的 `CLI 验证` 面板并切换到 `Claude Code` tab
- **THEN** 系统 MUST 展示默认 `Claude CLI` 路径输入与 `Run Claude Doctor` 操作入口
- **AND** 切换回 `Codex` tab 后，现有 `Codex` 路径与 `Run Doctor` 入口 MUST 继续保持可见和可操作

#### Scenario: saved claude path is restored in settings

- **WHEN** 用户在 `Claude Code` tab 中保存默认 `Claude CLI` 路径并重新进入设置页
- **THEN** 系统 MUST 回读并展示上次保存的 `claudeBin` 值
- **AND** 未设置路径时 UI MUST 继续以 `PATH` 解析模式工作，而不是展示损坏状态

### Requirement: Claude Doctor MUST Use A Dedicated Structured Command

系统 MUST 通过独立的 `claude_doctor` backend command 暴露 Claude 诊断结果，而不是复用 `codex_doctor` 或由 frontend 自行拼装诊断。

#### Scenario: running claude doctor returns structured diagnostics

- **WHEN** 用户在 settings 中触发 `Run Claude Doctor`
- **THEN** 系统 MUST 调用独立的 `claude_doctor` command
- **AND** 结果 MUST 至少包含 Claude 可用性、version、resolved binary path、wrapper kind 与 `PATH` / `pathEnvUsed` 等关键诊断字段或同等信息

#### Scenario: doctor failure remains diagnosable in settings

- **WHEN** `claude_doctor` 执行失败、超时或返回 unhealthy 结果
- **THEN** settings MUST 向用户展示可读的错误或诊断细节
- **AND** 系统 MUST NOT 将失败静默吞掉或退化成仅有布尔状态的不可解释结果

### Requirement: App And Daemon MUST Share Claude CLI Resolution Semantics

系统 MUST 让 app 与 daemon 在 Claude CLI 的 `PATH` 恢复、binary 解析与 reachability 判断上保持一致语义，避免同一环境在两个进程中得出相互矛盾的结论。

#### Scenario: daemon restores shell path before claude diagnostics

- **WHEN** daemon 在桌面启动环境中初始化
- **THEN** 系统 MUST 在执行 Claude CLI 探测前恢复与 app 一致的 shell `PATH` 语义
- **AND** MUST NOT 因 daemon 启动环境缺少 shell 注入路径而单独误报 Claude 缺失

#### Scenario: app and daemon classify the same claude bin consistently

- **WHEN** app 与 daemon 对同一个 `claudeBin` 配置执行 Claude 可用性检测
- **THEN** 两者 MUST 对“可用 / 不可用”得出一致的 reachability 结论
- **AND** MUST NOT 仅因进程入口不同而出现一边可用、一边缺失的分叉结果

### Requirement: Claude Detection MUST Support Version-To-Help Fallback

系统 MUST 在 Claude CLI 的 `--version` 探测失败但 `--help` 可成功执行时使用兼容 fallback，避免把可运行的 CLI 误报为未安装。

#### Scenario: help success upgrades failed version probe

- **WHEN** Claude CLI 的 `--version` 检测失败
- **AND** 同一 binary 的 `--help` 检测成功
- **THEN** 系统 MUST 将该 Claude CLI 视为已安装
- **AND** 结果中的 version MUST 允许回退为 `unknown` 或等价的非空兼容值，而不是返回未安装错误

#### Scenario: version and help both fail keeps not-installed result

- **WHEN** Claude CLI 的 `--version` 与 `--help` 检测都失败
- **THEN** 系统 MUST 继续返回不可用结果
- **AND** MUST 保留可用于定位失败原因的错误信息

### Requirement: Claude Settings Persistence MUST Remain Backward Compatible

系统 MUST 以向后兼容的方式扩展 `claudeBin` 的 frontend contract，确保旧设置文件与新保存值都能稳定读写。

#### Scenario: legacy settings without claude bin still load

- **WHEN** 现有设置文件不包含 `claudeBin`
- **THEN** 系统 MUST 仍能正常加载设置
- **AND** Claude settings UI MUST 以空值 / follow `PATH` 的默认语义初始化

#### Scenario: saved claude bin round-trips through frontend and backend

- **WHEN** 用户保存新的 `claudeBin` 并在后续启动中重新读取 settings
- **THEN** frontend `AppSettings` 与 backend `AppSettings` MUST 对该字段保持一致的 camelCase / serde 映射语义
- **AND** 系统 MUST NOT 因字段缺失、类型漂移或默认值覆盖而丢失已保存的 `claudeBin`
