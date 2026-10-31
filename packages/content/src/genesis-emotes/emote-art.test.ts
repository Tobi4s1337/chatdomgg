import { beforeAll, describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
// The frozen recipe compiler and observed fixtures, and the production rasterizer and mesher.
import { compileChannelGenesis } from '../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '../../../world/src/genesis/observed-fixtures';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '../../../voxel/src/index';
import { MAT, MATERIALS } from '../materials';
import { carve } from './carve';
import type { DecodedEmote } from './deps';
import {
  SIMULATED_APPROVAL_ID, SIMULATED_BROADCASTER, SIMULATED_EMOTE_ID, simulatedDerivatives, simulatedEmoteArtInput,
} from './fixtures';
import {
  CAME, EMOTE_ART_KITS, EMOTE_ART_PROFILES, GLASS_DYES, STATUE_PIGMENTS, VANE_METALS, composeGenesisEmoteArt,
  type ApprovedEmoteDerivative, type EmoteArtAbsence, type EmoteArtLandscape, type EmoteArtRecipe, type EmoteUse, type GenesisEmoteArt,
  type LandscapeCharacter,
} from './index';

const CHARACTERS: readonly LandscapeCharacter[] = ['coastal-harbour', 'river-valley', 'mountain-pass'];
/** The decoded toadWave GIF's delays as the compiler plays them: the 0 cs last frame takes the 100 ms default. */
const TOAD_DELAYS = [480, 90, 90, 110, 120, 90, 90, 100];
/** The window's own field and border dyes, which lead around any emote. */
const WINDOW_DYES: readonly number[] = [MAT.fabricRed, MAT.fabricGold, MAT.fabricGreen, MAT.fabricMutedGreen, MAT.fabricBlue, MAT.fabricMutedBlue];

/** The compiler's one delay rule: missing, non-finite or under 20 ms plays 100 ms; over 10 s holds at 10 s. */
const normalisedDelay = (ms: number) => (!Number.isFinite(ms) || ms < 20 ? 100 : Math.min(10_000, Math.round(ms)));

/**
 * The frozen compiler's recipe, as the adapter reads it. `DeepReadonly` maps the branded `KingdomId` string to an
 * object type, so the deep-readonly recipe does not type-check as `EmoteArtRecipe` on its own; the kingdom ID is
 * restated as the plain string it is at runtime and every other field is passed through untouched.
 */
const compileRecipe = (facts: unknown): EmoteArtRecipe => {
  const compiled = compileChannelGenesis(facts);
  return { ...compiled, kingdomId: String(compiled.kingdomId) };
};

const land = (recipe: EmoteArtRecipe, character: LandscapeCharacter): EmoteArtLandscape => {
  const found = recipe.landscapes.filter(candidate => candidate.character === character);
  if (found.length !== 1) throw new Error(`Expected exactly one ${character} landscape.`);
  return found[0]!;
};

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

const groundCells = (asset: VoxelAsset) => {
  const at = grid(asset);
  let n = 0;
  for (let z = 0; z < asset.size[2]; z++) for (let x = 0; x < asset.size[0]; x++) if (at(x, 0, z)) n++;
  return n;
};

const triangles = (asset: VoxelAsset) => prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)
  .reduce((n, chunk) => n + meshVoxelChunk(chunk).indices.length / 3, 0);

const materialsOf = (blueprint: VoxelBlueprint) => new Set(blueprint.boxes.map(box => box.material).filter(m => m !== 0));

/** JSON with the silhouette's typed array spelled out as a plain array, so two outputs compare value for value. */
const canonical = (art: GenesisEmoteArt) => JSON.stringify({
  ...art,
  monument: art.monument && { ...art.monument, silhouette: { ...art.monument.silhouette, materialIds: Array.from(art.monument.silhouette.materialIds) } },
});

const refusedEverywhere = (refusal: string): EmoteArtAbsence[] =>
  (['statue', 'weathervane', 'stained-glass'] as const).map(use => ({ use, reason: 'refused', refusal })) as EmoteArtAbsence[];

