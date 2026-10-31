import { describe, expect, it } from 'vitest';
import { KEEPER_RETREAT, keeperPresenceIntent, type KeeperPresenceInput, type KeeperPresenceIntent } from './presence';
import { KEEPER_ROLES } from './types';

const realm = (atPlace: number, inTown: number): KeeperPresenceInput => ({ source: 'realm', atPlace, inTown });
const simulated = (atPlace: number, inTown: number): KeeperPresenceInput => ({ source: 'simulated', label: 'SIMULATED', atPlace, inTown });

/** Feed a sequence of counts through the hysteresis, carrying the previous intent, and record every transition. */
function walk(role: (typeof KEEPER_ROLES)[number], counts: readonly (readonly [atPlace: number, inTown: number])[]) {
  let previous: KeeperPresenceIntent['kind'] = 'at-work';
  const transitions: string[] = [];
  for (const [atPlace, inTown] of counts) {
    const next: KeeperPresenceIntent['kind'] = keeperPresenceIntent(KEEPER_RETREAT[role], realm(atPlace, inTown), previous).kind;
    if (next !== previous) transitions.push(`${previous}->${next}@${atPlace}/${inTown}`);
    previous = next;
  }
  return transitions;
}

const upThenDown = (top: number, pair: (n: number) => readonly [number, number]) => {
  const out: (readonly [number, number])[] = [];
  for (let n = 0; n <= top; n++) out.push(pair(n));
  for (let n = top; n >= 0; n--) out.push(pair(n));
  return out;
};

