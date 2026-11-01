import { KingdomIdSchema } from '../../../shared/src/identity';
import { expect, it } from 'vitest';
import type { GrowthSceneFeed, GrowthSceneFrame } from '../../../shared/src/growth';
import { observeHomeProgress, createHomeProgress, type HomeProgressState } from './adapter';

it('validates provenance and replaces stale home progress, including a completed home', () => {
  let receive!: (frame: GrowthSceneFrame) => void;
  let unavailable!: () => void;
  const feed: GrowthSceneFeed = { label: 'SIMULATED', subscribe(next, fail) { receive = next; unavailable = fail; return () => {}; } };
  const states: HomeProgressState[] = [];
  const binding = (plotId: string) => ({ kingdomId: KingdomIdSchema.parse('123'), plotId });
  const stop = observeHomeProgress(feed, binding('one'), state => states.push(state));
  const frame: GrowthSceneFrame = { version: 1, kingdomId: KingdomIdSchema.parse('123'), origin: 'simulated', sequence: 1, asOf: 1,
    homes: [{ plotId: 'one', stage: 'cottage', qualifiedDays: 18, qualifiedMinutes: 180, currentStreak: 4, bestStreak: 9, nextGoal: { stage: 'house', requiredDays: 30, remainingDays: 12 } }],
    civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 }, beats: [] };
  receive(frame);
  expect(states.at(-1)).toMatchObject({ kind: 'ready', home: { currentStreak: 4, bestStreak: 9, nextGoal: { remainingDays: 12 } } });
  receive({ ...frame, sequence: 2, homes: [{ ...frame.homes[0]!, stage: 'hall', nextGoal: null }] });
  expect(states.at(-1)).toMatchObject({ kind: 'ready', home: { stage: 'hall', nextGoal: null } });
  receive(frame);
  expect(states.at(-1)).toMatchObject({ kind: 'ready', home: { stage: 'hall' } });
  receive({ ...frame, sequence: 3 });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
  receive({ ...frame, sequence: 3, homes: [{ ...frame.homes[0]!, stage: 'hall', qualifiedDays: 17, qualifiedMinutes: 170, nextGoal: null }] });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
  receive({ ...frame, sequence: 3, homes: [{ ...frame.homes[0]!, stage: 'hall', currentStreak: 0, bestStreak: 8, nextGoal: null }] });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
  receive({ ...frame, sequence: 3, homes: [{ ...frame.homes[0]!, stage: 'hall', currentStreak: 0, nextGoal: null }] });
  expect(states.at(-1)).toMatchObject({ kind: 'ready', home: { stage: 'hall', currentStreak: 0, bestStreak: 9 } });
  receive({ ...frame, sequence: 4, kingdomId: KingdomIdSchema.parse('456') });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
  receive({ ...frame, sequence: 4, origin: 'live' });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
  receive({ ...frame, sequence: 4, homes: [{ ...frame.homes[0]!, qualifiedMinutes: 999 }] });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
  receive({ ...frame, sequence: 4, homes: [{ ...frame.homes[0]!, nextGoal: { stage: 'house', requiredDays: 30, remainingDays: 1 } }] });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
  receive({ ...frame, sequence: 4, homes: [] });
  expect(states.at(-1)).toEqual({ kind: 'empty', label: 'SIMULATED' });
  unavailable();
  expect(states.at(-1)).toEqual({ kind: 'unavailable', label: 'SIMULATED' });
  receive({ ...frame, sequence: 4, homes: [] });
  expect(states.at(-1)).toEqual({ kind: 'empty', label: 'SIMULATED' });
  receive({ ...frame, sequence: 4 });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
  const oldReceive = receive;
  stop();
  const stopReplacement = observeHomeProgress(feed, binding('two'), state => states.push(state));
  expect(states.at(-1)).toEqual({ kind: 'loading', label: 'SIMULATED' });
  oldReceive(frame);
  expect(states.at(-1)).toEqual({ kind: 'loading', label: 'SIMULATED' });
  receive({ ...frame, homes: [{ ...frame.homes[0]!, plotId: 'two' }] });
  expect(states.at(-1)).toMatchObject({ kind: 'ready', home: { plotId: 'two' } });
  stopReplacement();
});

