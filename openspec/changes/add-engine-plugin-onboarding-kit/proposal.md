## Branch Calibration / 分支校准（2026-05-19）

当前变更只以 `feature/v0.5.0-md` 为事实源。原始方案是第 5 引擎接入脚手架，不属于当前 harness governance 治理层。收敛后，本 change 标记为 **Deferred / Tooling P2**。

## Why

新引擎 onboarding kit 有长期价值，但当前客户端已经支持 4 个 engine，下一阶段更紧急的是把已存在的治理信号变成可解释、可验证、可消费的 harness evidence。脚手架会引入模板、NotImplementedError、CI inventory gate 等新工具面，容易分散当前治理收口。

中文一句话：**现在不是接第 5 个引擎的时候，先把现有 4 个引擎和治理证据管住。**

## What Changes

- Keep capability `engine-plugin-onboarding-kit` as deferred tooling proposal.
- Do not implement scaffold script, templates, NotImplementedError, or onboarding docs in current pass.
- Preserve future guardrails for cross-platform scaffolding and inventory checks.

## Scope

### Out Of Current Harness Scope

- Engine scaffolder.
- Stub templates.
- NotImplementedError linting.
- Onboarding docs.
- Engine inventory CI gate.

## Status

Deferred until capability matrix consumption and runtime contract validation are stable.

## Validation

Stage validation intentionally skips the full noise sentry; run it only during final harness-wide integration closure.

```bash
openspec validate add-engine-plugin-onboarding-kit --strict --no-interactive
```