let raster: DecodedEmote;
let derivatives: ApprovedEmoteDerivative[];
let recipe: EmoteArtRecipe;
let assetHash: string;
/** Full simulated approval on each landscape character, plus a second river-valley compose for determinism. */
const full = new Map<LandscapeCharacter, GenesisEmoteArt>();
let again: GenesisEmoteArt;

beforeAll(async () => {
  const input = await simulatedEmoteArtInput();
  raster = input.raster;
  derivatives = input.derivatives;
  recipe = compileRecipe(input.facts);
  assetHash = input.facts.approvedEmotes[0]!.asset.assetHash;
  for (const character of CHARACTERS) full.set(character, composeGenesisEmoteArt(recipe, land(recipe, character), derivatives));
  again = composeGenesisEmoteArt(recipe, land(recipe, 'river-valley'), derivatives);
}, 30_000);

const art = () => full.get('river-valley')!;

describe('simulated full approval', () => {
  it('carves a statue, an emote window and a vane, labelled SIMULATED with nothing absent', () => {
    for (const character of CHARACTERS) {
      const composed = full.get(character)!;
      expect(composed.version).toBe('genesis-emote-art-1');
      expect(composed.character).toBe(character);
      expect(composed.landscapeId).toBe(land(recipe, character).id);
      expect(composed.style).toBe(recipe.identity.styleFamily);
      expect(composed.label).toBe('SIMULATED');
      expect(composed.monument).not.toBeNull();
      expect(composed.monument!.kind).toBe('statue');
      expect(composed.glass.kind).toBe('emote');
      expect(composed.glass.emote).not.toBeNull();
      expect(composed.vane).not.toBeNull();
      expect(composed.absences).toEqual([]);
    }
  });

  it('plays one blueprint per decoded frame with the compiler’s normalised delays', () => {
    const monument = art().monument!;
    expect(raster.frames.length).toBe(8);
    expect(monument.frames.length).toBe(raster.frames.length);
    const expected = raster.frames.map(frame => normalisedDelay(frame.durationMs));
    expect(monument.frames.map(frame => frame.durationMs)).toEqual(expected);
    expect(expected).toEqual(TOAD_DELAYS);
    expect(monument.periodMs).toBe(expected.reduce((a, b) => a + b, 0));
    expect(monument.periodMs).toBeGreaterThan(0);
  });

  it('stands every frame on one grid with the pedestal as the prefix of its boxes', () => {
    const monument = art().monument!;
    const pedestal = JSON.stringify(monument.pedestal.boxes);
    const size = monument.frames[0]!.blueprint.size;
    for (const { blueprint } of monument.frames) {
      expect(blueprint.size).toEqual(size);
      expect(blueprint.boxes.length).toBeGreaterThan(monument.pedestal.boxes.length);
      expect(JSON.stringify(blueprint.boxes.slice(0, monument.pedestal.boxes.length))).toBe(pedestal);
    }
    expect(new Set(monument.frames.map(frame => frame.blueprint.id)).size).toBe(monument.frames.length);
    // The animation really moves: not every frame carves the same boxes.
    expect(new Set(monument.frames.map(frame => JSON.stringify(frame.blueprint.boxes))).size).toBeGreaterThan(1);
    expect(monument.heightCells).toBe(monument.statueOffset[1] + monument.statueSize[1]);
  });
});

