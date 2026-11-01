import { randomUnit, seedHash, type CardinalTurn, type XZ } from '@chatdom/world';
import { sampleGenesisSurface, type DeepReadonly, type GenesisLandscape } from '@chatdom/world/genesis';
import type { LandHill } from '@chatdom/world';

/**
 * MashaD4's land: the seeded mountain-pass candidate, raised to the scale of a mountain city.
 *
 * Nothing moves that the seed placed. The two horns stand on the seed's own ridge centres, the pass keeps its
 * saddle between them, the keep keeps Crown Hill and the river keeps its course to the same sea. What changes is
 * scale: the horns become real mountains with a pass between them, a seeded wall of summits closes the north, two
 * flanking ranges hold the valley, and Crown Hill becomes the city mount the terraces climb. Every new draw is a
 * labelled slot of this landscape's own key, so the land is identical for every visitor and never depends on
 * mutable channel facts (followers, category, colours).
 *
 * The sea stands further off. Genesis land may rise only 0.22 m for every metre it lies from the shore, so on the
 * seed's coast the horns and the saddle were cut flat at one height and the pass vanished into a table wall. The
 * shoreline, its islands and the river's mouth keep their seeded shapes and move out together by `seaward`,
 * leaving river meadows between the city's foot and the beach, and room above for real mountains.
 *
 * The river now springs below the city instead of under the eastern horn: a stream carving its 0.9 bank through a
 * 180 m mountain would leave a cliff where its bank envelope ends. Its remaining bends keep their seeded cross-valley
 * positions and stretch down the longer valley to the moved mouth, falling to sea level there.
 *
 * Frame: "local" is the landscape's unturned frame (north, local -Z, is the mountains; south, +Z, the sea).
 */
export const MASHA_LAND = {
  /** City mount: the keep's plateau and the slope the terraces climb. */
  mount: { height: 58, plateau: 34, radius: 430 },
  horns: { west: { height: 178, radius: 150 }, east: { height: 196, radius: 156 }, plateau: 3 },
  /** First river point kept: the spring sits on the city mount's lower eastern slope. */
  springIndex: 6,
  /** How far the coast, its islands and the river mouth move out to sea (local +Z), in metres. */
  seaward: 340,
  /** The levelled terrace in the saddle that the crown tower and the Pass Road's end stand on. */
  passTerrace: { plateau: 26, radius: 74, towardCity: 6 },
  /**
   * The city's foot, in metres from the keep: Bell Court on the axis, and west of it the levelled close the cathedral
   * site is held on. The city places both here.
   */
  bellCourt: { south: 391 },
  close: { west: 35, plateau: 23, radius: 52 },
  /** The inn's yard on Bell Court's south-east corner, levelled at the court's own height. */
  innYard: { east: 27, south: 2, plateau: 15, radius: 40 },
} as const;

const half = (n: number): number => Math.round(n * 2) / 2;

export interface MashaFrame {
  readonly turn: CardinalTurn;
  /** Local (unturned) metres to world metres. */
  world(x: number, z: number): XZ;
  /** World metres to local metres. */
  local(x: number, z: number): XZ;
}

export function mashaFrame(turn: CardinalTurn): MashaFrame {
  return {
    turn,
    world: (x, z) => turn === 0 ? [x, z] : turn === 1 ? [z, -x] : turn === 2 ? [-x, -z] : [-z, x],
    local: (x, z) => turn === 0 ? [x, z] : turn === 1 ? [-z, x] : turn === 2 ? [-x, -z] : [z, -x],
  };
}

