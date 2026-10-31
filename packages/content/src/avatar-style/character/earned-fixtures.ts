import type { CitizenEntitlements, EntitlementKingdom } from './earned';

/*
 * SIMULATED verified records for the builder bench and the tests: a newcomer, a regular, a veteran with
 * everything, and a lapsed tier 3 sub. Not real people or kingdoms; every surface that shows them says
 * SIMULATED.
 */
const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);

export const SIMULATED_KINGDOM: EntitlementKingdom = { id: 'simulated-lanternmere', name: 'Lanternmere', colours: ['#2d5fd8', '#e8b54a'] };
const HOME = { name: SIMULATED_KINGDOM.name, colours: SIMULATED_KINGDOM.colours };
const SALTMARSH = { name: 'Saltmarsh', colours: ['#1ea59a', '#f3f1ee'] as const };
const EMBERFELL = { name: 'Emberfell', colours: ['#d3202a', '#f6d23c'] as const };
const THISTLEDOWN = { name: 'Thistledown', colours: ['#8a3fe6', '#f3f1ee'] as const };

export const SIMULATED_ENTITLEMENTS = {
  newcomer: {
    origin: 'simulated', kingdom: SIMULATED_KINGDOM, followedMonths: 0, sub: null, founder: false, keepsakes: [], forged: [], moments: [],
  },
  regular: {
    origin: 'simulated', kingdom: SIMULATED_KINGDOM, followedMonths: 14, sub: { tier: '1', months: 7, active: true }, founder: false,
    keepsakes: [{ id: 'sim-keepsake-first-light', name: 'First Light', earnedAt: at(2026, 9, 12), kingdom: { name: 'Lanternmere', shape: 'heater', colours: ['#2d5fd8', '#e8b54a'] } }],
    forged: [],
    moments: [{ id: 'sim-raid-saltmarsh', kind: 'raid', at: at(2026, 10, 14), kingdom: SALTMARSH, from: HOME }],
  },
  veteran: {
    origin: 'simulated', kingdom: SIMULATED_KINGDOM, followedMonths: 41, sub: { tier: '3', months: 38, active: true }, founder: true,
    keepsakes: [
      { id: 'sim-keepsake-wyrm-bell', name: 'The Wyrm Bell', earnedAt: at(2026, 8, 30), kingdom: { name: 'Emberfell', shape: 'swallowtail', colours: ['#d3202a', '#f6d23c'] } },
      { id: 'sim-keepsake-first-light', name: 'First Light', earnedAt: at(2026, 9, 12), kingdom: { name: 'Lanternmere', shape: 'heater', colours: ['#2d5fd8', '#e8b54a'] } },
      { id: 'sim-keepsake-tide-bridge', name: 'The Tide Bridge', earnedAt: at(2026, 10, 2), kingdom: { name: 'Saltmarsh', shape: 'round', colours: ['#1ea59a', '#f3f1ee'] } },
    ],
    forged: [
      { id: 'sim-forged-moon-lantern', title: 'Moon lantern', forgedAt: at(2026, 10, 3), motif: 'crescent-moon', palette: ['#223a7a', '#f6d23c'] },
      { id: 'sim-forged-fox-chimney', title: 'Fox chimney', forgedAt: at(2026, 10, 21), motif: 'sleeping-fox', palette: ['#f58a1f', '#f3f1ee'] },
    ],
    moments: [
      { id: 'sim-cheer-storm-28', kind: 'cheer-storm', at: at(2026, 10, 28), kingdom: { name: 'Lanternmere', colours: ['#2d5fd8', '#e8b54a'] } },
      { id: 'sim-raid-emberfell', kind: 'raid', at: at(2026, 10, 7), kingdom: EMBERFELL, from: HOME },
      { id: 'sim-raid-thistledown', kind: 'raid', at: at(2026, 10, 24), kingdom: THISTLEDOWN, from: HOME },
    ],
  },
  lapsed: {
    origin: 'simulated', kingdom: SIMULATED_KINGDOM, followedMonths: 26, sub: { tier: '3', months: 13, active: false }, founder: false,
    keepsakes: [], forged: [{ id: 'sim-forged-owl-vane', title: 'Owl weathervane', forgedAt: at(2026, 9, 19), motif: 'watchful-owl', palette: ['#5f6b3a', '#e6b73a'] }],
    moments: [],
  },
} as const satisfies Record<string, CitizenEntitlements>;

export type SimulatedPersona = keyof typeof SIMULATED_ENTITLEMENTS;
