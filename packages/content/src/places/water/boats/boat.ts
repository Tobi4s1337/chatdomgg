import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, type StyleKey } from '../../../materials';
import { millBlueprint, runs, stroke, wood } from '../millrace/craft';
import { NO_METADATA, type Footing, type WaterPiece } from '../place-piece';
import { HULL, HULL_PAINT, checkBoat, hullBoxes, hullFree, sheer, type BoatVariant } from './hull';

/**
 * The rowing boat afloat. `draft` is the whole cells from y = 0 (the keel's underside amidships) to the waterline:
 * the host sets the boat's origin at water level − draft and bobs and yaws it about its painter.
 */
export const ROWING_BOAT = {
  size: [HULL.beam, HULL.height, HULL.length] as const satisfies Vec3,
  length: HULL.length,
  beam: HULL.beam,
  draft: HULL.draft,
} as const;

/**
 * The upturned boat ashore: the same hull keel up on two sawhorses, its gunwale two cells over the ground at the
 * stem head and three-quarters of a metre up amidships. The frame is one cell wider than the hull each side for the
 * sawhorse legs; the hull's x = 0 lands on x = 1.
 */
export const UPTURNED_BOAT = {
  size: [HULL.beam + 2, HULL.height + 2, HULL.length] as const satisfies Vec3,
  /** Cells between the ground and the lowest point of the hull (the stem head). */
  lift: 2,
  /** z of each sawhorse's two-cell top bar; each stands where the gunwale above it is level. */
  trestles: [7, 18],
} as const;

/** The oars lie on the thwarts, one cell over the thwart row, 2 m long between z 3 and 19. */
const OAR = { y: HULL.thwartRow + 1, z: [3, 19], blade: 5 } as const;

/** Oars are pale ash, so they read against the darker thwarts and floorboards they lie on. */
const OAR_WOOD = MAT.earth;

/**
 * Loose gear laid into the open boat, one checked cell at a time: every cell must be air the hull left open and
 * no two pieces of gear may share a cell. A broken layout throws rather than burying gear in a plank.
 */
class Gear {
  private readonly taken = new Set<string>();
  private readonly free = hullFree();
  constructor(private readonly b: Boxes, private readonly id: string) {}
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number): void {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
      const key = `${x},${y},${z}`;
      if (!this.free(x, y, z) || this.taken.has(key)) throw new Error(`${this.id}: gear meets the hull or other gear at ${key}.`);
      this.taken.add(key);
    }
    this.b.add(x0, y0, z0, x1, y1, z1, material);
  }
}

/**
 * An oar along the boat: a square loom, a worn grip and a flat blade two cells wide whose tip carries the boat's
 * top-strake colour. `inboard` is the side the blade widens towards (+1 or -1 across X).
 */
function oar(lay: (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number) => void,
  x: number, y: number, inboard: 1 | -1, bladeForward: boolean, style: StyleKey, tip: number): void {
  const { end } = wood(style), plank = OAR_WOOD, [z0, z1] = OAR.z, [bx0, bx1] = inboard > 0 ? [x, x + 2] : [x - 1, x + 1];
  const [blade0, blade1] = bladeForward ? [z1 - OAR.blade, z1] : [z0, z0 + OAR.blade];
  const grip = bladeForward ? z0 : z1 - 1, tipZ = bladeForward ? z1 - 1 : z0;
  const [loom0, loom1] = bladeForward ? [z0 + 1, blade0] : [blade1, z1 - 1];
  lay(x, y, grip, x + 1, y + 1, grip + 1, end);
  lay(x, y, loom0, x + 1, y + 1, loom1, plank);
  const [b0, b1] = tipZ === blade0 ? [blade0 + 1, blade1] : [blade0, blade1 - 1];
  lay(bx0, y, b0, bx1, y + 1, b1, plank);
  lay(bx0, y, tipZ, bx1, y + 1, tipZ + 1, tip);
}

/** Each variant's oars: [loom x, inboard side, blade forward]. */
const OARS: Readonly<Record<BoatVariant, readonly (readonly [number, 1 | -1, boolean])[]>> = {
  0: [[3, 1, true], [7, -1, true]],
  1: [[3, 1, true], [7, -1, false]],
  2: [[3, 1, false], [7, -1, false]],
};

/**
 * The small things that tell the three boats apart. 0: the painter coiled on the bow thwart. 1: a copper bailer on
 * the floorboards and a cushion on the stern thwart. 2: a wicker fish basket between the rowing and bow thwarts,
 * a fish's tail over its rim.
 */