export function composeMashaLand(source: DeepReadonly<GenesisLandscape>): DeepReadonly<GenesisLandscape> {
  if (source.character !== 'mountain-pass') throw new Error('MashaD4 is composed on its mountain-pass candidate.');
  const frame = mashaFrame(source.coast.oceanToward);
  const key = `${source.id}/masha-1`;
  const draw = (slot: string) => randomUnit(seedHash(`${slot}/${key}`));
  const jitter = (slot: string, extent: number) => (draw(slot) * 2 - 1) * extent;
  const hill = (id: string) => {
    const found = source.terrainCore.hills.find(item => item.id === id);
    if (!found) throw new Error(`The mountain-pass candidate has no ${id}.`);
    return found;
  };
  const at = (x: number, z: number): XZ => { const p = frame.world(half(x), half(z)); return [p[0], p[1]]; };
  const keep = hill('castle-rise').centre, west = hill('ridge-west'), east = hill('ridge-east');
  const [westX, westZ] = frame.local(...west.centre), [eastX, eastZ] = frame.local(...east.centre);
  const mount: LandHill = { id: 'castle-rise', centre: [keep[0], keep[1]], height: MASHA_LAND.mount.height, radius: MASHA_LAND.mount.radius, plateau: MASHA_LAND.mount.plateau };
  // A wall of summits closes the north behind the pass; flanks hold the valley east and west.
  // The summits stand either side of the pass, so the notch between the horns opens onto distant air and a low
  // far ridge: from the valley the skyline reads as a crown, highest at its two outer shoulders.
  const summits: LandHill[] = [-400, -250, 260, 410].map((x, i) => ({
    id: `summit-${i}`, centre: at(x + jitter(`summit-${i}-x`, 30), -450 + jitter(`summit-${i}-z`, 35)),
    height: half(236 + jitter(`summit-${i}-height`, 30)), radius: half(200 + jitter(`summit-${i}-radius`, 20)), plateau: 2,
  }));
  summits.push({ id: 'far-ridge', centre: at(20 + jitter('far-ridge-x', 30), -620), height: half(150 + jitter('far-ridge-height', 15)), radius: 260, plateau: 20 });
  const flanks: LandHill[] = [
    { id: 'flank-west', centre: at(-520 + jitter('flank-west-x', 30), -150 + jitter('flank-west-z', 40)), height: half(120 + jitter('flank-west-height', 18)), radius: 230, plateau: 4 },
    { id: 'flank-east', centre: at(430 + jitter('flank-east-x', 30), -110 + jitter('flank-east-z', 40)), height: half(132 + jitter('flank-east-height', 18)), radius: 230, plateau: 4 },
    { id: 'shoulder-west', centre: at(westX - 150, westZ - 30), height: half(118 + jitter('shoulder-west-height', 12)), radius: 135, plateau: 2 },
    { id: 'shoulder-east', centre: at(eastX + 150, eastZ - 30), height: half(126 + jitter('shoulder-east-height', 12)), radius: 140, plateau: 2 },
  ];
  const horns: LandHill[] = [
    { id: 'ridge-west', centre: [west.centre[0], west.centre[1]], height: half(MASHA_LAND.horns.west.height + jitter('west-height', 10)), radius: MASHA_LAND.horns.west.radius, plateau: MASHA_LAND.horns.plateau },
    { id: 'ridge-east', centre: [east.centre[0], east.centre[1]], height: half(MASHA_LAND.horns.east.height + jitter('east-height', 10)), radius: MASHA_LAND.horns.east.radius, plateau: MASHA_LAND.horns.plateau },
  ];
  // Order matters: each hill eases the surface towards its own height, so the mountains are applied last.
  const hills = [mount, ...flanks, ...summits, ...horns];
  // The sea moves out; everything it owns moves with it, in the local frame.
  const seaward = (p: DeepReadonly<XZ>): XZ => { const [x, z] = frame.local(p[0], p[1]); return at(x, z + MASHA_LAND.seaward); };
  const river = source.terrainCore.streams.find(stream => stream.id === 'river');
  if (!river) throw new Error('The mountain-pass candidate has no river.');
  const kept = river.points.slice(MASHA_LAND.springIndex);
  const springZ = frame.local(...kept[0]!.position)[1], mouthZ = frame.local(...kept.at(-1)!.position)[1];
  const stretch = (mouthZ + MASHA_LAND.seaward - springZ) / (mouthZ - springZ);
  const course = kept.map(point => {
    const [x, z] = frame.local(...point.position);
    return { ...point, position: at(x, springZ + (z - springZ) * stretch) };
  });
  // Halfway bends, so the longer course still meanders: each a seeded sideways step from the straight line.
  const meander = course.flatMap((point, i) => {
    if (i === 0) return [point];
    const a = course[i - 1]!, [ax, az] = frame.local(...a.position), [bx, bz] = frame.local(...point.position);
    const middle = { ...point, position: at((ax + bx) / 2 + jitter(`river-meander-${i}`, 22), (az + bz) / 2),
      level: half((a.level + point.level) / 2), bed: half((a.level + point.level) / 2) - 2, width: half((a.width + point.width) / 2) };
    return [middle, point];
  });
  const streams = source.terrainCore.streams.map(stream => stream !== river ? stream : { ...stream, points: meander });
  const mouth = seaward([source.terrainCore.lake.x, source.terrainCore.lake.z]);
  const terrainCore = {
    ...source.terrainCore, hills,
    castleRise: { centre: mount.centre, radius: mount.radius, height: mount.height },
    lake: { ...source.terrainCore.lake, x: mouth[0], z: mouth[1] },
    waters: source.terrainCore.waters.map(water => { const p = seaward([water.x, water.z]); return { ...water, x: p[0], z: p[1] }; }),
    streams,
  };
  const coast = { ...source.coast, shoreline: source.coast.shoreline.map(seaward) };
  const islands = source.islands.map(island => ({ ...island, centre: seaward(island.centre) }));
  const draft = { ...source, terrainCore, coast, islands } as DeepReadonly<GenesisLandscape>;
  // The saddle is levelled into a terrace at its own natural height, a few metres towards the city.
  const saddle = source.mountainPass.saddle, [sx, sz] = frame.local(saddle[0], saddle[2]);
  const pass = half(sampleGenesisSurface(draft, saddle[0], saddle[2]).ground);
  const { plateau, radius, towardCity } = MASHA_LAND.passTerrace;
  const terrace: LandHill = { id: 'pass-terrace', centre: at(sx, sz + towardCity), height: pass, radius, plateau };
  // The cathedral close is levelled at its own middle's natural height, in the meadow beside Bell Court.
  const [kx, kz] = frame.local(...keep), closeAt = frame.world(kx - MASHA_LAND.close.west, kz + MASHA_LAND.bellCourt.south);
  const closeHeight = half(sampleGenesisSurface(draft, closeAt[0], closeAt[1]).ground);
  const close: LandHill = { id: 'cathedral-close', centre: at(kx - MASHA_LAND.close.west, kz + MASHA_LAND.bellCourt.south), height: closeHeight, radius: MASHA_LAND.close.radius, plateau: MASHA_LAND.close.plateau };
  const { innYard } = MASHA_LAND, courtAt = frame.world(kx, kz + MASHA_LAND.bellCourt.south);
  const courtHeight = half(sampleGenesisSurface(draft, courtAt[0], courtAt[1]).ground);
  const yard: LandHill = { id: 'inn-yard', centre: at(kx + innYard.east, kz + MASHA_LAND.bellCourt.south + innYard.south), height: courtHeight, radius: innYard.radius, plateau: innYard.plateau };
  return { ...draft, terrainCore: { ...terrainCore, hills: [...hills, terrace, close, yard] }, mountainPass: { ...source.mountainPass, saddle: [saddle[0], pass, saddle[2]] } };
}
