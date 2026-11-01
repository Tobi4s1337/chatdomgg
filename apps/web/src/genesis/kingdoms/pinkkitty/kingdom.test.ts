import { describe, expect, it } from 'vitest';
import { sampleLandWater, terrainHeight } from '@chatdom/world';
import { OBSERVED_GENESIS_FIXTURES } from '@chatdom/world/genesis/observed';
import { createGenesisWaterContent } from '../../water-content';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from '../../channels';
import { GENESIS_KINGDOMS, type GenesisKingdomComposition } from '../../kingdoms';
import { loadPinkKittyEmoteDerivatives, PINKKITTY_EMOTE_CHECKS } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/emotes/index';
import { LANTERN_AND_OAR } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/tavern/index';
import { composeGenesisKingdom } from './index';

const channel = GENESIS_CHANNELS.find(item => item.id === '4363967')!;
const observed = OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === '4363967')!;
const facts = { ...observed, profileColours: [...channel.palette], evidence: {
  kind: 'observed' as const, sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT),
} };
let composed: Promise<GenesisKingdomComposition> | undefined;
const kingdom = () => composed ??= composeGenesisKingdom({ facts, character: 'river-valley' });
const kinds = (k: GenesisKingdomComposition, pattern: RegExp) => k.seat!.props.filter(prop => pattern.test(prop.blueprint.id));

