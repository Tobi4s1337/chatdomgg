import type { BuildMirror, BuildTool } from '@chatdom/shared';

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

export const MIRRORS: readonly { value: BuildMirror | null; label: string; name: string; help: string }[] = [
  { value: null, label: 'Off', name: 'No mirror', help: 'Each stroke lands only where you put it.' },
  { value: 'x', label: 'X', name: 'Mirror left and right', help: 'Mirrors left and right across the middle of your plot.' },
  { value: 'z', label: 'Z', name: 'Mirror front and back', help: 'Mirrors front and back across the middle of your plot.' },
  { value: 'xz', label: 'X+Z', name: 'Mirror into all four corners', help: 'Mirrors into all four quarters of your plot.' },
];

/** Short spoken form of the mirror for compact readouts. */
export const mirrorWord = (value: BuildMirror | null) => value === null ? 'No mirror' : value === 'xz' ? 'Mirror X+Z' : `Mirror ${value.toUpperCase()}`;

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
