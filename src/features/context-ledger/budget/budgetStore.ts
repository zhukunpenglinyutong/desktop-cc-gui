import type { SessionBudgetConfig } from "./budgetTypes";

export type BudgetStore = {
  get(sessionId: string): SessionBudgetConfig | null;
  set(config: SessionBudgetConfig): void;
  remove(sessionId: string): void;
  list(): readonly SessionBudgetConfig[];
};

export function createBudgetStore(seed: readonly SessionBudgetConfig[] = []): BudgetStore {
  const configs = new Map<string, SessionBudgetConfig>();
  for (const config of seed) {
    configs.set(config.sessionId, config);
  }

  return {
    get(sessionId) {
      return configs.get(sessionId) ?? null;
    },
    set(config) {
      configs.set(config.sessionId, config);
    },
    remove(sessionId) {
      configs.delete(sessionId);
    },
    list() {
      return Array.from(configs.values());
    },
  };
}
