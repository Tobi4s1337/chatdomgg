import { describe, expect, it } from 'vitest';
import { createVoxelMaterial } from '@chatdom/render';
import { MATERIALS } from '@chatdom/content';
import { grandPalette } from '../../../../../packages/world/src/grand/palette';
import type { BakedSurface } from '../../../../../packages/world/src/grand/baked/types';
import type { GrandSeat } from '../../../../../packages/world/src/grand/kingdom/types';
import { createHostedGrandMaterial } from './material';
import { featherMistMask } from '../../../../../packages/render/src/grand/mist';
import { createKingdomReveal, KINGDOM_REVEAL_LIFT } from './reveal';

/** A round island of half-metre columns with the town on a shelf in the middle. */
function island(size = 512): BakedSurface {
  const ground = new Uint16Array(size * size), water = new Uint16Array(size * size), sea = 48;
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
    const i = x + z * size, d = Math.hypot(x - size / 2, z - size / 2) / (size * 0.44);
    ground[i] = d < 1 ? sea + 4 + Math.round(60 * (1 - d) * (1 - d)) : sea - 20;
    if (ground[i]! < sea) water[i] = sea;
  }
  return { size, height: 256, seaLevel: sea, ground, water };
}
const seat: GrandSeat = { offset: [128, -20, 128], columns: { x0: 230, z0: 230, x1: 282, z1: 282 }, band: 8 };
const air = { fog: '#c9b8a0', sun: '#ffd49a', night: 0 };

describe('a kingdom opening under the sea mist', () => {
  it('lays the founding at once and lifts only a crossing this tab saw', () => {
    const surface = island();
    const first = createKingdomReveal('kingdom-a');
    expect(first.lay(surface, seat, 9)).toBeNull();
    expect(first.mist.uniforms.uMistOn.value).toBe(1);
    expect(first.mist.lifting).toBe(false);
    // The rect is the land in settlement metres: land metres minus the seat offset.
    expect(first.mist.uniforms.uMistRect.value.toArray()).toEqual([-128, -128, 256, 256]);
    expect(first.update(1 / 60, air)).toBeNull();
    first.dispose();

    const grown = createKingdomReveal('kingdom-a');
    const opening = grown.lay(surface, seat, 70)!;
    expect(opening.lifting).toBe(true);
    expect(opening.stage).toBe(2);
    expect(grown.mist.lifting).toBe(true);
    // The director holds the opening while the mist rolls back, then lets go.
    expect(grown.update(1, air)).toEqual(opening.shot);
    for (let t = 0; t < KINGDOM_REVEAL_LIFT + 4; t++) grown.update(1, air);
    expect(grown.mist.lifting).toBe(false);
    expect(grown.update(1, air)).toBeNull();
    grown.dispose();

    // A later scene at the same count lays the stage without a second ceremony; a smaller count never re-closes it.
    const again = createKingdomReveal('kingdom-a');
    expect(again.lay(surface, seat, 70)!.lifting).toBe(false);
    const smaller = again.lay(surface, seat, 9)!;
    expect(smaller.stage).toBe(2);
    expect(smaller.lifting).toBe(false);
    again.dispose();
  });

  it('never lays the mist back over land this tab has seen open, even when a later scene counts fewer citizens', () => {
    const surface = island();
    const grown = createKingdomReveal('kingdom-shrink');
    expect(grown.lay(surface, seat, 160)!.stage).toBe(3);
    const open = Float32Array.from((grown.mist.uniforms.uMistMask.value.image as { data: ArrayLike<number> }).data);
    grown.dispose();
    const older = createKingdomReveal('kingdom-shrink');
    const opening = older.lay(surface, seat, 30)!;
    expect(opening.stage).toBe(3);
    expect(opening.lifting).toBe(false);
    expect(older.mist.lifting).toBe(false);
    expect(older.inspect()).toMatchObject({ stage: 3, citizens: 30 });
    expect(Array.from((older.mist.uniforms.uMistMask.value.image as { data: ArrayLike<number> }).data)).toEqual(Array.from(open));
    older.dispose();
  });

  it('feathers the mist edge outward, never over open land, and keeps a clearer mask clearer', () => {
    const cells = 40, small = new Uint8Array(cells * cells), large = new Uint8Array(cells * cells);
    for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) {
      const d = Math.hypot(x - 20, z - 20);
      if (d < 8) small[x + z * cells] = 255;
      if (d < 13) large[x + z * cells] = 255;
    }
    const a = featherMistMask(small, cells), b = featherMistMask(large, cells);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!).toBeGreaterThanOrEqual(small[i]!);
      expect(b[i]!).toBeGreaterThanOrEqual(a[i]!);
    }
    // The edge softens into the mist: just outside the open disc it is partly clear, far away it is not.
    expect(a[29 + 20 * cells]!).toBeGreaterThan(0);
    expect(a[29 + 20 * cells]!).toBeLessThan(255);
    expect(a[0]!).toBe(0);
  });

  it('lets the whole sea clear only at the last milestone', () => {
    const surface = island();
    const reveal = createKingdomReveal('kingdom-b');
    reveal.lay(surface, seat, 400);
    expect(reveal.mist.uniforms.uMistOutside.value).toBe(0);
    reveal.lay(surface, seat, 5000);
    expect(reveal.mist.uniforms.uMistOutside.value).toBe(1);
    expect(reveal.opening!.kind).toBe('whole');
    reveal.dispose();
  });

  it('puts the mist on the hosted floor only for a kingdom on its own world', () => {
    const native = createVoxelMaterial(MATERIALS, 'terrain'), palette = grandPalette({ stone: 'sandstone', grass: 'summer', hueDrift: 0, autumn: .5 });
    const reveal = createKingdomReveal('kingdom-c');
    const misted = createHostedGrandMaterial(palette, native, undefined, undefined, reveal.mist.uniforms);
    const pinned = createHostedGrandMaterial(palette, native);
    expect(misted.material.fragmentShader).toContain('colour=mix(colour,hostedMist.rgb,hostedMist.a);');
    expect(misted.material.uniforms.uMistMask).toBe(reveal.mist.uniforms.uMistMask);
    expect(pinned.material.fragmentShader).not.toContain('landMist');
    misted.dispose(); pinned.dispose(); native.dispose(); reveal.dispose();
  });
});
