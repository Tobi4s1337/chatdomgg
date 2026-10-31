import { describe, expect, it } from 'vitest';
import { compileChannelGenesis } from '../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES } from '../../../world/src/genesis/observed-fixtures';
import { MAT } from '../materials';
import { proposeGenesisLandmarks } from './adapter';
import { HARBOUR_TARGET, showcaseFixture } from './showcase-fixtures';

const { recipe, landscape } = showcaseFixture(HARBOUR_TARGET);
const [proposal] = proposeGenesisLandmarks(recipe, landscape);
const turn = (v: readonly [number, number], t: number): [number, number] => {
  let [x, z] = v;
  for (let i = 0; i < t; i++) [x, z] = [z, -x];
  return [x, z];
};

describe('genesis landmark adapter: coastal harbour', () => {
  it('reads the actual coastal showcase recipe', () => {
    expect(landscape.character).toBe('coastal-harbour');
    expect(recipe.identity.landmark).toBe('watchtower');
    expect(recipe.identity.styleFamily).toBe('tide');
    expect(recipe.identity.profileColourTargets).toEqual(['#c91709', '#f8ae04', '#fe9e79', '#075e86']);
  });

  it('proposes one harbour watchtower for the selected landscape, deterministically', () => {
    const again = proposeGenesisLandmarks(recipe, landscape);
    expect(again.length).toBe(1);
    expect(JSON.stringify(again)).toBe(JSON.stringify([proposal]));
    expect(proposal!.showcase).toBe('harbour-watchtower');
    expect(proposal!.id).toBe(`${landscape.id}/landmark/harbour-watchtower`);
    expect(proposal!.landscapeId).toBe(landscape.id);
    expect(proposal!.piece.blueprint.styleId).toBe('tide');
  });

  it('keeps the recipe landmark and the landscape character as separate inputs', () => {
    expect(proposal!.recipeLandmark).toBe(recipe.identity.landmark);
    expect(proposal!.crown).toBe('beacon-loft');
    const lighthouse = structuredClone(recipe) as typeof recipe;
    (lighthouse.identity as { landmark: string }).landmark = 'lighthouse';
    const [lit] = proposeGenesisLandmarks(lighthouse, lighthouse.landscapes.find(l => l.id === landscape.id)!);
    expect(lit!.recipeLandmark).toBe('lighthouse');
    expect(lit!.crown).toBe('lamp-room');
    expect(lit!.showcase).toBe('harbour-watchtower');
    // The recipe itself is never rewritten.
    expect(recipe.identity.landmark).toBe('watchtower');
    expect(Object.isFrozen(recipe.identity)).toBe(true);
  });

  it('uses the selected candidate even when another one is recommended', () => {
    expect(landscape.id).not.toBe(recipe.recommendedLandscapeId);
    const recommended = recipe.landscapes.find(l => l.id === recipe.recommendedLandscapeId)!;
    expect(recommended.character).not.toBe('coastal-harbour');
    expect(() => proposeGenesisLandmarks(recipe, recommended)).toThrow(/No landmark is authored/);
  });

  it('refuses a landscape that is not this recipe\'s, or that was altered', () => {
    const other = showcaseFixture('4363967');
    expect(() => proposeGenesisLandmarks(recipe, other.recipe.landscapes[0])).toThrow(/not one of this recipe/);
    const altered = { ...structuredClone(landscape), islands: [] } as unknown as typeof landscape;
    expect(() => proposeGenesisLandmarks(recipe, altered)).toThrow(/differs/);
  });

  it('turns the door to face inland and puts the axis on the gate\'s line, inside the shore', () => {
    const ocean = landscape.coast.oceanToward;
    const door = turn([0, 1], proposal!.quarterTurns), sea = turn([0, 1], ocean);
    expect(door[0] * sea[0] + door[1] * sea[1]).toBe(-1);
    // In the coast's frame (sea towards +v) the axis lies on the gate's u, setback metres inland of the shoreline.
    const back = (4 - ocean) % 4;
    const [axisU, axisV] = turn(proposal!.site.axis, back);
    const gate = landscape.places.find(p => p.purpose === 'gate')!;
    expect(axisU).toBeCloseTo(turn(gate.anchor, back)[0], 9);
    const shore = landscape.coast.shoreline.map(p => turn(p, back)).sort((a, b) => a[0] - b[0]);
    const i = shore.findIndex(p => p[0] >= axisU);
    const [u0, v0] = shore[i - 1]!, [u1, v1] = shore[i]!;
    expect(v0 + (v1 - v0) * (axisU - u0) / (u1 - u0) - axisV).toBeCloseTo(proposal!.site.setback, 9);
    expect(proposal!.site.status).toBe('unvalidated');
    // The local origin maps the tower's axis onto the site under the same turn.
    const local = turn([48 * 0.125, 44 * 0.125], proposal!.quarterTurns);
    expect(proposal!.site.origin[0] + local[0]).toBeCloseTo(proposal!.site.axis[0], 9);
    expect(proposal!.site.origin[1] + local[1]).toBeCloseTo(proposal!.site.axis[1], 9);
  });

  it('snaps the channel\'s actual colour targets onto cloth for the crest and flag', () => {
    expect(proposal!.palette.field).toEqual({ target: '#c91709', material: MAT.fabricRed });
    expect(proposal!.palette.band).toEqual({ target: '#f8ae04', material: MAT.fabricOrange });
    expect(proposal!.crest).toEqual({ shape: recipe.identity.crest.shape, charge: 'wave' });
    expect(proposal!.bannerCut).toBe(recipe.identity.banner.cut);
    const materials = new Set(proposal!.piece.blueprint.boxes.map(b => b.material));
    expect(materials.has(MAT.fabricRed) && materials.has(MAT.fabricOrange)).toBe(true);
  });

  it('falls back to the kit colours when a channel has no targets, and labels simulated recipes', () => {
    const facts = OBSERVED_GENESIS_FIXTURES.find(f => f.broadcasterId === HARBOUR_TARGET)!;
    expect(facts.profileColours).toEqual([]);
    const bare = compileChannelGenesis(facts);
    const [plain] = proposeGenesisLandmarks(bare, bare.landscapes.find(l => l.character === 'coastal-harbour')!);
    expect(plain!.palette.field).toEqual({ target: null, material: MAT.slate });
    expect(plain!.palette.band).toEqual({ target: null, material: MAT.cream });
    expect(plain!.provenance).toEqual({ evidence: 'observed', label: null });
    const simulated = compileChannelGenesis({ ...facts, evidence: { kind: 'simulated', sourceId: 'lane-bench', asOf: facts.evidence.asOf, label: 'SIMULATED' } });
    const [sim] = proposeGenesisLandmarks(simulated, simulated.landscapes.find(l => l.character === 'coastal-harbour')!);
    expect(sim!.provenance).toEqual({ evidence: 'simulated', label: 'SIMULATED' });
  });

  it('hands main the geometry and the checks, and claims no placement', () => {
    const { piece } = proposal!;
    expect(piece.doorways.length).toBe(1);
    expect(piece.footings.map(f => f.id)).toEqual(['plinth', 'steps', 'boulders']);
    expect(proposal!.checks.length).toBeGreaterThanOrEqual(4);
    expect(proposal!.site.status).toBe('unvalidated');
    expect(Object.keys(proposal!)).not.toEqual(expect.arrayContaining(['placement']));
    expect(piece.doorways[0]!.state).toBe('closed');
    expect(piece.affordances.every(a => a.status === 'needs-host')).toBe(true);
  });
});
