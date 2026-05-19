## Design / 设计

### Position

This proposal is intentionally deferred. It should not shape the current harness governance implementation.

## Future Guardrails

If revived, the design must satisfy:

- Consume `cost-budget` projected values only.
- Do not recompute pricing.
- Store only local ID-like references, never prompts or filesystem paths.
- Make retention explicit before writing durable records.
- Live under Settings, not StatusPanel.

## Rejected For Current Stage

- IndexedDB cost ledger.
- Cross-workspace dashboard.
- Export.
- Retention UI.
- Budget forecasting.

## Reason

The current client needs harness governance evidence and checkpoint explainability. A cross-workspace cost admin surface would compete for UI and storage design attention before the governance substrate is stable.
