// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ChannelFace } from './directory';
import { ID_A } from './fixtures.test-support';
import { validateBusiest, validateCaravan, validateChannelRoads, validateFinder, validateRoadStory, type FinderEntry } from './roads';
import { selectable } from '../gate/select';

const T = Date.UTC(2026, 10, 2, 10);
const face = (id: string, name: string | null = `Chan ${id}`, place: ChannelFace['place'] = 'mapped'): ChannelFace => ({
  id, login: name ? name.toLowerCase().replace(/\W+/g, '_') : null, name, freshUntil: name ? T + 86_400_000 : null,
  place, ordinal: place === 'mapped' ? Number(id) % 100 : null, tier: place === 'mapped' ? 2 : null, region: 3, realm: 7,
});
const head = (kind: string) => ({ version: 1, kind, preview: ID_A, servedAt: T });
const entry = (id: string, over: Partial<FinderEntry> = {}): FinderEntry => ({
  channel: face(id), position: { x: 10, y: 20 }, live: true, size: 40, viewers: 38, game: 'Just Chatting', language: 'de',
  land: 'waiting', roads: null, portrait: null, ...over,
});

describe('road replies', () => {
  it('reads a kingdom’s roads and refuses one that names no raid', () => {
    const reply = {
      ...head('chatdom-atlas-roads'), since: T - 5 * 86_400_000, channel: face('100'), position: { x: 1, y: 2 }, total: 1,
      roads: [{ other: face('200'), position: null, sent: 2, received: 1, travellers: 90, firstAt: T - 86_400_000, lastAt: T, basis: 'observations' }],
    };
    expect(validateChannelRoads(reply, ID_A).roads[0]!.position).toBeNull();
    expect(() => validateChannelRoads({ ...reply, roads: [{ ...reply.roads[0], sent: 0, received: 0 }] }, ID_A)).toThrow();
    expect(() => validateChannelRoads({ ...reply, roads: [{ ...reply.roads[0], other: face('100') }] }, ID_A)).toThrow();
    expect(() => validateChannelRoads({ ...reply, total: 0 }, ID_A)).toThrow();
    expect(() => validateChannelRoads({ ...reply, extra: true }, ID_A)).toThrow();
  });

  it('keeps a story’s basis honest: no raids seen is "none", never a zero count', () => {
    const story = {
      ...head('chatdom-atlas-road-story'), since: T - 86_400_000, a: face('100'), b: face('200'), pa: null, pb: { x: 3, y: 4 },
      aToB: { raids: 3, travellers: 120 }, bToA: { raids: 0, travellers: 0 }, firstAt: T - 3_600_000, lastAt: T, basis: 'observations', recent: [{ at: T, from: '100', viewers: 40 }],
    };
    expect(validateRoadStory(story, ID_A).aToB!.raids).toBe(3);
    const none = { ...story, aToB: null, bToA: null, firstAt: null, lastAt: null, basis: 'none', recent: [] };
    expect(validateRoadStory(none, ID_A).basis).toBe('none');
    expect(() => validateRoadStory({ ...none, basis: 'observations' }, ID_A)).toThrow();
    // A road has both ways (one may be unridden); a road with no raid either way is no road.
    expect(() => validateRoadStory({ ...story, bToA: null }, ID_A)).toThrow();
    expect(() => validateRoadStory({ ...story, aToB: { raids: 0, travellers: 0 } }, ID_A)).toThrow();
    expect(() => validateRoadStory({ ...story, b: face('100') }, ID_A)).toThrow();
  });

  it('reads the busiest roads with both ends placed', () => {
    const busy = { ...head('chatdom-atlas-busiest-roads'), since: T, roads: [{ a: '1', b: '2', pa: { x: 0, y: 0 }, pb: { x: 1, y: 1 }, ra: 0, rb: 4, raids: 1, travellers: 5, lastAt: T, basis: 'observations' }] };
    expect(validateBusiest(busy, ID_A).roads).toHaveLength(1);
    expect(() => validateBusiest({ ...busy, roads: [{ ...busy.roads[0], pa: null }] }, ID_A)).toThrow();
    expect(() => validateBusiest({ ...busy, preview: 'pv-other' }, ID_A)).toThrow();
  });

  it('drops a malformed caravan and one whose ends do not match', () => {
    const raid = { version: 1, id: 'raid-1', from: '100', to: '200', viewers: 12, at: T, a: face('100'), b: face('200'), pa: { x: 1, y: 1 }, pb: null, ra: 3, rb: null };
    expect(validateCaravan(raid).viewers).toBe(12);
    expect(() => validateCaravan({ ...raid, to: '100' })).toThrow();
    expect(() => validateCaravan({ ...raid, b: face('300') })).toThrow();
    expect(() => validateCaravan({ ...raid, viewers: 0 })).toThrow();
    expect(() => validateCaravan({ ...raid, id: '' })).toThrow();
  });
});

describe('the finder', () => {
  const reply = (groups: { kind: string; entries: FinderEntry[] }[]) => ({
    ...head('chatdom-atlas-finder'), liveAsOf: T, from: { channel: face('100'), position: { x: 0, y: 0 } }, groups,
  });

  it('accepts roads, realm, neighbours and search in order', () => {
    const ok = validateFinder(reply([
      { kind: 'roads', entries: [entry('201', { roads: { raids: 3, lastAt: T } })] },
      { kind: 'realm', entries: [entry('202')] },
      { kind: 'neighbours', entries: [entry('203')] },
      { kind: 'search', entries: [entry('201', { roads: { raids: 3, lastAt: T } }), entry('204', { live: false, viewers: null })] },
    ]), ID_A);
    expect(ok.groups.map(group => group.kind)).toEqual(['roads', 'realm', 'neighbours', 'search']);
  });

  it('refuses offline proposals, the source itself, and a channel proposed twice', () => {
    expect(() => validateFinder(reply([{ kind: 'realm', entries: [entry('202', { live: false })] }]), ID_A)).toThrow(/live/);
    expect(() => validateFinder(reply([{ kind: 'roads', entries: [entry('100')] }]), ID_A)).toThrow(/source/);
    expect(() => validateFinder(reply([{ kind: 'roads', entries: [entry('202')] }, { kind: 'realm', entries: [entry('202')] }]), ID_A)).toThrow(/once/);
  });

  it('carries no paid or ranked field a channel could buy', () => {
    expect(() => validateFinder(reply([{ kind: 'realm', entries: [{ ...entry('202'), sponsored: true } as FinderEntry] }]), ID_A)).toThrow();
  });

  it('lets only live, named channels be chosen', () => {
    expect(selectable(entry('202'))).toBe(true);
    expect(selectable(entry('202', { live: false }))).toBe(false);
    expect(selectable(entry('202', { channel: face('202', null, 'unseen') }))).toBe(false);
  });
});
