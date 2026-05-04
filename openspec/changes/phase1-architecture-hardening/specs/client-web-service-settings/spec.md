## ADDED Requirements

### Requirement: Web Service Runtime Control MUST Stay Compatible During Bridge Extraction
第一阶段 bridge 抽取 MUST 保持 web-service control plane、daemon fallback 与 runtime mode split 语义兼容。

#### Scenario: bridge extraction preserves control-plane command routing
- **WHEN** Web service settings、daemon control 或 runtime bridge 被抽取为 facade 与领域模块
- **THEN** start/stop/status 等 control-plane 行为 MUST 继续走既有 daemon RPC 语义
- **AND** 抽取 MUST NOT 把 Web API / WebSocket 入口误用为管理命令通道

#### Scenario: bridge extraction preserves web-service fallback semantics
- **WHEN** desktop Tauri runtime 与 web-service runtime 共用的 bridge surface 被收敛
- **THEN** remote connection error、local daemon bootstrap retry 与 fallback 结果 MUST 保持兼容
- **AND** 抽取 MUST NOT 只验证 desktop path 而破坏 web-service path
