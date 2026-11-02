import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHome } from '@chatdom/content';
import { rasterizeBlueprint } from '@chatdom/voxel';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit } from './index';
import { renderForgeContactSheet } from '../../../apps/codex/src/contact-sheet';

/** Orthographic street rays: one vote per occupied part pixel, not per voxel. */
function streetVisibility(home: ReturnType<typeof createHome>, part: ReturnType<typeof createHome>, origin: readonly number[], minY = 0) {
  const host = rasterizeBlueprint(home), asset = rasterizeBlueprint(part);
  const get = (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= host.size[0] || y >= host.size[1] || z >= host.size[2] ? 0 : host.voxels[x + host.size[0] * (y + host.size[1] * z)]!;
  let total = 0, visible = 0;
  for (let y = minY; y < asset.size[1]; y++) for (let x = 0; x < asset.size[0]; x++) {
    let z = asset.size[2] - 1;
    while (z >= 0 && !asset.voxels[x + asset.size[0] * (y + asset.size[1] * z)]) z--;
    if (z < 0) continue;
    total++;
    let blocked = false;
    for (let Z = z + origin[2]! + 1; Z < host.size[2]; Z++) if (get(x + origin[0]!, y + origin[1]!, Z)) { blocked = true; break; }
    if (!blocked) visible++;
  }
  return { total, visible };
}

describe('street-visible lantern sockets', () => {
  it('chooses the front facade when that wall has room, never a cavity behind the door', () => {
    const original = createHome('house', 'hearth', 0);
    const home = { ...original, id: 'extended-front-lot', size: [original.size[0], original.size[1], original.size[2] + 20] as [number, number, number] };
    // Revision one's survey; revision two's larger lantern envelope is covered in socket-revisions.test.ts.
    const socket = findForgeSockets(home, 'street-home', 1).find(s => s.kind === 'lantern')!;
    expect(socket.profile).toBe('wall');
    expect(socket.origin[2]).toBeGreaterThan(80);
    const part = assembleForge({ version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' }, forgeStyleKit('hearth', 1), socket);
    expect(checkForge(part, home).solidCells).toBeGreaterThan(80);
    const visibility = streetVisibility(home, part.blueprint, socket.origin);
    expect(visibility.visible).toBe(visibility.total);
  }, 30000);
  for (const tier of ['hut', 'house', 'hall'] as const) for (const family of ['hearth', 'tide', 'grove'] as const) for (const variant of [0, 1, 2]) {
    it(`${tier} ${family} ${variant}: supported, clear of windows and visible from +Z`, () => {
      const home = createHome(tier, family, variant);
      const socket = findForgeSockets(home).find(s => s.kind === 'lantern');
      expect(socket).toBeDefined();
      const part = assembleForge({ version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' }, forgeStyleKit(family), socket!);
      expect(checkForge(part, home).solidCells).toBeGreaterThan(80);
      const host = rasterizeBlueprint(home);
      const cell = (x: number, y: number, z: number) => host.voxels[x + host.size[0] * (y + host.size[1] * z)]!;
      for (const [x, y, z] of socket!.supports) expect(cell(x, y - (socket!.profile === 'wall' ? 0 : 1), z)).not.toBe(0);
      const motifY = socket!.profile === 'wall' ? 4 : Math.max(socket!.clearanceHeight, Math.max(...socket!.supports.map(p => p[1] - socket!.origin[1])) + 4);
      const visibility = streetVisibility(home, part.blueprint, socket!.origin, motifY);
      expect(visibility.total).toBeGreaterThan(20);
      expect(visibility.visible / visibility.total).toBeGreaterThan(0.8);
      if (process.env.FORGE_LANTERN_EVIDENCE && tier === 'house' && family === 'hearth' && variant === 0) {
        const uri = renderForgeContactSheet(part.blueprint, { home, origin: socket!.origin });
        writeFileSync('work/evidence/forge-wish/contact-sheets/lantern-after-socket.png', Buffer.from(uri.split(',')[1]!, 'base64'));
      }
    }, 30000);
  }
});
