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

/** Registry names are written as identifiers ("darkStone"); a citizen reads them as words. */
export function materialName(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
