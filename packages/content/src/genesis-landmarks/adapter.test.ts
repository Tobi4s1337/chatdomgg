import { describe, expect, it } from 'vitest';
import { compileChannelGenesis } from '../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES } from '../../../world/src/genesis/observed-fixtures';
import { MAT } from '../materials';
import {
  proposeGenesisLandmarks, type CathedralSiteProposal, type GenesisLandmarkProposal, type HarbourLandmarkProposal,
  type MountainLandmarkProposal, type RiverLandmarkProposal,
} from './adapter';
import { CATHEDRAL_SITE_AXIS, CATHEDRAL_SITE_SIZE } from './cathedral-site/site';
import { CROWN_TOWER_AXIS } from './crown-tower/crown';
import { RIVER_HALL, RIVER_HALL_AXIS } from './river-hall/hall';
import { HARBOUR_TARGET, MOUNTAIN_TARGET, RIVER_TARGET, showcaseFixture } from './showcase-fixtures';

const { recipe, landscape } = showcaseFixture(HARBOUR_TARGET);
const [proposal] = proposeGenesisLandmarks(recipe, landscape) as readonly HarbourLandmarkProposal[];
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
    const [lit] = proposeGenesisLandmarks(lighthouse, lighthouse.landscapes.find(l => l.id === landscape.id)!) as readonly HarbourLandmarkProposal[];
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
    // The recommended candidate gets its own landscape's landmark, never the harbour tower.
    const [other] = proposeGenesisLandmarks(recipe, recommended);
    expect(other!.landscapeId).toBe(recommended.id);
    expect(other!.showcase).not.toBe('harbour-watchtower');
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

