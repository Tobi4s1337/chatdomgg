/** One ledger shared by the word gate, both candidates and their result gates. */
export interface ForgeCallBudget {
  readonly remaining: number;
  readonly calls: number;
  take(): void;
  increaseLimit(limit: 5 | 7): void;
}

export class ForgeCallBudgetError extends Error {
  readonly code = 'FORGE_CALL_BUDGET';
  constructor() { super('The Forge has used this wish’s model-call budget.'); this.name = 'ForgeCallBudgetError'; }
}

export function createForgeCallBudget(limit = 5): ForgeCallBudget {
  if (!Number.isInteger(limit) || limit < 1 || limit > 7) throw new Error('Invalid Forge call budget.');
  let ceiling = limit;
  let calls = 0;
  return {
    get remaining() { return ceiling - calls; },
    get calls() { return calls; },
    take() {
      if (calls >= ceiling) throw new ForgeCallBudgetError();
      calls += 1;
    },
    increaseLimit(next) {
      if ((next !== 5 && next !== 7) || next < ceiling) throw new Error('Invalid Forge call budget increase.');
      ceiling = next;
    },
  };
}
