// The card in the panel shows only what an authority supplied, and its passport is the real reading. The SIMULATED
// night keeps one passport source for its whole life (a redraw never restarts the reading), that source reads the
// sitter's own book through the passport reader, and the real panel offers no card and no book at all.
import { describe, expect, it } from 'vitest';
import { createPassportSession, type PassportReadState } from '../../../../packages/ui/src/passport/craft';
import { createFixtureAdapter } from '../adapters/fixture';
import { createProductionAdapter } from '../adapters/production';
import type { HelperBridge } from '../helper';
import type { Home, PanelSnapshot } from '../model';
import { homeLine, nameInk } from './words';
import { remembersTravel, wornPiece } from './worn';

const cardOf = (home: Home) => (home.kind === 'citizen' || home.kind === 'guest' ? home : null);
const settled = (session: ReturnType<typeof createPassportSession>) => new Promise<PassportReadState>(resolve => {
  const stop = session.subscribe(state => { if (state.kind !== 'pending') { stop(); resolve(state); } });
});

describe('the citizen card in the panel', () => {
  it('keeps one passport source on the simulated night, and reads the sitter’s own book through it', async () => {
    const adapter = createFixtureAdapter('named');
    const seen: PanelSnapshot[] = [adapter.get()];
    const stop = adapter.subscribe(next => seen.push(next));
    adapter.requestAct('1');
    const first = cardOf(adapter.get().home), again = cardOf(seen.at(-1)!.home);
    expect(first?.card?.name).toBe('Wren Tarnwalker');
    expect(first?.card?.portrait?.origin).toBe('simulated');
    expect(first?.passport.kind).toBe('readable');
    // The same source across snapshots: the reading is keyed by it, so it would otherwise start again.
    expect(again?.passport).toBe(first?.passport);

    if (first?.passport.kind !== 'readable') throw new Error('no passport');
    const session = createPassportSession(first.passport.transport);
    const done = settled(session);
    session.open();
    const state = await done;
    expect(state.kind).toBe('visible');
    if (state.kind === 'visible') {
      expect(state.book.origin).toBe('simulated');
      expect(state.book.holder.name).toBe(first.card?.name);
      expect(state.book.keepsakes.items.length).toBeGreaterThan(0);
    }
    session.close();
    stop();
    adapter.dispose();
  });

  it('shows no card while the kingdom does not know who the viewer is, and none on the real panel', () => {
    for (const state of ['unshared', 'logged-out', 'refused'] as const) {
      const adapter = createFixtureAdapter(state);
      expect(cardOf(adapter.get().home)).toBeNull();
      adapter.dispose();
    }
    const helper: HelperBridge = {
      status: () => ({ kind: 'authorized', loggedIn: true, shared: true, role: 'viewer', bits: false }),
      subscribe: () => () => undefined, token: () => 'token', requestIdShare: () => false,
    };
    const real = createProductionAdapter(helper);
    expect(real.get().home.kind).toBe('unknown');
    real.dispose();
  });

  it('sets names in their colour only where it reads, and says a home’s size in words', () => {
    expect(nameInk('#2f6f5e')).toEqual({ ink: '#2f6f5e', swatch: null });
    // A bright chat colour would vanish on parchment: the name is inked and the colour rides beside it.
    expect(nameInk('#00ff7f')).toEqual({ ink: null, swatch: '#00ff7f' });
    expect(nameInk('red')).toEqual({ ink: null, swatch: null });
    expect(homeLine('cottage', 'Lantern Row')).toBe('A cottage on Lantern Row');
    expect(homeLine(null, 'Lantern Row')).toBe('Lantern Row');
  });

  it('draws worn pieces only from what the records name', () => {
    expect(wornPiece({ key: 'pin:founder', name: 'Founder’s pin', story: null, piece: { family: 'pin', value: { kind: 'founder' } } }))
      .toMatchObject({ family: 'pin', shape: 'founder' });
    expect(wornPiece({ key: 'scarf:r1', name: 'Raid scarf: Emberfold', story: 'Rode the raid', piece: { family: 'scarf', value: { colours: ['#9b2d20', '#24485a'] } } }))
      .toEqual({ id: 'scarf:r1', family: 'scarf', name: 'Raid scarf: Emberfold', story: 'Rode the raid', colours: ['#9b2d20', '#24485a'] });
  });

  it('knows which worn pieces remember a journey, so private travels name no road', () => {
    const adapter = createFixtureAdapter('named');
    const card = cardOf(adapter.get().home)?.card;
    const travel = card?.worn.filter(remembersTravel).map(piece => piece.name);
    // The keepsake pin and the raid scarf name where the road went; the hood and the ribbons are tenure.
    expect(travel).toEqual(['A sprig of salt lavender', 'Raid scarf: Emberfold']);
    expect(card?.worn.filter(piece => !remembersTravel(piece)).map(piece => piece.family)).toEqual(['ribbons', 'hood']);
    adapter.dispose();
  });
});