describe('genesis landmark adapter: river valley', () => {
  const river = showcaseFixture(RIVER_TARGET);
  const [hall] = proposeGenesisLandmarks(river.recipe, river.landscape) as readonly RiverLandmarkProposal[];
  const stream = river.landscape.terrainCore.streams.find(s => s.id === 'river')!;
  const plaza = river.landscape.places.find(p => p.purpose === 'plaza')!;

  it('reads the actual river showcase recipe', () => {
    expect(river.landscape.character).toBe('river-valley');
    expect(river.recipe.identity.landmark).toBe('stone-circle');
    expect(river.recipe.identity.styleFamily).toBe('hearth');
    expect(river.recipe.identity.profileColourTargets).toEqual(['#8753da', '#651e8c', '#74604c', '#4e125e']);
  });

  it('proposes one river hall for the selected landscape, deterministically, without a wheel', () => {
    const again = proposeGenesisLandmarks(river.recipe, river.landscape);
    expect(again.length).toBe(1);
    expect(JSON.stringify(again)).toBe(JSON.stringify([hall]));
    expect(hall!.showcase).toBe('river-hall');
    expect(hall!.id).toBe(`${river.landscape.id}/landmark/river-hall`);
    expect(hall!.landscapeId).toBe(river.landscape.id);
    expect(hall!.recipeLandmark).toBe('stone-circle');
    expect(hall!.wheel).toBe(false);
    expect(hall!.piece.parts.map(p => p.id)).toEqual(['flag']);
    expect(hall!.piece.blueprint.styleId).toBe('hearth');
  });

  it('turns a wheel only for a watermill kingdom, and never rewrites the recipe', () => {
    const mill = structuredClone(river.recipe) as typeof river.recipe;
    (mill.identity as { landmark: string }).landmark = 'watermill';
    const [turning] = proposeGenesisLandmarks(mill, mill.landscapes.find(l => l.id === river.landscape.id)!) as readonly RiverLandmarkProposal[];
    expect(turning!.wheel).toBe(true);
    expect(turning!.recipeLandmark).toBe('watermill');
    expect(turning!.piece.parts.map(p => p.id)).toEqual(['flag', 'wheel']);
    expect(turning!.site).toEqual(hall!.site);
    expect(river.recipe.identity.landmark).toBe('stone-circle');
    expect(Object.isFrozen(river.recipe.identity)).toBe(true);
  });

  it('sits the axis on the river\'s centre line where it passes nearest the plaza', () => {
    const { axis } = hall!.site;
    const toSegment = (a: readonly number[], b: readonly number[]) => {
      const dx = b[0]! - a[0]!, dz = b[1]! - a[1]!, t = Math.min(1, Math.max(0, ((plaza.anchor[0] - a[0]!) * dx + (plaza.anchor[1] - a[1]!) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(plaza.anchor[0] - a[0]! - dx * t, plaza.anchor[1] - a[1]! - dz * t);
    };
    const nearest = Math.min(...stream.points.slice(1).map((p, i) => toSegment(stream.points[i]!.position, p.position)));
    expect(Math.hypot(plaza.anchor[0] - axis[0], plaza.anchor[1] - axis[1])).toBeCloseTo(nearest, 9);
    const levels = stream.points.map(p => p.level), widths = stream.points.map(p => p.width);
    expect(hall!.site.river.id).toBe('river');
    expect(hall!.site.river.level).toBeGreaterThanOrEqual(Math.min(...levels));
    expect(hall!.site.river.level).toBeLessThanOrEqual(Math.max(...levels));
    expect(hall!.site.river.width).toBeGreaterThanOrEqual(Math.min(...widths));
    expect(hall!.site.river.width).toBeLessThanOrEqual(Math.max(...widths));
    expect(hall!.site.river.bed).toBeLessThan(hall!.site.river.level);
    expect(hall!.site.river.clearSpan).toBe(16);
  });

  it('turns the door towards the plaza\'s bank and maps the hall\'s axis onto the site', () => {
    const door = turn([0, 1], hall!.quarterTurns), { axis, origin } = hall!.site;
    expect(door[0] * (plaza.anchor[0] - axis[0]) + door[1] * (plaza.anchor[1] - axis[1])).toBeGreaterThan(0);
    const local = turn([RIVER_HALL_AXIS.x * 0.125, RIVER_HALL_AXIS.z * 0.125], hall!.quarterTurns);
    expect(origin[0] + local[0]).toBeCloseTo(axis[0], 9);
    expect(origin[1] + local[1]).toBeCloseTo(axis[1], 9);
    // y = 0 of the piece is the bed under the arches: the drawn water line lands on the river's surface.
    expect(hall!.site.elevation + RIVER_HALL.water * 0.125).toBeCloseTo(hall!.site.river.level, 9);
    expect(hall!.site.skew).toBeGreaterThanOrEqual(0);
    expect(hall!.site.skew).toBeLessThanOrEqual(45);
    expect(hall!.site.basis).toBe('river-nearest-plaza');
    expect(hall!.site.status).toBe('unvalidated');
  });

  it('snaps the channel\'s colours onto cloth for the crest, banners and flag', () => {
    expect(hall!.palette.field).toEqual({ target: '#8753da', material: MAT.fabricViolet });
    expect(hall!.palette.band).toEqual({ target: '#651e8c', material: MAT.slate });
    expect(hall!.crest).toEqual({ shape: 'swallowtail', charge: 'star' });
    expect(hall!.bannerCut).toBe('forked');
    const materials = new Set(hall!.piece.blueprint.boxes.map(b => b.material));
    expect(materials.has(MAT.fabricViolet) && materials.has(MAT.slate)).toBe(true);
    expect(hall!.provenance).toEqual({ evidence: 'observed', label: null });
    const simulated = compileChannelGenesis({ ...OBSERVED_GENESIS_FIXTURES.find(f => f.broadcasterId === RIVER_TARGET)!, evidence: { kind: 'simulated', sourceId: 'lane-bench', asOf: river.recipe.evidence.asOf, label: 'SIMULATED' } });
    const [sim] = proposeGenesisLandmarks(simulated, simulated.landscapes.find(l => l.character === 'river-valley')!);
    expect(sim!.provenance).toEqual({ evidence: 'simulated', label: 'SIMULATED' });
  });

  it('hands main the geometry and the checks, claims no placement, and gives its pass the crown tower', () => {
    const { piece } = hall!;
    expect(piece.doorways.length).toBe(1);
    expect(piece.water).toEqual({ level: RIVER_HALL.water, bank: RIVER_HALL.bank, channel: expect.any(Object) });
    expect(piece.glazing!.length).toBeGreaterThan(100);
    expect(hall!.checks.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(hall!)).not.toEqual(expect.arrayContaining(['placement']));
    expect(piece.affordances.every(a => a.status === 'needs-host')).toBe(true);
    // A town on its mountain-pass candidate gets the crown tower and no cathedral site.
    const mountain = river.recipe.landscapes.find(l => l.character === 'mountain-pass')!;
    expect(proposeGenesisLandmarks(river.recipe, mountain).map(p => p.showcase)).toEqual(['crown-tower']);
  });
});

describe('genesis landmark adapter: mountain pass and the city\'s cathedral site', () => {
  const mountain = showcaseFixture(MOUNTAIN_TARGET);
  const proposals = proposeGenesisLandmarks(mountain.recipe, mountain.landscape);
  const tower = proposals[0] as MountainLandmarkProposal, site = proposals[1] as CathedralSiteProposal;
  const plaza = mountain.landscape.places.find(p => p.purpose === 'plaza')!, gate = mountain.landscape.places.find(p => p.purpose === 'gate')!;
  const { saddle } = mountain.landscape.mountainPass;

  it('reads the actual mountain showcase recipe, a city', () => {
    expect(mountain.landscape.character).toBe('mountain-pass');
    expect(mountain.landscape.id).toBe(mountain.recipe.recommendedLandscapeId);
    expect(mountain.recipe.identity.landmark).toBe('watchtower');
    expect(mountain.recipe.identity.styleFamily).toBe('hearth');
    expect(mountain.recipe.identity.profileColourTargets).toEqual(['#514a98', '#87746f', '#6e5a65', '#3945d8']);
    expect(mountain.recipe.size.tier).toBe('city');
    expect(mountain.recipe.size.cathedralSite).toBe(true);
  });

  it('proposes the crown tower and then the cathedral site, deterministically', () => {
    expect(JSON.stringify(proposeGenesisLandmarks(mountain.recipe, mountain.landscape))).toBe(JSON.stringify(proposals));
    expect(proposals.map(p => p.showcase)).toEqual(['crown-tower', 'cathedral-site']);
    expect(tower.id).toBe(`${mountain.landscape.id}/landmark/crown-tower`);
    expect(site.id).toBe(`${mountain.landscape.id}/landmark/cathedral-site`);
    for (const p of proposals) {
      expect(p.landscapeId).toBe(mountain.landscape.id);
      expect(p.character).toBe('mountain-pass');
      expect(p.recipeLandmark).toBe('watchtower');
      expect(p.piece.blueprint.styleId).toBe('hearth');
    }
    expect(tower.head).toBe('watch-fire');
    expect(tower.piece.emitters.some(e => e.kind === 'beacon')).toBe(true);
  });

  it('hangs a bell in the head only for a bell-garden kingdom, and never rewrites the recipe', () => {
    const rung = structuredClone(mountain.recipe) as typeof mountain.recipe;
    (rung.identity as { landmark: string }).landmark = 'bell-garden';
    const [bell, again] = proposeGenesisLandmarks(rung, rung.landscapes.find(l => l.id === mountain.landscape.id)!) as readonly [MountainLandmarkProposal, CathedralSiteProposal];
    expect(bell.head).toBe('bell');
    expect(bell.recipeLandmark).toBe('bell-garden');
    expect(bell.piece.emitters.some(e => e.kind === 'beacon')).toBe(false);
    expect(bell.piece.affordances.map(a => a.kind)).toContain('ring-bell');
    expect(bell.site).toEqual(tower.site);
    expect(again.site).toEqual(site.site);
    expect(mountain.recipe.identity.landmark).toBe('watchtower');
    expect(Object.isFrozen(mountain.recipe.identity)).toBe(true);
  });

  it('stands the tower twenty metres from the saddle towards the plaza, its door turned to the town', () => {
    const { axis, origin } = tower.site;
    expect(Math.hypot(axis[0] - saddle[0], axis[1] - saddle[2])).toBeCloseTo(20, 9);
    // On the straight line from the saddle to the plaza, between them.
    const toPlaza = [plaza.anchor[0] - saddle[0], plaza.anchor[1] - saddle[2]] as const, toAxis = [axis[0] - saddle[0], axis[1] - saddle[2]] as const;
    expect(toPlaza[0] * toAxis[1] - toPlaza[1] * toAxis[0]).toBeCloseTo(0, 6);
    expect(toPlaza[0] * toAxis[0] + toPlaza[1] * toAxis[1]).toBeGreaterThan(0);
    const door = turn([0, 1], tower.quarterTurns);
    expect(door[0] * (plaza.anchor[0] - axis[0]) + door[1] * (plaza.anchor[1] - axis[1])).toBeGreaterThan(0);
    // No other quarter turn faces the plaza better.
    const best = Math.max(...[0, 1, 2, 3].map(t => { const d = turn([0, 1], t); return d[0] * toPlaza[0] + d[1] * toPlaza[1]; }));
    // and so turned away from the saddle behind it.
    expect(door[0] * toAxis[0] + door[1] * toAxis[1]).toBeGreaterThan(0);
    expect(door[0] * toPlaza[0] + door[1] * toPlaza[1]).toBeCloseTo(best, 9);
    const local = turn([CROWN_TOWER_AXIS.x * 0.125, CROWN_TOWER_AXIS.z * 0.125], tower.quarterTurns);
    expect(origin[0] + local[0]).toBeCloseTo(axis[0], 9);
    expect(origin[1] + local[1]).toBeCloseTo(axis[1], 9);
    expect(tower.site.elevation).toBe(saddle[1]);
    expect(tower.site.pass).toEqual({ saddle: [...saddle], width: mountain.landscape.mountainPass.width, between: [...mountain.landscape.mountainPass.betweenHillIds] });
    expect(tower.site.basis).toBe('pass-towards-plaza');
    expect(tower.site.status).toBe('unvalidated');
  });

  it('reserves the cathedral across the plaza from the gate, its west front turned back to the plaza', () => {
    const { axis, origin, footprint } = site.site;
    const onward = [plaza.anchor[0] - gate.anchor[0], plaza.anchor[1] - gate.anchor[1]] as const, length = Math.hypot(...onward);
    const half = (CATHEDRAL_SITE_SIZE[2] * 0.125) / 2;
    expect(axis[0]).toBeCloseTo(plaza.anchor[0] + (onward[0] / length) * (10 + half), 9);
    expect(axis[1]).toBeCloseTo(plaza.anchor[1] + (onward[1] / length) * (10 + half), 9);
    expect(site.site.forecourt).toBe(10);
    const front = turn([0, 1], site.quarterTurns);
    expect(front[0] * (plaza.anchor[0] - axis[0]) + front[1] * (plaza.anchor[1] - axis[1])).toBeGreaterThan(0);
    const local = turn([CATHEDRAL_SITE_AXIS.x * 0.125, CATHEDRAL_SITE_AXIS.z * 0.125], site.quarterTurns);
    expect(origin[0] + local[0]).toBeCloseTo(axis[0], 9);
    expect(origin[1] + local[1]).toBeCloseTo(axis[1], 9);
    // The footprint is the turned reserve (24 m × 32 m), round its axis, and inside the recorded settlement reserve.
    const spans = [footprint.maxX - footprint.minX, footprint.maxZ - footprint.minZ].sort((a, b) => a - b);
    expect(spans[0]).toBeCloseTo(CATHEDRAL_SITE_SIZE[0] * 0.125, 9);
    expect(spans[1]).toBeCloseTo(CATHEDRAL_SITE_SIZE[2] * 0.125, 9);
    expect(axis[0] > footprint.minX && axis[0] < footprint.maxX && axis[1] > footprint.minZ && axis[1] < footprint.maxZ).toBe(true);
    const reserve = mountain.landscape.settlementReserve;
    expect(site.site.withinSettlementReserve).toBe(footprint.minX >= reserve.minX && footprint.maxX <= reserve.maxX && footprint.minZ >= reserve.minZ && footprint.maxZ <= reserve.maxZ);
    expect(site.site.withinSettlementReserve).toBe(true);
    // It keeps clear of the plaza's anchor and of the tower.
    expect(plaza.anchor[0] >= footprint.minX && plaza.anchor[0] <= footprint.maxX && plaza.anchor[1] >= footprint.minZ && plaza.anchor[1] <= footprint.maxZ).toBe(false);
    expect(tower.site.axis[0] >= footprint.minX && tower.site.axis[0] <= footprint.maxX && tower.site.axis[1] >= footprint.minZ && tower.site.axis[1] <= footprint.maxZ).toBe(false);
    expect(site.site.basis).toBe('plaza-frontage');
    expect(site.site.status).toBe('unvalidated');
  });

  it('snaps the channel\'s colours onto cloth once, for the tower and the site alike', () => {
    expect(tower.palette.field).toEqual({ target: '#514a98', material: MAT.slate });
    expect(tower.palette.band).toEqual({ target: '#87746f', material: MAT.fabricViolet });
    expect(site.palette).toEqual(tower.palette);
    expect(tower.crest).toEqual({ shape: mountain.recipe.identity.crest.shape, charge: mountain.recipe.identity.crest.charge });
    expect(site.crest).toEqual(tower.crest);
    expect(tower.bannerCut).toBe(mountain.recipe.identity.banner.cut);
    for (const p of proposals) {
      const materials = new Set(p.piece.blueprint.boxes.map(b => b.material));
      expect(materials.has(MAT.slate) && materials.has(MAT.fabricViolet)).toBe(true);
      expect(p.provenance).toEqual({ evidence: 'observed', label: null });
    }
    const simulated = compileChannelGenesis({ ...OBSERVED_GENESIS_FIXTURES.find(f => f.broadcasterId === MOUNTAIN_TARGET)!, evidence: { kind: 'simulated', sourceId: 'lane-bench', asOf: mountain.recipe.evidence.asOf, label: 'SIMULATED' } });
    const sim = proposeGenesisLandmarks(simulated, simulated.landscapes.find(l => l.character === 'mountain-pass')!);
    expect(sim.map(p => p.provenance)).toEqual([{ evidence: 'simulated', label: 'SIMULATED' }, { evidence: 'simulated', label: 'SIMULATED' }]);
  });

  it('hands main the geometry and the checks for both, and claims no placement', () => {
    expect(tower.piece.doorways.length).toBe(1);
    expect(tower.piece.footings.map(f => f.id)).toEqual(['terrace', 'steps', 'outcrop']);
    expect(tower.piece.affordances.map(a => a.kind)).toEqual(expect.arrayContaining(['enter', 'sit', 'play-board', 'look-out', 'tend-beacon']));
    expect(tower.checks.length).toBeGreaterThanOrEqual(5);
    expect(site.piece.doorways.length).toBe(0);
    expect(site.piece.clear.some(v => v.role === 'reserve')).toBe(true);
    expect(site.piece.affordances.map(a => a.kind)).toContain('raise-cathedral');
    expect(site.checks.length).toBeGreaterThanOrEqual(4);
    for (const p of proposals) {
      expect(Object.keys(p)).not.toEqual(expect.arrayContaining(['placement']));
      expect(p.piece.affordances.every(a => a.status === 'needs-host')).toBe(true);
    }
  });
});

describe('genesis landmark adapter: all three showcase proposals', () => {
  const targets = [HARBOUR_TARGET, RIVER_TARGET, MOUNTAIN_TARGET] as const;
  const all = targets.map(target => { const f = showcaseFixture(target); return { ...f, proposals: proposeGenesisLandmarks(f.recipe, f.landscape) }; });
  const flat: GenesisLandmarkProposal[] = all.flatMap(a => [...a.proposals]);

  it('gives each showcase landscape its own landmark, and only the city a cathedral site', () => {
    expect(all.map(a => a.landscape.character)).toEqual(['coastal-harbour', 'river-valley', 'mountain-pass']);
    expect(all.map(a => a.proposals.map(p => p.showcase))).toEqual([['harbour-watchtower'], ['river-hall'], ['crown-tower', 'cathedral-site']]);
    expect(all.map(a => a.recipe.size.cathedralSite)).toEqual([false, false, true]);
    expect(new Set(flat.map(p => p.id)).size).toBe(flat.length);
    expect(new Set(flat.map(p => p.piece.blueprint.id)).size).toBe(flat.length);
  });

  it('keeps every proposal an unvalidated candidate for main, with its own landscape and checks', () => {
    for (const { landscape, proposals } of all) {
      for (const p of proposals) {
        expect(p.landscapeId).toBe(landscape.id);
        expect(p.character).toBe(landscape.character);
        expect(p.site.status).toBe('unvalidated');
        expect(p.checks.length).toBeGreaterThanOrEqual(4);
        expect([0, 1, 2, 3]).toContain(p.quarterTurns);
        expect(Object.keys(p)).not.toEqual(expect.arrayContaining(['placement']));
        expect(p.piece.affordances.every(a => a.status === 'needs-host')).toBe(true);
        expect(p.piece.blueprint.styleId).toBe(all.find(a => a.landscape.id === landscape.id)!.recipe.identity.styleFamily);
      }
    }
  });

  it('gives a city its cathedral site on whichever landscape is chosen, and a hamlet none on any', () => {
    const city = all[2]!.recipe;
    for (const candidate of city.landscapes) {
      const chosen = proposeGenesisLandmarks(city, candidate);
      expect(chosen.length).toBe(2);
      expect(chosen[1]!.showcase).toBe('cathedral-site');
      expect((chosen[1] as CathedralSiteProposal).site.basis).toBe('plaza-frontage');
    }
    expect(city.landscapes.map(l => proposeGenesisLandmarks(city, l)[0]!.showcase).sort()).toEqual(['crown-tower', 'harbour-watchtower', 'river-hall']);
    const hamlet = all[0]!.recipe;
    for (const candidate of hamlet.landscapes) expect(proposeGenesisLandmarks(hamlet, candidate).length).toBe(1);
  });
});
