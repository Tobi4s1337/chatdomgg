import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtlasChannel } from '@chatdom/shared';
import type { AtlasRaid, KingdomId } from '../../../api/src/raid-gate/contracts';
import type { GateDestination, GateSnapshot, JourneySnapshot } from './controller';
import {
  countdownSeconds, countdownShare, isStreamPath, MARCH_NEWS_MS, MARCH_SETBACK_MS, marchActions, marchCallShows, marchDestinationName, marchNews,
  marchNotice, marchPartyLine, marchWords, monarchName, mountRaidMarchCall, twitchChannelUrl, watchLogin,
} from './march-call';
import type { RaidGateApi } from './ports';

const T0 = 1_800_000_000_000;
const SOURCE = { kingdomId: '129634568' as KingdomId, name: 'Willowmere', login: 'tobi4s_' };
const FERN = '41000002' as KingdomId, MASHA = '12826' as KingdomId;
const fernhollow: AtlasChannel = { kingdomId: FERN, login: 'fernhollow', displayName: 'Fernhollow', language: 'en', founded: true, kingdomName: 'Fernhollow', contentClassification: 'general' };
const mashad4: AtlasChannel = { kingdomId: MASHA, login: 'mashad4', displayName: 'MashaD4', language: 'en', founded: false, kingdomName: null, contentClassification: 'general' };
const toFern: GateDestination = { target: { kingdomId: FERN, founded: true, live: true, classification: 'general' }, channel: fernhollow, land: 'founded' };
const toMasha: GateDestination = { target: { kingdomId: MASHA, founded: false, live: true, classification: 'general' }, channel: mashad4, land: 'waiting' };
const raid = { id: 'raid-1' } as AtlasRaid;

function snap(over: Partial<GateSnapshot> = {}): GateSnapshot {
  return {
    phase: 'gathering', origin: 'live', mapOrigin: null, viewer: 'walker', authority: null, source: SOURCE, destination: toFern, requestId: 'req-1',
    optedIn: 5, joined: false, expiresAt: T0 + 60_000, state: 'prepared', countdownEndsAt: null, raid: null, checking: null, canStart: false, busy: null,
    farewell: null, asking: null, notice: null, canReconnect: false, journey: null, canTravel: false, welcome: null, ...over,
  };
}

function trip(state: JourneySnapshot['state'], over: Partial<JourneySnapshot> = {}): JourneySnapshot {
  return {
    kind: 'raid', ticket: 't-1', state, from: SOURCE.kingdomId, to: FERN, destination: toFern, role: state === 'committed' ? 'visitor' : null,
    arrivalId: state === 'committed' ? 'a-1' : null, overrun: false, refusal: null, busy: null, ...over,
  };
}

const departed = (over: Partial<GateSnapshot> = {}) => snap({ phase: 'departed', state: 'landed', joined: true, raid, canTravel: true, ...over });