describe('keeper presence intent', () => {
  for (const role of KEEPER_ROLES) {
    const policy = KEEPER_RETREAT[role];

    describe(role, () => {
      it('is at work in an empty town', () => {
        expect(keeperPresenceIntent(policy, realm(0, 0))).toEqual({ kind: 'at-work', label: null });
        expect(keeperPresenceIntent(policy, realm(0, 0), 'at-work')).toEqual({ kind: 'at-work', label: null });
      });

      it('returns strictly below where it withdraws, with a finite finish', () => {
        expect(policy.return.atPlace).toBeLessThan(policy.withdraw.atPlace);
        expect(policy.return.inTown).toBeLessThan(policy.withdraw.inTown);
        expect(policy.return.atPlace).toBeGreaterThanOrEqual(0);
        expect(policy.withdraw.atPlace).toBeLessThanOrEqual(policy.withdraw.inTown);
        expect(Number.isFinite(policy.finish) && policy.finish > 0).toBe(true);
      });

      it('withdraws at exactly the place threshold, not one below', () => {
        const at = policy.withdraw.atPlace;
        expect(keeperPresenceIntent(policy, realm(at - 1, at - 1)).kind).toBe('at-work');
        expect(keeperPresenceIntent(policy, realm(at, at))).toEqual({ kind: 'withdraw', to: policy.to, reason: 'place-filling', finish: policy.finish, label: null });
      });

      it('withdraws at exactly the town threshold, not one below, with nobody at the place', () => {
        const town = policy.withdraw.inTown;
        expect(keeperPresenceIntent(policy, realm(0, town - 1)).kind).toBe('at-work');
        expect(keeperPresenceIntent(policy, realm(0, town))).toEqual({ kind: 'withdraw', to: policy.to, reason: 'town-filling', finish: policy.finish, label: null });
      });

      it('names the place when both thresholds are met', () => {
        expect(keeperPresenceIntent(policy, realm(policy.withdraw.atPlace, policy.withdraw.inTown))).toMatchObject({ kind: 'withdraw', reason: 'place-filling' });
      });

      it('stays withdrawn above either return level and returns only when both are met', () => {
        const back = policy.return;
        const away = (atPlace: number, inTown: number) => keeperPresenceIntent(policy, realm(atPlace, inTown), 'withdraw');
        expect(away(back.atPlace + 1, back.inTown)).toMatchObject({ kind: 'withdraw', reason: 'place-filling', to: policy.to, finish: policy.finish });
        expect(away(back.atPlace, back.inTown + 1)).toMatchObject({ kind: 'withdraw', reason: 'town-filling', to: policy.to, finish: policy.finish });
        expect(away(back.atPlace + 1, back.inTown + 1).kind).toBe('withdraw');
        // Between the return and withdraw levels, the previous intent decides.
        const between = [back.atPlace + 1, back.inTown + 1] as const;
        expect(keeperPresenceIntent(policy, realm(...between), 'at-work').kind).toBe('at-work');
        expect(away(...between).kind).toBe('withdraw');
        expect(away(back.atPlace, back.inTown)).toEqual({ kind: 'at-work', label: null });
        expect(away(0, 0)).toEqual({ kind: 'at-work', label: null });
      });

      it('never flickers: a town filling then emptying withdraws once and returns once', () => {
        const top = policy.withdraw.inTown + 10;
        const town = walk(role, upThenDown(top, n => [0, n]));
        expect(town).toEqual([`at-work->withdraw@0/${policy.withdraw.inTown}`, `withdraw->at-work@0/${policy.return.inTown}`]);
        const place = walk(role, upThenDown(policy.withdraw.atPlace + 5, n => [n, n]));
        expect(place).toEqual([`at-work->withdraw@${policy.withdraw.atPlace}/${policy.withdraw.atPlace}`, `withdraw->at-work@${policy.return.atPlace}/${policy.return.atPlace}`]);
      });

      it('holds still while the count hovers at the edge after withdrawing', () => {
        const edge = policy.withdraw.inTown;
        const hover: (readonly [number, number])[] = [[0, edge]];
        for (let i = 0; i < 20; i++) hover.push([0, i % 2 ? edge : edge - 1], [0, policy.return.inTown + 1]);
        expect(walk(role, hover)).toEqual([`at-work->withdraw@0/${edge}`]);
      });

      it('labels simulated input SIMULATED on every intent and realm input null', () => {
        for (const [atPlace, inTown] of [[0, 0], [policy.withdraw.atPlace, policy.withdraw.atPlace], [0, policy.withdraw.inTown]] as const) {
          for (const previous of ['at-work', 'withdraw'] as const) {
            expect(keeperPresenceIntent(policy, simulated(atPlace, inTown), previous).label).toBe('SIMULATED');
            expect(keeperPresenceIntent(policy, realm(atPlace, inTown), previous).label).toBeNull();
          }
        }
      });
    });
  }

  it('throws on counts that are not whole, non-negative numbers of people', () => {
    const policy = KEEPER_RETREAT.innkeeper;
    for (const [atPlace, inTown] of [[-1, 0], [0, -1], [0.5, 1], [1, 2.5], [Number.NaN, 0], [0, Number.NaN], [0, Number.POSITIVE_INFINITY]] as const) {
      expect(() => keeperPresenceIntent(policy, realm(atPlace, inTown))).toThrow(/whole, non-negative/);
      expect(() => keeperPresenceIntent(policy, simulated(atPlace, inTown), 'withdraw')).toThrow(/whole, non-negative/);
    }
    expect(() => keeperPresenceIntent(policy, realm(3, 2))).toThrow(/more people than the town/);
  });

  it('never speaks in counts, viewers or lights', () => {
    const allowed = new Set(['kind', 'label', 'to', 'reason', 'finish']);
    for (const role of KEEPER_ROLES) {
      const policy = KEEPER_RETREAT[role];
      for (const input of [realm(0, 0), realm(policy.withdraw.atPlace, policy.withdraw.inTown), simulated(0, policy.withdraw.inTown)]) {
        for (const previous of ['at-work', 'withdraw'] as const) {
          const intent = keeperPresenceIntent(policy, input, previous);
          for (const key of Object.keys(intent)) expect(allowed.has(key)).toBe(true);
          const json = JSON.stringify(intent).toLowerCase();
          for (const word of ['count', 'viewer', 'light', 'people', 'presence', 'atplace', 'intown', 'population']) expect(json).not.toContain(word);
        }
      }
    }
  });
});
