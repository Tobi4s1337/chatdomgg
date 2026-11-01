import { HOME_DEPTH_METRES, type HomeTier, type Vec3 } from '@chatdom/shared';
import { createCastlePlan, currentFootprint, homeFrame, seedHash, transformCardinalPoint, type CardinalTurn, type SettlementHome, type SettlementPlan, type XZ } from '@chatdom/world';
import { sampleGenesisSurface, type ChannelKingdomRecipe, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import { MASHA_LAND, mashaFrame } from './land';

type Node = SettlementPlan['nodes'][number];
type Edge = SettlementPlan['streets'][number];
type Square = SettlementPlan['market'];
type Quarter = SettlementPlan['quarters'][number];
type Plot = SettlementPlan['reservations'][number];
type Bounds = SettlementPlan['bounds'];

/**
 * MashaD4's city: five hundred and twelve reserved homes on terraces that climb the city mount to the keep.
 *
 * Each terrace is a lane along a contour arc centred on the keep. Homes stand on its uphill side, all facing
 * south across the valley, so the whole city shows its doors and windows to the road in. A stair runs straight
 * down the middle from the castle gate through every terrace to Bell Court at the foot, and the Pass Road
 * leaves the east end of Old Row and climbs in switchbacks to the saddle, where the crown tower keeps the pass.
 *
 * Old Row is the innermost terrace, under the castle wall. Slots count outward from it, so the earliest
 * addresses are nearest the keep (spec 39). The stair halves each terrace, and the halves are grouped, in slot
 * order, into eight wards of about sixty-four homes. Every lot is a full 8 × 16 m
 * reservation on dry ground, inside the cut-and-fill its terrace can grade, clear of every road, square and the
 * castle. Nothing here is a person, a deed or a lit window.
 */
export const MASHA_CITY = {
  /** Radius of Old Row's lane from the keep's centre, and the terrace pitch. */
  firstRing: 62, pitch: 25,
  /**
   * Terraces are rounded squares about the keep (superellipses of this exponent), not circles: homes stand on
   * whole quarter turns, and a row of them only closes up along a straight lane. The long sides carry the rows;
   * the rounded corners are where a terrace turns.
   */
  squareness: 4,
  /**
   * The city's box about the keep, in metres: the kingdom view draws detailed ground for at most 512 m a side, so
   * every lot, lane and square stays within `halfWidth` either side of the keep and `south` of it. The Pass Road
   * climbs on beyond, to the saddle on the distant mountainside.
   */
  halfWidth: 222, south: 405,
  /** Terraces wrap round the mount's flanks this far from due south, until the box's north edge stops them. */
  sweep: 125 * Math.PI / 180,
  laneWidth: 5, frontGap: 1.5,
  /** Largest cut or fill a lot may need against its natural ground. */
  cut: 7,
  /** Half-width of the central stair's clear corridor. */
  stairClear: 7,
  passWidth: 5,
} as const;

const WARD_NAMES = ['Old Row', 'Crown Terrace', 'Juniper Walk', 'Highstone Reach', 'Gentian Lane', 'Larch Terrace', 'Scree Walk', 'Saddle Lane'] as const;
const half = (n: number): number => Math.round(n * 2) / 2;
const overlap = (a: Bounds, b: Bounds, margin = 0) => a.minX < b.maxX + margin && a.maxX > b.minX - margin && a.minZ < b.maxZ + margin && a.maxZ > b.minZ - margin;
const boxDistance = (b: Bounds, x: number, z: number) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ));
const pointBounds = (points: readonly XZ[]): Bounds => ({
  minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])),
  minZ: Math.min(...points.map(p => p[1])), maxZ: Math.max(...points.map(p => p[1])),
});

export interface MashaCityLayout {
  readonly plan: SettlementPlan;
  /** Local frame of the composition, for the content that dresses the plan. */
  readonly keep: { readonly local: XZ; readonly height: number };
  /** Each terrace's lane, and the ward that holds its west and east of the stair. */
  readonly terraces: readonly { readonly ring: number; readonly radius: number; readonly wards: readonly [number, number]; readonly lane: readonly Vec3[] }[];
  readonly stair: readonly Vec3[];
  readonly passRoad: readonly Vec3[];
  /** Flat ground held at the saddle for the crown tower's terrace (world metres). */
  readonly passTerrace: { readonly centre: Vec3; readonly boundary: readonly XZ[] };
  /** Land held for the cathedral its people may raise, beside Bell Court; `front` is the way its west front faces. */
  readonly cathedral: { readonly centre: Vec3; readonly boundary: readonly XZ[]; readonly front: XZ };
}

