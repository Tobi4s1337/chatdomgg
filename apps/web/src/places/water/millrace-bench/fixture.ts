// SIMULATED millrace geography for the millrace review page: a millpond held by a weir, the stream past a wheel
// pit fed by its launder from an earth leat, and the humpback bridge over a quiet pool downstream. Every height
// and site here is a bench fixture, never a land decision; production code never imports this module. The pieces
// themselves are the lane's real content factories, sized from this fixture exactly as a host would size them
// from the land's sampler.
import type { Vec3 } from '@chatdom/shared';
import { createHumpbackBridge, BRIDGE } from '../../../../../../packages/content/src/places/water/bridge/index';
import { WEIR, createMillWheel, createWeir, createWheelPit, weirFrame, wheelPitFrame, wheelPitTrestles, WHEEL_PIT } from '../../../../../../packages/content/src/places/water/millrace/index';
import { createFishingRock, createLilies, createPebbles, createReeds, createSteppingStones } from '../../../../../../packages/content/src/places/water/shore/index';
import type { WaterPiece } from '../../../../../../packages/content/src/places/water/place-piece';

export const SIMULATED_MILLRACE = 'SIMULATED · MILLRACE & BRIDGE BENCH · fixture land, no people';

/** Build cells to metres. */
const CELL = 0.125;
export type Turn = 0 | 1 | 2 | 3;

/**
 * One static piece: `origin` is the blueprint's (0,0,0) corner in world metres, yawed by `turn` quarter turns about
 * it. A mounted part instead names its own `pivot` (local metres), which lands on `origin` and turns by `yaw`.
 */
export interface Placement {
  readonly id: string;
  readonly piece: WaterPiece;
  readonly origin: Vec3;
  readonly turn: Turn;
  readonly mounted?: { readonly pivot: Vec3; readonly yaw: number };
}

/** A water surface with its own bed mask: the renderer draws it only where the fixture ground lies below `level`. */
export interface FixtureWater {
  readonly id: string;
  readonly level: number;
  readonly centre: readonly [number, number];
  readonly radius: readonly [number, number];
  /** Columns of the shared ground grid this body covers. */
  readonly covers: (x: number, z: number) => boolean;
}

export interface FixtureView { readonly eye: Vec3; readonly target: Vec3; readonly fov: number }

export interface MillraceFixture {
  readonly label: string;
  readonly ground: { readonly origin: [number, number]; readonly step: number; readonly width: number; readonly depth: number; readonly data: Float32Array };
  readonly placements: readonly Placement[];
  readonly waters: readonly FixtureWater[];
  readonly views: Readonly<Record<'mill-wheel' | 'bridge-pond', { readonly wide: FixtureView; readonly tall: FixtureView }>>;
  readonly shadowBounds: { readonly min: Vec3; readonly max: Vec3 };
}

/** Optional pieces the review composes when their factories exist; each arrives with its own footprint. */
export interface FixtureExtras {
  readonly mill?: WaterPiece;
  readonly fingerpost?: { readonly post: WaterPiece; readonly arms: readonly { readonly mount: string; readonly piece: WaterPiece; readonly yaw: number }[] };
}

// ── The fixture's geography, in metres. x runs east, z south; the stream flows +Z. ─────────────────────────────
const STREAM_X = -4;
const STREAM_LEVEL = 0;
/** The tailrace and stream bed, three cells under the water: the wheel pit's floor sits on it. */
const BED = STREAM_LEVEL - 3 * CELL;
const POND = { x: -8.5, z: -31, rx: 8, rz: 8.6 } as const;