describe('march call: when it shows', () => {
  it('never shows on a stream page', () => {
    for (const path of ['/stream', '/stream/', '/stream/raid', '/k/tobi4s_/stream', '/k/tobi4s_/stream/']) {
      expect(isStreamPath(path)).toBe(true);
      expect(marchCallShows(snap(), path)).toBe(false);
      expect(marchCallShows(departed({ journey: trip('preparing') }), path)).toBe(false);
    }
    for (const path of ['/', '/k/tobi4s_', '/streams-of-light', '/-/raid-gate']) expect(isStreamPath(path)).toBe(false);
  });

  it('calls only a signed-in walker or the monarch', () => {
    expect(marchCallShows(snap(), '/')).toBe(true);
    expect(marchCallShows(snap({ viewer: 'monarch', phase: 'preview' }), '/')).toBe(true);
    expect(marchCallShows(snap({ viewer: null }), '/')).toBe(false);
    expect(marchCallShows(snap({ viewer: null, phase: 'unbound' }), '/')).toBe(false);
    expect(marchCallShows(snap({ viewer: null, journey: trip('preparing') }), '/')).toBe(false);
  });

  it('shows only while a gate is open, departed or journeying for them, or a farewell is due', () => {
    for (const phase of ['gathering', 'starting', 'countdown', 'checking', 'departed', 'called-off', 'refused'] as const) {
      expect(marchCallShows(snap({ phase }), '/')).toBe(true);
      expect(marchCallShows(snap({ phase, destination: null }), '/')).toBe(false);
    }
    for (const phase of ['quiet', 'loading', 'unreachable', 'unbound'] as const) expect(marchCallShows(snap({ phase, destination: null }), '/')).toBe(false);
    // The monarch's map, grant and lapse belong to the throne's board; a walker never has a preview phase.
    for (const phase of ['idle', 'choosing', 'previewing', 'authority', 'lapsed'] as const) expect(marchCallShows(snap({ phase, viewer: 'monarch' }), '/')).toBe(false);
    expect(marchCallShows(snap({ phase: 'preview', viewer: 'walker' }), '/')).toBe(false);
    expect(marchCallShows(snap({ phase: 'quiet', destination: null, journey: trip('committed') }), '/')).toBe(true);
    expect(marchCallShows(snap({ phase: 'quiet', destination: null, farewell: { reason: 'closed', destination: toFern, joined: true } }), '/')).toBe(true);
    expect(marchCallShows(snap({ phase: 'quiet', destination: null, farewell: { reason: 'lapsed', destination: toFern, joined: false } }), '/')).toBe(true);
    // The monarch closed it themselves; the board already says so.
    expect(marchCallShows(snap({ phase: 'idle', viewer: 'monarch', destination: null, farewell: { reason: 'closed', destination: toFern, joined: false } }), '/')).toBe(false);
  });
});

