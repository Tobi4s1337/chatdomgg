import { describe, expect, it, vi } from 'vitest';
import type { KingdomId } from '@chatdom/shared';
import { createPlaySettings } from './settings';
import { availableHudPieces, availableLedgerPages, forgeEntry, onSlotsChanged, registerForgeEntry, registerHudPiece, registerLedgerPage,
  wantedArrivalSteps, registerArrivalStep, type LedgerPageProvider, type PlayContext } from './slots';

const ctx: PlayContext = { kingdomId: '1' as KingdomId, self: null, live: false, mode: 'walking', settings: createPlaySettings(null),
  requestCursor: () => ({ release() {}, active: true }), closeLedger() {},
  requestInput: () => ({ active: false, onKey: () => () => {}, onPointer: () => () => {}, release() {} }), hideSelf: () => ({ release() {} }) };
const page = (id: string, order: number, available = true): LedgerPageProvider => ({ id, title: id, order, available: () => available, mount: () => () => {} });

describe('the play slots', () => {
  it('show a page only while it has a provider that says it is available, in order', () => {
    const changed = vi.fn(), stop = onSlotsChanged(changed);
    const offLook = registerLedgerPage(page('look', 15));
    const offSettings = registerLedgerPage(page('settings-test', 10));
    const offHidden = registerLedgerPage(page('raid-gate', 40, false));
    const offBroken = registerLedgerPage({ ...page('broken', 50), available: () => { throw new Error('no data'); } });
    expect(availableLedgerPages(ctx).map(p => p.id)).toEqual(['settings-test', 'look']);
    offLook();
    expect(availableLedgerPages(ctx).map(p => p.id)).toEqual(['settings-test']);
    expect(changed).toHaveBeenCalledTimes(5);
    offSettings(); offHidden(); offBroken(); stop();
    expect(availableLedgerPages(ctx)).toEqual([]);
  });

  it('refuse a second provider with the same id, and an unregister that is not theirs', () => {
    const off = registerLedgerPage(page('forge', 25));
    expect(() => registerLedgerPage(page('forge', 26))).toThrow(/already registered/);
    off(); off();
    expect(availableLedgerPages(ctx)).toEqual([]);
  });

  it('place HUD pieces by region and run arrival steps in order', () => {
    const offA = registerHudPiece({ id: 'raid-banner', region: 'top-centre', order: 1, available: () => true, mount: () => () => {} });
    const offB = registerHudPiece({ id: 'map', region: 'top-right', order: 1, available: () => true, mount: () => () => {} });
    const offC = registerArrivalStep({ id: 'mirror', order: 10, wanted: () => true, run: async () => {} });
    const offD = registerArrivalStep({ id: 'later', order: 20, wanted: () => false, run: async () => {} });
    expect(availableHudPieces(ctx, 'top-centre').map(p => p.id)).toEqual(['raid-banner']);
    expect(availableHudPieces(ctx).map(p => p.id)).toEqual(['map', 'raid-banner']);
    expect(wantedArrivalSteps(ctx).map(s => s.id)).toEqual(['mirror']);
    offA(); offB(); offC(); offD();
  });

  it('hold one Forge entry, shown only while it is available', () => {
    expect(forgeEntry(ctx)).toBeNull();
    let open = false;
    const off = registerForgeEntry({ available: () => open, openForge() {} });
    expect(() => registerForgeEntry({ available: () => true, openForge() {} })).toThrow();
    expect(forgeEntry(ctx)).toBeNull();
    open = true;
    expect(forgeEntry(ctx)).not.toBeNull();
    off();
    expect(forgeEntry(ctx)).toBeNull();
  });
});
