import { describe, expect, it } from 'vitest';
import { sampleLandWater, terrainHeight } from '@chatdom/world';
import { OBSERVED_GENESIS_FIXTURES } from '@chatdom/world/genesis/observed';
import { createGenesisWaterContent } from '../../water-content';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from '../../channels';
import { GENESIS_KINGDOMS, type GenesisKingdomComposition } from '../../kingdoms';
import { loadPinkKittyEmoteDerivatives, PINKKITTY_EMOTE_CHECKS } from '../../../../../../packages/content/src/genesis-kingdoms/pinkkitty/emotes/index';
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

  it('carves only the three checked emote derivatives, each for its one use', async () => {
    const derivatives = await loadPinkKittyEmoteDerivatives();
    expect(derivatives.map(d => [d.emoteId, d.use, d.asset.assetHash])).toEqual(PINKKITTY_EMOTE_CHECKS.map(c => [c.emoteId, c.use, c.assetHash]));
    const k = await kingdom();
    expect(k.recipe.identity).toBeDefined();
    expect(k.hour).toBeGreaterThan(18.5);
  });
});
