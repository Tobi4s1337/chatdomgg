import type { BuildTool, BuildToolsState } from '@chatdom/shared';

/** Order matches the core's 1–4 shortcuts in build/session.ts. */
export const TOOLS: readonly { id: BuildTool; name: string; key: string; hint: string }[] = [
  { id: 'place', name: 'Place', key: '1', hint: 'Click a face to set a block against it. Drag to lay a whole course.' },
  { id: 'erase', name: 'Erase', key: '2', hint: 'Click a block to take it away. Drag to clear a run.' },
  { id: 'paint', name: 'Paint', key: '3', hint: 'Recolour blocks that are already there. Paint never adds a block.' },
  { id: 'fill', name: 'Fill', key: '4', hint: 'Recolour a block and every touching block of the same material.' },
];

export const BRUSHES: readonly { cells: 1 | 2 | 4; name: string; label: string }[] = [
  { cells: 4, name: 'Half a metre', label: '½ m' },
  { cells: 2, name: 'A quarter metre', label: '¼ m' },
  { cells: 1, name: 'An eighth of a metre', label: '⅛ m' },
];

type Swatch = { id: number; name: string; colour: string };
/**
 * Shelves for the kingdom palette, keyed by registry name. They only arrange what the core supplies:
 * a shelf with nothing on it is not drawn, and any material not named here sits with the accents.
 */
const SHELVES: readonly { name: string; members: readonly string[] }[] = [
  { name: 'Plaster', members: ['plaster', 'cream'] },
  { name: 'Timber', members: ['timber', 'bark'] },
  { name: 'Stone', members: ['stone', 'limestone', 'darkStone', 'brick', 'paving'] },
  { name: 'Roof', members: ['slate', 'terracotta', 'thatch'] },
  { name: 'Accents', members: [] },
  { name: 'Garden', members: ['earth', 'grass', 'leaf', 'moss', 'petal', 'blueFlower'] },
];

export function shelveMaterials(materials: readonly Swatch[]): { name: string; items: Swatch[] }[] {
  const shelves = SHELVES.map(shelf => ({ name: shelf.name, items: [] as Swatch[] }));
  const accents = shelves.find(shelf => shelf.name === 'Accents')!;
  for (const item of materials) (shelves[SHELVES.findIndex(shelf => shelf.members.includes(item.name))] ?? accents).items.push(item);
  return shelves.filter(shelf => shelf.items.length);
}

/** Registry names are written as identifiers ("darkStone"); a citizen reads them as words. */
export function materialName(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const count = new Intl.NumberFormat('en-GB');

/**
 * The engine still names its browser-local draft mode; a person never reads that word (decision 25). This is the
 * one place the rack asks it: a private draft can be shaped, anything else rests until the street opens to building.
 */
export const privateDraft = (mode: BuildToolsState['mode']) => mode === 'SIMULATED';

/** The rack's heading: the owner's approved name when the kingdom knows it, a plain heading when it does not. */
export function rackHeading(ownerName?: string): string {
  const name = ownerName?.trim();
  return name ? `${name}’s home` : 'Your home';
}

/** What happens to the work, in plain words: who sees it and where it is kept. */
export function draftWords(mode: BuildToolsState['mode']): { title: string; detail: string; unsent: string } {
  return privateDraft(mode)
    ? { title: 'Private to you', detail: 'Saved in this browser until the street opens to building.', unsent: 'Not yet on your street' }
    : { title: 'Not open to building yet', detail: 'The tools rest until this street opens to building.', unsent: 'Not on the street' };
}

/** The one action that reaches a street, and exactly which street it reaches. */
export function welcomeWords(mode: BuildToolsState['mode'], publishing: boolean): { title: string; detail: string; short: string } {
  if (!privateDraft(mode)) return { title: 'Welcome the street', detail: 'Opens with the street', short: 'Not open yet' };
  return { title: publishing ? 'Opening the shutters…' : 'Welcome the street', detail: 'Your street in this browser', short: 'This browser' };
}

/** The allowance as words and a gauge: blocks used of the plot's budget, and what is left. */
export function allowanceWords(occupied: number, budget: number): { fraction: number; used: string; left: string; near: boolean; full: boolean; spoken: string } {
  const total = Math.max(0, budget), used = Math.max(0, occupied), left = Math.max(0, total - used);
  const fraction = total > 0 ? Math.min(1, used / total) : 1;
  return {
    fraction, near: fraction > .9, full: left === 0,
    used: `${count.format(used)} of ${count.format(total)}`,
    left: left === 0 ? 'No blocks left' : left === 1 ? '1 block left' : `${count.format(left)} left`,
    spoken: `${count.format(used)} of ${count.format(total)} blocks used, ${left === 0 ? 'none' : count.format(left)} left`,
  };
}

/** The pieces shelf is drawn only when the core really offers something to place; never as an empty stand-in. */
export function pieceShelf<T>(pieces: readonly T[] | undefined): readonly T[] | null {
  return pieces && pieces.length ? pieces : null;
}
