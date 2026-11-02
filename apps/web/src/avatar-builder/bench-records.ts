import type { CitizenEntitlements, EntitlementKingdom } from '../../../../packages/content/src/avatar-style';

/*
 * The builder bench's people and their records: a newcomer, a regular, a veteran with everything and a lapsed tier 3
 * sub. Invented for the dev bench and its stills only (`builder.html`); no public route ever reaches them.
 */
const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

export const BENCH_KINGDOM: EntitlementKingdom = { id: 'bench-lanternmere', name: 'Lanternmere', colours: ['#2d5fd8', '#e8b54a'] };
const HOME = { name: BENCH_KINGDOM.name, colours: BENCH_KINGDOM.colours };
const SALTMARSH = { name: 'Saltmarsh', colours: ['#1ea59a', '#f3f1ee'] as const };
const EMBERFELL = { name: 'Emberfell', colours: ['#d3202a', '#f6d23c'] as const };
const THISTLEDOWN = { name: 'Thistledown', colours: ['#8a3fe6', '#f3f1ee'] as const };
const ORIGIN = 'simulated' as const;

export const BENCH_PEOPLE = {
  newcomer: { name: 'pebble_wren', nameColour: '#1E90FF' },
  regular: { name: 'cozy_otter', nameColour: '#FF7F50' },
  veteran: { name: 'old_lamplighter', nameColour: '#8A2BE2' },
  lapsed: { name: 'moss_and_mead', nameColour: '#2E8B57' },
} as const;
export type BenchPerson = keyof typeof BENCH_PEOPLE;

export const BENCH_RECORDS: Readonly<Record<BenchPerson, CitizenEntitlements>> = {
  newcomer: { origin: ORIGIN, kingdom: BENCH_KINGDOM, followedMonths: 0, sub: null, founder: false, keepsakes: [], forged: [], moments: [] },
  regular: {
    origin: ORIGIN, kingdom: BENCH_KINGDOM, followedMonths: 14, sub: { tier: '1', months: 7, active: true }, founder: false,
    keepsakes: [{ id: 'bench-keepsake-first-light', name: 'First Light', earnedAt: at(2026, 9, 12), kingdom: { name: 'Lanternmere', shape: 'heater', colours: ['#2d5fd8', '#e8b54a'] } }],
    forged: [],
    moments: [{ id: 'bench-raid-saltmarsh', kind: 'raid', at: at(2026, 10, 14), kingdom: SALTMARSH, from: HOME }],
  },
  veteran: {
    origin: ORIGIN, kingdom: BENCH_KINGDOM, followedMonths: 41, sub: { tier: '3', months: 38, active: true }, founder: true,
    keepsakes: [
      { id: 'bench-keepsake-wyrm-bell', name: 'The Wyrm Bell', earnedAt: at(2026, 8, 30), kingdom: { name: 'Emberfell', shape: 'swallowtail', colours: ['#d3202a', '#f6d23c'] } },
      { id: 'bench-keepsake-first-light', name: 'First Light', earnedAt: at(2026, 9, 12), kingdom: { name: 'Lanternmere', shape: 'heater', colours: ['#2d5fd8', '#e8b54a'] } },
      { id: 'bench-keepsake-tide-bridge', name: 'The Tide Bridge', earnedAt: at(2026, 10, 2), kingdom: { name: 'Saltmarsh', shape: 'round', colours: ['#1ea59a', '#f3f1ee'] } },
    ],
    forged: [
      { id: 'bench-forged-moon-lantern', title: 'Moon lantern', forgedAt: at(2026, 10, 3), motif: 'crescent-moon', palette: ['#223a7a', '#f6d23c'] },
      { id: 'bench-forged-fox-chimney', title: 'Fox chimney', forgedAt: at(2026, 10, 21), motif: 'sleeping-fox', palette: ['#f58a1f', '#f3f1ee'] },
    ],
    moments: [
      { id: 'bench-cheer-storm-28', kind: 'cheer-storm', at: at(2026, 10, 28), kingdom: { name: 'Lanternmere', colours: ['#2d5fd8', '#e8b54a'] } },
      { id: 'bench-raid-emberfell', kind: 'raid', at: at(2026, 10, 7), kingdom: EMBERFELL, from: HOME },
      { id: 'bench-raid-thistledown', kind: 'raid', at: at(2026, 10, 24), kingdom: THISTLEDOWN, from: HOME },
    ],
  },
  lapsed: {
    origin: ORIGIN, kingdom: BENCH_KINGDOM, followedMonths: 26, sub: { tier: '3', months: 13, active: false }, founder: false,
    keepsakes: [], forged: [{ id: 'bench-forged-owl-vane', title: 'Owl weathervane', forgedAt: at(2026, 9, 19), motif: 'watchful-owl', palette: ['#5f6b3a', '#e6b73a'] }],
    moments: [],
  },
};

/** A device memory that forgets with the page, so a bench still always shows its first reveal. */
export function freshMemory(): { getItem(key: string): string | null; setItem(key: string, value: string): void } {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
