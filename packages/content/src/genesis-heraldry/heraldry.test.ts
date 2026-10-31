import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
// The frozen recipe compiler and observed fixtures, and the production rasterizer and mesher.
import { compileChannelGenesis } from '../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES } from '../../../world/src/genesis/observed-fixtures';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '../../../voxel/src/index';
import { MAT, MATERIALS } from '../materials';
import { AVATAR_MATERIALS } from '../avatars/palette';
import {
  CREST_ARMS, GENESIS_CREST, GENESIS_STANDARD, HERALDIC_KITS, NEUTRAL_COLOURS, STANDARD_ARMS,
  composeGenesisHeraldry, contrast, type GenesisHeraldry, type HeraldicStyle, type HeraldryRecipe,
} from './index';

const RECIPES = OBSERVED_GENESIS_FIXTURES.map(facts => compileChannelGenesis(facts));
const STYLES: readonly HeraldicStyle[] = ['hearth', 'tide', 'grove'];
const BUDGET = { boxes: 1500, cells: 120_000, triangles: 60_000 };

const grid = (asset: VoxelAsset) => {
  const [sx, sy, sz] = asset.size;
  return (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[x + sx * (y + sy * z)]!;
};

/** Face-connected flood from every ground cell; returns how many occupied cells it could not reach. */
function floating(asset: VoxelAsset): number {
  const [sx, sy, sz] = asset.size;
  const seen = new Uint8Array(asset.voxels.length), queue: number[] = [];
  let occupied = 0;
  asset.voxels.forEach((m, i) => { if (m) occupied++; if (m && Math.floor(i / sx) % sy === 0) { seen[i] = 1; queue.push(i); } });
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const n of [x > 0 ? i - 1 : -1, x + 1 < sx ? i + 1 : -1, y > 0 ? i - sx : -1, y + 1 < sy ? i + sx : -1,
      z > 0 ? i - sx * sy : -1, z + 1 < sz ? i + sx * sy : -1]) {
      if (n >= 0 && !seen[n] && asset.voxels[n]) { seen[n] = 1; queue.push(n); }
    }
  }
  return occupied - queue.length;
}

const triangles = (asset: VoxelAsset) => prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)
  .reduce((n, chunk) => n + meshVoxelChunk(chunk).indices.length / 3, 0);

/** Every proposal the three observed recipes can make: each recipe on each of its three candidate landscapes. */
const PROPOSALS: readonly GenesisHeraldry[] = RECIPES.flatMap(recipe => recipe.landscapes.map(land => composeGenesisHeraldry(recipe, land)));

