import type { EngineType } from "../../../types";
import type { CostRecord, EngineCostAggregate, WorkspaceCostAggregate } from "./costTypes";

const ENGINES: readonly EngineType[] = ["claude", "codex", "gemini", "opencode"];

function sumKnownAmounts(records: readonly CostRecord[]) {
  return records.reduce((total, record) => total + (record.amountUsd ?? 0), 0);
}

export function aggregateCostByEngine(records: readonly CostRecord[]): EngineCostAggregate[] {
  return ENGINES.flatMap((engine) => {
    const engineRecords = records.filter((record) => record.engine === engine);
    if (engineRecords.length === 0) {
      return [];
    }
    return [
      {
        engine,
        amountUsd: engineRecords.some((record) => record.amountUsd != null)
          ? sumKnownAmounts(engineRecords)
          : null,
        partial: engineRecords.some((record) => record.degraded),
        records: engineRecords,
      },
    ];
  });
}

export function aggregateWorkspaceCost(records: readonly CostRecord[]): WorkspaceCostAggregate {
  const byEngine = aggregateCostByEngine(records);
  return {
    amountUsd: records.some((record) => record.amountUsd != null) ? sumKnownAmounts(records) : null,
    currency: "USD",
    partial: records.some((record) => record.degraded),
    records,
    byEngine,
  };
}