describe('march call: the words', () => {
  it('reads Twitch countdown seconds from countdownEndsAt, whole and never negative', () => {
    expect(countdownSeconds(null, T0)).toBeNull();
    expect(countdownSeconds(T0 + 38_000, T0)).toBe(38);
    expect(countdownSeconds(T0 + 37_001, T0)).toBe(38);
    expect(countdownSeconds(T0 + 37_000, T0)).toBe(37);
    expect(countdownSeconds(T0 - 5_000, T0)).toBe(0);
    expect(countdownShare(T0 + 45_000, T0, 90_000)).toBe(.5);
    expect(countdownShare(T0 + 200_000, T0, 90_000)).toBe(1);
    expect(countdownShare(T0 - 1, T0, 90_000)).toBe(0);
  });

  it('names the destination as people know it', () => {
    expect(marchDestinationName(toFern)).toBe('Fernhollow');
    expect(marchDestinationName(toMasha)).toBe('MashaD4');
    expect(marchDestinationName({ ...toFern, channel: null })).toBe('a neighbouring kingdom');
    expect(marchDestinationName({ ...toMasha, channel: null })).toBe('a live channel');
    expect(marchDestinationName(null)).toBe('a neighbouring kingdom');
  });

  it('counts the real party', () => {
    expect(marchPartyLine(snap({ optedIn: 0 }))).toBe('No one has chosen to march yet. Staying is always fine.');
    expect(marchPartyLine(snap({ optedIn: 1 }))).toBe('One walker is marching. Staying is always fine.');
    expect(marchPartyLine(snap({ optedIn: 5 }))).toBe('5 walkers are marching. Staying is always fine.');
    expect(marchPartyLine(snap({ optedIn: 1, joined: true }))).toBe("You're the first to march.");
    expect(marchPartyLine(snap({ optedIn: 2, joined: true }))).toBe('You and 1 other are marching.');
    expect(marchPartyLine(snap({ optedIn: 6, joined: true }))).toBe('You and 5 others are marching.');
  });

  it('calls the realm to the gate in the monarch\'s name', () => {
    expect(marchWords(snap(), T0)).toEqual({ eyebrow: 'The gate is open', title: 'tobi4s_ rides to Fernhollow', detail: '5 walkers are marching. Staying is always fine.', tone: 'call' });
    expect(marchWords(snap({ viewer: 'monarch', phase: 'preview' }), T0).title).toBe('You ride to Fernhollow');
    expect(marchWords(snap({ farewell: { reason: 'changed', destination: toMasha, joined: true } }), T0).detail).toBe("The call to MashaD4 ended, so your choice to march ended with it. Join again if you'd like to come.");
  });

  it('holds its breath through Twitch\'s countdown, and says when it ended unexplained', () => {
    const counting = snap({ phase: 'countdown', state: 'pending', joined: true, optedIn: 7, countdownEndsAt: T0 + 38_000 });
    expect(marchWords(counting, T0)).toMatchObject({ eyebrow: 'Twitch counts down', title: 'tobi4s_ rides to Fernhollow', tone: 'breath' });
    expect(marchWords(counting, T0).detail).toBe('The party sets out when Twitch confirms the raid. You and 6 others are marching.');
    expect(marchWords(counting, T0 + 40_000).detail).toBe("Twitch's countdown has ended. Waiting for Twitch to confirm the raid.");
    const checking = marchWords(snap({ phase: 'checking', state: 'unknown', checking: 'answer' }), T0);
    expect(checking).toMatchObject({ title: 'Checking whether the raid began', tone: 'checking' });
    expect(checking.detail).toContain('Nobody has left');
  });

  it('offers the ride out only on the witnessed departure, and tells waiting land plainly', () => {
    expect(marchWords(departed(), T0)).toMatchObject({ eyebrow: 'Twitch confirmed the raid', title: 'The party rides out for Fernhollow', tone: 'ride' });
    const waiting = marchWords(departed({ destination: toMasha, canTravel: false }), T0);
    expect(waiting).toMatchObject({ title: 'MashaD4 has no kingdom yet', tone: 'waiting' });
    expect(waiting.detail).toContain('no world to walk into');
    expect(marchWords(departed({ joined: false, canTravel: false }), T0)).toMatchObject({ title: 'The party rode out for Fernhollow', detail: '5 walkers marched. You stayed home, and your door is right where you left it.' });
  });

  it('tells a called-off, refused or lapsed gate calmly', () => {
    expect(marchWords(snap({ phase: 'called-off', state: 'cancelled' }), T0)).toMatchObject({ title: 'The raid was called off', detail: 'Twitch confirmed the raid to Fernhollow was called off. Nobody left, and everyone is home.' });
    expect(marchWords(snap({ phase: 'refused', state: 'rejected' }), T0)).toMatchObject({ title: "Twitch didn't start the raid", detail: 'Nothing left Willowmere, and everyone is home.' });
    expect(marchWords(snap({ phase: 'quiet', destination: null, farewell: { reason: 'lapsed', destination: toFern, joined: true } }), T0))
      .toMatchObject({ title: 'The call has ended', detail: 'The call to Fernhollow ran out before the gate opened. Nobody left, and your choice to march ended with it.' });
    expect(marchWords(snap({ phase: 'quiet', destination: null, farewell: { reason: 'closed', destination: toFern, joined: false } }), T0))
      .toMatchObject({ title: 'The gate has closed', detail: 'tobi4s_ closed the gate before the ride to Fernhollow. Nobody left.' });
  });

  it('walks the journey stage by stage, and home again', () => {
    const at = (j: JourneySnapshot) => marchWords(departed({ journey: j, canTravel: false }), T0);
    expect(at(trip('reserved')).title).toBe('Setting out for Fernhollow');
    expect(at(trip('preparing')).title).toBe('Fernhollow draws its world');
    expect(at(trip('preparing', { overrun: true })).title).toBe('Fernhollow is still drawing its world');
    expect(at(trip('committing')).title).toBe('Stepping through the gate');
    expect(at(trip('unknown')).title).toBe('Confirming where you stand');
    expect(at(trip('committed'))).toMatchObject({ eyebrow: 'Arrived in Fernhollow', title: "You stand at Fernhollow's gate as a visitor", tone: 'arrived' });
    expect(at(trip('committed', { role: 'citizen' })).title).toBe("You're at your own door in Fernhollow");
    expect(at(trip('reserved', { kind: 'return', from: FERN, to: SOURCE.kingdomId })).title).toBe('Setting out for home');
    expect(at(trip('committed', { kind: 'return', from: FERN, to: SOURCE.kingdomId, role: 'citizen' }))).toMatchObject({ title: 'Home in Willowmere', tone: 'news' });
    expect(at(trip('asking', { ticket: null, refusal: 'full' }))).toMatchObject({ title: 'Fernhollow is full right now', detail: 'Fernhollow has no room right now. Nobody was moved and nothing was held.' });
    expect(at(trip('cancelled')).title).toBe('You turned back');
  });

  it('says a refusal or a lost answer plainly', () => {
    expect(marchNotice(snap())).toBeNull();
    expect(marchNotice(snap({ notice: { kind: 'unreachable' } }))).toBe("Couldn't reach the gatekeeper. Nothing changed.");
    expect(marchNotice(snap({ notice: { kind: 'denied', code: 'stale' } }))).toBe('That gate has moved on. This is where it stands now.');
  });
});