const smooth = (a: number, b: number, t: number) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function millraceFixture(extras: FixtureExtras = {}): MillraceFixture {
  // The weir: its downstream bed is the stream bed, so the pond stands `drop` cells over the tail water.
  const weirDrop = 6, weirWidth = 32, wf = weirFrame(weirWidth, weirDrop);
  const weirOrigin: Vec3 = [STREAM_X - (WEIR.wing + weirWidth / 2) * CELL, STREAM_LEVEL - wf.downstream * CELL, -22.5];
  const pondLevel = weirOrigin[1] + wf.upstream * CELL;

  // The wheel pit east of the stream, the launder running back up the hill to the earth leat.
  const run = 48, pf = wheelPitFrame(run);
  const pitOrigin: Vec3 = [0, BED, -14];
  const pitEnd = pitOrigin[2] + pf.size[2] * CELL, pitStart = pitOrigin[2] + pf.pitStart * CELL;
  const troughFloor = BED + pf.troughFloor * CELL;
  const leatX = pitOrigin[0] + pf.leatEnd[0] * CELL;

  // The bridge downstream, over a pool deepened under its arch.
  const bridgeWater = 6, bridgeBank = 13;
  const bridgeBed = STREAM_LEVEL - bridgeWater * CELL;
  const bridgeZ = 12;
  const bridgeOrigin: Vec3 = [STREAM_X - BRIDGE.centre * CELL, bridgeBed, bridgeZ];
  const bankTop = bridgeBed + bridgeBank * CELL;
  const bridgeEnds = [bridgeOrigin[0], bridgeOrigin[0] + BRIDGE.size[0] * CELL] as const;

  // The mill east of the pit: its wheel-side plinth against the pit's outer wall, turned to face the wheel, and its
  // shaft collar on the wheel's axle line, so the wheel drives it. Its front and yard face north, up the leat.
  const hub = add(pitOrigin, metres(pf.hub));
  const mill = extras.mill && (() => {
    const shaft = extras.mill.mounts.find(m => m.id === 'shaft');
    if (!shaft) throw new Error('The mill needs its shaft mount.');
    const [sx, , sz] = metres(extras.mill.blueprint.size), [mx, my, mz] = metres(shaft.position);
    const at: Vec3 = [pitOrigin[0] + WHEEL_PIT.width * CELL + mx, hub[1] - my, hub[2] + mz];
    return { piece: extras.mill, origin: at, x: [at[0] - sx, at[0]] as const, z: [at[2] - sz, at[2]] as const };
  })();

  /** The valley: low banks by the water, rising gently away from it, and a hill north-east carrying the leat. */
  const land = (x: number, z: number): number => {
    const d = Math.abs(x - STREAM_X);
    let h = lerp(0.55, 1.35, smooth(3, 16, d)) + 0.08 * Math.sin(x * 0.53 + z * 0.21) + 0.06 * Math.sin(z * 0.37 - x * 0.19);
    // A broad hillside rising north-east of the pit, and the slope the launder's trestles climb towards the leat.
    h += 2.1 * smooth(-7, -22, z) * smooth(-2.5, 6, x);
    const leat = Math.abs(x - leatX);
    h = Math.max(h, lerp(0.9, troughFloor - 1.6, smooth(-pitStart, -pitOrigin[2], -z)) - 0.45 * Math.max(0, leat - 2.5));
    // The earth leat: a raised bank carrying its channel along the hill, the bed level with the launder floor and its
    // sides falling about one in one to the hillside.
    if (z < pitOrigin[2] + 0.25) {
      const crest = troughFloor + 0.65;
      h = Math.max(h, crest - Math.max(0, leat - 1.3) * 0.95);
      if (leat < 1.3) h = leat < 0.55 ? troughFloor : lerp(troughFloor, crest, (leat - 0.55) / 0.75);
    }
    return h;
  };
  /** Carves a channel whose banks ease from `bed` at `half` to the land over `slope` metres. */
  const carve = (h: number, distance: number, half: number, slope: number, bed: number) =>
    distance <= half ? Math.min(h, bed) : distance < half + slope ? Math.min(h, lerp(bed, h, smooth(0, 1, (distance - half) / slope))) : h;

  const height = (x: number, z: number): number => {
    let h = land(x, z);
    // The pond: a shelving bowl, deepest at its middle.
    const p = Math.hypot((x - POND.x) / POND.rx, (z - POND.z) / POND.rz);
    if (p < 1.35) h = Math.min(h, p < 1 ? lerp(pondLevel - 0.95, pondLevel - 0.2, p * p) : lerp(pondLevel - 0.2, h, (p - 1) / 0.35));
    // The pond's mouth runs into the weir.
    if (z > -27.5 && z < weirOrigin[2] + 0.3) h = carve(h, Math.abs(x - STREAM_X), 2, 1.4, pondLevel - 0.7);
    // The stream from the weir to the scene's southern edge, widening into the bridge pool.
    if (z >= weirOrigin[2]) {
      const pool = smooth(bridgeZ - 4.5, bridgeZ - 1.5, z) * (1 - smooth(bridgeZ + 5.5, bridgeZ + 9, z));
      h = carve(h, Math.abs(x - STREAM_X - 0.4 * Math.sin(z * 0.18)), lerp(2, 3.1, pool), lerp(1.3, 1.8, pool), lerp(BED, bridgeBed, pool));
    }
    // The tailrace: out of the pit's open end, then west into the stream.
    const pitX = pitOrigin[0] + 2;
    if (z >= pitEnd - 0.5 && z < pitEnd + 3.2) h = carve(h, Math.abs(x - pitX), 1.25, 0.6, BED);
    if (x > STREAM_X && x < pitX + 0.5) h = carve(h, Math.abs(z - (pitEnd + 2.2)), 1.1, 0.6, BED);
    // The mill's levelled garth: its floor at the plinth's foot, easing back into the hillside over three metres.
    if (mill) {
      const out = Math.hypot(Math.max(0, mill.x[0] - x, x - mill.x[1]), Math.max(0, mill.z[0] - z, z - mill.z[1]));
      h = lerp(mill.origin[1] - 0.03, h, smooth(0, 3, out));
    }
    // Pieces bear on their own foundations: the ground stays under their solid bodies, never through them.
    const inside = (o: Vec3, sx: number, sz: number, pad = 0) => x > o[0] - pad && x < o[0] + sx * CELL + pad && z > o[2] - pad && z < o[2] + sz * CELL + pad;
    if (inside(weirOrigin, wf.size[0], wf.size[2])) h = Math.min(h, weirOrigin[1] - 0.04);
    if (inside([pitOrigin[0], 0, pitStart], WHEEL_PIT.width, WHEEL_PIT.length)) h = Math.min(h, BED - 0.04);
    if (inside(bridgeOrigin, BRIDGE.size[0], BRIDGE.size[2], 0.6)) h = Math.min(h, bankTop - 0.03);
    if (x < bridgeEnds[0] + 0.1 && x > bridgeEnds[0] - 3 && Math.abs(z - bridgeZ - 2) < 3.5) h = lerp(bankTop - 0.03, h, smooth(0, 3, bridgeEnds[0] - x));
    if (x > bridgeEnds[1] - 0.1 && x < bridgeEnds[1] + 3 && Math.abs(z - bridgeZ - 2) < 3.5) h = lerp(bankTop - 0.03, h, smooth(0, 3, x - bridgeEnds[1]));
    return h;
  };

  // The ground grid every renderer piece shares: terrain shading, water masks and the pieces' sampled feet.
  const step = 0.5, origin: [number, number] = [-26, -46];
  const width = 2 * 26 / step + 1, depth = (46 + 30) / step + 1;
  const data = new Float32Array(width * depth);
  for (let k = 0; k < depth; k++) for (let i = 0; i < width; i++) data[i + width * k] = height(origin[0] + i * step, origin[1] + k * step);
  const sample = (x: number, z: number) => height(x, z);

  // The launder's trestle feet: the supplied ground under each trestle, in cells above the pit floor.
  const feet = pf.trestles.map(zc => {
    const z = pitOrigin[2] + zc * CELL;
    return Math.max(WHEEL_PIT.foot[0], Math.min(WHEEL_PIT.foot[1], Math.round((sample(leatX, z) - BED) / CELL)));
  });
  if (feet.length !== wheelPitTrestles(run)) throw new Error('Fixture trestle count disagrees with the pit.');

  const placements: Placement[] = [
    { id: 'weir', piece: createWeir('grove', weirWidth, weirDrop), origin: weirOrigin, turn: 0 },
    { id: 'wheel-pit', piece: createWheelPit('grove', run, feet), origin: pitOrigin, turn: 0 },
    { id: 'wheel', piece: createMillWheel('grove'), origin: add(pitOrigin, metres(pf.wheelOffset)), turn: 0 },
    { id: 'bridge', piece: createHumpbackBridge('hearth', bridgeWater, bridgeBank), origin: bridgeOrigin, turn: 0 },
  ];

  // Shore life: reeds where banks meet water, lilies on the still pond and the pool's slack edge, a pebble shoal in
  // the stream and the stepping stones out to the fishing rock in the pond's shallows.
  const onGround = (id: string, piece: WaterPiece, x: number, z: number, turn: Turn = 0, lift = 0): Placement => {
    const [sx, , sz] = piece.blueprint.size, footprint = turn % 2 ? [sz, sx] : [sx, sz];
    const corner: Vec3 = [x - (footprint[0]! * CELL) / 2, 0, z - (footprint[1]! * CELL) / 2];
    let y = Infinity;
    for (const [u, v] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]] as const) {
      y = Math.min(y, sample(corner[0] + u * footprint[0]! * CELL, corner[2] + v * footprint[1]! * CELL));
    }
    return { id, piece, origin: turned([corner[0], y + lift, corner[2]], piece.blueprint.size, turn), turn };
  };
  const onWater = (id: string, piece: WaterPiece, x: number, z: number, level: number, turn: Turn = 0): Placement => {
    const [sx, , sz] = piece.blueprint.size, footprint = turn % 2 ? [sz, sx] : [sx, sz];
    return { id, piece, origin: turned([x - (footprint[0]! * CELL) / 2, level, z - (footprint[1]! * CELL) / 2], piece.blueprint.size, turn), turn };
  };
  const reeds: readonly [number, number, number, Turn][] = [
    [-14.6, -27, 0, 0], [-15.2, -33.5, 1, 1], [-12.5, -38.6, 2, 0], [-6.5, -39.4, 0, 2], [-1.2, -35, 1, 3], [-0.9, -28.6, 2, 1],
    [-6.6, -14.5, 0, 0], [-1.6, -11.5, 2, 2], [-6.9, -4.5, 1, 1], [-1.4, 3.5, 0, 3], [-7.5, 8.5, 2, 0], [-0.1, 9.2, 1, 2],
    [-7.9, 19.6, 0, 1], [0.4, 22.6, 2, 3], [-8.4, 25, 1, 0],
  ];
  reeds.forEach(([x, z, v, t], i) => placements.push(onGround(`reeds-${i}`, createReeds(i % 3 ? 'grove' : 'hearth', v), x, z, t)));
  const lilies: readonly [number, number, number, Turn, number][] = [
    [-11, -29, 0, 0, pondLevel], [-6, -35.5, 1, 1, pondLevel], [-10.5, -36, 2, 2, pondLevel], [-6.2, 17.5, 2, 1, STREAM_LEVEL],
  ];
  lilies.forEach(([x, z, v, t, level], i) => placements.push(onWater(`lilies-${i}`, createLilies(i % 2 ? 'hearth' : 'grove', v), x, z, level + 0.01, t)));
  placements.push(onGround('pebbles-0', createPebbles('grove', 0), STREAM_X + 0.6, 4.5, 0));
  placements.push(onGround('pebbles-1', createPebbles('hearth', 1), STREAM_X - 0.4, -10.5, 1));
  placements.push(onGround('pebbles-2', createPebbles('grove', 2), STREAM_X + 0.8, 24, 3));
  const pondBed = pondLevel - 0.75;
  const stones = createSteppingStones('grove', 1, 6), rock = createFishingRock('grove', 0, 6);
  placements.push({ id: 'stepping-stones', piece: stones, origin: turned([-15.4, pondBed, -32.6], stones.blueprint.size, 3), turn: 3 });
  placements.push({ id: 'fishing-rock', piece: rock, origin: [-11.4, pondBed, -33.4], turn: 0 });

  // The mill and fingerpost, when their factories are composed in.
  if (mill) placements.push({ id: 'mill', piece: mill.piece, origin: mill.origin, turn: 2 });
  if (extras.fingerpost) {
    const post = extras.fingerpost.post;
    // At the bridge's west foot, beside the path where it comes off the deck.
    const [px, pz] = [bridgeEnds[0] - 2.4, bridgeZ + BRIDGE.size[2] * CELL + 0.4], half = (post.blueprint.size[0] * CELL) / 2;
    const corner: Vec3 = [px, sample(px + half, pz + half) - 0.04, pz];
    placements.push({ id: 'fingerpost', piece: post, origin: corner, turn: 0 });
    for (const arm of extras.fingerpost.arms) {
      const mount = post.mounts.find(m => m.id === arm.mount);
      if (!mount) throw new Error(`Fingerpost has no mount ${arm.mount}.`);
      const root = arm.piece.mounts.find(m => m.id === 'root');
      if (!root) throw new Error('A fingerpost arm needs its root mount.');
      // The arm's root pivot meets the post's collar; the arm then yaws about it to its supplied bearing.
      const at = add(corner, metres(mount.position));
      placements.push({ id: `arm-${arm.mount}`, piece: arm.piece, origin: at, turn: 0, mounted: { pivot: metres(root.position), yaw: arm.yaw } });
    }
  }

  const waters: FixtureWater[] = [
    { id: 'millpond', level: pondLevel, centre: [POND.x, -27], radius: [12, 12], covers: (x, z) => z < weirOrigin[2] + 0.4 },
    { id: 'stream', level: STREAM_LEVEL, centre: [STREAM_X, 4], radius: [14, 22], covers: (x, z) => z >= weirOrigin[2] + 1 && !(x > -0.2 && z < pitStart) },
    { id: 'tailrace', level: STREAM_LEVEL, centre: [pitOrigin[0] + 2, pitStart + 3], radius: [3.5, 4], covers: (x, z) => x > -0.2 && z >= pitStart && z < pitEnd + 4 },
    { id: 'leat', level: troughFloor + 0.28, centre: [leatX, -30], radius: [2.5, 16], covers: (x, z) => z < pitOrigin[2] + 0.2 && Math.abs(x - leatX) < 1.4 },
  ];

  const views = {
    'mill-wheel': {
      wide: { eye: [-9.2, 5.6, 6.4], target: [3.6, 3.1, -7.6], fov: 46 },
      tall: { eye: [-8.2, 6.4, 10.4], target: [5.4, 3.6, -6.2], fov: 62 },
    },
    'bridge-pond': {
      wide: { eye: [STREAM_X - 2, 1.4, 31], target: [STREAM_X - 4, 2.0, bridgeZ + 1], fov: 50 },
      tall: { eye: [STREAM_X + 1.6, 1.1, 29], target: [STREAM_X - 0.3, 2.4, bridgeZ + 1], fov: 60 },
    },
  } as const satisfies MillraceFixture['views'];

  return {
    label: SIMULATED_MILLRACE,
    ground: { origin, step, width, depth, data },
    placements, waters, views,
    shadowBounds: { min: [origin[0], BED - 1, origin[1]], max: [origin[0] + (width - 1) * step, 12, origin[1] + (depth - 1) * step] },
  };
}

/** The origin that yaws a piece by `turn` about its corner and lands its turned footprint at `corner`. */
export function turned(corner: Vec3, size: Vec3, turn: Turn): Vec3 {
  const [w, , d] = metres(size);
  const shift: readonly [number, number] = turn === 0 ? [0, 0] : turn === 1 ? [0, w] : turn === 2 ? [w, d] : [d, 0];
  return [corner[0] + shift[0], corner[1], corner[2] + shift[1]];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const metres = (cells: Vec3): Vec3 => [cells[0] * CELL, cells[1] * CELL, cells[2] * CELL];

