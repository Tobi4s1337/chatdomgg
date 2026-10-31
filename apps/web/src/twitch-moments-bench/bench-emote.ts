import { MAT } from '@chatdom/content';
import { blueprint, box, type Box } from '../twitch-moments/banner';
import type { ApprovedEffect } from '../twitch-moments';

/**
 * The bench's one approved channel emote, SIMULATED: Willowmere's own lantern-hearted fox, as the emote owner's
 * approved voxel effect would arrive (exact ID, revision and origin). It is drawn here as pixel rows; a real
 * effect comes from the emote approval lookup, and an unknown emote shows nothing.
 */
export const BENCH_EMOTE = { id: 'emotesimfox1', name: 'willowFox' } as const;

// One character per voxel: o outline, f fur, c cream, e eye, n nose, l lantern glow, blank is air. Rows top down.
const FOX = [
  '  oo        oo  ',
  ' ofo        ofo ',
  ' offo      offo ',
  ' offfoooooofffo ',
  'offffffffffffffo',
  'offfeffffffefffo',
  'offfeffffffefffo',
  'offffffnnffffffo',
  ' offccccccccffo ',
  ' occcccllcccco  ',
  '  occcllllccco  ',
  '   occcllccco   ',
  '    occccco     ',
  '     ooooo      ',
];
const BLINK = FOX.map((row, y) => (y === 5 ? row.replace(/e/g, 'f') : y === 6 ? row.replace(/e/g, 'o') : row));
const PAINT: Readonly<Record<string, number>> = { o: MAT.darkStone, f: MAT.fabricRed, c: MAT.cream, e: MAT.darkStone, n: MAT.darkStone, l: MAT.goldLeaf };

function frame(id: string, rows: readonly string[]) {
  const height = rows.length, width = Math.max(...rows.map(r => r.length)), boxes: Box[] = [];
  rows.forEach((row, i) => {
    const y = height - 1 - i;
    // Runs of one colour become one box, so the emote meshes as a few dozen boxes, not hundreds.
    for (let x = 0; x < row.length;) {
      const ch = row[x]!;
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== ' ') boxes.push(box(x, y, 0, end, y + 1, 2, PAINT[ch]!));
      x = end;
    }
  });
  return blueprint(id, 'tide', [width, height, 2], boxes);
}

export const BENCH_EMOTE_EFFECT: ApprovedEffect = {
  id: BENCH_EMOTE.id, revision: 3, origin: 'simulated', periodMs: 3600,
  frames: [{ blueprint: frame('bench-emote-fox-open', FOX), durationMs: 3300 }, { blueprint: frame('bench-emote-fox-blink', BLINK), durationMs: 300 }],
};
