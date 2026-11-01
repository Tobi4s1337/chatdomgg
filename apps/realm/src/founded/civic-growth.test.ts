import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, type GrowthPrivateState } from '@chatdom/shared';
import { generateSettlementPlan, transformCardinalPoint } from '@chatdom/world';
import { createGrowthState } from '@chatdom/world/growth';
import { standingClear } from '@chatdom/world/interactions';
import { createRealmState } from '@chatdom/world/realm';
import { humpbackDeckTop } from '../../../../packages/content/src/places/water/bridge/bridge';
import { createNativeTown } from './native';
import { installFoundedCivicGrowth, planFoundedCivicSites } from './civic-growth';
import { assembleFoundedScene } from './scene';
import { compileFoundedScene, foundedGroundAt } from './collision';
import { enrichNativeForgeHearth, enrichNativeForgeWorkshop } from './forge-hearth-furnishings';
import { createFoundedWorldLoader, type FoundedWorldStore } from './provider';

const kingdomId = KingdomIdSchema.parse('900000002');
const plan = generateSettlementPlan({ seed: 'founded-scene-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
const native = createNativeTown(plan);
const overlap = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
const growthAt = (level: number): GrowthPrivateState => {
  const growth = createGrowthState(kingdomId, 'simulated');
  return { ...growth, civic: { ...growth.civic, levels: { tavern: level, forge: level, market: level, bridge: level, 'castle-court': level } } };
};

describe('founded civic growth sites', () => {
  it('reserves mature sites outside every future home lot, samples actual water, and reaches dry banks with supported steps', () => {
    const { sites, unavailable } = planFoundedCivicSites(plan, native);
    expect(sites.map(site => site.place).sort()).toEqual(['bridge', 'castle-court', 'market', 'tavern']);
    expect(unavailable.map(item => item.place)).toEqual(['forge']);
    for (const site of sites) for (const reservation of plan.reservations) expect(overlap(site.clearance, reservation.lot), `${site.place}/${reservation.id}`).toBe(false);
    const bridge = sites.find(site => site.place === 'bridge')!;
    expect(bridge.position[1] + bridge.bridge!.water / 8).toBe(plan.lake.level);
    expect(bridge.bridge).not.toEqual({ water: 6, bank: 14 });
    for (const [side, tops] of bridge.approaches!.entries()) {
      const deck = bridge.position[1] + bridge.bridge!.bank / 8;
      expect(tops.length).toBeGreaterThanOrEqual(4);
      expect(tops[0]! - deck).toBeLessThanOrEqual(.25);
      tops.forEach((height, i) => { if (i) expect(Math.abs(height - tops[i - 1]!)).toBeLessThanOrEqual(.25); });
      const x = side === 0 ? -tops.length * .5 + .25 : 18 + tops.length * .5 - .25;
      const end = transformCardinalPoint(bridge.position, bridge.rotation, [x, 0, 2]);
      expect(foundedGroundAt(plan, end[0], end[2])[1]).toBeGreaterThan(plan.lake.level);
    }
  });

  it('uses committed levels in exact scene hashes without moving any home, hearth, site or bridge span, and exposes a real walk', async () => {
    const empty = createRealmState(kingdomId, 'simulated');
    const first = await assembleFoundedScene({ kingdomId, plan, native, state: { ...empty, growth: growthAt(1) }, collisionRevision: 1 });
    const mature = await assembleFoundedScene({ kingdomId, plan, native, state: { ...empty, growth: growthAt(4) }, collisionRevision: 2 });
    expect(mature.geometryDigest).not.toBe(first.geometryDigest);
    const unchanged = first.scene.placements.filter(piece => !piece.id.startsWith('civic:growth:v1:'));
    expect(mature.scene.placements.filter(piece => !piece.id.startsWith('civic:growth:v1:'))).toEqual(unchanged);
    expect(first.scene.placements.filter(piece => piece.id.startsWith('civic:growth:v1:'))).toHaveLength(4);
    for (const piece of mature.scene.placements.filter(piece => piece.id.startsWith('civic:growth:v1:'))) {
      expect(mature.scene.assets.find(asset => asset.assetHash === piece.assetHash)!.blueprint.id).toMatch(/-4$/);
      expect(piece.position).toEqual(first.scene.placements.find(other => other.id === piece.id)!.position);
    }
    const hearth = enrichNativeForgeHearth(plan, native).fixtures.find(piece => piece.id === 'forge:hearth:v1')!;
    const preserved = installFoundedCivicGrowth(plan, native, growthAt(4)).fixtures.find(piece => piece.id === hearth.id)!;
    expect(preserved).toEqual(hearth);
    const hero = enrichNativeForgeWorkshop(plan, enrichNativeForgeHearth(plan, native));
    const workshop = hero.fixtures.find(piece => piece.id === 'forge:workshop:v1');
    expect(workshop).toBeDefined();
    expect(installFoundedCivicGrowth(plan, hero, growthAt(4)).fixtures.find(piece => piece.id === workshop!.id)).toEqual(workshop);
    expect(mature.civicUnavailable.map(item => item.place)).toEqual(['forge']);
    const world = compileFoundedScene(mature.scene);
    const { sites } = planFoundedCivicSites(plan, native), bridge = sites.find(site => site.place === 'bridge')!, tavern = sites.find(site => site.place === 'tavern')!;
    for (const x of [1, 4, 9, 14, 17]) {
      const top = Math.max(...Array.from({ length: 7 }, (_, i) => humpbackDeckTop(Math.floor(x * 8) - 3 + i, bridge.bridge!.water, bridge.bridge!.bank)));
      const feet = transformCardinalPoint(bridge.position, bridge.rotation, [x, top / 8, 2]);
      expect(standingClear(world, feet), `bridge standing at ${x}m`).toBe(true);
    }
    for (const z of [1, 2, 2.875]) expect(standingClear(world, transformCardinalPoint(tavern.position, tavern.rotation, [4, .375, z])), `tavern entrance ${z}`).toBe(true);
    const footings = mature.scene.placements.filter(piece => piece.id.startsWith('civic:site:v1:bridge:footing:'));
    expect(footings).toHaveLength(2);
    for (const footing of footings) {
      const blueprint = mature.scene.assets.find(asset => asset.assetHash === footing.assetHash)!.blueprint;
      const top = footing.position[1] + blueprint.size[1] / 8;
      expect(top).toBe(bridge.position[1]);
    }
  }, 30_000);

  it('invalidates the provider geometry cache on civic-only growth and retains geometry on a repeated snapshot', async () => {
    const revisions = new Map<string, number>();
    const store: FoundedWorldStore = {
      native: async () => native,
      revision: async (_kingdom, digest) => {
        if (!revisions.has(digest)) revisions.set(digest, revisions.size + 1);
        return revisions.get(digest)!;
      },
      put: async () => undefined,
    };
    const source = { origin: 'simulated' as const, currentLayout: async () => ({ revision: plan.revision, foundedAt: 1, adoptedAt: 1 }), layoutPlan: async () => plan };
    const loader = createFoundedWorldLoader(source, store), empty = createRealmState(kingdomId, 'simulated');
    const first = await loader.load(kingdomId, empty), grownState = { ...empty, growth: growthAt(4) };
    const grown = await loader.load(kingdomId, grownState);
    expect(grown.scene.collisionRevision).not.toBe(first.scene.collisionRevision);
    expect(grown.build.geometryDigest).not.toBe(first.build.geometryDigest);
    expect(grown.scene.placements.filter(piece => piece.plotId)).toEqual(first.scene.placements.filter(piece => piece.plotId));
    expect(await loader.load(kingdomId, { ...grownState, sequence: 1 })).toBe(grown);
  }, 60_000);

  it('retains supplied levels beyond authored four and reports occupied sites without taking the accepted kingdom down', () => {
    const forms = installFoundedCivicGrowth(plan, native, growthAt(9)).fixtures.filter(piece => piece.id.startsWith('civic:growth:v1:'));
    expect(forms.every(piece => piece.blueprint.id.endsWith('-9'))).toBe(true);
    const reservation = plan.reservations[0]!;
    const blocked = { ...plan, revision: `${plan.revision}:blocked`, reservations: [{ ...reservation, lot: { ...reservation.lot, ...plan.bounds } }] };
    expect(planFoundedCivicSites(blocked, { ...native, revision: blocked.revision }).unavailable.map(item => item.place).sort()).toEqual(['bridge', 'castle-court', 'forge', 'market', 'tavern']);
  });
});
