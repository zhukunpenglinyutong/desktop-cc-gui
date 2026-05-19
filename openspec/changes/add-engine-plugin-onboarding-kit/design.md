## Design / 设计

### Position

Deferred tooling proposal. Do not implement in the current harness governance pass.

## Future Guardrails

If revived:

- Scaffolder must be cross-platform and use Node `path`.
- Dry-run must be available and safe by default.
- Existing 4 engines must remain untouched.
- Inventory checks must report missing integration points without auto-mutating source files.
- Templates must use LF and avoid platform-specific paths.

## Rejected For Current Stage

- `scripts/scaffold-engine.mjs`
- stub templates.
- NotImplementedError production lint.
- onboarding docs.
- automatic i18n patching.

## Reason

The current governance problem is not lack of engine onboarding. It is lack of a small evidence bridge and explainable policy verdicts for the engine/runtime work already present in the client.