function stow(g: Gear, variant: BoatVariant): void {
  const seat = HULL.thwartRow + 1, floor = HULL.floor + 1, rope = MAT.thatch;
  if (variant === 0) {
    const [z0] = HULL.thwarts[2];
    for (const [x, z] of [[4, 0], [5, 0], [6, 0], [4, 1], [6, 1], [4, 2], [5, 2], [6, 2]] as const) g.box(x, seat, z0 + z, x + 1, seat + 1, z0 + z + 1, rope);
    // The last turns lie over the coil's shoulder.
    g.box(6, seat + 1, z0 + 1, 7, seat + 2, z0 + 3, rope);
  } else if (variant === 1) {
    g.box(4, floor, 7, 6, floor + 1, 9, MAT.forgeCopper);
    g.box(4, floor + 1, 8, 6, floor + 2, 9, MAT.forgeCopper);
    const [z0, z1] = HULL.thwarts[0];
    g.box(4, seat, z0, 6, seat + 1, z1, MAT.cloth);
  } else {
    // Wicker sides round a full bottom, and the fish standing in it tail up.
    g.box(4, floor, 15, 7, floor + 1, 18, MAT.thatch);
    g.box(4, floor + 1, 15, 7, floor + 2, 16, MAT.thatch);
    g.box(4, floor + 1, 17, 7, floor + 2, 18, MAT.thatch);
    g.box(4, floor + 1, 16, 5, floor + 2, 17, MAT.thatch);
    g.box(6, floor + 1, 16, 7, floor + 2, 17, MAT.thatch);
    g.box(5, floor + 1, 16, 6, floor + 3, 17, MAT.darkStone);
    g.box(5, floor + 3, 16, 6, floor + 4, 17, MAT.cream);
  }
}

/**
 * A 3.5 m clinker rowing boat afloat, bow at +Z. Its painter mount is the forward face of the brass bow ring; the
 * host ties the painter there and bobs and yaws the boat about it. It carries no footings: it floats.
 */
export function createRowingBoat(style: StyleKey, variant: BoatVariant): WaterPiece {
  checkBoat('rowing boat', style, variant);
  const id = `water-boat-${style}-${variant}`, b = hullBoxes(style, variant), g = new Gear(b, id);
  const tip = HULL_PAINT[style][variant].top;
  for (const [x, inboard, forward] of OARS[variant]) oar(g.box.bind(g), x, OAR.y, inboard, forward, style, tip);
  stow(g, variant);
  const [rx, ry, rz] = HULL.ring;
  return {
    ...NO_METADATA,
    blueprint: millBlueprint(id, style, 'prop', ROWING_BOAT.size, b),
    mounts: [{ id: 'painter', position: [rx + 0.5, ry + 0.5, rz + 1], axis: [0, 1, 0] }],
  };
}

/**
 * The same boat hauled out and turned over on two sawhorses by the boathouse: tarred bottom and keel up, the
 * painted top strake underneath, the gunwale resting on both sawhorse bars. Its oars lie on the sawhorses' low
 * stretchers in the dry under the hull. The sawhorse feet are its footings on level ground.
 */
export function createUpturnedBoat(style: StyleKey, variant: BoatVariant): WaterPiece {
  checkBoat('upturned boat', style, variant);
  const id = `water-boat-upturned-${style}-${variant}`, { plank, end } = wood(style), b = new Boxes();
  const [SX, SY] = UPTURNED_BOAT.size, flip = UPTURNED_BOAT.lift + HULL.height;
  for (const box of hullBoxes(style, variant).list) {
    b.add(box.from[0] + 1, flip - box.to[1], box.from[2], box.to[0] + 1, flip - box.from[1], box.to[2], box.material);
  }
  const footings: Footing[] = [];
  const stretcher = 2;
  UPTURNED_BOAT.trestles.forEach((zt, t) => {
    if (sheer(zt) !== sheer(zt + 1)) throw new Error(`${id}: the gunwale is not level over the sawhorse at z ${zt}.`);
    // The bar lies just under the gunwale, which the flip puts at flip - sheer.
    const bar = flip - sheer(zt) - 1;
    b.add(0, bar, zt, SX, bar + 1, zt + 2, plank);
    b.add(0, bar, zt, 1, bar + 1, zt + 2, end);
    b.add(SX - 1, bar, zt, SX, bar + 1, zt + 2, end);
    for (const x of [0, SX - 1]) {
      // Two legs splayed fore and aft from under the bar, and the cross bar that braces them.
      const legs = [stroke([zt + 0.5, bar - 0.5], [zt - 1.5, 0.5]), stroke([zt + 1.5, bar - 0.5], [zt + 3.5, 0.5])];
      legs.forEach((cells, leg) => {
        const inside = cells.filter(([, y]) => y >= 0 && y < bar);
        runs(inside, (z0, z1, y) => b.add(x, y, z0, x + 1, y + 1, z1, plank));
        const feet = inside.filter(([, y]) => y === 0).map(([z]) => z);
        footings.push({ id: `foot-${t}-${x ? 'east' : 'west'}-${leg ? 'fore' : 'aft'}`, box: { from: [x, 0, Math.min(...feet)], to: [x + 1, 1, Math.max(...feet) + 1] } });
      });
      const braced = legs.flat().filter(([, y]) => y === stretcher).map(([z]) => z);
      b.add(x, stretcher, Math.min(...braced), x + 1, stretcher + 1, Math.max(...braced) + 1, plank);
    }
    b.add(1, stretcher, zt, SX - 1, stretcher + 1, zt + 2, plank);
  });
  // The oars, laid on both stretchers out of the weather.
  const tip = HULL_PAINT[style][variant].top;
  const put = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number) => b.add(x0, y0, z0, x1, y1, z1, m);
  oar(put, 4, stretcher + 1, 1, true, style, tip);
  oar(put, 8, stretcher + 1, -1, false, style, tip);
  if (SY !== flip) throw new Error(`${id}: frame height ${SY} does not hold the flipped hull.`);
  return { ...NO_METADATA, blueprint: millBlueprint(id, style, 'prop', UPTURNED_BOAT.size, b), footings };
}
