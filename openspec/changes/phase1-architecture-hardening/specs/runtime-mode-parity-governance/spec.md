## ADDED Requirements

### Requirement: Runtime Mode Split MUST Remain Explicit During Bridge Extraction
第一阶段 bridge 抽取 MUST 保持 desktop Tauri runtime 与 web-service runtime 的 mode split 语义显式且等价。

#### Scenario: facade preserves desktop and web-service dispatch boundary
- **WHEN** `src/services/tauri.ts` 或等价 bridge surface 被抽取为 facade + domain modules
- **THEN** facade MUST 继续明确区分 desktop Tauri runtime 与 web-service runtime
- **AND** 调用方 MUST NOT 因抽取而失去 mode-aware 行为

#### Scenario: runtime-mode branch does not leak into unrelated domains
- **WHEN** bridge 内部新增 runtime-mode adapter 或 helper
- **THEN** runtime-mode 分支 MUST 保持在边界层
- **AND** 领域模块 MUST NOT 到处散落 `desktop vs web-service` 条件判断

### Requirement: Daemon Capability And Fallback Semantics MUST Stay Equivalent
web-service runtime 的 daemon capability 探测与 fallback 语义 MUST 在抽取前后保持等价。

#### Scenario: daemon capability detection remains compatible
- **WHEN** runtime bridge 判断 daemon RPC capability、web-service availability 或 fallback mode
- **THEN** 抽取前后的判定结果 MUST 保持等价
- **AND** 同一环境 MUST NOT 因桥接拆分而落入不同 runtime mode

#### Scenario: rollback keeps runtime-mode behavior valid
- **WHEN** 新的 runtime-mode adapter、facade 或 fallback layer 被局部回滚
- **THEN** desktop 与 web-service runtime 仍 MUST 满足既有行为契约
- **AND** 回滚 MUST NOT 留下半抽取、半旧路径的矛盾状态
