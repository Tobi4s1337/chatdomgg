import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
// The frozen recipe compiler and observed fixtures, and the production rasterizer and mesher.
import { compileChannelGenesis } from '../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '../../../world/src/genesis/observed-fixtures';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '../../../voxel/src/index';
import { MAT, MATERIALS } from '../materials';
import { AVATAR_MATERIALS } from '../avatars/palette';
import { DISPLAY_NAMES, PROFILE_TARGETS, selectLandscape } from './fixtures';
import {
  GENESIS_CREST, GENESIS_STANDARD, HERALDIC_KITS, MIN_CONTRAST, NEUTRAL_COLOURS, TINCTURES,
  FITTINGS, METALS, VISIONS, clothArms, composeGenesisHeraldry, contrast, heraldicPalette, readableContrast, shieldArms, snapTargets, visionContrasts, visionLuminance,
  type ClothCut, type CrestCharge, type CrestShape, type GenesisHeraldry, type HeraldicStyle, type HeraldryRecipe,
} from './index';

const RECIPES = OBSERVED_GENESIS_FIXTURES.map(facts => compileChannelGenesis(facts));
/** The same three channels with their profile palette proposals as targets, through the real compiler. */
const TARGETED = OBSERVED_GENESIS_FIXTURES.map(facts => compileChannelGenesis({ ...facts, profileColours: [...PROFILE_TARGETS[facts.broadcasterId]!] }));
const STYLES: readonly HeraldicStyle[] = ['hearth', 'tide', 'grove'];
const SHAPES: readonly CrestShape[] = ['heater', 'round', 'swallowtail'];
const CHARGES: readonly CrestCharge[] = ['oak', 'star', 'wave', 'mountain'];
const CUTS: readonly ClothCut[] = ['square', 'forked', 'pennant'];
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

/** A recipe forced to one device, so every shape, charge and cut can be composed through the public entry. */
const withDevice = (recipe: HeraldryRecipe, shape: CrestShape, charge: CrestCharge, cut: ClothCut, style = recipe.identity.styleFamily): HeraldryRecipe =>
  ({ ...recipe, identity: { ...recipe.identity, styleFamily: style, crest: { shape, charge }, banner: { cut } } });

/** Every proposal the observed recipes can make, neutral and targeted: each recipe on each candidate landscape. */
const PROPOSALS: readonly GenesisHeraldry[] = [...RECIPES, ...TARGETED].flatMap(recipe => recipe.landscapes.map(land => composeGenesisHeraldry(recipe, land)));

