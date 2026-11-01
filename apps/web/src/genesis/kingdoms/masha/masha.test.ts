import { describe, expect, it } from 'vitest';
import { compileChannelGenesis, sampleGenesisSurface } from '@chatdom/world/genesis';
import { OBSERVED_GENESIS_FIXTURES, OBSERVED_GENESIS_SHOWCASE_CHOICES } from '@chatdom/world/genesis/observed';
import { GENESIS_CHANNELS, PROFILE_CAPTURED_AT } from '../../channels';
import { composeMashaKingdom, MASHA_ID } from '.';
import { MASHA_LAND, mashaFrame } from './land';
import { compileMashaCity } from './city';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { terrainHeight, transformCardinalPoint, type CardinalTurn } from '@chatdom/world';
import type { LandmarkPiece } from '@chatdom/content/genesis-landmarks';
import { describeGenesisSoundscape } from '../../../../../../packages/audio/src/genesis-biomes';

function compose() {
  const channel = GENESIS_CHANNELS.find(item => item.id === MASHA_ID)!;
  const observed = OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId === MASHA_ID)!;
  const choice = OBSERVED_GENESIS_SHOWCASE_CHOICES.find(item => item.broadcasterId === MASHA_ID)!;
  const recipe = compileChannelGenesis({ ...observed, profileColours: [...channel.palette], evidence: {
    kind: 'observed', sourceId: 'atlas-20261030-helix-20261031', asOf: Date.parse(PROFILE_CAPTURED_AT) } });
  const selected = recipe.landscapes.find(item => item.character === choice.character)!;
  return { recipe, selected, kingdom: composeMashaKingdom(recipe, selected) };
}

const { recipe, selected, kingdom } = compose();
const { plan, landscape } = kingdom;
const ground = (x: number, z: number) => sampleGenesisSurface(landscape, x, z);

