import { describe, expect, it } from 'vitest';
import { terrainHeight, samplePublicGround } from '@chatdom/world';
import { compileChannelGenesis, compileGenesisSettlement, sampleGenesisSurface } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES } from '@chatdom/world/genesis/observed';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from '../../channels';
import { genesisKingdomComposer } from '../../kingdom-composer';
import { findHarbourSite, withHarbourPrecinct } from './harbour-plan';
import { createGenesisWaterContent } from '../../water-content';
import { composeAggman, composeGenesisKingdom, withApprovedEmoteWorks } from './index';
import { aggmanApprovedEmotes, loadAggmanEmoteDerivatives } from './content';
import type { Dressing } from '../../../kingdom/settlement-content';
import { createGenesisSeatContent } from '../../seat-content';

const channel = GENESIS_CHANNELS.find(item => item.id === '63920635')!;
const facts = { ...OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === '63920635')!, profileColours: [...channel.palette],
  evidence: { kind: 'observed' as const, sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT) } };
const recipe = compileChannelGenesis(facts);
const landscape = recipe.landscapes.find(item => item.character === 'coastal-harbour')!;
const proposed = compileGenesisSettlement(recipe, landscape.id);
const site = findHarbourSite(proposed);
const plan = withHarbourPrecinct(proposed, site);

describe('The_AGGman harbour precinct', () => {
  it('keeps every proposed home, street and node exactly and only adds public ground', () => {
    expect(plan.homes).toBe(proposed.homes);
    expect(plan.reservations).toBe(proposed.reservations);
    expect(plan.streets.slice(0, proposed.streets.length)).toEqual(proposed.streets);
    expect(plan.nodes.slice(0, proposed.nodes.length)).toEqual(proposed.nodes);
    const added = plan.streets.slice(proposed.streets.length);
    expect(added.map(street => street.id)).toEqual(['aggman:harbour-lane', 'aggman:quay', 'aggman:inn:pad']);
    for (const street of added) expect(plan.activeStreetIds).toContain(street.id);
    expect(plan.revision).not.toBe(proposed.revision);
  });

  it('lays the lane and quay on dry ground, clear of the sea, at walkable grades', () => {
    const land = plan.genesisSurface!;
    for (const street of plan.streets.slice(proposed.streets.length)) {
      for (let i = 0; i < street.points.length; i++) {
        const [x, , z] = street.points[i]!;
        const surface = sampleGenesisSurface(land, x, z);
        expect(surface.water, `${street.id} point ${i}`).toBeNull();
        expect(surface.shoreDistance).toBeGreaterThan(4);
        if (i) {
          const [px, py, pz] = street.points[i - 1]!;
          expect(Math.abs(street.points[i]![1] - py) / Math.max(.01, Math.hypot(x - px, z - pz))).toBeLessThan(.14);
        }
      }
    }
    // The paving the scene draws is where the precinct says it is.
    expect(samplePublicGround(plan, site.market[0], site.quay.z)?.pavingDistance).toBeLessThanOrEqual(0);
    expect(samplePublicGround(plan, site.market[0], (site.quay.z + site.market[2]) / 2)?.pavingDistance).toBeLessThanOrEqual(0);
    // The inn's front sits level with the quay; its back kitchen wall (1.25 m inside the pad's back edge) is cut no
    // deeper than a course of its 3.5 m stone ground floor into the slope, and never floats above it.
    const pad = site.innPad;
    for (const x of [pad.minX, pad.maxX]) {
      expect(Math.abs(terrainHeight(plan, x, pad.minZ) - pad.level)).toBeLessThan(.05);
      expect(terrainHeight(plan, x, pad.maxZ - 1.25) - pad.level).toBeGreaterThanOrEqual(-.05);
      expect(terrainHeight(plan, x, pad.maxZ - 1.25) - pad.level).toBeLessThan(.5);
    }
  });

  it('composes the same seat every time, through the shared registry', () => {
    const composer = genesisKingdomComposer('63920635')!;
    expect(composer).toBeDefined();
    const a = composer.compose({ recipe, landscape, plan: proposed }), b = composer.compose({ recipe, landscape, plan: proposed });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.plan!.revision).toBe(plan.revision);
    expect(a.seat!.buildings.some(item => item.id === proposed.castle.beaconModuleId)).toBe(true);
    for (const item of [...a.seat!.props, ...a.seat!.buildings]) for (const value of item.position) expect(Number.isFinite(value)).toBe(true);
    for (const brazier of a.seat!.braziers) for (const value of brazier.position) expect(Number.isFinite(value)).toBe(true);
    const ids = new Set(a.seat!.props.map(item => item.blueprint.id));
    expect([...ids].some(id => id.startsWith('genesis-aggman-quay-'))).toBe(true);
    expect([...ids].some(id => id.startsWith('genesis-standard-'))).toBe(true);
    expect([...ids].some(id => id.startsWith('genesis-crest-'))).toBe(true);
  }, 30_000);

  it('leaves the other Genesis channels to their own composition', () => {
    expect(genesisKingdomComposer('4363967')?.broadcasterId ?? null).not.toBe('63920635');
  });
});