describe('genesis heraldry adapter', () => {
  it('reads the frozen recipe on the selected landscape, never the recommendation', () => {
    for (const recipe of RECIPES) for (const land of recipe.landscapes) {
      const heraldry = composeGenesisHeraldry(recipe, land);
      expect(heraldry.landscapeId).toBe(land.id);
      expect(heraldry.character).toBe(land.character);
      expect(heraldry.style).toBe(recipe.identity.styleFamily);
      expect(heraldry.standard.blueprint.id).toBe(`genesis-standard-${recipe.identity.styleFamily}-${land.character}`);
    }
    const [first, second] = RECIPES;
    expect(() => composeGenesisHeraldry(first!, second!.landscapes[0])).toThrow(/not one of this recipe's candidates/);
    expect(() => composeGenesisHeraldry(first!, { id: first!.landscapes[0].id, character: 'mountain-pass' === first!.landscapes[0].character ? 'river-valley' : 'mountain-pass' }))
      .toThrow(/not one of this recipe's candidates/);
  });

  it('is deterministic, returns fresh objects and leaves the recipe and palette untouched', () => {
    const palette = JSON.stringify(MATERIALS);
    const recipe = RECIPES[0]!;
    const before = JSON.stringify(recipe);
    const a = composeGenesisHeraldry(recipe, recipe.landscapes[2]);
    const b = composeGenesisHeraldry(recipe, recipe.landscapes[2]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.standard.blueprint.boxes).not.toBe(b.standard.blueprint.boxes);
    (a.standard.blueprint.boxes as unknown[]).length = 0;
    expect(composeGenesisHeraldry(recipe, recipe.landscapes[2]).standard.blueprint.boxes.length).toBe(b.standard.blueprint.boxes.length);
    expect(JSON.stringify(recipe)).toBe(before);
    expect(JSON.stringify(MATERIALS)).toBe(palette);
  });

  it('is honestly neutral: no observed colours, no channel colours claimed, no emote charge', () => {
    for (const heraldry of PROPOSALS) {
      expect(heraldry.treatment).toEqual({ kind: 'neutral', reason: 'no-profile-colours' });
      expect(heraldry.colours).toEqual(NEUTRAL_COLOURS[heraldry.style]);
      expect(heraldry.device).toEqual({ shape: 'heater', charge: 'chevron-lozenge', cut: 'forked' });
    }
    const recipe = RECIPES[1]!;
    const withTargets: HeraldryRecipe = { ...recipe, identity: { ...recipe.identity, profileColourTargets: ['#8753da', '#651e8c'] } };
    const targeted = composeGenesisHeraldry(withTargets, recipe.landscapes[2]);
    expect(targeted.treatment).toEqual({ kind: 'neutral', reason: 'targets-not-snapped' });
    expect(JSON.stringify(targeted.standard)).toBe(JSON.stringify(composeGenesisHeraldry(recipe, recipe.landscapes[2]).standard));
    expect(() => composeGenesisHeraldry({ ...recipe, identity: { ...recipe.identity, profileColourTargets: ['pink'] } }, recipe.landscapes[0])).toThrow(/#rrggbb/);
    // An approved emote derivative is still never drawn as a charge.
    const withEmote = { ...recipe, identity: { ...recipe.identity, emoteWorks: [{ emoteId: '1', use: 'statue', asset: { assetHash: 'a'.repeat(64), approvalId: 'x' } }] } };
    expect(JSON.stringify(composeGenesisHeraldry(withEmote, recipe.landscapes[0]))).toBe(JSON.stringify(composeGenesisHeraldry(recipe, recipe.landscapes[0])));
  });

  it('carries the recipe choices without leaking seed keys, evidence or receipts', () => {
    RECIPES.forEach((recipe, i) => {
      const json = JSON.stringify(PROPOSALS[i * 3]);
      const heraldry = PROPOSALS[i * 3]!;
      expect(heraldry.requested).toEqual({ shape: recipe.identity.crest.shape, charge: recipe.identity.crest.charge, cut: recipe.identity.banner.cut });
      for (const secret of [recipe.identity.crest.seedKey, recipe.identity.banner.seedKey, recipe.seedKey + '"', recipe.evidence.sourceId, 'approvalId', 'assetHash']) {
        expect(json).not.toContain(secret);
      }
    });
  });
});

describe('neutral colours', () => {
  it('keep a legible field and charge in every style family', () => {
    for (const style of STYLES) {
      const { field, charge, border } = NEUTRAL_COLOURS[style];
      expect(contrast(field, charge), style).toBeGreaterThanOrEqual(3);
      expect(new Set([field, charge, border]).size).toBe(3);
    }
  });

  it('dress citizens with avatar swatches in the same colours', () => {
    for (const heraldry of PROPOSALS) {
      for (const swatch of Object.values(heraldry.cape.colours)) expect(AVATAR_MATERIALS.has(swatch)).toBe(true);
      expect(heraldry.cape.colours.cloth).toBe(heraldry.colours.field);
      expect(heraldry.cape.colours.trim).toBe(heraldry.colours.border);
      expect(heraldry.cape.hem).toBe('notched');
    }
  });
});

describe('standard and crest models', () => {
  const pieces = PROPOSALS.flatMap(heraldry => [heraldry.standard, heraldry.crest].map(piece => ({ heraldry, piece })));
  const grove = (() => {
    const recipe = RECIPES[2]!;
    return composeGenesisHeraldry({ ...recipe, identity: { ...recipe.identity, styleFamily: 'grove' } }, recipe.landscapes[1]);
  })();
  pieces.push(...[grove.standard, grove.crest].map(piece => ({ heraldry: grove, piece })));

  it('fit the strict schema, stand on the ground as one structure and stay inside their budgets', () => {
    const seen = new Set<string>();
    for (const { piece } of pieces) {
      const blueprint: VoxelBlueprint = piece.blueprint;
      if (seen.has(blueprint.id)) continue;
      seen.add(blueprint.id);
      expect(VoxelBlueprintSchema.parse(blueprint)).toEqual(blueprint);
      const asset = rasterizeBlueprint(blueprint);
      const cells = asset.voxels.reduce((n, m) => n + (m ? 1 : 0), 0);
      expect(floating(asset), blueprint.id).toBe(0);
      expect(blueprint.boxes.length, blueprint.id).toBeLessThanOrEqual(BUDGET.boxes);
      expect(cells, blueprint.id).toBeLessThanOrEqual(BUDGET.cells);
      expect(triangles(asset), blueprint.id).toBeLessThanOrEqual(BUDGET.triangles);
    }
    // Hearth, Tide and Grove across all three landscape characters.
    expect([...seen].sort()).toEqual(expect.arrayContaining(['genesis-standard-tide-coastal-harbour', 'genesis-crest-hearth-mountain-pass', 'genesis-standard-grove-coastal-harbour']));
  });

  it('use only the kit, the neutral colours and the land accents', () => {
    for (const { heraldry, piece } of pieces) {
      const kit = HERALDIC_KITS[heraldry.style];
      const allowed = new Set<number>([MAT.air, kit.stone, kit.base, kit.band, kit.trim, kit.binding, kit.cord, ...Object.values(heraldry.colours),
        MAT.brass, MAT.glass, MAT.darkStone, MAT.thatch, MAT.moss, MAT.blueFlower, MAT.petal]);
      for (const box of piece.blueprint.boxes) expect(allowed.has(box.material), `${piece.blueprint.id} uses ${box.material}`).toBe(true);
    }
  });

  it('fly the arms on the cloth: border, field and charge read through both faces and the folds stay one sheet', () => {
    const marks = new Set(STANDARD_ARMS.join('').replaceAll('.', ''));
    expect([...marks].sort()).toEqual(['B', 'C', 'F']);
    expect(new Set(CREST_ARMS.join('').replaceAll('.', ''))).toEqual(marks);
    const heraldry = PROPOSALS[0]!, at = grid(rasterizeBlueprint(heraldry.standard.blueprint));
    const { cloth } = GENESIS_STANDARD;
    const colour = { B: heraldry.colours.border, F: heraldry.colours.field, C: heraldry.colours.charge } as Record<string, number>;
    STANDARD_ARMS.forEach((row, i) => [...row].forEach((mark, col) => {
      if (mark === '.') return;
      // Looking along -Z from the front and +Z from behind, the first cloth cell in the column is the arms' mark.
      const x = cloth.x + col, y = cloth.top - i;
      let front = 27; while (front > 0 && !at(x, y, front)) front--;
      let back = cloth.z; while (back < 27 && !at(x, y, back)) back++;
      expect(at(x, y, front), `front ${x},${y}`).toBe(colour[mark]);
      expect(at(x, y, back), `back ${x},${y}`).toBe(colour[mark]);
    }));
    // The tails end above head height and the finial is the top of the model.
    expect((cloth.top - cloth.rows + 1) * 0.125).toBeGreaterThan(5);
    expect(at(16, 119, 14)).toBe(MAT.brass);
  });

  it('carve the arms proud on both faces of the crest, framed by the rim', () => {
    const heraldry = PROPOSALS[0]!, at = grid(rasterizeBlueprint(heraldry.crest.blueprint));
    const { shield, faces } = GENESIS_CREST;
    const colour = { B: heraldry.colours.border, F: heraldry.colours.field, C: heraldry.colours.charge } as Record<string, number>;
    CREST_ARMS.forEach((row, i) => [...row].forEach((mark, col) => {
      if (mark === '.') return;
      const x = shield.x + col, y = shield.y + shield.height - 1 - i;
      for (const [face, proud] of faces) {
        expect(at(x, y, face)).toBe(heraldry.colours.field);
        expect(at(x, y, proud)).toBe(mark === 'F' ? MAT.air : colour[mark]);
      }
    }));
  });

  it('set every lantern light inside lantern glass, open to the air around it', () => {
    for (const { piece } of pieces) {
      const at = grid(rasterizeBlueprint(piece.blueprint));
      expect(piece.lanterns.length).toBe(piece.blueprint.id.startsWith('genesis-standard') ? 4 : 2);
      expect(new Set(piece.lanterns.map(l => l.id)).size).toBe(piece.lanterns.length);
      for (const { position: [x, y, z] } of piece.lanterns) {
        expect(at(x, y, z)).toBe(MAT.glass);
        expect(at(x - 2, y, z) === MAT.air || at(x + 2, y, z) === MAT.air || at(x, y, z - 2) === MAT.air || at(x, y, z + 2) === MAT.air).toBe(true);
      }
    }
  });
});
