import { describe, expect, it } from 'vitest';
import { createForgeCallBudget } from './budget';

describe('per-wish Forge call ledger', () => {
  it('caps normal wishes at five and allows only explicit softening to raise to seven', () => {
    const budget = createForgeCallBudget();
    for (let i = 0; i < 5; i++) budget.take();
    expect(budget).toMatchObject({ calls: 5, remaining: 0 });
    expect(() => budget.take()).toThrow(expect.objectContaining({ code: 'FORGE_CALL_BUDGET' }));
    budget.increaseLimit(7);
    budget.take(); budget.take();
    expect(() => budget.take()).toThrow(expect.objectContaining({ code: 'FORGE_CALL_BUDGET' }));
    expect(budget).toMatchObject({ calls: 7, remaining: 0 });
    expect(() => budget.increaseLimit(5)).toThrow();
  });

  it.each([0, -1, 8, 1.5, NaN, Infinity])('rejects invalid limits %s', limit => {
    expect(() => createForgeCallBudget(limit)).toThrow();
  });

  it('keeps wishes independent', () => {
    const a = createForgeCallBudget(); const b = createForgeCallBudget();
    a.take();
    expect(b).toMatchObject({ calls: 0, remaining: 5 });
  });
});