describe('per-use enforcement', () => {
  let glassOnly: GenesisEmoteArt;
  let glassDerivativeOnly: GenesisEmoteArt;
  let noDerivatives: GenesisEmoteArt;

  beforeAll(async () => {
    const input = await simulatedEmoteArtInput(['stained-glass']);
    const only = compileRecipe(input.facts);
    glassOnly = composeGenesisEmoteArt(only, land(only, 'river-valley'), input.derivatives);
    glassDerivativeOnly = composeGenesisEmoteArt(recipe, land(recipe, 'river-valley'), simulatedDerivatives(raster, ['stained-glass']));
    noDerivatives = composeGenesisEmoteArt(recipe, land(recipe, 'river-valley'), []);
  }, 30_000);

  it('carves only the use the facts approve', () => {
    expect(glassOnly.glass.kind).toBe('emote');
    expect(glassOnly.monument).toBeNull();
    expect(glassOnly.vane).toBeNull();
    expect(glassOnly.absences).toEqual([{ use: 'statue', reason: 'none-approved' }, { use: 'weathervane', reason: 'none-approved' }]);
    expect(glassOnly.label).toBe('SIMULATED');
  });

  it('never lets a glass derivative stand in for a statue or a vane', () => {
    expect(glassDerivativeOnly.glass.kind).toBe('emote');
    expect(glassDerivativeOnly.monument).toBeNull();
    expect(glassDerivativeOnly.vane).toBeNull();
    expect(glassDerivativeOnly.absences).toEqual([
      { use: 'statue', reason: 'refused', refusal: 'use-mismatch' },
      { use: 'weathervane', reason: 'refused', refusal: 'use-mismatch' },
    ]);
    // The same approved window either way: the glass does not depend on what else was approved.
    expect(JSON.stringify(glassDerivativeOnly.glass)).toBe(JSON.stringify(glassOnly.glass));
    expect(JSON.stringify(glassOnly.glass)).toBe(JSON.stringify(art().glass));
  });

  it('reports every use as derivative-missing when nothing is supplied, behind plain glass', () => {
    expect(noDerivatives.absences).toEqual((['statue', 'weathervane', 'stained-glass'] as const).map(use => ({ use, reason: 'derivative-missing' })));
    expect(noDerivatives.monument).toBeNull();
    expect(noDerivatives.vane).toBeNull();
    expect(noDerivatives.glass.kind).toBe('plain');
    expect(noDerivatives.glass.emote).toBeNull();
    expect(noDerivatives.label).toBe('SIMULATED');
  });
});

describe('refusals', () => {
  const compose = (supplied: readonly unknown[], facts?: EmoteArtRecipe) => {
    const r = facts ?? recipe;
    return composeGenesisEmoteArt(r, land(r, 'mountain-pass'), supplied);
  };
  const expectRefused = (composed: GenesisEmoteArt, refusal: string) => {
    expect(composed.absences).toEqual(refusedEverywhere(refusal));
    expect(composed.monument).toBeNull();
    expect(composed.vane).toBeNull();
    expect(composed.glass.kind).toBe('plain');
    expect(composed.glass.emote).toBeNull();
  };

  it('refuses a derivative bound to another channel', () => {
    expectRefused(compose(derivatives.map(d => ({ ...d, broadcasterId: '900000002' }))), 'other-channel');
  });

  it('refuses a live derivative on a simulated recipe', () => {
    expectRefused(compose(derivatives.map(d => ({ ...d, origin: 'live' }))), 'origin-mismatch');
  });

  it('refuses an approval reference that is not the recipe’s', () => {
    expectRefused(compose(derivatives.map(d => ({ ...d, asset: { ...d.asset, approvalId: 'simulated-approval-other' } }))), 'asset-mismatch');
  });

  it('refuses a raster that no longer hashes to the approved asset, even with the hash field intact', () => {
    const frames = raster.frames.map(frame => ({ durationMs: frame.durationMs, rgba: frame.rgba.slice() }));
    const index = frames[0]!.rgba.findIndex((value, i) => i % 4 === 3 && value > 200) - 1;
    frames[0]!.rgba[index] = frames[0]!.rgba[index]! ^ 0xff;
    const altered: DecodedEmote = { width: raster.width, height: raster.height, frames };
    expectRefused(compose(derivatives.map(d => ({ ...d, raster: altered }))), 'raster-mismatch');
    // The fixture raster itself is untouched.
    expect(compose([]).absences.every(absence => absence.reason === 'derivative-missing')).toBe(true);
  });

  it('refuses a derivative carrying anything beyond its fields, such as a URL', () => {
    expectRefused(compose(derivatives.map(d => ({ ...d, url: 'https://static-cdn.example/emote.gif' }))), 'malformed');
    expectRefused(compose(derivatives.map(d => ({ ...d, asset: { ...d.asset, assetHash: 'not-a-hash' } }))), 'malformed');
  });

  it('refuses two derivatives for one use as ambiguous', () => {
    expectRefused(compose([...derivatives, ...derivatives.map(d => ({ ...d }))]), 'ambiguous');
    // One use doubled refuses only that use; a single glass derivative with no rival still carves.
    const doubled = compose([...simulatedDerivatives(raster, ['statue', 'statue']), ...simulatedDerivatives(raster, ['weathervane', 'weathervane'])]);
    expect(doubled.absences).toEqual([
      { use: 'statue', reason: 'refused', refusal: 'ambiguous' },
      { use: 'weathervane', reason: 'refused', refusal: 'ambiguous' },
      { use: 'stained-glass', reason: 'refused', refusal: 'use-mismatch' },
    ]);
    expect(doubled.glass.kind).toBe('plain');
  });
});

