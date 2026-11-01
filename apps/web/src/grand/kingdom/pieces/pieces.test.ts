import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { validateFoundedScene } from '@chatdom/world/founded-scene';
import { terrainHeight } from '@chatdom/world';
import { placeSettlementContent } from '../../../kingdom/settlement-content';
import { foundedKingdomContent, loadGrandKingdomContent, placeHomes, type GrandKingdomContent } from './index';

const FIXTURE = new URL('../../../../../realm/src/founded/artifacts/simulated-town.scene.json', import.meta.url);
// Composition is the slow part (seconds per kingdom); every check below reuses one composed kingdom.
const SLOW = 120_000;

function checkContent(content: GrandKingdomContent) {
  const { plan, pieces } = content;
  expect(pieces.length).toBeGreaterThan(0);
  expect(new Set(pieces.map(piece => piece.id)).size, 'piece ids are unique').toBe(pieces.length);
  const homes = pieces.filter(piece => piece.role === 'home');
  const slots = homes.map(home => home.slot);
  expect(new Set(slots).size, 'home slots are unique').toBe(homes.length);
  expect([...slots].sort((a, b) => a! - b!)).toEqual(plan.homes.map(home => home.slot).sort((a, b) => a - b));
  expect(pieces.every(piece => piece.role === 'home' || piece.slot === undefined)).toBe(true);
  for (const piece of pieces) expect([...piece.position, piece.yaw].every(Number.isFinite), piece.id).toBe(true);
  // One schema check per distinct blueprint object; many placements share one.
  const checked = new Set<VoxelBlueprint>();
  for (const { blueprint, id } of pieces) {
    if (checked.has(blueprint)) continue;
    checked.add(blueprint);
    expect(VoxelBlueprintSchema.safeParse(blueprint).success, `${id} (${blueprint.id})`).toBe(true);
  }
  expect(content.houses.filter(house => house.slot !== 65534)).toHaveLength(plan.homes.length);
  expect(content.beaconPosition?.every(Number.isFinite)).toBe(true);
}

describe('grand kingdom pieces', () => {
  it('installs the founded fixture exactly: one home per plot, placements unchanged', async () => {
    const scene = await validateFoundedScene(JSON.parse(await readFile(FIXTURE, 'utf8')));
    const content = foundedKingdomContent(scene, { name: 'SIMULATED town', login: 'simulated' });
    checkContent(content);
    expect(content.evidence).toBe('simulated');
    expect(content.pieces).toHaveLength(scene.placements.length);
    const byId = new Map(content.pieces.map(piece => [piece.placementId, piece]));
    const homes = content.pieces.filter(piece => piece.role === 'home');
    expect(homes).toHaveLength(scene.plan.homes.length);
    for (const plot of scene.plan.homes) {
      const placement = scene.placements.find(p => p.plotId === plot.id && p.id === `home:${plot.id}`)!;
      const piece = byId.get(placement.id)!;
      expect(piece.role).toBe('home');
      expect(piece.slot).toBe(plot.slot);
      expect(piece.position).toEqual(placement.position);
      expect(piece.yaw).toBe(placement.rotation * Math.PI / 2);
      expect(piece.assetHash).toBe(placement.assetHash);
    }
    for (const placement of scene.placements) {
      const piece = byId.get(placement.id)!;
      expect(piece.position).toEqual(placement.position);
      expect(piece.yaw).toBe(placement.rotation * Math.PI / 2);
    }
    expect(content.pieces.filter(piece => piece.role === 'castle')).toHaveLength(scene.plan.castle.modules.length);
  }, SLOW);

  it('founds tobi4s_’s Willowmere through the realm pipeline, labelled SIMULATED', async () => {
    const content = await loadGrandKingdomContent('tobi4s_');
    checkContent(content);
    expect(content).toMatchObject({ kingdomId: '129634568', name: 'Willowmere', evidence: 'simulated', recipe: null });
    expect(content.founded?.origin).toBe('simulated');
    // The founding config, or the view's town default when today's generator refuses eight quarters.
    expect(content.plan.config).toMatchObject({ seed: 'tobi4s_', tier: 'town', year: 2026 });
    expect([2019, 2022]).toContain(content.plan.config.firstYear);
    expect(content.pieces.filter(piece => piece.role === 'civic').length).toBeGreaterThan(0);
  }, SLOW);

  it.each([
    ['the_aggman', '63920635', 'The_AGGman'],
    ['pinkkittyrose', '4363967', 'PinkKittyRose'],
    ['mashad4', '154972160', 'MashaD4'],
  ])('composes %s’s potential kingdom with its own seat', async (login, kingdomId, name) => {
    const content = await loadGrandKingdomContent(login);
    checkContent(content);
    expect(content).toMatchObject({ kingdomId, name, login, evidence: 'potential', founded: null });
    expect(content.recipe).not.toBeNull();
    expect(content.landscape).not.toBeNull();
    for (const role of ['castle', 'civic', 'tree', 'seat'] as const) expect(content.pieces.some(piece => piece.role === role), role).toBe(true);
    // Homes keep their plot's exact frame.
    const plots = new Map(content.plan.homes.map(home => [`home:${home.id}`, home]));
    for (const home of content.pieces.filter(piece => piece.role === 'home')) expect(home.yaw).toBe(plots.get(home.id)!.rotation * Math.PI / 2);
    // The shared-bytes placement is the kingdom view's own placement, value for value.
    if (login !== 'mashad4') {
      const ground = (x: number, z: number) => terrainHeight(content.plan, x, z);
      const ours = placeHomes(content.plan.homes, ground), theirs = placeSettlementContent(content.plan.homes, ground);
      expect(ours.houses).toEqual(theirs.houses.map(({ slot, blueprint, position, yaw }) => ({ slot, blueprint, position, yaw })));
      expect(ours.props).toEqual(theirs.props);
    }
  }, SLOW);
});
