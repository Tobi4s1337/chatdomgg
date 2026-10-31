import { HOME_DEPTH_METRES, type HomeTier, type Vec3 } from '@chatdom/shared';
import { seedHash } from '../layout';
import { createCastlePlan } from '../settlement/castle';
import { boundsOverlap, currentFootprint, expandBounds, homeFrame, pointBounds, rectangleDistance, SpatialIndex } from '../settlement/geometry';
import { gradeRoute } from '../settlement/routing';
import type { BoundsXZ, CardinalTurn, PlotReservation, PublicSquare, SettlementHome, SettlementPlan, SettlementQuarter, StreetEdge, StreetNode, XZ } from '../settlement/types';
import type { ChannelKingdomRecipe, DeepReadonly } from './contracts';
import { draw } from './landscape';
import { sampleGenesisSurface } from './surface';

const half = (n: number): number => Math.round(n * 2) / 2;

/** Potential buildings only: slots are technical addresses, never people, deeds or follow tenure. */
export function compileGenesisSettlement(recipe: DeepReadonly<ChannelKingdomRecipe>, selectedLandscapeId: string): SettlementPlan {
  const landscape = recipe.landscapes.find(candidate => candidate.id === selectedLandscapeId);
  if (!landscape) throw new Error('Selected Genesis landscape does not belong to this recipe.');
  const turn = landscape.coast.oceanToward;
  const world = (x: number, z: number): XZ => turn === 0 ? [half(x), half(z)] : turn === 1 ? [half(z), -half(x)] : turn === 2 ? [-half(x), -half(z)] : [-half(z), half(x)];
  const local = (x: number, z: number): XZ => turn === 0 ? [x, z] : turn === 1 ? [-z, x] : turn === 2 ? [-x, -z] : [z, -x];
  const surface = (x: number, z: number) => sampleGenesisSurface(landscape, ...world(x, z));
  const dry = (x: number, z: number, radius = 0): boolean => {
    for (const dx of radius ? [-radius, 0, radius] : [0]) for (const dz of radius ? [-radius, 0, radius] : [0]) {
      const sample = surface(x + dx, z + dz);
      if (sample.waterLevel !== null && sample.ground <= sample.waterLevel + .5) return false;
    }
    return true;
  };
  const position = (x: number, y: number, z: number): Vec3 => { const p = world(x, z); return [p[0], y, p[1]]; };
  // The observation year groups address slots. It is not a guessed founding or follow year.
  const slotYear = new Date(recipe.evidence.asOf).getUTCFullYear();
  const config = { seed: `${recipe.seedKey}/${landscape.id}/settlement-1`, tier: recipe.size.tier === 'hamlet' ? 'hamlet' as const : 'town' as const, firstYear: slotYear, year: slotYear };
  const nodes: StreetNode[] = [], streets: StreetEdge[] = [], courts: PublicSquare[] = [], quarters: SettlementQuarter[] = [];
  const homes: SettlementHome[] = [], reservations: PlotReservation[] = [];
  const lots = new SpatialIndex<PlotReservation>();
  const roadPoints = new SpatialIndex<{ position: Vec3; radius: number }>();
  const sourceCastle = createCastlePlan();
  const castleAnchor = landscape.places.find(place => place.purpose === 'castle')!.anchor;
  const castleLocal = local(...castleAnchor), castleHeight = half(sampleGenesisSurface(landscape, ...castleAnchor).ground);
  const castlePoint = (p: Vec3): Vec3 => position(p[0] + castleLocal[0], p[1] - sourceCastle.centre[1] + castleHeight, p[2] - sourceCastle.centre[2] + castleLocal[1]);
  const castleBoundary = (b: BoundsXZ): BoundsXZ => pointBounds([[b.minX, b.minZ], [b.maxX, b.maxZ]].map(([x, z]) => world(x! + castleLocal[0], z! - sourceCastle.centre[2] + castleLocal[1])));
  const castle: SettlementPlan['castle'] = {
    ...sourceCastle, centre: castlePoint(sourceCastle.centre), bounds: castleBoundary(sourceCastle.bounds),
    modules: sourceCastle.modules.map(module => ({ ...module, position: castlePoint(module.position), rotation: ((module.rotation + turn) % 4) as CardinalTurn })),
    court: { ...sourceCastle.court, elevation: castleHeight, boundary: sourceCastle.court.boundary.map(([x, z]) => world(x + castleLocal[0], z - sourceCastle.centre[2] + castleLocal[1])) },
  };
  const addNode = (id: string, p: Vec3, kind: StreetNode['kind'] = 'junction'): StreetNode => { const node = { id, position: p, kind }; nodes.push(node); return node; };
  const plaza = landscape.places.find(place => place.purpose === 'plaza')!;
  const [marketX, marketZ] = local(...plaza.anchor), marketHeight = half(surface(marketX, marketZ).ground);
  if (!dry(marketX, marketZ, 15) || !dry(...castleLocal, 34)) throw new Error('Genesis civic anchors require dry ground.');
  const marketNode = addNode('market', position(marketX, marketHeight, marketZ), 'market');
  const market: PublicSquare = { id: 'market', nodeId: marketNode.id, elevation: marketHeight, boundary: [[-14, -12], [14, -12], [14, 12], [-14, 12]].map(([x, z]) => world(marketX + x!, marketZ + z!)) };
  const castleGate = addNode(castle.gateNodeId, position(castleLocal[0], castleHeight, castleLocal[1] + 24), 'castle-gate');
  const append = (id: string, from: StreetNode, to: StreetNode, points: readonly Vec3[], kind: StreetEdge['kind'], name: string, width = 4): StreetEdge => {
    for (const p of points) { const q = local(p[0], p[2]); if (!dry(q[0], q[1], width / 2 + 1)) throw new Error(`Submerged Genesis street: ${id}`); }
    const edge: StreetEdge = { id, from: from.id, to: to.id, points, kind, name, width, verge: kind === 'approach' ? 0 : 1 };
    streets.push(edge);
    if (kind !== 'approach') for (const p of points) { const radius = width / 2 + 1.5; roadPoints.add({ minX: p[0] - radius, maxX: p[0] + radius, minZ: p[2] - radius, maxZ: p[2] + radius }, { position: p, radius }); }
    return edge;
  };
  // A longer approach follows the east side of the rise rather than a steep straight ramp.
  const crownWay: XZ[] = [local(castleGate.position[0], castleGate.position[2]), [-8, -24], [12, 0], [marketX, marketZ]];
  const crownPoints: XZ[] = [];
  for (let i = 1; i < crownWay.length; i++) {
    const a = crownWay[i - 1]!, b = crownWay[i]!, steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) crownPoints.push(world(a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps));
  }
  const crownGrade = gradeRoute(crownPoints, castleHeight, marketHeight, 0, .12);
  if (!crownGrade) throw new Error('Genesis castle approach exceeds the walkable grade.');
  append('genesis:crown-way', castleGate, marketNode, crownGrade, 'main', 'Crown Way', 6);

  const phase = draw(config.seed, 'ward-curve') * Math.PI * 2;
  const character = landscape.character;
  const wardZ = character === 'coastal-harbour' ? 112 : marketZ;
  const curve = (column: number, z: number): number => {
    const amplitude = character === 'mountain-pass' ? 4 : character === 'river-valley' ? 2.5 : 3;
    const length = character === 'coastal-harbour' ? 83 : character === 'river-valley' ? 110 : 62;
    const base = character === 'coastal-harbour' ? -78 - column * 44 : character === 'river-valley' ? 48 - column * 44 : column === 0 ? 35 : column === 1 ? -10 : -110 - (column - 2) * 44;
    const bend = character === 'mountain-pass' ? (column < 2 ? 20 : -4) * (Math.exp(-(((z + 150) / 105) ** 2)) - Math.exp(-(((wardZ + 150) / 105) ** 2))) : 0;
    return half(base + bend + amplitude * (Math.sin((z - wardZ) / length + phase) - Math.sin(phase)));
  };
  const streetNames = character === 'coastal-harbour' ? ['Harbour Reach', 'Saltwind Lane', 'Lantern Walk', 'Gull Court'] : character === 'river-valley' ? ['Willow Bend', 'Millwater Lane', 'Reed Walk', 'Orchard Rise'] : ['Saddle Lane', 'Juniper Walk', 'Highstone Reach', 'Pine Court'];
  const perWard = Math.ceil(recipe.size.homeCapacity / recipe.size.wards);
  let trunk = marketNode;
  // Connected ward streets are extended westwards, away from the river and sea. Full dry
  // reserves are checked before a house is admitted; none is made dry by a water-covering pad.
  for (let column = 0; homes.length < recipe.size.homeCapacity && column < 40; column++) {
    const streetName = column === 0 ? 'Old Row' : streetNames[(column - 1) % streetNames.length]!;
    const rootX = curve(column, wardZ), previous = local(trunk.position[0], trunk.position[2]);
    const rootId = `genesis:ward:${column}`, trunkPoints: Vec3[] = [trunk.position];
    const steps = Math.ceil(Math.hypot(rootX - previous[0], wardZ - previous[1])); let y = trunk.position[1];
    for (let k = 1; k <= steps; k++) {
      const x = previous[0] + (rootX - previous[0]) * k / steps;
      const z = previous[1] + (wardZ - previous[1]) * k / steps + Math.sin(Math.PI * k / steps) * (column ? 2 : -3);
      const p = position(x, 0, z), before = trunkPoints.at(-1)!;
      const run = Math.hypot(p[0] - before[0], p[2] - before[2]);
      y += Math.max(-run * .1, Math.min(run * .1, surface(x, z).ground - y));
      trunkPoints.push([p[0], y, p[2]]);
    }
    const root = addNode(rootId, trunkPoints.at(-1)!, 'court');
    append(`genesis:ward-way:${column}`, trunk, root, trunkPoints, 'main', character === 'coastal-harbour' ? 'Harbour Way' : character === 'river-valley' ? 'Riverward Way' : 'Passward Way', 5);
    trunk = root;
    const courtId = `${rootId}:green`, rootLocal = local(root.position[0], root.position[2]);
    courts.push({ id: courtId, nodeId: root.id, elevation: root.position[1], boundary: [[-4, -5], [4, -5], [4, 5], [-4, 5]].map(([x, z]) => world(rootLocal[0] + x!, rootLocal[1] + z!)) });
    const wardStart = homes.length, target = Math.min(recipe.size.homeCapacity, wardStart + perWard);
    const branchPriors = new Map<number, StreetNode>([[-1, root], [1, root]]);
    for (let row = 0; row < 25 && homes.length < target; row++) for (const direction of [-1, 1]) {
      if (homes.length >= target) break;
      const prior = branchPriors.get(direction)!;
      // The northern reserve is longer: the ocean is always on the southern side
      // in this landscape frame. Coastal lanes stop short of even the lowest bay.
      const slotCount = direction < 0 ? 25 : character === 'coastal-harbour' ? 11 : 17;
      if (row < slotCount) {
        const z = wardZ + direction * (14 + row * 11), x = curve(column, z);
        const prev = local(prior.position[0], prior.position[2]), points: Vec3[] = [prior.position];
        const count = Math.ceil(Math.abs(z - prev[1])); let height = prior.position[1];
        for (let k = 1; k <= count; k++) {
          const pz = prev[1] + (z - prev[1]) * k / count, px = curve(column, pz), p = position(px, 0, pz), before = points.at(-1)!;
          const run = Math.hypot(p[0] - before[0], p[2] - before[2]);
          height += Math.max(-run * .12, Math.min(run * .12, surface(px, pz).ground - height));
          points.push([p[0], height, p[2]]);
        }
        if (!points.every(p => { const q = local(p[0], p[2]); return dry(q[0], q[1], 3) && rectangleDistance(castle.bounds, p[0], p[2]) >= 3.5; })) continue;
        const node = addNode(`${rootId}:${direction}:${row}`, points.at(-1)!);
        const edge = append(`${node.id}:lane`, prior, node, points, 'lane', streetName);
        branchPriors.set(direction, node);
        for (const side of [-1, 1]) {
          if (homes.length >= target) break;
          const rotation = (((side < 0 ? 1 : 3) + turn) % 4) as CardinalTurn;
          const centre = position(x + side * 13.5, height, z);
          const box = currentFootprint({ position: centre, rotation, allowedDepth: 16 });
          if (boundsOverlap(box, expandBounds(castle.bounds, 3)) || boundsOverlap(box, expandBounds(pointBounds(market.boundary), 3))) continue;
          if (lots.within(expandBounds(box, 1)).some(other => boundsOverlap(box, other.lot, 1))) continue;
          let clear = true;
          for (let px = box.minX - 1; px <= box.maxX + 1; px += 2) for (let pz = box.minZ - 1; pz <= box.maxZ + 1; pz += 2) {
            const q = local(px, pz); if (!dry(q[0], q[1])) clear = false;
          }
          // Public roads and the castle route keep their complete clear corridor.
          for (const road of roadPoints.within(box)) if (rectangleDistance(box, road.position[0], road.position[2]) < road.radius) clear = false;
          if (!clear) continue;
          const ordinal = homes.length, id = `genesis:plot:${ordinal}`;
          const plot: PlotReservation = { id, quarterYear: slotYear, ordinal, street: streetName, streetId: edge.id, courtId, approachId: `${id}:approach`, position: centre, rotation, lot: { ...box, height: 20, depth: 16, frontage: 8 } };
          const front = homeFrame(plot).front, frontage = addNode(`${id}:front`, front, 'frontage');
          append(plot.approachId, frontage, node, [front, node.position], 'approach', streetName, 2);
          const hash = seedHash(`${config.seed}/${id}`), tier: HomeTier = hash % 11 === 0 ? 'house' : hash % 5 === 0 ? 'hut' : 'cottage';
          homes.push({ ...plot, slot: ordinal, tier, allowedDepth: HOME_DEPTH_METRES[tier], style: recipe.identity.styleFamily, variant: hash % 3 });
          reservations.push(plot); lots.add(box, plot);
        }
      }
    }
    if (homes.length === wardStart) throw new Error(`Genesis ward ${column} has no dry frontages.`);
    quarters.push({ year: slotYear, name: streetName, rootNodeId: root.id, courtIds: [courtId], growthNodeIds: [...branchPriors.values()].map(node => node.id) });
  }
  if (homes.length !== recipe.size.homeCapacity) throw new Error('Genesis settlement cannot reserve its complete capacity.');
  const extent: XZ[] = [[castle.bounds.minX, castle.bounds.minZ], [castle.bounds.maxX, castle.bounds.maxZ], ...market.boundary];
  for (const home of homes) extent.push([home.lot.minX, home.lot.minZ], [home.lot.maxX, home.lot.maxZ]);
  for (const road of streets) for (const p of road.points) extent.push([p[0], p[2]]);
  const bounds = expandBounds(pointBounds(extent), 16);
  // Frame the actual defining landform, rather than aiming a camera only at houses.
  const landmarks: XZ[] = character === 'coastal-harbour' ? [world(-165, 205), world(135, 205)] : character === 'river-valley' ? landscape.terrainCore.streams.flatMap(stream => stream.points.map(point => point.position)) : [[landscape.mountainPass.saddle[0], landscape.mountainPass.saddle[2]] as XZ, ...landscape.terrainCore.hills.filter(hill => hill.id.startsWith('ridge-')).map(hill => hill.centre)];
  for (const [x, z] of landmarks) { bounds.minX = Math.min(bounds.minX, x - 4); bounds.maxX = Math.max(bounds.maxX, x + 4); bounds.minZ = Math.min(bounds.minZ, z - 4); bounds.maxZ = Math.max(bounds.maxZ, z + 4); }
  const body = { version: 2 as const, config, landform: landscape.terrainCore, genesisSurface: landscape, homes, reservations, quarters, nodes, streets, activeStreetIds: streets.map(edge => edge.id), market, courts, castle, bounds, lake: landscape.terrainCore.lake };
  return { ...body, revision: `genesis-settlement:1:${seedHash(JSON.stringify(body)).toString(16)}` };
}