export function compileMashaCity(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>): MashaCityLayout {
  const capacity = recipe.size.homeCapacity;
  const frame = mashaFrame(landscape.coast.oceanToward), turn = frame.turn;
  const world = (x: number, z: number): XZ => { const p = frame.world(x, z); return [half(p[0]), half(p[1])]; };
  const position = (x: number, y: number, z: number): Vec3 => { const p = world(x, z); return [p[0], y, p[1]]; };
  const surface = (x: number, z: number) => { const p = frame.world(x, z); return sampleGenesisSurface(landscape, p[0], p[1]); };
  const ground = (x: number, z: number) => surface(x, z).ground;
  const dry = (x: number, z: number, margin = 0) => { const s = surface(x, z); return s.waterLevel === null && s.shoreDistance > margin; };
  const slotYear = new Date(recipe.evidence.asOf).getUTCFullYear();
  const config = { seed: `${recipe.seedKey}/${landscape.id}/masha-city-1`, tier: 'town' as const, firstYear: slotYear, year: slotYear };

  // The keep: the standard castle plan on Crown Hill's plateau, its gate to the south.
  const keepAnchor = landscape.places.find(place => place.purpose === 'castle')!.anchor;
  const [kx, kz] = frame.local(...keepAnchor), keepHeight = half(ground(kx, kz));
  const source = createCastlePlan();
  const castlePoint = (p: Vec3): Vec3 => position(p[0] + kx, p[1] - source.centre[1] + keepHeight, p[2] - source.centre[2] + kz);
  const castleXZ = ([x, z]: XZ): XZ => world(x + kx, z - source.centre[2] + kz);
  const castle: SettlementPlan['castle'] = {
    ...source, centre: castlePoint(source.centre),
    bounds: pointBounds([castleXZ([source.bounds.minX, source.bounds.minZ]), castleXZ([source.bounds.maxX, source.bounds.maxZ])]),
    modules: source.modules.map(module => ({ ...module, position: castlePoint(module.position), rotation: ((module.rotation + turn) % 4) as CardinalTurn })),
    court: { ...source.court, elevation: keepHeight, boundary: source.court.boundary.map(castleXZ) },
  };
  if (!dry(kx, kz, 40)) throw new Error('The keep needs dry ground.');

  const nodes: Node[] = [], streets: Edge[] = [], courts: Square[] = [], quarters: Quarter[] = [];
  const homes: SettlementHome[] = [], reservations: Plot[] = [];
  const addNode = (id: string, p: Vec3, kind: Node['kind'] = 'junction'): Node => { const node = { id, position: p, kind }; nodes.push(node); return node; };
  const append = (id: string, from: Node, to: Node, points: readonly Vec3[], kind: Edge['kind'], name: string, width: number): Edge => {
    const edge: Edge = { id, from: from.id, to: to.id, points, kind, name, width, verge: kind === 'approach' ? 0 : 1 };
    streets.push(edge);
    return edge;
  };
  const gate = addNode(castle.gateNodeId, position(kx, keepHeight, kz + 24), 'castle-gate');

  // Terrace lanes: contour arcs about the keep, sampled every two metres, with a gentle graded fall along them.
  const { firstRing, pitch, squareness, sweep, laneWidth, frontGap, cut, stairClear, halfWidth, south } = MASHA_CITY;
  type LanePoint = { x: number; z: number; y: number; angle: number };
  type Lane = { ring: number; radius: number; points: LanePoint[] };
  const laneAt = (radius: number, ring: number): Lane | undefined => {
    // Walk the rounded square finely, then keep a point every two metres of lane; `angle` is the outward normal's
    // bearing from due south, which picks the way the homes along it face.
    const n = squareness, curve = (t: number) => Math.sign(t) * Math.abs(t) ** (2 / n);
    const raw: LanePoint[] = [];
    let previous: XZ | undefined, run = 2;
    for (let phi = -sweep; phi <= sweep + 1e-9; phi += .1 / radius) {
      const dx = radius * curve(Math.sin(phi)), dz = radius * curve(Math.cos(phi));
      if (previous) run += Math.hypot(dx - previous[0], dz - previous[1]);
      previous = [dx, dz];
      if (run < 2) continue;
      run = 0;
      const angle = Math.atan2(Math.sign(dx) * Math.abs(dx) ** (n - 1), Math.sign(dz) * Math.abs(dz) ** (n - 1));
      raw.push({ x: kx + dx, z: kz + dz, y: ground(kx + dx, kz + dz), angle });
    }
    // Keep the run of dry street either side of the stair, so a lane stops at the river's bank and the city's box.
    const wet = raw.map(p => !dry(p.x, p.z, laneWidth + 4) || Math.abs(p.x - kx) > halfWidth - laneWidth || p.z > kz + south - 40 || p.z < kz - 36 || Math.abs(p.angle) > Math.PI * .7);
    const centre = raw.findIndex(p => p.x >= kx);
    if (centre < 0 || wet[centre]) return undefined;
    let from = centre, to = centre;
    while (from > 0 && !wet[from - 1]) from--;
    while (to < raw.length - 1 && !wet[to + 1]) to++;
    const points = raw.slice(from, to + 1);
    if (points.length < 8) return undefined;
    // A lane follows its contour: smooth the natural height, then hold the fall along it under 10%.
    const smooth = points.map((_, i) => {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - 6); j <= Math.min(points.length - 1, i + 6); j++) { sum += points[j]!.y; count++; }
      return sum / count;
    });
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < smooth.length; i++) smooth[i] = Math.max(smooth[i - 1]! - .2, Math.min(smooth[i - 1]! + .2, smooth[i]!));
      for (let i = smooth.length - 2; i >= 0; i--) smooth[i] = Math.max(smooth[i + 1]! - .2, Math.min(smooth[i + 1]! + .2, smooth[i]!));
    }
    return { ring, radius, points: points.map((p, i) => ({ ...p, y: half(smooth[i]! * 2) / 2 })) };
  };
  // A home faces the cardinal direction nearest its terrace's outward fall: south on the face of the mount,
  // east or west on its flanks, so a lot never stands across its own lane.
  const facing = (angle: number): { local: XZ; rotation: CardinalTurn } => {
    const local: XZ = angle > Math.PI / 4 ? [1, 0] : angle < -Math.PI / 4 ? [-1, 0] : [0, 1];
    const target = frame.world(...local);
    const rotation = ([0, 1, 2, 3] as const).find(r => { const o = transformCardinalPoint([0, 0, 0], r, [0, 0, 1]); return Math.abs(o[0] - target[0]) < 1e-9 && Math.abs(o[2] - target[1]) < 1e-9; })!;
    return { local, rotation };
  };
  // Coarse buckets for the clearance tests: thousands of lane samples, hundreds of lots.
  const CELL = 8;
  const bucket = <T,>(grid: Map<string, T[]>, b: Bounds, item: T) => {
    for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++) for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) {
      const key = `${cx},${cz}`; const list = grid.get(key); if (list) list.push(item); else grid.set(key, [item]);
    }
  };
  const near = <T,>(grid: Map<string, T[]>, b: Bounds): Set<T> => {
    const found = new Set<T>();
    for (let cx = Math.floor(b.minX / CELL); cx <= Math.floor(b.maxX / CELL); cx++) for (let cz = Math.floor(b.minZ / CELL); cz <= Math.floor(b.maxZ / CELL); cz++) for (const item of grid.get(`${cx},${cz}`) ?? []) found.add(item);
    return found;
  };
  const roadGrid = new Map<string, { position: Vec3; radius: number }[]>(), lotGrid = new Map<string, Bounds[]>();
  const addRoad = (position: Vec3, radius: number) => bucket(roadGrid, { minX: position[0] - radius, maxX: position[0] + radius, minZ: position[2] - radius, maxZ: position[2] + radius }, { position, radius });

  const crossing = (lane: Lane) => lane.points.reduce((best, p) => Math.abs(p.x - kx) < Math.abs(best.x - kx) ? p : best);
  const lanes: Lane[] = [], keepOut: Bounds[] = [castle.bounds];
  const clearOfRoads = (box: Bounds) => [...near(roadGrid, box)].every(road => boxDistance(box, road.position[0], road.position[2]) >= road.radius - 1e-6);
  const admittedOn = new Map<number, { street: { x: number; y: number; z: number }; home: SettlementHome }[]>();
  const saddle = landscape.mountainPass.saddle, [sx, sz] = frame.local(saddle[0], saddle[2]);
  const passHeight = half(ground(sx, sz));
  let passRoad: Vec3[] = [];

  // The Pass Road: from Old Row's east end, switchbacks up the mountain to the saddle, under a 12% grade.
  function layPassRoad(old: Lane): Vec3[] {
    const oldEnd = old.points.reduce((best, q) => q.x > best.x ? q : best);
    const legs: XZ[] = [[oldEnd.x, oldEnd.z]];
    {
      const startZ = oldEnd.z - 4, endZ = sz + 26, rise = passHeight - oldEnd.y;
      // Hairpins alternate between the keep's east flank and the eastern horn's foot.
      const west = Math.max(kx + 40, sx - 22), east = sx + 58;
      const legCount = Math.max(2, Math.ceil(rise / (.09 * (east - west))));
      for (let leg = 1; leg <= legCount; leg++) {
        const t = leg / legCount, z = startZ + (endZ - startZ) * t;
        legs.push([leg === legCount ? sx : leg % 2 ? east : west, z]);
      }
      legs.push([sx, sz + 22]);
    }
    const passXZ: XZ[] = [];
    for (let i = 1; i < legs.length; i++) {
      const a = legs[i - 1]!, b = legs[i]!, steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 2);
      for (let k = i === 1 ? 0 : 1; k <= steps; k++) passXZ.push([a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps]);
    }
    // Round the hairpins so the road reads as a carriageway, not a polyline.
    const rounded = passXZ.map((p, i) => {
      let x = 0, z = 0, count = 0;
      for (let j = Math.max(0, i - 4); j <= Math.min(passXZ.length - 1, i + 4); j++) { x += passXZ[j]![0]; z += passXZ[j]![1]; count++; }
      return i === 0 || i === passXZ.length - 1 ? p : [x / count, z / count] as XZ;
    });
    let length = 0;
    const along = rounded.map((p, i) => (length += i ? Math.hypot(p[0] - rounded[i - 1]![0], p[1] - rounded[i - 1]![1]) : 0));
    // The road arrives level: it reaches the terrace's height a little short of its end, so its grading never tilts
    // the terrace's front edge.
    const climb = length - 24;
    const passRoad = rounded.map((p, i) => position(p[0], oldEnd.y + (passHeight - oldEnd.y) * Math.min(1, along[i]! / climb), p[1]));
    if ((passHeight - oldEnd.y) / climb > .12) throw new Error('The Pass Road exceeds a walkable grade.');
    return passRoad;
  }

  for (let ring = 0; ring < 40 && homes.length < capacity; ring++) {
    const lane = laneAt(firstRing + ring * pitch, ring);
    if (!lane) break;
    lanes.push(lane);
    for (const p of lane.points) addRoad(position(p.x, p.y, p.z), laneWidth / 2 + 1.5);
    if (ring === 0) {
      passRoad = layPassRoad(lane);
      for (const p of passRoad) addRoad(p, MASHA_CITY.passWidth / 2 + 1.5);
    }
    const laneId = `masha:terrace:${ring}`;
    const admitted: { street: { x: number; y: number; z: number }; home: SettlementHome }[] = [];
    // Try a lot every half metre along the lane, so a row closes up to its half-metre gaps.
    const stations = lane.points.flatMap((p, i) => {
      const q = lane.points[i + 1];
      if (!q) return [p];
      return [0, .25, .5, .75].map(t => ({ x: p.x + (q.x - p.x) * t, z: p.z + (q.z - p.z) * t, y: p.y + (q.y - p.y) * t, angle: t < .5 ? p.angle : q.angle }));
    });
    for (const street of stations) {
      if (homes.length >= capacity) break;
      if (Math.abs(street.x - kx) < stairClear + 1) continue;
      const { local: f, rotation } = facing(street.angle);
      for (const extra of [0, .5, 1]) {
        const back = laneWidth / 2 + frontGap + extra + 8;
        const cx = street.x - f[0] * back, cz = street.z - f[1] * back;
        const centre = position(cx, street.y, cz);
        const box = currentFootprint({ position: centre, rotation, allowedDepth: 16 });
        if (keepOut.some(other => overlap(box, other, 3)) || [...near(lotGrid, box)].some(other => overlap(box, other, .5)) || !clearOfRoads(box)) continue;
        let fits = true;
        for (let across = -4; across <= 4 && fits; across += 2) for (let depth = -8; depth <= 8 && fits; depth += 2) {
          const lx = cx + f[0] * depth - f[1] * across, lz = cz + f[1] * depth + f[0] * across;
          if (!dry(lx, lz, 2) || Math.abs(ground(lx, lz) - street.y) > cut) fits = false;
        }
        if (!fits) continue;
        const ordinal = homes.length, id = `masha:plot:${ordinal}`;
        const plot: Plot = { id, quarterYear: slotYear, ordinal, street: '', streetId: laneId, courtId: `masha:stair:${ring}:green`, approachId: `${id}:approach`, position: centre, rotation, lot: { ...box, height: 20, depth: 16, frontage: 8 } };
        const hash = seedHash(`${config.seed}/${id}`), tier: HomeTier = hash % 9 === 0 ? 'house' : hash % 4 === 0 ? 'hut' : 'cottage';
        const home: SettlementHome = { ...plot, slot: ordinal, tier, allowedDepth: HOME_DEPTH_METRES[tier], style: recipe.identity.styleFamily, variant: hash % 3 };
        homes.push(home); bucket(lotGrid, home.lot, home.lot as Bounds); admitted.push({ street, home });
        break;
      }
    }
    admittedOn.set(ring, admitted);
  }
  if (homes.length !== capacity) throw new Error(`MashaD4's terraces reserve ${homes.length} of ${capacity} homes.`);

  // Wards: walk the terrace halves in slot order and close a ward each time it holds its share of the homes.
  const share = capacity / WARD_NAMES.length, wardOfHalf = new Map<string, number>();
  const sideOf = (ring: number, x: number) => x < crossing(lanes[ring]!).x ? 0 : 1;
  let counted = 0;
  for (const lane of lanes) for (const side of [0, 1] as const) {
    const count = (admittedOn.get(lane.ring) ?? []).filter(a => sideOf(lane.ring, a.street.x) === side).length;
    wardOfHalf.set(`${lane.ring}:${side}`, Math.min(WARD_NAMES.length - 1, Math.floor((counted + count / 2) / share)));
    counted += count;
  }
  const wardAt = (ring: number, x: number) => wardOfHalf.get(`${ring}:${sideOf(ring, x)}`)!;
  for (const [ring, admitted] of admittedOn) admitted.forEach((entry, i) => {
    const named: SettlementHome = { ...entry.home, street: WARD_NAMES[wardAt(ring, entry.street.x)]! };
    homes[named.slot] = named; admitted[i] = { street: entry.street, home: named };
  });
  reservations.push(...homes);

  // The central stair: from the gate straight down through every terrace to Bell Court at the foot.
  const lastRadius = lanes.at(-1)!.radius;
  // Bell Court is a fixed place of the land at the city's foot; the last terrace must leave it room.
  const marketZ = kz + MASHA_LAND.bellCourt.south, marketHeight = half(ground(kx, marketZ));
  if (!dry(kx, marketZ, 18) || marketZ - 12 < kz + lastRadius + 8 || marketZ + 12 > kz + south) throw new Error('Bell Court needs dry, open ground at the foot of the stair.');
  const marketNode = addNode('market', position(kx, marketHeight, marketZ), 'market');
  const market: Square = { id: 'market', nodeId: marketNode.id, elevation: marketHeight, boundary: [[-15, -12], [15, -12], [15, 12], [-15, 12]].map(([x, z]) => world(kx + x!, marketZ + z!)) };
  // The cathedral reserve fronts Bell Court from the west: its west front (liturgical, facing the square) on the court.
  const reserveX = kx - MASHA_LAND.close.west;
  const cathedral = { x: reserveX, z: marketZ, y: half(ground(reserveX, marketZ)), boundary: [[-16, -12], [16, -12], [16, 12], [-16, 12]].map(([x, z]) => world(reserveX + x!, marketZ + z!)) };
  const reserveBox = pointBounds(cathedral.boundary);
  if (homes.some(home => overlap(home.lot, reserveBox, 2)) || !clearOfRoads(reserveBox) || !dry(reserveX, marketZ, 20)) throw new Error('The cathedral reserve needs clear, dry ground beside Bell Court.');
  // Landings never climb on the way down, even where a terrace's lane is graded a little above the one before.
  let landing = keepHeight;
  const stairStops = [{ z: kz + 24, y: keepHeight }, ...lanes.map(lane => { const p = crossing(lane); landing = Math.min(landing, p.y); return { z: p.z, y: landing }; }), { z: marketZ - 12, y: Math.min(landing, marketHeight) }];
  const stair: Vec3[] = [], stairIndex: number[] = [0];
  for (let i = 1; i < stairStops.length; i++) {
    const a = stairStops[i - 1]!, b = stairStops[i]!, steps = Math.max(1, Math.ceil(b.z - a.z));
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) stair.push(position(kx, a.y + (b.y - a.y) * k / steps, a.z + (b.z - a.z) * k / steps));
    stairIndex.push(stair.length - 1);
  }
  const terraces: MashaCityLayout['terraces'][number][] = [];
  const junctions = new Map<number, Node>();
  let previousStair: Node = gate;
  lanes.forEach((lane, i) => {
    const node = addNode(`masha:stair:${lane.ring}`, stair[stairIndex[i + 1]!]!, 'court');
    append(`masha:stair:${lane.ring}:down`, previousStair, node, stair.slice(stairIndex[i]!, stairIndex[i + 1]! + 1), 'lane', 'Crown Stair', 4);
    previousStair = node; junctions.set(lane.ring, node);
  });
  append('masha:stair:market', previousStair, marketNode, stair.slice(stairIndex.at(-2)!), 'lane', 'Crown Stair', 4);

  for (const lane of lanes) {
    const laneId = `masha:terrace:${lane.ring}`, junction = junctions.get(lane.ring)!;
    const points = lane.points.map(p => position(p.x, p.y, p.z));
    const stops: { x: number; node: Node }[] = [{ x: crossing(lane).x, node: junction }];
    for (const { street, home } of admittedOn.get(lane.ring) ?? []) {
      const stop = addNode(`${laneId}:${home.id}`, position(street.x, street.y, street.z));
      const front = homeFrame(home).front, frontage = addNode(`${home.id}:front`, front, 'frontage');
      append(home.approachId, frontage, stop, [front, stop.position], 'approach', home.street, 2);
      stops.push({ x: street.x, node: stop });
    }
    // Split the lane into edges between its stops, either side of the stair.
    stops.sort((a, b) => a.x - b.x);
    const indexOf = (x: number) => lane.points.reduce((best, q, i) => Math.abs(q.x - x) < Math.abs(lane.points[best]!.x - x) ? i : best, 0);
    const ends = [{ x: lane.points[0]!.x, node: addNode(`${laneId}:west`, points[0]!) }, ...stops, { x: lane.points.at(-1)!.x, node: addNode(lane.ring === 0 ? 'masha:pass:foot' : `${laneId}:east`, points.at(-1)!) }];
    for (let i = 1; i < ends.length; i++) {
      const a = ends[i - 1]!, b = ends[i]!, from = indexOf(a.x), to = indexOf(b.x);
      if (to <= from) continue;
      streets.push({ id: `${laneId}:${i}`, from: a.node.id, to: b.node.id, points: points.slice(from, to + 1), kind: 'lane', name: WARD_NAMES[wardAt(lane.ring, (a.x + b.x) / 2)]!, width: laneWidth, verge: 1 });
    }
    terraces.push({ ring: lane.ring, radius: lane.radius, wards: [wardOfHalf.get(`${lane.ring}:0`)!, wardOfHalf.get(`${lane.ring}:1`)!], lane: points });
    const [jx, jz] = frame.local(junction.position[0], junction.position[2]);
    courts.push({ id: `${junction.id}:green`, nodeId: junction.id, elevation: junction.position[1], boundary: [[-6, -3], [6, -3], [6, 3], [-6, 3]].map(([x, z]) => world(jx + x!, jz + z!)) });
  }
  // Each ward is rooted at the stair landing of its highest terrace and grows from the lane ends it holds.
  for (let ward = 0; ward < WARD_NAMES.length; ward++) {
    const halves = terraces.flatMap(t => t.wards.flatMap((w, side) => w === ward ? [{ ring: t.ring, side }] : []));
    if (!halves.length) throw new Error(`${WARD_NAMES[ward]} holds no terrace.`);
    const rings = [...new Set(halves.map(h => h.ring))];
    quarters.push({ year: slotYear, name: WARD_NAMES[ward]!, rootNodeId: junctions.get(rings[0]!)!.id, courtIds: rings.map(ring => `${junctions.get(ring)!.id}:green`),
      growthNodeIds: halves.map(h => h.side === 0 ? `masha:terrace:${h.ring}:west` : h.ring === 0 ? 'masha:pass:foot' : `masha:terrace:${h.ring}:east`) });
  }
  // Bell Court sits on the stair's foot; the Pass Road ends on the levelled saddle terrace.
  const passTop = addNode('masha:pass:top', passRoad.at(-1)!, 'court');
  const passFoot = nodes.find(node => node.id === 'masha:pass:foot')!;
  append('masha:pass', passFoot, passTop, passRoad, 'main', 'Pass Road', MASHA_CITY.passWidth);
  // The levelled saddle terrace (the land's own `pass-terrace`): the crown tower stands on it, the road ends at its front.
  const passBoundary: XZ[] = [[-12, -14], [12, -14], [12, 26], [-12, 26]].map(([x, z]) => world(sx + x!, sz + z!));
  courts.push({ id: 'masha:pass:terrace', nodeId: passTop.id, elevation: passHeight, boundary: passBoundary });
  const cathedralNode = addNode('masha:cathedral', position(cathedral.x + 16, cathedral.y, cathedral.z), 'court');
  courts.push({ id: 'masha:cathedral:reserve', nodeId: cathedralNode.id, elevation: cathedral.y, boundary: cathedral.boundary });

  // The detailed ground covers the city: every lot, the keep, Bell Court and every street but the Pass Road, which
  // leaves it for the mountainside. The bounds are exactly the box, so the view's ground never depends on the lots.
  const box = pointBounds([world(kx - halfWidth, kz - 40), world(kx + halfWidth, kz + south)]);
  const extent: XZ[] = [[castle.bounds.minX, castle.bounds.minZ], [castle.bounds.maxX, castle.bounds.maxZ], ...market.boundary, ...cathedral.boundary];
  for (const home of homes) extent.push([home.lot.minX, home.lot.minZ], [home.lot.maxX, home.lot.maxZ]);
  for (const road of streets) if (road.id !== 'masha:pass') for (const p of road.points) extent.push([p[0], p[2]]);
  const reach = pointBounds(extent);
  if (reach.minX < box.minX || reach.maxX > box.maxX || reach.minZ < box.minZ || reach.maxZ > box.maxZ) throw new Error('MashaD4\'s city spills out of its box.');
  const bounds = { minX: box.minX - 16, maxX: box.maxX + 16, minZ: box.minZ - 16, maxZ: box.maxZ + 16 };
  const body = { version: 2 as const, config, landform: landscape.terrainCore, genesisSurface: landscape, homes, reservations, quarters, nodes, streets,
    activeStreetIds: streets.map(edge => edge.id), market, courts, castle, bounds, lake: landscape.terrainCore.lake } as Omit<SettlementPlan, 'revision'>;
  const plan: SettlementPlan = { ...body, revision: `masha-city:1:${seedHash(JSON.stringify(body)).toString(16)}` };
  return {
    plan, keep: { local: [kx, kz], height: keepHeight }, terraces, stair, passRoad,
    passTerrace: { centre: position(sx, passHeight, sz + 6), boundary: passBoundary },
    cathedral: { centre: position(cathedral.x, cathedral.y, cathedral.z), boundary: cathedral.boundary, front: frame.world(1, 0) },
  };
}