it('clears the previous subject before subscribing and rejects an invalid feed label', () => {
  const listeners: Array<(frame: GrowthSceneFrame) => void> = [];
  const feed: GrowthSceneFeed = { label: 'SIMULATED', subscribe(next) { listeners.push(next); return () => {}; } };
  const states: HomeProgressState[] = [];
  const binding = (plotId: string) => ({ kingdomId: KingdomIdSchema.parse('123'), plotId });
  const progress = createHomeProgress(state => states.push(state));
  progress.replace(feed, binding('one'));
  const old = listeners[0]!;
  progress.replace(feed, binding('two'));
  expect(states.at(-1)).toEqual({ kind: 'loading', label: 'SIMULATED' });
  old({} as GrowthSceneFrame);
  expect(states.at(-1)).toEqual({ kind: 'loading', label: 'SIMULATED' });
  progress.replace({ ...feed, label: 'UNTRUSTED' } as unknown as GrowthSceneFeed, binding('two'));
  expect(states.at(-1)).toEqual({ kind: 'invalid' });
  progress.replace(null, null);
  expect(states.at(-1)).toEqual({ kind: 'unavailable' });
  progress.close();
});

it('does not start a feed when the host clears its binding during loading', () => {
  let subscriptions = 0;
  const feed: GrowthSceneFeed = { label: 'SIMULATED', subscribe() { subscriptions++; return () => {}; } };
  const states: HomeProgressState[] = [];
  const progress = createHomeProgress(state => { states.push(state); if (state.kind === 'loading') progress.replace(null, null); });
  progress.replace(feed, { kingdomId: KingdomIdSchema.parse('123'), plotId: 'one' });
  expect(states.at(-1)).toEqual({ kind: 'unavailable' });
  expect(subscriptions).toBe(0);
});

it('reports a failing feed as unavailable without leaving a prior result behind', () => {
  const states: HomeProgressState[] = [];
  const progress = createHomeProgress(state => states.push(state));
  const broken: GrowthSceneFeed = { label: 'LIVE', subscribe() { throw new Error('offline'); } };
  progress.replace(broken, { kingdomId: KingdomIdSchema.parse('123'), plotId: 'one' });
  expect(states.at(-1)).toEqual({ kind: 'unavailable', label: 'LIVE' });
});

it('does not let a feed change its provenance after subscription', () => {
  let send!: (frame: GrowthSceneFrame) => void;
  const feed: { label: 'LIVE' | 'SIMULATED'; subscribe: GrowthSceneFeed['subscribe'] } = { label: 'SIMULATED', subscribe(next) { send = next; return () => {}; } };
  const states: HomeProgressState[] = [];
  observeHomeProgress(feed, { kingdomId: KingdomIdSchema.parse('123'), plotId: 'one' }, state => states.push(state));
  feed.label = 'LIVE';
  send({ version: 1, kingdomId: KingdomIdSchema.parse('123'), origin: 'live', sequence: 1, asOf: 1, homes: [], civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 }, beats: [] });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
});

it('keeps the subscribed binding and witnessed floor independent of mutable caller objects', () => {
  let send!: (frame: GrowthSceneFrame) => void;
  const feed: GrowthSceneFeed = { label: 'SIMULATED', subscribe(next) { send = next; return () => {}; } };
  const states: HomeProgressState[] = [];
  const binding = { kingdomId: KingdomIdSchema.parse('123'), plotId: 'one' };
  observeHomeProgress(feed, binding, state => states.push(state));
  binding.plotId = 'two';
  const frame: GrowthSceneFrame = { version: 1, kingdomId: binding.kingdomId, origin: 'simulated', sequence: 1, asOf: 1, homes: [{ plotId: 'one', stage: 'cottage', qualifiedDays: 18, qualifiedMinutes: 180, currentStreak: 4, bestStreak: 9, nextGoal: { stage: 'house', requiredDays: 30, remainingDays: 12 } }], civic: { tavern: 1, forge: 1, market: 1, bridge: 1, 'castle-court': 1 }, beats: [] };
  send(frame);
  const result = states.at(-1);
  expect(result).toMatchObject({ kind: 'ready', home: { plotId: 'one' } });
  if (result?.kind !== 'ready') throw new Error('Expected home');
  result.home.qualifiedDays = 0;
  send({ ...frame, sequence: 2, homes: [{ ...frame.homes[0]!, qualifiedDays: 17, qualifiedMinutes: 170, nextGoal: { stage: 'house', requiredDays: 30, remainingDays: 13 } }] });
  expect(states.at(-1)).toEqual({ kind: 'invalid', label: 'SIMULATED' });
});