describe('observed real channels', () => {
  const observed = OBSERVED_GENESIS_SHOWCASE_CHOICES.map(choice => {
    const facts = OBSERVED_GENESIS_FIXTURES.find(candidate => candidate.broadcasterId === choice.broadcasterId)!;
    const observedRecipe = compileRecipe(facts);
    return { choice, facts, recipe: observedRecipe, landscape: land(observedRecipe, choice.character) };
  });

  it('compose an honest empty state: no statue, no vane, plain glass and no label', () => {
    expect(observed.length).toBe(3);
    for (const { choice, recipe: observedRecipe, landscape } of observed) {
      const composed = composeGenesisEmoteArt(observedRecipe, landscape, []);
      expect(composed.character).toBe(choice.character);
      expect(composed.label).toBeNull();
      expect(composed.monument).toBeNull();
      expect(composed.vane).toBeNull();
      expect(composed.glass.kind).toBe('plain');
      expect(composed.glass.emote).toBeNull();
      expect(composed.absences).toEqual((['statue', 'weathervane', 'stained-glass'] as const).map(use => ({ use, reason: 'none-approved' })));
      // Offered derivatives change nothing when the recipe approves nothing.
      expect(canonical(composeGenesisEmoteArt(observedRecipe, landscape, derivatives))).toBe(canonical(composed));
    }
  });

  it('refuse a simulated derivative offered to an observed recipe, even one that lists the same work', () => {
    for (const { facts, choice } of observed) {
      const listed = compileRecipe({
        ...facts,
        approvedEmotes: [{ emoteId: SIMULATED_EMOTE_ID, broadcasterId: facts.broadcasterId, asset: { assetHash, approvalId: SIMULATED_APPROVAL_ID }, allowedUses: ['statue', 'weathervane', 'stained-glass'] }],
      });
      expect(listed.identity.emoteWorks.map(work => work.use)).toEqual(['statue', 'weathervane', 'stained-glass']);
      const offered = derivatives.map(d => ({ ...d, broadcasterId: facts.broadcasterId, origin: 'simulated' as const }));
      const composed = composeGenesisEmoteArt(listed, land(listed, choice.character), offered);
      expect(composed.absences).toEqual(refusedEverywhere('origin-mismatch'));
      expect(composed.label).toBeNull();
      expect(composed.monument).toBeNull();
      expect(composed.vane).toBeNull();
      expect(composed.glass.kind).toBe('plain');
    }
  });
});