describe('march call: what may be pressed', () => {
  it('offers join or leave while people may still choose', () => {
    for (const phase of ['gathering', 'starting', 'countdown', 'checking'] as const) {
      expect(marchActions(snap({ phase }))).toEqual(['join']);
      expect(marchActions(snap({ phase, joined: true }))).toEqual(['leave']);
    }
  });

  it('offers Ride out only when the controller can travel, and never travel to waiting land', () => {
    expect(marchActions(departed())).toEqual(['ride', 'stay']);
    expect(marchActions(departed({ destination: toMasha, canTravel: false }))).toEqual(['watch', 'stay']);
    expect(marchActions(departed({ destination: { ...toMasha, channel: null }, canTravel: false }))).toEqual(['stay']);
    expect(marchActions(departed({ joined: false, canTravel: false }))).toEqual(['done']);
    expect(watchLogin(departed({ destination: toMasha }))).toBe('mashad4');
    expect(twitchChannelUrl('mashad4')).toBe('https://www.twitch.tv/mashad4');
  });

  it('follows the journey: turn back before the step, check an unknown step, return home after arriving', () => {
    const at = (j: JourneySnapshot, over: Partial<GateSnapshot> = {}) => marchActions(departed({ journey: j, canTravel: false, ...over }));
    expect(at(trip('asking', { ticket: null }))).toEqual([]);
    expect(at(trip('reserved'))).toEqual(['turn-back']);
    expect(at(trip('preparing'))).toEqual(['turn-back']);
    expect(at(trip('committing'))).toEqual([]);
    expect(at(trip('unknown'))).toEqual(['check']);
    expect(at(trip('committed'))).toEqual(['return', 'watch']);
    expect(at(trip('committed', { arrivalId: null, destination: { ...toFern, channel: null } }))).toEqual([]);
    expect(at(trip('committed', { kind: 'return', from: FERN, to: SOURCE.kingdomId }))).toEqual(['done']);
    expect(at(trip('cancelled'))).toEqual(['again', 'done']);
    expect(at(trip('asking', { ticket: null, refusal: 'full' }))).toEqual(['again', 'done']);
    expect(at(trip('asking', { ticket: null, refusal: 'unauthorized' }))).toEqual(['done']);
    // Once the raid is no longer the gate's news, trying again would be refused: it is not offered.
    expect(at(trip('cancelled'), { phase: 'quiet', destination: null, joined: false, raid: null })).toEqual(['done']);
  });
});

