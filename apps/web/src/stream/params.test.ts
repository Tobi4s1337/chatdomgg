import { describe, expect, it } from 'vitest';
import { browserSourcePath, parseKingdomPresentationParams, parseStreamParams } from './params';
import { createDockFixture } from './dock-fixture';

describe('public kingdom presentation', () => {
  it('selects the read-only realm source and waits for its approved name', () => {
    expect(parseStreamParams('?source=realm&kingdom=129634568&seed=pretend-name&hour=19.5')).toMatchObject({
      source: 'realm', kingdomId: '129634568', kingdomName: 'Kingdom', hour: 19.5,
    });
  });
  it('preserves the existing demonstration layouts when no coordinates are supplied', () => {
    expect(parseKingdomPresentationParams(new URLSearchParams(), 'hamlet')).toEqual({ firstYear: 2025, year: 2026 });
    expect(parseKingdomPresentationParams(new URLSearchParams(), 'town')).toEqual({ firstYear: 2022, year: 2026 });
  });

  it('matches the real channel layout, numeric kingdom and slot zero in both surfaces', () => {
    const search = '?source=herald&seed=tobi4s_&tier=hamlet&firstYear=2026&year=2026&kingdom=129634568&focusSlot=0';
    expect(parseStreamParams(search)).toMatchObject({ source: 'realm', seed: 'tobi4s_', tier: 'hamlet', firstYear: 2026,
      year: 2026, kingdomId: '129634568', focusSlot: 0, time: null });
    expect(parseKingdomPresentationParams(new URLSearchParams(search), 'hamlet')).toEqual({ firstYear: 2026, year: 2026,
      kingdomId: '129634568', focusSlot: 0 });
  });

  it('does not admit malformed identity, slots or unbounded founding ranges', () => {
    for (const search of ['firstYear=2027&year=2026', 'firstYear=1000&year=9999', 'firstYear=-1&year=NaN']) {
      expect(parseKingdomPresentationParams(new URLSearchParams(search), 'town')).toEqual({ firstYear: 2022, year: 2026 });
    }
    for (const slot of ['-1', '65535', '1.2', '01', 'NaN']) {
      expect(parseKingdomPresentationParams(new URLSearchParams(`kingdom=someone&focusSlot=${slot}`), 'hamlet')).toEqual({ firstYear: 2025, year: 2026 });
    }
  });

  it('allows a real citizen camera on stage while retaining window framing in small formats', () => {
    expect(parseStreamParams('?source=herald&camera=citizen').camera).toBe('citizen');
    expect(parseStreamParams('?source=herald&camera=citizen&layout=strip').camera).toBe('window');
  });
});

describe('stream source isolation', () => {
  it('requires a real realm on the public route despite arbitrary sources, seeds and fixture flags', () => {
    for (const source of ['', 'realm', 'herald', 'simulated', 'fixture', 'unknown']) {
      const search = `?source=${source}&seed=invented-kingdom&presenceOrigin=simulated&fixture=1&dockFixture=1&forgeFixture=1`;
      const params = parseStreamParams(search, '/stream');
      expect(params).toMatchObject({ source: 'realm', presenceOrigin: 'live', kingdomName: 'Kingdom' });
      expect(params.kingdomId).toBeUndefined();
      expect(parseStreamParams(`${search}&kingdom=129634568`, '/stream')).toMatchObject({
        source: 'realm', presenceOrigin: 'live', kingdomId: '129634568', kingdomName: 'Kingdom',
      });
    }
  });

  it('does not invent an identity for a bare stream or an invalid kingdom', () => {
    for (const search of ['', '?seed=willowmere', '?kingdom=willowmere', '?kingdom=0', '?kingdom=129634568oops']) {
      const params = parseStreamParams(search);
      expect(params.source).toBe('realm');
      expect(params.kingdomName).toBe('Kingdom');
      expect(params.kingdomId).toBeUndefined();
    }
  });

  it('keeps the explicit development bench staged, with fixture provenance and authoring coordinates', () => {
    for (const source of ['', '&source=simulated', '&source=fixture']) {
      expect(parseStreamParams(`?seed=willowmere&tier=hamlet&time=30&preview=1${source}`, '/-/stream')).toMatchObject({
        source: 'simulated', presenceOrigin: 'simulated', kingdomName: 'Willowmere', seed: 'willowmere',
        tier: 'hamlet', time: 30, preview: true,
      });
    }
    expect(parseStreamParams('?source=realm&kingdom=129634568', '/-/stream')).toMatchObject({
      source: 'realm', presenceOrigin: 'live', kingdomName: 'Kingdom', kingdomId: '129634568',
    });
    for (const path of ['/', '/stream/', '/-/streaming', '/-/stream/']) {
      expect(parseStreamParams('?source=simulated&seed=invented', path).source).toBe('realm');
    }
  });

  it('copies real browser sources while applying the authoring controls and removing staged toggles', () => {
    const path = browserSourcePath({ pathname: '/stream', search: '?preview=1&source=simulated&kingdom=129634568&presenceOrigin=simulated&dockFixture=1&forgeFixture=1&fixture=1' }, 'stage', 'show', 'break', [0, 0, 74, 100]);
    const url = new URL(path, 'https://chatdom.gg');
    expect(url.pathname).toBe('/stream');
    expect(Object.fromEntries(url.searchParams)).toEqual({ source: 'realm', kingdom: '129634568', mood: 'show', seam: 'break', safe: 'chat' });
    expect(parseStreamParams(url.search)).toMatchObject({ source: 'realm', mood: 'show', seam: 'break', safe: [0, 0, 74, 100] });
  });

  it('keeps copied fixture URLs on the bench and removes stage-only controls in small layouts', () => {
    const path = browserSourcePath({ pathname: '/-/stream', search: '?preview=1&source=simulated&dockFixture=1&safe=chat&seam=starting' }, 'window', 'calm', 'ending', [0, 0, 74, 100]);
    const url = new URL(path, 'https://chatdom.gg');
    expect(url.pathname).toBe('/-/stream');
    expect(Object.fromEntries(url.searchParams)).toEqual({ source: 'simulated', dockFixture: '1', layout: 'window' });
    expect(parseStreamParams(url.search, url.pathname)).toMatchObject({ source: 'simulated', layout: 'window', seam: null, safe: null });
  });

  it('retains dock fixture provenance and never invents a realm receipt', async () => {
    const fixture = createDockFixture();
    let act: { origin: string; kingdomId: string; id: string } | undefined;
    const unsubscribe = fixture.subscribe(value => { act = value; });
    fixture.trigger('fire-light');
    expect(act).toMatchObject({ origin: 'simulated', kingdomId: fixture.kingdomId, id: 'simulated:dock:1' });
    await expect(fixture.witness({ actionId: 'simulated:press:1', kingdomId: fixture.kingdomId, origin: 'simulated', streamEventId: 'simulated:dock:1' })).rejects.toThrow('A picture rehearsal has no realm receipt.');
    unsubscribe();
  });
});