describe('landscape guard', () => {
  it('throws for a landscape that is not one of the recipe’s candidates', () => {
    const other = compileRecipe(OBSERVED_GENESIS_FIXTURES[0]);
    expect(other.landscapes.some(candidate => recipe.landscapes.some(own => own.id === candidate.id))).toBe(false);
    expect(() => composeGenesisEmoteArt(recipe, other.landscapes[0]!, derivatives)).toThrow(/not one of this recipe's candidates/);
    expect(() => composeGenesisEmoteArt(recipe, { id: 'elsewhere', character: 'river-valley' }, derivatives)).toThrow(/not one of this recipe's candidates/);
    const own = land(recipe, 'river-valley');
    expect(() => composeGenesisEmoteArt(recipe, { id: own.id, character: 'mountain-pass' }, derivatives)).toThrow(/not one of this recipe's candidates/);
  });
});

describe('determinism and leakage', () => {
  it('composes JSON-identical output twice, in fresh objects', () => {
    expect(canonical(again)).toBe(canonical(art()));
    expect(Array.from(again.monument!.silhouette.materialIds)).toEqual(Array.from(art().monument!.silhouette.materialIds));
    expect(again.monument!.frames[0]!.blueprint.boxes).not.toBe(art().monument!.frames[0]!.blueprint.boxes);
    expect(again.monument!.silhouette.materialIds).not.toBe(art().monument!.silhouette.materialIds);
  });

  it('carries no hashes, approval IDs, emote IDs or URLs', () => {
    expect(assetHash).toMatch(/^[a-f0-9]{64}$/);
    for (const composed of full.values()) {
      const json = canonical(composed);
      for (const secret of [assetHash, SIMULATED_APPROVAL_ID, SIMULATED_EMOTE_ID, 'http', 'approvalId', 'assetHash']) expect(json).not.toContain(secret);
    }
  });
});

describe('the statue', () => {
  it('keeps the compiled front as its silhouette, the right way round', () => {
    const monument = art().monument!;
    const { silhouette: mask, statueOffset: [ox, oy, oz], statueSize: [sw, sh, sd] } = monument;
    expect([mask.width, mask.height]).toEqual([sw, sh]);
    expect(mask.materialIds.length).toBe(mask.width * mask.height);
    const at = grid(rasterizeBlueprint(monument.frames[0]!.blueprint));
    let occupied = 0, minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      const m = mask.materialIds[x + mask.width * y]!;
      // The front-most carved cell of each column, looking along -Z.
      let front = 0;
      for (let z = oz + sd - 1; z >= oz && !front; z--) front = at(ox + x, oy + y, z);
      expect(front, `mask ${x},${y}`).toBe(m);
      if (!m) continue;
      occupied++;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;
    expect(occupied / (bw * bh)).toBeGreaterThanOrEqual(0.4);
    expect(bh).toBe(EMOTE_ART_PROFILES.statue.height);

    // Deliberately asymmetric: mirrored across its own bounds, the silhouette does not match itself.
    let differ = 0;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const mirror = maxX - (x - minX);
      if (!!mask.materialIds[x + mask.width * y] !== !!mask.materialIds[mirror + mask.width * y]) differ++;
    }
    expect(differ / occupied).toBeGreaterThan(0.05);

    // The tilted gold crown sits right of centre, as drawn: the carving is not mirrored. Its bright gold snaps
    // to the gilt-hair pigment, with gold leaf allowed should the palette ever take it instead.
    const gilt = (m: number) => m === MAT.hairGold || m === MAT.goldLeaf;
    let crown = 0, crownX = 0;
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      if (gilt(mask.materialIds[x + mask.width * y]!)) { crown++; crownX += x; }
    }
    expect(crown).toBeGreaterThan(10);
    expect(crownX / crown).toBeGreaterThan((minX + maxX) / 2);
    // And it is in the upper part of the head: y is up.
    let crownY = 0;
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (gilt(mask.materialIds[x + mask.width * y]!)) crownY += y;
    expect(crownY / crown).toBeGreaterThan((minY + maxY) / 2);
  });

  it('paints the carving only in statue pigments', () => {
    const pigments = new Set(STATUE_PIGMENTS);
    const monument = art().monument!;
    for (const { blueprint } of monument.frames) {
      for (const box of blueprint.boxes.slice(monument.pedestal.boxes.length)) expect(pigments.has(box.material), `${blueprint.id} uses ${box.material}`).toBe(true);
    }
  });

  it('sets the carving on the cap, inside the pedestal footprint, and the whole statue on the ground', () => {
    for (const composed of full.values()) {
      const monument = composed.monument!;
      const [FW, FD] = monument.footprint;
      const [ox, oy, oz] = monument.statueOffset;
      const [sw, , sd] = monument.statueSize;
      expect(monument.pedestal.size[0]).toBe(FW);
      expect(monument.pedestal.size[2]).toBe(FD);
      expect(ox).toBeGreaterThanOrEqual(0);
      expect(oz).toBeGreaterThanOrEqual(0);
      expect(ox + sw).toBeLessThanOrEqual(FW);
      expect(oz + sd).toBeLessThanOrEqual(FD);
      const pedestal = grid(rasterizeBlueprint(monument.pedestal));
      // The carving's footprint stands on the solid cap.
      for (let z = oz; z < oz + sd; z++) for (let x = ox; x < ox + sw; x++) expect(pedestal(x, oy - 1, z), `cap ${x},${z}`).not.toBe(0);
      for (const { blueprint } of monument.frames) {
        expect(blueprint.size[0]).toBe(FW);
        expect(blueprint.size[2]).toBe(FD);
        expect(groundCells(rasterizeBlueprint(blueprint))).toBeGreaterThan(0);
      }
      expect(monument.clearanceCells).toBeGreaterThan(0);
    }
  });

  it('lights four lanterns inside the pedestal, each in lantern glass', () => {
    for (const composed of full.values()) {
      const monument = composed.monument!;
      expect(monument.lanterns.length).toBe(4);
      expect(new Set(monument.lanterns.map(l => l.id)).size).toBe(4);
      const asset = rasterizeBlueprint(monument.pedestal);
      const at = grid(asset);
      for (const { position: [x, y, z] } of monument.lanterns) {
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(asset.size[0]);
        expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThan(asset.size[1]);
        expect(z).toBeGreaterThanOrEqual(0); expect(z).toBeLessThan(asset.size[2]);
        expect(at(x, y, z), `${composed.character} lantern ${x},${y},${z}`).toBe(MAT.glass);
      }
    }
  });
});

describe('the window', () => {
  it('uses only glass dyes and the window’s own field and border', () => {
    const allowed = new Set([...GLASS_DYES, ...WINDOW_DYES]);
    const composed = art(), glass = composed.glass;
    const panes = new Set(glass.light.texels.filter(t => t !== 0));
    for (const m of panes) expect(allowed.has(m), `texel ${m}`).toBe(true);
    // The emote brings its own colours into the field, not only the window's.
    expect([...panes].some(m => !WINDOW_DYES.includes(m))).toBe(true);
    // Everything else in the unit is the kit's masonry round the leaded sheet.
    const kit = EMOTE_ART_KITS[composed.style];
    for (const m of materialsOf(glass.blueprint)) expect(allowed.has(m) || m === kit.stone || m === kit.moulding, `unit uses ${m}`).toBe(true);
  });

  it('glazes plain leaded lights in clear glass when no emote is approved for it', () => {
    const plain = composeGenesisEmoteArt(recipe, land(recipe, 'river-valley'), []).glass;
    expect(plain.kind).toBe('plain');
    expect(plain.emote).toBeNull();
    expect(plain.light.texels.length).toBe(plain.light.width * plain.light.height);
    expect(plain.light.texels.every(t => t === 0 || t === MAT.glass)).toBe(true);
    expect(plain.light.texels.filter(t => t === MAT.glass).length).toBeGreaterThan(plain.light.texels.length / 3);
  });

  it('lays the light inside the unit, the emote inside the light, and every lit texel on the glass sheet', () => {
    for (const glass of [art().glass, composeGenesisEmoteArt(recipe, land(recipe, 'river-valley'), []).glass]) {
      const { light, blueprint } = glass;
      const [lx, ly, lz] = light.origin;
      expect(light.facing).toBe('south');
      expect(light.texels.length).toBe(light.width * light.height);
      expect(lx).toBeGreaterThanOrEqual(0); expect(ly).toBeGreaterThanOrEqual(0); expect(lz).toBeGreaterThanOrEqual(1);
      expect(lx + light.width).toBeLessThanOrEqual(blueprint.size[0]);
      expect(ly + light.height).toBeLessThanOrEqual(blueprint.size[1]);
      expect(lz).toBeLessThanOrEqual(blueprint.size[2]);
      expect(glass.opening).toEqual([blueprint.size[0], blueprint.size[1]]);
      const at = grid(rasterizeBlueprint(blueprint));
      let lit = 0;
      for (let y = 0; y < light.height; y++) for (let x = 0; x < light.width; x++) {
        const t = light.texels[x + light.width * y]!;
        if (!t) continue;
        lit++;
        expect(at(lx + x, ly + y, lz - 1), `pane ${x},${y}`).toBe(t);
        // Nothing stands on the outward face in front of a lit pane.
        expect(at(lx + x, ly + y, lz), `face ${x},${y}`).toBe(0);
      }
      expect(lit).toBeGreaterThan(light.texels.length / 3);
    }
  });

  it('draws the approved emote in the light: most of its silhouette glows, the came takes the rest', () => {
    const glass = art().glass;
    const [ex, ey, ew, eh] = glass.emote!;
    const { light } = glass;
    expect(ex).toBeGreaterThanOrEqual(0); expect(ey).toBeGreaterThanOrEqual(0);
    expect(ex + ew).toBeLessThanOrEqual(light.width);
    expect(ey + eh).toBeLessThanOrEqual(light.height);
    const profile = EMOTE_ART_PROFILES['stained-glass'];
    const carved = carve(simulatedDerivatives(raster, ['stained-glass'])[0]!, profile.purpose, profile.palette, profile.height, profile.depth);
    if (!carved.ok) throw new Error(`The glass carving failed: ${carved.code}`);
    const mask = carved.emote.mask;
    expect([mask.width, mask.height]).toEqual([ew, eh]);
    let occupied = 0, glowing = 0;
    for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
      const m = mask.materialIds[x + mask.width * y]!;
      if (!m) continue;
      occupied++;
      const t = light.texels[ex + x + light.width * (ey + y)]!;
      if (t) glowing++;
      // Each glowing cell is the emote's own dye; its near-black drawing becomes leading.
      expect(t, `emote ${x},${y}`).toBe(m === CAME ? 0 : m);
    }
    expect(occupied).toBeGreaterThan(0);
    expect(glowing / occupied).toBeGreaterThanOrEqual(0.6);
  });
});

