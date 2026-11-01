import { describe, expect, it } from 'vitest';
import { terrainHeight, samplePublicGround } from '@chatdom/world';
import { compileChannelGenesis, compileGenesisSettlement, sampleGenesisSurface } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES } from '@chatdom/world/genesis/observed';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from '../../channels';
import { genesisKingdomComposer } from '../../kingdom-composer';
import { findHarbourSite, withHarbourPrecinct } from './harbour-plan';

const channel = GENESIS_CHANNELS.find(item => item.id === '63920635')!;
const recipe = compileChannelGenesis({ ...OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === '63920635')!, profileColours: [...channel.palette],
  evidence: { kind: 'observed', sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT) } });
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
