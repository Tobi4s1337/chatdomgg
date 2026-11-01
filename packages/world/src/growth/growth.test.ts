import { describe, expect, it } from 'vitest';
import { GrowthHomeViewSchema, GrowthSceneFrameSchema, KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { createGrowthState, GROWTH_POLICY_V1, projectGrowthHome, projectGrowthScene, reduceGrowth } from './index';
import type { GrowthObservation, GrowthState } from './index';

const kingdomId = KingdomIdSchema.parse('100');
const personId = PersonIdSchema.parse('200');
const other = PersonIdSchema.parse('300');
const dayMs = GROWTH_POLICY_V1.streamDayMs;
type Body = GrowthObservation extends infer O ? O extends GrowthObservation ? Omit<O, 'kingdomId' | 'origin' | 'seq' | 'at'> : never : never;

function harness() {
  let state = createGrowthState(kingdomId, 'simulated');
  const history: GrowthObservation[] = [];
  const send = (body: Body, at = state.asOf) => {
    const input = { ...body, kingdomId, origin: 'simulated' as const, seq: state.sequence + 1, at };
    const result = reduceGrowth(state, input);
    state = result.state;
    history.push(input);
    return result;
  };
  const night = (day: number, id = `night:${day}`) => send({ type: 'stream-observed', sessionId: id, startedAt: day * dayMs }, day * dayMs);
  const present = (id = personId) => send({ type: 'presence-qualified', personId: id, sessionId: state.session!.id,
    coveredMs: 600_000, source: 'observed-presence', evidenceReceipt: `receipt:${state.sequence}` }, Math.max(state.asOf, state.session!.startedAt + 600_000));
  const bind = (installedTier: 'hut' | 'cottage' | 'house' | 'manor' | 'hall' | null = null) =>
    send({ type: 'home-bound', personId, plotId: 'plot:200', installedTier });
  return { send, night, present, bind, history, get state() { return state; } };
}

describe('earned growth', () => {
  it('turns a tent into a hut on the third qualified day and grows through every tier', () => {
    const h = harness(); h.bind();
    for (let day = 1; day <= 180; day++) {
      h.night(day);
      const result = h.present();
      const expectedTier = Object.entries(GROWTH_POLICY_V1.homeDays).find(([, threshold]) => day === threshold)?.[0];
      expect(result.milestones.filter(item => item.kind === 'home-grown').map(item => item.to)).toEqual(expectedTier ? [expectedTier] : []);
      GrowthHomeViewSchema.parse(projectGrowthHome(h.state, personId));
    }
    expect(projectGrowthHome(h.state, personId)).toMatchObject({ stage: 'hall', qualifiedDays: 180, qualifiedMinutes: 1800, currentStreak: 180, bestStreak: 180, nextGoal: null });
    expect(h.state.civic.levels).toEqual({ tavern: 4, forge: 4, market: 4, bridge: 4, 'castle-court': 3 });
  });

  it('deduplicates sessions on one UTC start date and a marathon across midnight', () => {
    const h = harness(); h.bind(); h.night(1); h.present();
    h.send({ type: 'stream-observed', sessionId: 'night:1', startedAt: dayMs }, 3 * dayMs);
    h.present();
    expect(projectGrowthHome(h.state, personId)?.qualifiedDays).toBe(1);
    h.send({ type: 'stream-observed', sessionId: 'restart', startedAt: 3 * dayMs }, 3 * dayMs);
    h.present();
    h.send({ type: 'stream-observed', sessionId: 'restart:2', startedAt: 3 * dayMs + 700_000 }, 3 * dayMs + 700_000);
    expect(h.present().milestones).toEqual([]);
    expect(projectGrowthHome(h.state, personId)).toMatchObject({ qualifiedDays: 2, currentStreak: 2 });
    expect(h.state.civic).toMatchObject({ qualifiedDays: 2, personDays: 2 });
  });

  it('keeps earned homes and best streak through missed stream-days; offline dates never break a streak', () => {
    const h = harness(); h.bind();
    for (const day of [1, 2, 20]) { h.night(day); h.present(); }
    expect(projectGrowthHome(h.state, personId)).toMatchObject({ stage: 'hut', currentStreak: 3, bestStreak: 3 });
    h.night(21);
    expect(projectGrowthHome(h.state, personId)?.currentStreak).toBe(3);
    h.night(22);
    expect(projectGrowthHome(h.state, personId)).toMatchObject({ stage: 'hut', currentStreak: 0, bestStreak: 3 });
    h.present();
    expect(projectGrowthHome(h.state, personId)).toMatchObject({ stage: 'hut', qualifiedDays: 4, currentStreak: 1, bestStreak: 3 });
  });

  it('preserves an installed tier without claiming its unobserved days or inventing a ceremony', () => {
    const h = harness();
    expect(h.bind('manor').milestones).toEqual([]);
    h.night(1); h.present(); h.bind('hut');
    expect(projectGrowthHome(h.state, personId)).toMatchObject({ stage: 'manor', qualifiedDays: 1, nextGoal: { stage: 'hall', remainingDays: 179 } });
  });

  it('counts every quiet citizen equally while civic growth remains paced by days', () => {
    const h = harness();
    for (let day = 1; day <= 7; day++) { h.night(day); h.present(); h.present(other); h.present(other); }
    expect(h.state.civic).toMatchObject({ qualifiedDays: 7, personDays: 14, levels: { tavern: 2, forge: 1 } });
    expect(h.state.citizens[other]?.qualifiedDays).toBe(h.state.citizens[personId]?.qualifiedDays);
    expect(h.state.citizens[other]?.home).toBeNull(); // Presence never manufactures a deed.
  });

  it('replays exactly and keeps source retries idempotent without retaining receipt history', () => {
    const h = harness(); h.bind();
    for (let day = 1; day <= 30; day++) { h.night(day); h.present(); }
    const replay = h.history.reduce((state, observation) => reduceGrowth(state, observation).state, createGrowthState(kingdomId, 'simulated'));
    expect(replay).toEqual(h.state);
    const duplicate = reduceGrowth(replay, h.history[2]!);
    expect(duplicate.state).toBe(replay);
    expect(duplicate.milestones).toEqual([]);
    expect(Object.keys(replay.citizens[personId]!)).toEqual(['qualifiedDays', 'lastQualifiedOrdinal', 'streak', 'bestStreak', 'home']);
  });

  it('rejects money, insufficient proof, cross-origin evidence and qualifications for unwitnessed streams', () => {
    const h = harness(); h.night(1);
    const input: GrowthObservation = { type: 'presence-qualified', personId, kingdomId, origin: 'simulated', seq: 2,
      at: dayMs + 600_000, sessionId: 'night:1', coveredMs: 600_000, source: 'observed-presence', evidenceReceipt: 'receipt:1' };
    for (const invalid of [
      { ...input, source: 'subscription' }, { ...input, amount: 500 }, { ...input, coveredMs: 599_999 },
      { ...input, origin: 'live' }, { ...input, origin: 'recovered' }, { ...input, sessionId: 'other' },
    ]) expect(() => reduceGrowth(h.state, invalid as GrowthObservation)).toThrow();
  });

  it('does not mutate supplied snapshots and cannot move an existing home', () => {
    const h = harness(); h.bind(); h.night(1);
    const before: GrowthState = structuredClone(h.state);
    h.present();
    expect(before.citizens[personId]?.qualifiedDays).toBe(0);
    expect(before.day?.qualified).toBe(false);
    expect(() => h.send({ type: 'home-bound', personId, plotId: 'other-plot', installedTier: 'hall' })).toThrow('move');
  });

  it('projects a schema-valid bounded scene without private identity or evidence receipts', () => {
    const h = harness(); h.bind();
    h.send({ type: 'home-bound', personId: other, plotId: 'plot:100', installedTier: 'house' });
    for (const day of [1, 2]) { h.night(day); h.present(); }
    h.night(3);
    const result = h.present();
    const milestones = Array.from({ length: 70 }, () => result.milestones).flat();
    const frame = projectGrowthScene(h.state, milestones);
    expect(GrowthSceneFrameSchema.parse(frame)).toEqual(frame);
    expect(frame.homes.map(home => home.plotId)).toEqual(['plot:100', 'plot:200']);
    expect(frame.beats).toHaveLength(128);
    expect(frame.beats.at(-1)).toMatchObject({ kind: 'streak-reached', plotId: 'plot:200', days: 3 });
    expect(JSON.stringify(frame)).not.toMatch(/personId|evidenceReceipt|observed-presence|citizens|sessionId/);
  });
});
