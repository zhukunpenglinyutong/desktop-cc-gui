## Implementation Evidence

Current branch: `feature/v0.5.0-md`

### Implemented

- Pricing fixtures: `src/features/context-ledger/pricing/fixtures/{claude,codex,gemini,opencode}.ts`
- Pricing registry: `src/features/context-ledger/pricing/pricingRegistry.ts`
- Cost projection: `src/features/context-ledger/cost/projectCost.ts`
- Cost aggregation: `src/features/context-ledger/cost/costAggregate.ts`
- Budget store and thresholds: `src/features/context-ledger/budget/*`
- Public barrel: `src/features/context-ledger/cost-budget.ts`
- StatusPanel integration: `src/features/status-panel/components/CostBudgetSection.tsx`
- StatusPanel host props wired through `useLayoutNodes.tsx`
- i18n keys: `statusPanel.cost.*` and `statusPanel.budget.*`
- Checker: `scripts/check-context-ledger-cost-budget.mjs`

### Validation

- `npm run check:context-ledger-cost-budget`: pass
- `npm exec vitest run src/features/context-ledger/pricing/pricingRegistry.test.ts src/features/context-ledger/cost/costProjection.test.ts`: pass
- `npm run typecheck`: pass

### Runtime Boundary

- Cost/budget is observational only. The block tier does not interrupt runtime execution in this change.
- Block-level cost remains explicitly unsupported.

### Completion Review

- Residual risk: pricing fixtures can become stale; stale fixture detection marks records degraded rather than silently estimating zero.
- Follow-up backlog: block-level attribution, cost prediction, multi-currency display, cost-aware routing, and remote pricing refresh.
- Existing context-ledger projection/governance tests remain covered in the full heavy-noise run.
