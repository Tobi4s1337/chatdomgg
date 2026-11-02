import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHome } from '../core';
import { MAT, type StyleKey } from '../materials';
import { createForgeMotif } from './index';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit } from '../../../forge/src/index';
import { renderForgeContactSheet } from '../../../../apps/codex/src/contact-sheet';

const styles: StyleKey[] = ['hearth', 'tide', 'grove'];
describe('crescent lantern', () => {
  it.each(styles)('%s keeps an open crescent mouth around its glass heart', style => {
    const { boxes, emitter } = createForgeMotif('crescent-moon', style);
    const at = (x: number, y: number, z: number) => boxes.reduce((material, b) => x >= b.from[0] && x < b.to[0] && y >= b.from[1] && y < b.to[1] && z >= b.from[2] && z < b.to[2] ? b.material : material, 0);
    expect(at(...emitter)).toBe(MAT.glass);
    // The middle remains open all the way through, with solid arms above and below.
    for (let z = 0; z < 8; z++) for (let y = 5; y < 11; y++) for (let x = 6; x < 10; x++) expect(at(x, y, z)).toBe(0);
    expect(at(7, 1, 4)).not.toBe(0);
    expect(at(7, 14, 4)).not.toBe(0);
  });
  for (const family of styles) for (const kind of ['chimney', 'lantern', 'weathervane'] as const) it(`${family} moon fits the ${kind} socket`, () => {
    const home = createHome('house', family, 0);
    const socket = findForgeSockets(home).find(s => s.kind === kind)!;
    const result = assembleForge({ version: 2, kind, motif: 'crescent-moon', finish: 'native', accent: 'none' }, forgeStyleKit(family), socket);
    expect(checkForge(result, home).solidCells).toBeGreaterThan(80);
    if (process.env.FORGE_MOON_EVIDENCE && kind === 'lantern') {
      const uri = renderForgeContactSheet(result.blueprint, { home, origin: socket.origin });
      writeFileSync(`work/evidence/forge-wish/contact-sheets/moon-after-${family}.png`, Buffer.from(uri.split(',')[1]!, 'base64'));
    }
  }, 30000);
});