describe("MashaD4's kingdom", () => {
  it('composes the same city from the same seed', () => {
    expect(selected.character).toBe('mountain-pass');
    expect(compose().kingdom.plan.revision).toBe(plan.revision);
    expect(plan.revision).toMatch(/^masha-city:1:[0-9a-f]+$/);
  });

  it('belongs to MashaD4 alone', () => {
    const other = OBSERVED_GENESIS_FIXTURES.find(item => item.broadcasterId !== MASHA_ID)!;
    const foreign = compileChannelGenesis({ ...other, profileColours: ['#808080'], evidence: { kind: 'observed', sourceId: 'test', asOf: 0 } });
    expect(() => composeMashaKingdom(foreign, foreign.landscapes[0]!)).toThrow(/MashaD4/);
  });

  it('reserves its true size: 512 homes in eight wards, earliest addresses under the keep', () => {
    expect(recipe.size.homeCapacity).toBe(512);
    expect(plan.homes).toHaveLength(512);
    expect(plan.reservations).toHaveLength(512);
    expect(plan.homes.map(home => home.slot)).toEqual([...Array(512).keys()]);
    expect(new Set(plan.homes.map(home => home.id)).size).toBe(512);
    expect(plan.quarters.map(q => q.name)).toEqual(['Old Row', 'Crown Terrace', 'Juniper Walk', 'Highstone Reach', 'Gentian Lane', 'Larch Terrace', 'Scree Walk', 'Saddle Lane']);
    for (const quarter of plan.quarters) {
      const held = plan.homes.filter(home => home.street === quarter.name).length;
      expect(held, quarter.name).toBeGreaterThanOrEqual(40);
      expect(held, quarter.name).toBeLessThanOrEqual(96);
    }
    const ring = (id: string) => Number(id.split(':')[2]);
    expect(plan.homes[0]!.street).toBe('Old Row');
    expect(ring(plan.homes[0]!.streetId)).toBe(0);
    for (let i = 1; i < plan.homes.length; i++) expect(ring(plan.homes[i]!.streetId)).toBeGreaterThanOrEqual(ring(plan.homes[i - 1]!.streetId));
    expect(plan.homes.every(home => home.style === kingdom.style)).toBe(true);
  });

  it('stands every lot on dry ground, apart from every other lot, the keep and the cathedral reserve', () => {
    const sorted = [...plan.homes].sort((a, b) => a.lot.minX - b.lot.minX);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!.lot;
      for (let j = i + 1; j < sorted.length && sorted[j]!.lot.minX < a.maxX; j++) {
        const b = sorted[j]!.lot;
        expect(a.minZ < b.maxZ && a.maxZ > b.minZ, `${sorted[i]!.id} overlaps ${sorted[j]!.id}`).toBe(false);
      }
      for (const [x, z] of [[a.minX, a.minZ], [a.maxX, a.minZ], [a.minX, a.maxZ], [a.maxX, a.maxZ]] as const) expect(ground(x, z).waterLevel, sorted[i]!.id).toBeNull();
    }
    const castle = plan.castle.bounds, reserve = plan.courts.find(court => court.id === 'masha:cathedral:reserve')!;
    const rx = reserve.boundary.map(p => p[0]), rz = reserve.boundary.map(p => p[1]);
    for (const { lot, id } of plan.homes) {
      expect(lot.minX < castle.maxX && lot.maxX > castle.minX && lot.minZ < castle.maxZ && lot.maxZ > castle.minZ, id).toBe(false);
      expect(lot.minX < Math.max(...rx) && lot.maxX > Math.min(...rx) && lot.minZ < Math.max(...rz) && lot.maxZ > Math.min(...rz), id).toBe(false);
    }
  });

  it('wires every street, home approach, ward and court to real nodes', () => {
    const nodes = new Set(plan.nodes.map(node => node.id));
    expect(nodes.size).toBe(plan.nodes.length);
    const edges = new Set(plan.streets.map(edge => edge.id));
    expect(edges.size).toBe(plan.streets.length);
    for (const edge of plan.streets) { expect(nodes.has(edge.from), edge.id).toBe(true); expect(nodes.has(edge.to), edge.id).toBe(true); }
    for (const home of plan.homes) expect(edges.has(home.approachId), home.id).toBe(true);
    const courts = new Set(plan.courts.map(court => court.id));
    for (const quarter of plan.quarters) {
      expect(nodes.has(quarter.rootNodeId)).toBe(true);
      for (const id of quarter.courtIds) expect(courts.has(id)).toBe(true);
      for (const id of quarter.growthNodeIds) expect(nodes.has(id)).toBe(true);
    }
    expect(nodes.has(plan.castle.gateNodeId)).toBe(true);
    expect(nodes.has(plan.market.nodeId)).toBe(true);
  });

  it('climbs from Bell Court up the Crown Stair to the gate, and up the Pass Road to the saddle', () => {
    const city = compileMashaCity({ ...recipe, identity: { ...recipe.identity, styleFamily: kingdom.style } }, landscape);
    for (let i = 1; i < city.stair.length; i++) expect(city.stair[i]![1]).toBeLessThanOrEqual(city.stair[i - 1]![1] + 1e-9);
    expect(city.stair[0]![1] - city.stair.at(-1)![1]).toBeGreaterThan(40);
    let length = 0;
    for (let i = 1; i < city.passRoad.length; i++) length += Math.hypot(city.passRoad[i]![0] - city.passRoad[i - 1]![0], city.passRoad[i]![2] - city.passRoad[i - 1]![2]);
    for (let i = 1; i < city.passRoad.length; i++) { const run = Math.hypot(city.passRoad[i]![0] - city.passRoad[i - 1]![0], city.passRoad[i]![2] - city.passRoad[i - 1]![2]); if (run > .5) expect((city.passRoad[i]![1] - city.passRoad[i - 1]![1]) / run).toBeLessThanOrEqual(.2); }
    expect((city.passRoad.at(-1)![1] - city.passRoad[0]![1]) / length).toBeLessThanOrEqual(.12);
    expect(city.passRoad.at(-1)![1]).toBeGreaterThan(city.keep.height + 40);
    expect(Math.hypot(city.passRoad.at(-1)![0] - city.passTerrace.centre[0], city.passRoad.at(-1)![2] - city.passTerrace.centre[2])).toBeLessThan(20);
  });

  it('raises a seamless mountain crown with the pass notched between its horns', () => {
    const frame = mashaFrame(landscape.coast.oceanToward);
    const height = (x: number, z: number) => { const p = frame.world(x, z); return ground(p[0], p[1]).ground; };
    const ridge = landscape.terrainCore.hills.filter(hill => hill.id.startsWith('ridge-'));
    expect(ridge).toHaveLength(2);
    const saddle = frame.local(landscape.mountainPass.saddle[0], landscape.mountainPass.saddle[2]);
    const horns = ridge.map(hill => height(...frame.local(hill.centre[0], hill.centre[1])));
    expect(Math.min(...horns)).toBeGreaterThan(height(...saddle) + 25);
    expect(MASHA_LAND.mount.height).toBeLessThan(height(...saddle));
    // No cliff seams: neighbouring 2 m samples never jump further than the steepest authored slope allows.
    const b = plan.bounds;
    let worst = 0;
    for (let x = b.minX; x <= b.maxX; x += 4) {
      let previous = ground(x, b.minZ).ground;
      for (let z = b.minZ + 2; z <= b.maxZ; z += 2) { const h = ground(x, z).ground; worst = Math.max(worst, Math.abs(h - previous)); previous = h; }
    }
    expect(worst).toBeLessThan(6);
  });

  it('chooses slate roofs from the channel colours and opens at dusk on the road in', () => {
    expect(kingdom.style).toBe('tide');
    expect(kingdom.hour).toBeGreaterThan(18);
    expect(kingdom.hour).toBeLessThan(20);
    expect(kingdom.camera.eye[1]).toBeGreaterThan(plan.market.elevation);
  });

  it('stands the crown tower on the levelled pass, and the cathedral site and The Copper Kettle beside Bell Court, on their own ground', () => {
    const cell = VOXEL_METRES.build;
    const grounded = (name: string, placed: { origin: Vec3; turn: CardinalTurn; piece: LandmarkPiece }) => {
      for (const footing of placed.piece.footings) {
        for (let x = footing.box.from[0]; x <= footing.box.to[0]; x += 4) for (let z = footing.box.from[2]; z <= footing.box.to[2]; z += 4) {
          const p = transformCardinalPoint(placed.origin, placed.turn, [x * cell, 0, z * cell]);
          const h = terrainHeight(plan, p[0], p[2]);
          expect(h, `${name} ${footing.id} at ${x},${z}`).toBeGreaterThanOrEqual(placed.origin[1] - cell - 1e-6);
          expect(h, `${name} ${footing.id} at ${x},${z}`).toBeLessThanOrEqual(placed.origin[1] + (footing.embed + 1) * cell + 1e-6);
        }
      }
    };
    grounded('crown tower', kingdom.seat.crownTower);
    grounded('cathedral site', kingdom.seat.cathedralSite);
    grounded('Copper Kettle', kingdom.seat.inn);
    expect(Math.abs(kingdom.seat.crownTower.origin[1] - landscape.mountainPass.saddle[1])).toBeLessThan(.25);
    // The watch fire in the pass is the kingdom's beacon, and the only fire the seat adds beyond the keep's court.
    expect(kingdom.seat.beaconPosition).toEqual(kingdom.seat.crownTower.watchFire);
    expect(kingdom.seat.beaconPosition[1]).toBeGreaterThan(landscape.mountainPass.saddle[1] + 15);
    const reserve = plan.courts.find(court => court.id === 'masha:cathedral:reserve')!;
    const market = plan.nodes.find(node => node.id === plan.market.nodeId)!.position;
    const centre = [reserve.boundary.reduce((a, p) => a + p[0], 0) / 4, reserve.boundary.reduce((a, p) => a + p[1], 0) / 4];
    expect(Math.hypot(centre[0]! - market[0], centre[1]! - market[2])).toBeLessThan(40);
    // The Copper Kettle stands on its own yard at Bell Court's corner, its door to the south like the city's homes.
    const yard = plan.courts.find(court => court.id === 'masha:inn:yard')!;
    const inn = kingdom.seat.inn;
    expect(inn.turn).toBe(mashaFrame(landscape.coast.oceanToward).turn);
    const innCentre = transformCardinalPoint(inn.origin, inn.turn, [inn.piece.blueprint.size[0] * cell / 2, 0, inn.piece.blueprint.size[2] * cell / 2]);
    const [minX, maxX] = [Math.min(...yard.boundary.map(p => p[0])), Math.max(...yard.boundary.map(p => p[0]))];
    const [minZ, maxZ] = [Math.min(...yard.boundary.map(p => p[1])), Math.max(...yard.boundary.map(p => p[1]))];
    expect(innCentre[0]).toBeGreaterThan(minX); expect(innCentre[0]).toBeLessThan(maxX);
    expect(innCentre[2]).toBeGreaterThan(minZ); expect(innCentre[2]).toBeLessThan(maxZ);
    expect(Math.hypot(innCentre[0] - market[0], innCentre[2] - market[2])).toBeLessThan(40);
    expect(kingdom.seat.props.some(prop => prop.blueprint === inn.piece.blueprint)).toBe(true);
  });

  it('composes honest emote absence, the recipe\'s own keepers and its sound on the drawn land', () => {
    expect(recipe.identity.emoteWorks).toHaveLength(0);
    expect(kingdom.emoteArt.monument).toBeNull();
    expect(kingdom.emoteArt.vane).toBeNull();
    expect(kingdom.emoteArt.absences.length).toBeGreaterThan(0);
    expect(kingdom.emoteArt.absences.every(absence => absence.reason === 'none-approved')).toBe(true);
    expect(kingdom.keepers.map(item => item.proposal.keeper.role).sort()).toEqual(['innkeeper', 'lamplighter']);
    const tansy = kingdom.keepers.find(item => item.proposal.keeper.role === 'innkeeper')!;
    expect(tansy.site).toEqual(plan.nodes.find(node => node.id === 'masha:inn')!.position);
    for (const { proposal } of kingdom.keepers) expect(proposal.presence).toEqual({ carriesPresenceLight: false, counted: false, twitchChat: 'never', citizen: false });
    const sound = describeGenesisSoundscape(kingdom.sound.recipe, kingdom.sound.landscapeId);
    expect(sound.character).toBe('mountain-pass');
    expect(sound.saddle).toEqual([...landscape.mountainPass.saddle]);
    expect(sound.shoreline).toEqual(landscape.coast.shoreline.map(p => [p[0], p[1]]));
  });
});