/** World-space box of a placed blueprint turned by whole quarter turns about its origin. */
function bounds(item: Dressing): { min: [number, number, number]; max: [number, number, number] } {
  const [sx, sy, sz] = item.blueprint.size.map(v => v * .125) as [number, number, number];
  const turn = ((Math.round(item.yaw / (Math.PI / 2)) % 4) + 4) % 4, [ox, oy, oz] = item.position;
  const corners = [[0, 0], [sx, 0], [0, sz], [sx, sz]].map(([x, z]) => turn === 0 ? [x!, z!] : turn === 1 ? [z!, -x!] : turn === 2 ? [-x!, -z!] : [-z!, x!]);
  const xs = corners.map(c => ox + c[0]!), zs = corners.map(c => oz + c[1]!);
  return { min: [Math.min(...xs), oy, Math.min(...zs)], max: [Math.max(...xs), oy + sy, Math.max(...zs)] };
}

describe('The_AGGman as a kingdom of its own', () => {
  it('reads the channel’s checked emotes exactly as the recipe compiler does', () => {
    const own = compileChannelGenesis({ ...facts, approvedEmotes: aggmanApprovedEmotes() });
    expect(withApprovedEmoteWorks(recipe).identity.emoteWorks).toEqual(own.identity.emoteWorks);
    expect(own.identity.emoteWorks.map(work => work.use).sort()).toEqual(['stained-glass', 'statue', 'weathervane']);
  });

  it('raises the statue, the window and the vane only from checked derivatives', async () => {
    const derivatives = await loadAggmanEmoteDerivatives();
    const own = withApprovedEmoteWorks(recipe);
    const with_ = composeAggman(own, landscape, proposed, derivatives);
    expect(with_.emoteArt.absences).toEqual([]);
    expect(with_.emoteArt.glass.kind).toBe('emote');
    const ids = (k: typeof with_) => new Set(k.seat.props.map(item => item.blueprint.id));
    expect(ids(with_).has(with_.emoteArt.monument!.frames[0]!.blueprint.id)).toBe(true);
    expect(ids(with_).has(with_.emoteArt.vane!.rotor.id)).toBe(true);
    // Without the derivatives: no statue, no vane, and the lancet keeps plain leaded lights.
    const without = composeAggman(own, landscape, proposed, []);
    expect(without.emoteArt.monument).toBeNull();
    expect(without.emoteArt.vane).toBeNull();
    expect(without.emoteArt.glass.kind).toBe('plain');
    expect(without.seat.props.length).toBe(with_.seat.props.length - 3);
  }, 60_000);

  it('places the inn, the light, the gear, the boats and the geese without two pieces in one place', async () => {
    const k = composeAggman(withApprovedEmoteWorks(recipe), landscape, proposed, await loadAggmanEmoteDerivatives());
    const quay = new Set(k.seat.props.filter(item => item.blueprint.id.startsWith('genesis-aggman-quay-')));
    // Pennant and bunting cloth flies overhead; their posts are set clear by hand and checked below.
    const overhead = (item: Dressing) => /pennant|bunting/.test(item.blueprint.id);
    const nested = (a: Dressing, b: Dressing) => overhead(a) || overhead(b) || [a, b].some(item => /glass|vane|emote/.test(item.blueprint.id)) && [a, b].some(item => item.blueprint.id.startsWith('genesis-aggman-last-lantern'));
    const shared = new Set(createGenesisSeatContent(recipe, landscape, plan)!.props.map(item => item.blueprint.id));
    const ours = k.seat.props.filter(item => !shared.has(item.blueprint.id) && !quay.has(item));
    const water = createGenesisWaterContent(k.plan).filter(item => item.blueprint.id.startsWith('water-pier'));
    const shrink = (b: ReturnType<typeof bounds>) => ({ min: b.min.map(v => v + .05), max: b.max.map(v => v - .05) });
    const clash: string[] = [];
    const all: Dressing[] = [...ours, ...water.map(item => ({ blueprint: item.blueprint, position: item.position, yaw: item.yaw }))];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!, b = all[j]!;
      if (nested(a, b) || (water.some(w => w.blueprint === a.blueprint) && water.some(w => w.blueprint === b.blueprint))) continue;
      const A = shrink(bounds(a)), B = shrink(bounds(b));
      if ([0, 1, 2].every(axis => A.min[axis]! < B.max[axis]! && B.min[axis]! < A.max[axis]!)) clash.push(`${a.blueprint.id} × ${b.blueprint.id}`);
    }
    expect(clash).toEqual([]);
    const names = ours.map(item => item.blueprint.id);
    for (const piece of ['genesis-aggman-harbour-inn', 'genesis-aggman-last-lantern', 'genesis-aggman-harbour-coble', 'genesis-aggman-goose-gaggle', 'genesis-aggman-fish-stall'])
      expect(names.some(name => name.startsWith(piece)), piece).toBe(true);
  }, 60_000);

  it('floats its boats and swimming geese on the sea and stands the rest on dry ground', async () => {
    const k = composeAggman(withApprovedEmoteWorks(recipe), landscape, proposed, await loadAggmanEmoteDerivatives());
    for (const item of k.seat.props.filter(p => /coble|rowing-boat|goose-swimming/.test(p.blueprint.id))) {
      const b = bounds(item);
      for (const [x, z] of [[b.min[0], b.min[2]], [b.max[0], b.max[2]], [b.min[0], b.max[2]], [b.max[0], b.min[2]]])
        expect(sampleGenesisSurface(k.plan.genesisSurface!, x!, z!).water, item.blueprint.id).toBe('ocean');
    }
    for (const item of k.seat.props.filter(p => /drawn-up|gaggle|goose-family|harbour-inn|last-lantern/.test(p.blueprint.id))) {
      const b = bounds(item), centre = [(b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2] as const;
      expect(sampleGenesisSurface(k.plan.genesisSurface!, centre[0], centre[1]).water, item.blueprint.id).toBeNull();
    }
  }, 60_000);

  it('gives Rowan the inn door and Brindle the quay lamps, lit as fire and never as people', async () => {
    const k = composeAggman(withApprovedEmoteWorks(recipe), landscape, proposed, await loadAggmanEmoteDerivatives());
    const rowan = k.keepers.find(keeper => keeper.proposal.keeper.role === 'innkeeper')!;
    const brindle = k.keepers.find(keeper => keeper.proposal.keeper.role === 'lamplighter')!;
    expect(rowan.proposal.keeper.name).toBe('Rowan');
    expect(rowan.site.fixtures.map(f => f.kind)).toEqual(['door']);
    expect(rowan.round.missing).toEqual([]);
    expect(brindle.site.fixtures.filter(f => f.kind === 'lamp').length).toBeGreaterThanOrEqual(5);
    expect(brindle.round.missing).toEqual([]);
    expect(brindle.round.visits.length).toBeGreaterThan(0);
    for (const keeper of k.keepers) {
      expect(keeper.proposal.keeper.carriesPresenceLight).toBe(false);
      expect(keeper.round.label).toBeNull();
      expect(keeper.site.provenance).toBe('host');
    }
    expect(k.hour).toBeGreaterThan(19);
    expect(k.lore).toBe(channel.lore);
    expect(k.sound.landscapeId).toBe(landscape.id);
  }, 60_000);

  it('opens as its own kingdom from the channel’s facts through the per-kingdom registry', async () => {
    const own = await composeGenesisKingdom({ facts, character: 'coastal-harbour' });
    expect(own.recipe.identity.emoteWorks.length).toBe(3);
    expect(own.plan.revision).toBe(plan.revision);
    expect(own.hour).toBe(19.6);
    await expect(composeGenesisKingdom({ facts, character: 'river-valley' })).rejects.toThrow();
  }, 60_000);
});

