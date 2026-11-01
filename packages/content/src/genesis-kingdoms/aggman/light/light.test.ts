import { describe, expect, it } from 'vitest';
import { voxels } from '../../../places/water/piece-checks';
import { composeGenesisEmoteArt } from '../../../genesis-emotes/index';
import { aggmanPieceFailures, BUILDING_BUDGET } from '../checks';
import { createLastLantern } from './light';

// The plain leaded window the Genesis emote adapter composes when no glass is approved (tide kit).
const recipe = { kingdomId: '63920635', evidence: { kind: 'observed' as const }, identity: { styleFamily: 'tide' as const, emoteWorks: [] }, landscapes: [{ id: 'coast', character: 'coastal-harbour' as const }] };
const glass = composeGenesisEmoteArt(recipe, recipe.landscapes[0]!, []).glass;

describe('The Last Lantern', () => {
  it('meets the building bar and is deterministic', () => {
    const light = createLastLantern(glass);
    expect(aggmanPieceFailures(light, BUILDING_BUDGET)).toEqual([]);
    expect(createLastLantern(glass)).toEqual(light);
    expect(light.blueprint.size[1] * .125).toBeGreaterThan(12);
    expect(light.blueprint.size[1] * .125).toBeLessThan(17);
  });

  it('leaves the lancet open for the window unit, flush with the seaward face', () => {
    const light = createLastLantern(glass);
    const { at } = voxels(light.blueprint);
    const [gx, gy, gz] = light.glassAt, [w, h] = glass.opening, front = light.blueprint.size[2] - 2;
    expect(gz + 6).toBe(front);
    for (const [x, y] of [[gx, gy], [gx + w - 1, gy], [gx + w / 2, gy + h - 1], [gx + w / 2, gy + h / 2]] as const)
      for (let z = gz; z < front; z++) expect(at(Math.floor(x), y, z), `${x},${y},${z}`).toBe(0);
    // Stone frames the opening on both sides and above.
    expect(at(gx - 1, gy + 10, front - 2)).not.toBe(0);
    expect(at(gx + w, gy + 10, front - 2)).not.toBe(0);
    expect(at(gx + w / 2, gy + h, front - 2)).not.toBe(0);
  });

  it('lights the window from within and the lantern room above', () => {
    const light = createLastLantern(glass);
    const { at } = voxels(light.blueprint);
    const [high, low] = light.lanterns;
    expect(high![1]).toBeGreaterThan(low![1]);
    for (const cell of light.lanterns) expect(at(cell[0], cell[1], cell[2])).not.toBe(0);
    // The low brazier stands behind the lancet, inside the tower.
    expect(low![2]).toBeLessThan(light.glassAt[2]);
    expect(low![1]).toBeGreaterThan(light.glassAt[1]);
  });
});