describe('genesis heraldry adapter', () => {
  it('reads the frozen recipe on the selected landscape, never the recommendation', () => {
    for (const recipe of RECIPES) for (const land of recipe.landscapes) {
      const heraldry = composeGenesisHeraldry(recipe, land);
      expect(heraldry.landscapeId).toBe(land.id);
      expect(heraldry.character).toBe(land.character);
      expect(heraldry.style).toBe(recipe.identity.styleFamily);
      expect(heraldry.standard.blueprint.id.startsWith(`genesis-standard-${recipe.identity.styleFamily}-${land.character}-`)).toBe(true);
    }
    const [first, second] = RECIPES;
    expect(() => composeGenesisHeraldry(first!, second!.landscapes[0])).toThrow(/not one of this recipe's candidates/);
    expect(() => composeGenesisHeraldry(first!, { id: first!.landscapes[0].id, character: 'mountain-pass' === first!.landscapes[0].character ? 'river-valley' : 'mountain-pass' }))
      .toThrow(/not one of this recipe's candidates/);
    expect(() => composeGenesisHeraldry(withDevice(first!, 'kite' as CrestShape, 'oak', 'square'), first!.landscapes[0])).toThrow(/Unknown crest/);
  });

  it('carves exactly the crest shape, charge and cloth cut the recipe chose', () => {
    for (const recipe of RECIPES) {
      const heraldry = composeGenesisHeraldry(recipe, recipe.landscapes[0]);
      expect(heraldry.device).toEqual({ shape: recipe.identity.crest.shape, charge: recipe.identity.crest.charge, cut: recipe.identity.banner.cut });
      expect(heraldry.crest.arms).toEqual(shieldArms(heraldry.device.shape, heraldry.device.charge));
      expect(heraldry.standard.arms).toEqual(clothArms(heraldry.device.cut, heraldry.device.charge));
    }
    // The observed recipes already carve three different charges: wave, star and mountain.
    expect(new Set(RECIPES.map(recipe => recipe.identity.crest.charge)).size).toBe(3);
  });

  it('is deterministic, returns fresh objects and leaves the recipe and palette untouched', () => {
    const palette = JSON.stringify(MATERIALS);
    for (const recipe of [RECIPES[0]!, TARGETED[1]!]) {
      const before = JSON.stringify(recipe);
      const a = composeGenesisHeraldry(recipe, recipe.landscapes[2]);
      const b = composeGenesisHeraldry(recipe, recipe.landscapes[2]);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.standard.blueprint.boxes).not.toBe(b.standard.blueprint.boxes);
      (a.standard.blueprint.boxes as unknown[]).length = 0;
      expect(composeGenesisHeraldry(recipe, recipe.landscapes[2]).standard.blueprint.boxes.length).toBe(b.standard.blueprint.boxes.length);
      expect(JSON.stringify(recipe)).toBe(before);
    }
    expect(JSON.stringify(MATERIALS)).toBe(palette);
  });

  it('is honestly neutral without profile colours, and an unapproved proposal with them', () => {
    for (const heraldry of PROPOSALS.slice(0, 9)) {
      expect(heraldry.treatment).toEqual({ kind: 'neutral', reason: 'no-profile-colours' });
      expect(heraldry.colours).toEqual(NEUTRAL_COLOURS[heraldry.style]);
    }
    for (const heraldry of PROPOSALS.slice(9)) {
      expect(heraldry.treatment.kind).toBe('snapped');
      if (heraldry.treatment.kind !== 'snapped') continue;
      expect(heraldry.treatment.status).toBe('proposal');
      expect(heraldry.colours.field).toBe(heraldry.treatment.field.material);
      expect(heraldry.colours.charge).toBe(heraldry.treatment.charge.material);
    }
    const recipe = RECIPES[1]!;
    expect(() => composeGenesisHeraldry({ ...recipe, identity: { ...recipe.identity, profileColourTargets: ['pink'] } }, recipe.landscapes[0])).toThrow(/#rrggbb/);
    // An approved emote derivative is still never drawn as a charge.
    const withEmote = { ...recipe, identity: { ...recipe.identity, emoteWorks: [{ emoteId: '1', use: 'statue', asset: { assetHash: 'a'.repeat(64), approvalId: 'x' } }] } };
    expect(JSON.stringify(composeGenesisHeraldry(withEmote, recipe.landscapes[0]))).toBe(JSON.stringify(composeGenesisHeraldry(recipe, recipe.landscapes[0])));
  });

  it('carries the recipe choices without leaking seed keys, evidence or receipts', () => {
    [...RECIPES, ...TARGETED].forEach((recipe, i) => {
      const json = JSON.stringify(PROPOSALS[i * 3]);
      for (const secret of [recipe.identity.crest.seedKey, recipe.identity.banner.seedKey, recipe.seedKey + '"', recipe.evidence.sourceId, 'approvalId', 'assetHash', 'seedKey']) {
        expect(json).not.toContain(secret);
      }
    });
  });
});

describe('palette snapping', () => {
  const name = (id: number) => Object.entries(MAT).find(([, value]) => value === id)![0];

  it('snaps the three channels’ profile targets to tinctures, honouring the first target as the field', () => {
    const snaps = TARGETED.map(recipe => composeGenesisHeraldry(recipe, recipe.landscapes[0]));
    expect(snaps.map(({ colours }) => [name(colours.field), name(colours.charge), name(colours.border)])).toEqual([
      // The_AGGman: red with the peach target as a linen charge; the amber target's gold dye is 2.9:1 to a deuteranope.
      ['fabricRed', 'cream', 'brass'],
      ['fabricViolet', 'hairBlack', 'brass'], // PinkKittyRose: violet with the deep purple target as sable.
      ['fabricMutedViolet', 'cream', 'brass'], // MashaD4: indigo; no later target reads on it, so a linen charge.
    ]);
    expect(snaps.map(({ treatment }) => treatment.kind === 'snapped' && [treatment.field.target, treatment.charge.target]))
      .toEqual([['#c91709', '#fe9e79'], ['#8753da', '#4e125e'], ['#514a98', null]]);
  });

  it('always picks registered tinctures with a legible field and charge and a distinct border', () => {
    const levels = ['00', '33', '66', '99', 'cc', 'ff'];
    const colours = levels.flatMap(r => levels.flatMap(g => levels.map(b => `#${r}${g}${b}`)));
    const palette = JSON.stringify(MATERIALS);
    colours.forEach((first, i) => {
      const targets = [first, colours[(i * 37 + 11) % colours.length]!, colours[(i * 101 + 5) % colours.length]!];
      const snapped = snapTargets(targets);
      expect(snapTargets(targets)).toEqual(snapped);
      const { field, charge, border } = snapped.colours;
      expect(TINCTURES).toContain(field);
      expect(TINCTURES).toContain(charge);
      expect(contrast(field, charge), targets.join()).toBeGreaterThanOrEqual(MIN_CONTRAST);
      for (const [vision, ratio] of Object.entries(visionContrasts(field, charge))) expect(ratio, `${targets.join()} ${vision}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(new Set([field, charge, border]).size).toBe(3);
      for (const swatch of [field, charge, border]) expect(AVATAR_MATERIALS.has(swatch)).toBe(true);
      expect(snapped.field.target).toBe(first);
      if (snapped.charge.target !== null) expect(targets.slice(1)).toContain(snapped.charge.target);
    });
    expect(JSON.stringify(MATERIALS)).toBe(palette);
    expect(() => snapTargets([])).toThrow(/No profile colour targets/);
  });

  it('dresses citizens in the proposal’s colours with a hem that follows the cut', () => {
    for (const heraldry of PROPOSALS) {
      for (const swatch of Object.values(heraldry.cape.colours)) expect(AVATAR_MATERIALS.has(swatch)).toBe(true);
      expect(heraldry.cape.colours.cloth).toBe(heraldry.colours.field);
      expect(heraldry.cape.colours.trim).toBe(heraldry.colours.border);
      if (heraldry.treatment.kind === 'snapped') expect(heraldry.cape.colours.lining).toBe(heraldry.colours.charge);
      expect(heraldry.cape.hem).toBe({ square: 'straight', forked: 'notched', pennant: 'rounded' }[heraldry.device.cut]);
    }
  });
});

describe('drawn arms', () => {
  const all = [
    ...SHAPES.flatMap(shape => CHARGES.map(charge => ({ id: `${shape}/${charge}`, arms: shieldArms(shape, charge) }))),
    ...CUTS.flatMap(cut => CHARGES.map(charge => ({ id: `${cut}/${charge}`, arms: clothArms(cut, charge) }))),
  ];

  it('draw every charge on every shape and cut: bordered, mirror-symmetric and bold enough to read', () => {
    for (const { id, arms } of all) {
      // A long cloth is mostly field below its charge, so it carries a smaller share than a shield does.
      const least = arms.length > 30 ? 0.1 : 0.15;
      for (const row of arms) expect(row, id).toBe([...row].reverse().join(''));
      const cells = arms.join('');
      const charge = [...cells].filter(c => c === 'C').length, inner = [...cells].filter(c => c === 'C' || c === 'F').length;
      expect(charge / inner, id).toBeGreaterThan(least);
      expect(charge / inner, id).toBeLessThan(0.6);
      // The border closes the outline: no field or charge cell lies next to the outside.
      arms.forEach((row, r) => [...row].forEach((mark, c) => {
        if (mark === '.' || mark === 'B') return;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(arms[r + dr]?.[c + dc] ?? '.', `${id} ${c},${r}`).not.toBe('.');
      }));
    }
  });

  it('give each charge its own silhouette', () => {
    for (const shape of SHAPES) expect(new Set(CHARGES.map(charge => shieldArms(shape, charge).join('\n'))).size).toBe(4);
    for (const cut of CUTS) expect(new Set(CHARGES.map(charge => clothArms(cut, charge).join('\n'))).size).toBe(4);
    // The cuts differ at the hem: level, two tails, one point.
    const hems = CUTS.map(cut => clothArms(cut, 'oak').at(-1)!.replace(/^\.+|\.+$/g, ''));
    expect(hems[0]!.length).toBe(GENESIS_STANDARD.cloth.width);
    expect(hems[1]!.split(/\.+/).length).toBe(2);
    expect(hems[2]!.split(/\.+/).length).toBe(1);
    expect(hems[2]!.length).toBeLessThanOrEqual(2);
  });
});

describe('standard and crest models', { timeout: 60_000 }, () => {
  const recipe = RECIPES[2]!, land = recipe.landscapes[1];
  const variants = [
    ...SHAPES.flatMap(shape => CHARGES.map(charge => composeGenesisHeraldry(withDevice(recipe, shape, charge, 'forked'), land))),
    ...CUTS.map(cut => composeGenesisHeraldry(withDevice(recipe, 'heater', 'oak', cut), land)),
    ...STYLES.map(style => composeGenesisHeraldry(withDevice(recipe, 'round', 'wave', 'pennant', style), recipe.landscapes[2])),
  ];
  const pieces = [...PROPOSALS, ...variants].flatMap(heraldry => [heraldry.standard, heraldry.crest].map(piece => ({ heraldry, piece })));

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
    // Ids name the whole variant, so distinct models never share a cached mesh.
    const models = new Map<string, string>();
    for (const { piece } of pieces) {
      const json = JSON.stringify(piece.blueprint.boxes);
      expect(models.get(piece.blueprint.id) ?? json, piece.blueprint.id).toBe(json);
      models.set(piece.blueprint.id, json);
    }
  });

  it('use only the kit, the proposal colours and the land accents', () => {
    for (const { heraldry, piece } of pieces) {
      const kit = HERALDIC_KITS[heraldry.style];
      const allowed = new Set<number>([MAT.air, kit.stone, kit.base, kit.band, kit.trim, kit.binding, kit.cord, ...Object.values(heraldry.colours),
        MAT.brass, MAT.glass, MAT.darkStone, MAT.thatch, MAT.moss, MAT.blueFlower, MAT.petal]);
      for (const box of piece.blueprint.boxes) expect(allowed.has(box.material), `${piece.blueprint.id} uses ${box.material}`).toBe(true);
    }
  });

  it('fly the arms on every cut: border, field and charge read through both faces and the folds stay one sheet', () => {
    for (const heraldry of [...variants.slice(12, 15), TARGETED.map(r => composeGenesisHeraldry(r, r.landscapes[0]))[0]!]) {
      const at = grid(rasterizeBlueprint(heraldry.standard.blueprint));
      const { cloth } = GENESIS_STANDARD;
      const colour = { B: heraldry.colours.border, F: heraldry.colours.field, C: heraldry.colours.charge } as Record<string, number>;
      heraldry.standard.arms.forEach((row, i) => [...row].forEach((mark, col) => {
        if (mark === '.') return;
        // Looking along -Z from the front and +Z from behind, the first cloth cell in the column is the arms' mark.
        const x = cloth.x + col, y = cloth.top - i;
        let front = 27; while (front > 0 && !at(x, y, front)) front--;
        let back = cloth.z; while (back < 27 && !at(x, y, back)) back++;
        expect(at(x, y, front), `${heraldry.device.cut} front ${x},${y}`).toBe(colour[mark]);
        expect(at(x, y, back), `${heraldry.device.cut} back ${x},${y}`).toBe(colour[mark]);
      }));
      // The hem ends above head height and the finial is the top of the model.
      expect((cloth.top - cloth.rows + 1) * 0.125).toBeGreaterThan(5);
      expect(at(16, 119, 14)).toBe(MAT.brass);
    }
  });

  it('carve the arms proud on both faces of every crest shape, framed by the rim', () => {
    for (const heraldry of [...variants.slice(0, 12), PROPOSALS[10]!]) {
      const at = grid(rasterizeBlueprint(heraldry.crest.blueprint));
      const { shield, faces } = GENESIS_CREST;
      const height = shield.height[heraldry.device.shape];
      const colour = { B: heraldry.colours.border, F: heraldry.colours.field, C: heraldry.colours.charge } as Record<string, number>;
      heraldry.crest.arms.forEach((row, i) => [...row].forEach((mark, col) => {
        if (mark === '.') return;
        const x = shield.x + col, y = shield.y + height - 1 - i;
        for (const [face, proud] of faces) {
          expect(at(x, y, face)).toBe(heraldry.colours.field);
          expect(at(x, y, proud), `${heraldry.device.shape} ${x},${y}`).toBe(mark === 'F' ? MAT.air : colour[mark]);
        }
      }));
    }
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

/** FNV-1a over a model's boxes: a short fingerprint that moves when any box, cell or material of it moves. */
const digest = (blueprint: VoxelBlueprint) => {
  let hash = 0x811c9dc5;
  for (const char of JSON.stringify(blueprint.boxes)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
};

describe('the three showcase proposals', () => {
  // Each composition target on the landscape the showcase selects, neutral as observed: no profile colours.
  const showcase = OBSERVED_GENESIS_SHOWCASE_CHOICES.map(choice => {
    const recipe = RECIPES[OBSERVED_GENESIS_FIXTURES.findIndex(facts => facts.broadcasterId === choice.broadcasterId)]!;
    const land = selectLandscape(recipe.landscapes, choice.character);
    return { choice, recipe, land, heraldry: composeGenesisHeraldry(recipe, land) };
  });
  const name = (id: number) => Object.entries(MAT).find(([, value]) => value === id)![0];

  it('select each target’s own landscape explicitly, which is mostly not the recommendation', () => {
    expect(showcase.map(({ choice }) => DISPLAY_NAMES[choice.broadcasterId])).toEqual(['The_AGGman', 'PinkKittyRose', 'MashaD4']);
    expect(showcase.map(({ heraldry }) => [heraldry.style, heraldry.character])).toEqual([
      ['tide', 'coastal-harbour'], ['hearth', 'river-valley'], ['hearth', 'mountain-pass'],
    ]);
    expect(showcase.map(({ recipe, land }) => land.id === recipe.recommendedLandscapeId)).toEqual([false, false, true]);
    expect(showcase.map(({ heraldry }) => heraldry.device)).toEqual([
      { shape: 'heater', charge: 'wave', cut: 'forked' },
      { shape: 'swallowtail', charge: 'star', cut: 'forked' },
      { shape: 'heater', charge: 'mountain', cut: 'square' },
    ]);
    for (const { heraldry } of showcase) expect(heraldry.treatment).toEqual({ kind: 'neutral', reason: 'no-profile-colours' });
    expect(() => selectLandscape(RECIPES[0]!.landscapes, 'desert')).toThrow(/exactly one desert/);
  });

  it('read for every kind of colour vision: field and charge at least 3:1, and the charge drawn in bold strokes', () => {
    for (const { heraldry } of showcase) {
      const { field, charge } = heraldry.colours;
      expect(heraldry.legibility).toEqual(visionContrasts(field, charge));
      expect(Object.keys(heraldry.legibility)).toEqual([...VISIONS]);
      for (const vision of VISIONS) expect(heraldry.legibility[vision], `${heraldry.style} ${vision}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    // Locked so a recolour of linen or a roof that costs legibility is seen: the weakest reader of each showcase.
    expect(showcase.map(({ heraldry }) => {
      const weakest = VISIONS.reduce((a, b) => heraldry.legibility[a] <= heraldry.legibility[b] ? a : b);
      return [name(heraldry.colours.charge), weakest, Number(heraldry.legibility[weakest].toFixed(2))];
    })).toEqual([['slate', 'protanopia', 3.96], ['terracotta', 'deuteranopia', 3.24], ['terracotta', 'deuteranopia', 3.24]]);
    // Every neutral style, and every tincture as a field, has a charge that passes, so composition never strands a kingdom.
    for (const style of STYLES) expect(readableContrast(NEUTRAL_COLOURS[style].field, NEUTRAL_COLOURS[style].charge)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    for (const field of TINCTURES) expect(TINCTURES.some(other => other !== field && readableContrast(field, other) >= MIN_CONTRAST), name(field)).toBe(true);
    // The charge has no lone cells that would shimmer at stream distance: each touches another, at least at a corner
    // (the oak's root tips step out diagonally).
    for (const arms of [...SHAPES.flatMap(shape => CHARGES.map(charge => shieldArms(shape, charge))), ...CUTS.flatMap(cut => CHARGES.map(charge => clothArms(cut, charge)))]) {
      arms.forEach((row, r) => [...row].forEach((mark, c) => {
        if (mark !== 'C') return;
        const touches = [-1, 0, 1].some(dr => [-1, 0, 1].some(dc => (dr || dc) && arms[r + dr]?.[c + dc] === 'C'));
        expect(touches, `${arms.join('\n')}\n${c},${r}`).toBe(true);
      }));
    }
  });

  it('simulate colour vision faithfully: greys stay put, and red against gold dims for a deuteranope', () => {
    for (const hex of ['#000000', '#7f7f7f', '#ffffff']) for (const vision of VISIONS) {
      expect(visionLuminance(hex, vision)).toBeCloseTo(visionLuminance(hex, 'typical'), 3);
    }
    // The gold dye on the red dye passes 3:1 for typical vision but not for a deuteranope, so snapping refuses it.
    expect(contrast(MAT.fabricRed, MAT.fabricGold)).toBeGreaterThan(3);
    expect(visionContrasts(MAT.fabricRed, MAT.fabricGold).deuteranopia).toBeLessThan(3);
  });

  it('lock the palette: a closed set of at most sixteen materials, the registry revision, and fingerprints of every model', () => {
    const palette = JSON.stringify(MATERIALS);
    for (const { heraldry } of showcase) {
      const allowed = heraldicPalette(HERALDIC_KITS[heraldry.style], heraldry.colours);
      expect(allowed.size).toBeLessThanOrEqual(16);
      const carved = new Set([...heraldry.standard.blueprint.boxes, ...heraldry.crest.blueprint.boxes].map(box => box.material).filter(m => m !== MAT.air));
      expect(heraldry.palette.materials).toEqual([...carved].sort((a, b) => a - b));
      for (const material of heraldry.palette.materials) expect(allowed.has(material), name(material)).toBe(true);
      expect(heraldry.palette.revision).toBe(MATERIALS.revision);
    }
    // Changing any of these on purpose means looking at the showcase again; nothing here moves by accident.
    expect(showcase.map(({ heraldry }) => ({
      materials: heraldry.palette.materials.map(name).join(' '),
      standard: [heraldry.standard.blueprint.boxes.length, digest(heraldry.standard.blueprint)],
      crest: [heraldry.crest.blueprint.boxes.length, digest(heraldry.crest.blueprint)],
    }))).toEqual(SHOWCASE_LOCK);
    // The tinctures snapping chooses from and the fittings, in the registry colours the contrast rules were verified against.
    expect(Object.fromEntries([...TINCTURES, ...FITTINGS].map(id => [name(id), MATERIALS.materials.find(m => m.id === id)!.colour]))).toEqual(COLOUR_LOCK);
    expect(METALS.every(metal => TINCTURES.includes(metal))).toBe(true);
    expect(JSON.stringify(MATERIALS)).toBe(palette);
  });
});

/** The three neutral showcase proposals as accepted: palette, box count and fingerprint of each model. */
const SHOWCASE_LOCK = [
  { materials: 'stone timber slate thatch brass glass darkStone cream', standard: [784, '5d7fdc41'], crest: [664, '76a91bd8'] },
  { materials: 'stone limestone timber terracotta brass glass darkStone moss cream petal blueFlower', standard: [767, '82a9716c'], crest: [745, '3f08b9b9'] },
  { materials: 'stone limestone timber terracotta brass glass darkStone cream', standard: [859, '80f64ae0'], crest: [629, '5cc52677'] },
];
/** Registry colours of the tinctures and fittings, as the contrast rules were verified against them (revision 4). */
const COLOUR_LOCK = {
  cream: '#e5d8b7', fabricGold: '#d8bd68', fabricRed: '#a94744', fabricOrange: '#c78746', fabricGreen: '#58816c',
  fabricBlue: '#557f9e', fabricViolet: '#8b6f9e', fabricMutedRed: '#765b58', fabricMutedOrange: '#7d6b57',
  fabricMutedGold: '#897e62', fabricMutedGreen: '#5c6e62', fabricMutedBlue: '#596d7c', fabricMutedViolet: '#6e6378',
  hairBlack: '#30241f', brass: '#b69155', glass: '#d0a66a', darkStone: '#65727d', thatch: '#b89a5f', moss: '#74835b',
  blueFlower: '#8e9eb8', petal: '#d2968d',
};