describe('PinkKittyRose, a river town of its own', () => {
  it('is registered for its own broadcaster and refuses any other land', async () => {
    expect(GENESIS_KINGDOMS['4363967']).toBeTypeOf('function');
    await expect(composeGenesisKingdom({ facts, character: 'coastal-harbour' })).rejects.toThrow();
  });

  it('reserves its true size, 160 homes, the same way every time', async () => {
    const k = await kingdom(), again = await composeGenesisKingdom({ facts, character: 'river-valley' });
    expect(k.plan.homes).toHaveLength(160);
    expect(k.plan.config.tier).toBe('town');
    expect(again.plan.revision).toBe(k.plan.revision);
    expect(k.plan.revision).toMatch(/^genesis-river-town:1:/);
    expect(new Set(k.plan.homes.map(home => home.slot)).size).toBe(160);
    expect(k.plan.quarters).toHaveLength(3);
  });

  it('keeps every lot dry, apart and inside the horizon footprint', async () => {
    const k = await kingdom(), land = k.plan.genesisSurface!.terrainCore;
    const lots = k.plan.homes.map(home => home.lot);
    for (const [i, a] of lots.entries()) {
      for (const [x, z] of [[a.minX, a.minZ], [a.maxX, a.minZ], [a.minX, a.maxZ], [a.maxX, a.maxZ]] as const) {
        const water = sampleLandWater(land as never, x, z);
        expect(!water || water.shoreDistance >= 0, `lot ${i} corner is in water`).toBe(true);
      }
      for (const b of lots.slice(i + 1)) expect(a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ).toBe(false);
    }
    const { minX, maxX, minZ, maxZ } = k.plan.bounds;
    expect(Math.ceil(maxX / 16) * 16 - Math.floor(minX / 16) * 16).toBeLessThanOrEqual(512);
    expect(Math.ceil(maxZ / 16) * 16 - Math.floor(minZ / 16) * 16).toBeLessThanOrEqual(512);
  });

  it('joins every home and the castle gate to the square through the street graph', async () => {
    const k = await kingdom(), links = new Map<string, string[]>(), ids = new Set(k.plan.nodes.map(node => node.id));
    for (const street of k.plan.streets) {
      expect(ids.has(street.from) && ids.has(street.to) && street.from !== street.to, street.id).toBe(true);
      links.set(street.from, [...links.get(street.from) ?? [], street.to]);
      links.set(street.to, [...links.get(street.to) ?? [], street.from]);
    }
    const seen = new Set(['market']), queue = ['market'];
    while (queue.length) for (const next of links.get(queue.pop()!) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    expect(seen.has(k.plan.castle.gateNodeId)).toBe(true);
    for (const home of k.plan.homes) expect(seen.has(`${home.id}:front`), `${home.id} is cut off`).toBe(true);
  });

  it('raises the hall, its landing, the screen, the arms, the statue, the vane and the riverside', async () => {
    const k = await kingdom(), seat = k.seat!;
    expect(kinds(k, /river-hall/).length).toBeGreaterThan(0);
    expect(kinds(k, /^genesis-pinkkitty-landing-r40-w96$/)).toHaveLength(1);
    expect(kinds(k, /glass-screen|screen/).length).toBeGreaterThan(0);
    expect(kinds(k, /cresset/).length).toBeGreaterThanOrEqual(3);
    expect(kinds(k, /rose-arch|arch/).length).toBeGreaterThanOrEqual(2);
    expect(kinds(k, /planter/).length).toBeGreaterThanOrEqual(4);
    expect(seat.crossing).toBe(true);
    // Every flame the seat lights burns on a piece it raised: none stands in for a person.
    expect(seat.braziers.length).toBeGreaterThanOrEqual(8);
    for (const brazier of seat.braziers) expect(brazier.position.every(Number.isFinite)).toBe(true);
  });

  it('sets its dressing clear of every home lot', async () => {
    const k = await kingdom(), lots = k.plan.homes.map(home => home.lot);
    for (const prop of kinds(k, /cresset|rose|planter|landing|screen/)) {
      const [x, , z] = prop.position;
      for (const lot of lots) expect(x > lot.minX + .01 && x < lot.maxX - .01 && z > lot.minZ + .01 && z < lot.maxZ - .01, `${prop.blueprint.id} inside a lot`).toBe(false);
    }
  });

  it('stands the hall and the landing on their bank, with the generic footbridge standing aside', async () => {
    const k = await kingdom();
    const landing = kinds(k, /landing/)[0]!;
    // The landing's y = 0 lies a metre below the square; the square is graded to its own level.
    const market = k.plan.nodes.find(node => node.id === 'market')!;
    expect(landing.position[1]).toBeCloseTo(k.plan.market.elevation - 1, 5);
    expect(terrainHeight(k.plan, market.position[0], market.position[2])).toBeCloseTo(k.plan.market.elevation, 5);
    expect(createGenesisWaterContent(k.plan, { crossing: true }).some(prop => /bridge/.test(prop.blueprint.id))).toBe(false);
  });

  it('gives the recipe’s keepers the places the town built, with work at dusk and never a presence', async () => {
    const k = await kingdom(), keepers = k.keepers!;
    expect(keepers.map(item => item.proposal.keeper)).toEqual(k.recipe.soul.keepers.filter(keeper => keepers.some(item => item.proposal.keeper.placeId === keeper.placeId)));
    expect(keepers.map(item => item.proposal.keeper.placeId).sort()).toEqual(['plaza', 'tavern']);
    for (const { proposal, site, round } of keepers) {
      expect(proposal.presence).toEqual({ carriesPresenceLight: false, counted: false, twitchChat: 'never', citizen: false });
      expect(site.provenance).toBe('host');
      expect(round.label).toBeNull();
      expect(round.missing, `${proposal.keeper.role} lacks fixtures`).toEqual([]);
      expect(round.outOfBounds).toEqual([]);
      expect(round.visits.length, `${proposal.keeper.role} has no work at ${k.hour}`).toBeGreaterThan(0);
      // Every visit stands on the town's own ground, or at the inn on its own floor on the levee, clear of the water.
      const inn = kinds(k, /^genesis-pinkkitty-tavern-lantern-and-oar$/)[0]!, floor = inn.position[1] + LANTERN_AND_OAR.ground * .125;
      for (const visit of round.visits) {
        const ground = terrainHeight(k.plan, visit.position[0], visit.position[2]);
        if (proposal.place.id === 'tavern') {
          expect(visit.position[1], visit.fixtureId).toBeCloseTo(floor, 3);
          expect(visit.position[1], visit.fixtureId).toBeGreaterThan(ground - .05);
        } else expect(Math.abs(visit.position[1] - ground), visit.fixtureId).toBeLessThan(1.1);
        const water = sampleLandWater(k.plan.genesisSurface!.terrainCore as never, visit.position[0], visit.position[2]);
        expect(!water || water.shoreDistance >= 0, `${visit.fixtureId} stands in water`).toBe(true);
      }
    }
    // The court's lamps are dark glass: a lamp in an unfounded town never burns for a person who is not there.
    const lamps = kinds(k, /^keeper-lamp-post/);
    expect(lamps.length).toBeGreaterThanOrEqual(4);
    for (const lamp of lamps) for (const brazier of k.seat!.braziers) expect(Math.hypot(brazier.position[0] - lamp.position[0], brazier.position[2] - lamp.position[2])).toBeGreaterThan(1.5);
  });

  it('stands The Lantern and Oar on the levee, its steps down to the meadow and its path to a lane, clear of every street and lot', async () => {
    const k = await kingdom(), inn = kinds(k, /^genesis-pinkkitty-tavern-lantern-and-oar$/), steps = kinds(k, /^genesis-pinkkitty-tavern-steps-\d+-[we]$/);
    expect(inn).toHaveLength(1);
    expect(steps).toHaveLength(1);
    const approach = k.plan.streets.find(street => street.id === 'pk:tavern:approach')!;
    expect(approach).toBeDefined();
    // The path starts at the steps' foot on the meadow, not in the air before a door four metres up, and the foot's
    // paving meets the graded ground there within a riser.
    const [start] = approach.points, inn0 = inn[0]!, floor = inn0.position[1] + LANTERN_AND_OAR.ground * .125;
    expect(floor - start![1]).toBeGreaterThan(1);
    const rise = Number(/steps-(\d+)-/.exec(steps[0]!.blueprint.id)![1]), foot = floor - rise * .125;
    const end = k.seat!.props.find(prop => prop.blueprint.id === steps[0]!.blueprint.id)!;
    const reach = (10 + rise / 2 * 4 + 8) * .125, toward = /-w$/.test(end.blueprint.id) ? -1 : 1;
    // The inn is turned a quarter: its −X end lies at world +Z.
    const door = [inn0.position[0], inn0.position[2] - 70 * .125] as const;
    const [fx, fz] = [start![0], door[1] - toward * reach];
    expect(Math.abs(foot - terrainHeight(k.plan, fx, fz)), 'foot paving to ground').toBeLessThan(.3);
    // No other street runs through the inn or its steps, and no home lot touches them.
    const rect = (prop: (typeof inn)[number]) => {
      const turn = Math.round(prop.yaw / (Math.PI / 2)) & 3, [sx, , sz] = prop.blueprint.size, w = sx * .125, d = sz * .125;
      const [x, , z] = prop.position;
      // A quarter turn carries local (x, z) to world (z, -x).
      return turn === 1 ? { minX: x, maxX: x + d, minZ: z - w, maxZ: z } : { minX: x, maxX: x + w, minZ: z, maxZ: z + d };
    };
    for (const piece of [...inn, ...steps]) {
      const r = rect(piece);
      for (const street of k.plan.streets) {
        if (street.id === 'pk:tavern:approach') continue;
        for (const p of street.points) expect(p[0] > r.minX - street.width / 2 && p[0] < r.maxX + street.width / 2 && p[2] > r.minZ - street.width / 2 && p[2] < r.maxZ + street.width / 2, `${street.id} crosses ${piece.blueprint.id}`).toBe(false);
      }
      for (const home of k.plan.homes) expect(home.lot.minX < r.maxX && r.minX < home.lot.maxX && home.lot.minZ < r.maxZ && r.minZ < home.lot.maxZ, `${home.id} on ${piece.blueprint.id}`).toBe(false);
    }
  });

  it('carves only the three checked emote derivatives, each for its one use', async () => {
    const derivatives = await loadPinkKittyEmoteDerivatives();
    expect(derivatives.map(d => [d.emoteId, d.use, d.asset.assetHash])).toEqual(PINKKITTY_EMOTE_CHECKS.map(c => [c.emoteId, c.use, c.assetHash]));
    const k = await kingdom();
    expect(k.recipe.identity).toBeDefined();
    expect(k.hour).toBeGreaterThan(18.5);
  });
});
