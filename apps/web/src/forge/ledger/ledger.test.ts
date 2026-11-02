import { afterEach, describe, expect, it, vi } from 'vitest';
import { FORGE_MOTIFS, KingdomIdSchema, type ForgeLedgerEntry, type ForgeLedgerView } from '@chatdom/shared';
import { forgeLedgerByline, forgeLedgerCopies, forgeLedgerSummary, parseForgeLedger, sameLedger, watchForgeLedger, type ForgeLedgerRead, type ForgeLedgerState } from './read';
import { forgeKeepsakePortrait } from './portrait';
import { FORGE_LEDGER_PAGE, forgeKeepsakeDescription } from './page';

const K = KingdomIdSchema.parse('129634568');
const AT = Date.UTC(2026, 10, 2, 15);
const entry = (n: number, patch: Partial<ForgeLedgerEntry> = {}): ForgeLedgerEntry => ({ id: `piece-${n}`, title: `Piece ${n}`, plaque: 'Kept warm.',
  plan: { version: 2, kind: 'weathervane', motif: 'watchful-owl', finish: 'copper', accent: 'none' }, family: 'tide', kitRevision: 2,
  maker: { name: 'Wren' }, forgedAt: AT - n * 60_000, ...patch });
const view = (entries: ForgeLedgerEntry[], patch: Partial<ForgeLedgerView> = {}): ForgeLedgerView => ({ version: 1, kingdomId: K, total: entries.length, entries, at: AT, ...patch });

afterEach(() => { vi.useRealTimers(); });

describe('reading the forge’s memory', () => {
  it('accepts only a ledger for the kingdom asked for, newest first, with no extra fields', () => {
    expect(parseForgeLedger(view([entry(1), entry(2)]), K)?.total).toBe(2);
    expect(parseForgeLedger(view([entry(2), entry(1)]), K)).toBeNull();
    expect(parseForgeLedger(view([entry(1)]), KingdomIdSchema.parse('1'))).toBeNull();
    expect(parseForgeLedger({ ...view([]), words: 'secret' }, K)).toBeNull();
    expect(parseForgeLedger(view([{ ...entry(1), words: 'secret' } as ForgeLedgerEntry]), K)).toBeNull();
  });

  it('shows new pieces as they land, keeps the last ledger through a failed read and never rolls back', async () => {
    vi.useFakeTimers();
    const answers: (ForgeLedgerView | Error)[] = [view([entry(2)]), new Error('down'), view([entry(1), entry(2)]), view([entry(2)], { at: AT - 1 })];
    const read: ForgeLedgerRead = async () => { const next = answers.shift()!; if (next instanceof Error) throw next; return { kind: 'ledger', view: next }; };
    const seen: ForgeLedgerState[] = [];
    const watch = watchForgeLedger(K, { read, pollMs: 1_000 });
    watch.subscribe(state => seen.push(state));
    for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(1_000);
    watch.dispose();
    expect(seen.map(state => state.kind === 'ledger' ? state.view.entries.map(e => e.id).join(',') : state.kind))
      .toEqual(['loading', 'piece-2', 'piece-1,piece-2']);
  });

  it('says plainly when the kingdom has no forge or the memory cannot be read', async () => {
    const none = watchForgeLedger(K, { read: async () => ({ kind: 'no-forge' }) });
    await vi.waitFor(() => expect(none.state()).toEqual({ kind: 'no-forge' }));
    none.dispose();
    const down = watchForgeLedger(K, { read: async () => { throw new Error('down'); } });
    await vi.waitFor(() => expect(down.state()).toEqual({ kind: 'unavailable' }));
    down.dispose();
    expect(watchForgeLedger('not a kingdom').state()).toEqual({ kind: 'no-forge' });
  });

  it('notices a renamed maker but not a later read of the same ledger', () => {
    expect(sameLedger(view([entry(1)]), view([entry(1)], { at: AT + 5 }))).toBe(true);
    expect(sameLedger(view([entry(1)]), view([entry(1, { maker: { name: 'Wren Vale' } })]))).toBe(false);
  });
});

describe('the words on the page', () => {
  it('says who wished and when, and nothing about copies until they exist', () => {
    expect(forgeLedgerByline(entry(0), AT)).toBe('Wren\u00a0· 2\u00a0Nov');
    expect(forgeLedgerByline(entry(0, { forgedAt: Date.UTC(2025, 0, 9) }), AT)).toBe('Wren\u00a0· 9\u00a0January\u00a02025');
    expect(forgeLedgerCopies(entry(0))).toBeNull();
    expect(forgeLedgerCopies(entry(0, { copies: 3 }))).toBe('On 3 homes');
  });

  it('counts every piece and says when only the newest are shown', () => {
    expect(forgeLedgerSummary(view([]))).toMatch(/^Nothing has been forged here yet/);
    expect(forgeLedgerSummary(view([entry(1)]))).toBe('One piece has been forged in this kingdom.');
    expect(forgeLedgerSummary(view([entry(1), entry(2)], { total: 130 }))).toBe('130 pieces have been forged in this kingdom. The newest 2 are shown.');
  });

  it('describes each portrait for people who cannot see it', () => {
    expect(forgeKeepsakeDescription(entry(0))).toBe('A copper watchful owl weathervane');
    expect(forgeKeepsakeDescription(entry(0, { plan: { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' } }))).toBe('A crescent moon lantern');
  });

  it('is a ledger page for walkers and watchers, never on the stream', () => {
    expect(FORGE_LEDGER_PAGE).toMatchObject({ id: 'forged', title: 'The forge remembers' });
    expect(FORGE_LEDGER_PAGE.available({ mode: 'walking' })).toBe(true);
    expect(FORGE_LEDGER_PAGE.available({ mode: 'stream' })).toBe(false);
  });
});

describe('the portrait', () => {
  it('draws every motif as a lit, far-to-near set of faces, once per piece', () => {
    for (const motif of FORGE_MOTIFS) for (const kind of ['chimney', 'lantern', 'weathervane'] as const) {
      const portrait = forgeKeepsakePortrait({ plan: { version: 2, kind, motif, finish: 'ceramic', accent: 'leaves' }, family: 'grove', kitRevision: 2 });
      expect(portrait.faces.length).toBeGreaterThan(40);
      expect(portrait.faces.every((face, i) => i === 0 || face.depth >= portrait.faces[i - 1]!.depth)).toBe(true);
      const [minU, minV, maxU, maxV] = portrait.bounds;
      expect(maxU - minU).toBeGreaterThan(4); expect(maxV - minV).toBeGreaterThan(4);
    }
    const key = { plan: entry(0).plan, family: 'tide' as const, kitRevision: 2 };
    expect(forgeKeepsakePortrait(key)).toBe(forgeKeepsakePortrait(key));
  });
});