describe('march call: news is told once', () => {
  it('holds plain news briefly and lets a marcher choose in their own time', () => {
    expect(marchNews(snap())).toBeNull();
    expect(marchNews(snap({ phase: 'called-off' }))).toEqual({ key: 'called-off:req-1', holdMs: MARCH_NEWS_MS, lasting: true, ends: 'hide', covers: null });
    expect(marchNews(snap({ phase: 'refused' }))).toMatchObject({ key: 'refused:req-1', lasting: true });
    expect(marchNews(departed({ joined: false, canTravel: false }))).toMatchObject({ key: 'departed:req-1', holdMs: MARCH_NEWS_MS });
    expect(marchNews(departed())).toMatchObject({ key: 'marched:req-1', holdMs: null });
    expect(marchNews(snap({ phase: 'quiet', destination: null, farewell: { reason: 'lapsed', destination: toFern, joined: true } }))).toMatchObject({ holdMs: MARCH_NEWS_MS, lasting: false });
  });

  it('puts an ended journey away with the ride that began it', () => {
    expect(marchNews(departed({ journey: trip('preparing') }))).toBeNull();
    expect(marchNews(departed({ journey: trip('committed') }))).toBeNull();
    expect(marchNews(departed({ journey: trip('cancelled') }))).toMatchObject({ holdMs: MARCH_SETBACK_MS, ends: 'journey', covers: 'marched:req-1' });
    expect(marchNews(departed({ journey: trip('committed', { kind: 'return', from: FERN, to: SOURCE.kingdomId }) }))).toMatchObject({ holdMs: MARCH_NEWS_MS, ends: 'journey', covers: 'marched:req-1' });
    expect(marchNews(snap({ phase: 'quiet', destination: null, journey: trip('committed', { kind: 'return', from: FERN, to: SOURCE.kingdomId }) }))).toMatchObject({ covers: null });
  });
});

describe('march call: mounting', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('does nothing at all on a stream page: no controller, no request, no layer', () => {
    vi.stubGlobal('location', { pathname: '/k/tobi4s_/stream' });
    const api: RaidGateApi = { origin: 'live', request: vi.fn(), subscribe: vi.fn() };
    const dispose = mountRaidMarchCall({ kingdomId: SOURCE.kingdomId, source: SOURCE, origin: 'live', signal: new AbortController().signal, api });
    expect(api.request).not.toHaveBeenCalled();
    expect(api.subscribe).not.toHaveBeenCalled();
    dispose();
  });

  it('does nothing once its signal has already ended', () => {
    vi.stubGlobal('location', { pathname: '/k/tobi4s_' });
    const api: RaidGateApi = { origin: 'live', request: vi.fn(), subscribe: vi.fn() };
    const life = new AbortController();
    life.abort();
    mountRaidMarchCall({ kingdomId: SOURCE.kingdomId, source: SOURCE, origin: 'live', signal: life.signal, api })();
    expect(api.request).not.toHaveBeenCalled();
  });
});

describe('march call: a host that is not told the login', () => {
  it('names the monarch plainly rather than leaving a gap', () => {
    expect(monarchName({ ...SOURCE, login: '' })).toBe('The monarch');
    expect(monarchName(SOURCE)).toBe('tobi4s_');
  });
});

describe('march call: titles', () => {
  it('capitalises our own plain phrases at the start of a title, never a login', () => {
    const unnamed = { ...toFern, channel: null };
    const trip = { kind: 'raid' as const, ticket: 't', state: 'preparing' as const, from: SOURCE.kingdomId, to: FERN, destination: unnamed, role: null,
      arrivalId: null, overrun: true, refusal: null, busy: null };
    expect(marchWords(snap({ journey: trip }), T0).title).toBe('A neighbouring kingdom is still drawing its world');
    expect(marchWords(snap({ phase: 'gathering' }), T0).title.startsWith('tobi4s_')).toBe(true);
  });
});