describe('the vane', () => {
  it('cuts the rotor from gilded sheet and pivots it on the mast top', () => {
    const vane = art().vane!;
    const metals = new Set([...VANE_METALS, MAT.brass, MAT.goldLeaf]);
    for (const m of materialsOf(vane.rotor)) expect(metals.has(m), `rotor uses ${m}`).toBe(true);
    expect(vane.mastPivot[1]).toBe(vane.mast.size[1]);
    expect(vane.mastPivot[0]).toBeGreaterThanOrEqual(0); expect(vane.mastPivot[0]).toBeLessThan(vane.mast.size[0]);
    expect(vane.mastPivot[2]).toBeGreaterThanOrEqual(0); expect(vane.mastPivot[2]).toBeLessThan(vane.mast.size[2]);
    const mast = grid(rasterizeBlueprint(vane.mast));
    expect(mast(vane.mastPivot[0], vane.mastPivot[1] - 1, vane.mastPivot[2])).not.toBe(0);
    expect(vane.rotorPivot[1]).toBe(0);
    expect(vane.rotorPivot[0]).toBeGreaterThanOrEqual(0);
    expect(vane.rotorPivot[0]).toBeLessThan(vane.rotor.size[0]);
    expect(vane.rotor.size[2]).toBe(2);
    const rotor = grid(rasterizeBlueprint(vane.rotor));
    expect(rotor(vane.rotorPivot[0], 0, vane.rotorPivot[2])).not.toBe(0);
    expect(vane.mount[1]).toBe(0);
    expect(mast(vane.mount[0], 0, vane.mount[2])).not.toBe(0);
  });
});

describe('palette, budgets and structure', { timeout: 60_000 }, () => {
  const pieces = (composed: GenesisEmoteArt): VoxelBlueprint[] => [
    ...(composed.monument ? [composed.monument.pedestal, ...composed.monument.frames.map(frame => frame.blueprint)] : []),
    composed.glass.blueprint,
    ...(composed.vane ? [composed.vane.mast, composed.vane.rotor] : []),
  ];

  it('lists exactly the carved materials, ascending, against the registry revision', () => {
    for (const composed of [...full.values(), composeGenesisEmoteArt(recipe, land(recipe, 'coastal-harbour'), [])]) {
      const { materials, revision } = composed.palette;
      expect(revision).toBe(MATERIALS.revision);
      expect(materials).toEqual([...new Set(materials)].sort((a, b) => a - b));
      const carved = new Set<number>();
      for (const piece of pieces(composed)) for (const m of materialsOf(piece)) carved.add(m);
      expect(materials).toEqual([...carved].sort((a, b) => a - b));
      // Every listed material is visible somewhere once the boxes are executed.
      const visible = new Set<number>();
      for (const piece of pieces(composed)) for (const m of rasterizeBlueprint(piece).voxels) if (m) visible.add(m);
      expect([...visible].sort((a, b) => a - b)).toEqual(materials);
      const registered = new Set(MATERIALS.materials.map(m => m.id));
      for (const m of materials) expect(registered.has(m)).toBe(true);
    }
  });

  it('fit the strict schema and stay inside their box and triangle budgets', () => {
    const composed = art();
    const monument = composed.monument!, vane = composed.vane!;
    for (const piece of pieces(composed)) expect(VoxelBlueprintSchema.parse(piece)).toEqual(piece);
    for (const { blueprint } of monument.frames) expect(blueprint.boxes.length, blueprint.id).toBeLessThanOrEqual(9000);
    expect(composed.glass.blueprint.boxes.length).toBeLessThanOrEqual(4000);
    expect(vane.mast.boxes.length + vane.rotor.boxes.length).toBeLessThanOrEqual(1500);
    expect(triangles(rasterizeBlueprint(monument.frames[0]!.blueprint))).toBeLessThanOrEqual(120_000);
    expect(triangles(rasterizeBlueprint(composed.glass.blueprint))).toBeLessThanOrEqual(120_000);
    // Distinct models never share an id, so a cached mesh never stands in for another.
    const ids = pieces(composed).map(piece => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stand the pedestal and the window unit on the ground as one face-connected structure', () => {
    for (const composed of full.values()) {
      for (const blueprint of [composed.monument!.pedestal, composed.glass.blueprint]) {
        const asset = rasterizeBlueprint(blueprint);
        expect(groundCells(asset), blueprint.id).toBeGreaterThan(0);
        expect(floating(asset), blueprint.id).toBe(0);
      }
    }
    const plain = rasterizeBlueprint(composeGenesisEmoteArt(recipe, land(recipe, 'river-valley'), []).glass.blueprint);
    expect(groundCells(plain)).toBeGreaterThan(0);
    expect(floating(plain)).toBe(0);
  });

  // The letters are one-cell sheet: each must meet its neighbours face to face and stand on its arm's bar.
  it('stand the vane mast on its foot as one face-connected structure', () => {
    const asset = rasterizeBlueprint(art().vane!.mast);
    expect(groundCells(asset)).toBeGreaterThan(0);
    expect(floating(asset)).toBe(0);
  });
});

// Keeps the use list in step with the profiles the adapter carves.
it('profiles every use the recipe can approve', () => {
  const uses: readonly EmoteUse[] = ['statue', 'weathervane', 'stained-glass'];
  expect(Object.keys(EMOTE_ART_PROFILES).sort()).toEqual([...uses].sort());
  expect(SIMULATED_BROADCASTER).toBe(recipe.kingdomId);
});
