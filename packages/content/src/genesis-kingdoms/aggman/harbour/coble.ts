import { MAT } from '../../../materials';
import type { AggmanPiece, Livery } from '../piece';
import { layBasket, layCoil, layCreel, freePut, IRON, ROPE } from './gear';
import { Grid, noise, round } from './grid';
import { TAR, hullShape, layHull, type HullForm } from './hull';

/**
 * The harbour's hero boat: a 6.5 m clinker coble of the north-east coast, afloat. She has the coble's high, flared
 * bow over a deep forefoot, a low waist, a steeply raked transom with a deep rudder hung on it, and a lug sail on
 * a mast stepped well forward. Her paint is the kingdom's livery: a blue hull over a tarred bottom with a cream
 * band at the waterline and a gold top strake that sweeps up to the stem; the sail is livery red with a broad cream
 * band, the kingdom's mark on the water, read from across the harbour.
 *
 * Variant 0 is under sail: the yard hoisted to the masthead and the sail drawing, bellied to starboard (+X) with a
 * reef band of ties, its sheet led to the starboard quarter and its tack to the forward thwart; a burgee streams
 * from the masthead. Variant 1 lies at her mooring: the yard lowered onto the thwarts with the sail furled along it
 * under cream gaskets, the mast bare but for its halyard and forestay.
 *
 * Frame: build cells, bow at +Z, transom near z = 4 (the rudder hangs behind it), beam across X centred on
 * x = 9, y = 0 the underside of the keel amidships. `draft` (3) is the whole cells below the waterline. A brass
 * lantern stands on the masthead; its glass is the piece's one lantern cell.
 */
export const COBLE = {
  size: [18, 64, 56] as const,
  /** The hull's transom sits this far forward of the piece's z = 0, leaving room for the rudder. */
  hullAt: 4,
  length: 52,
  beam: 18,
  draft: 3,
  /** The mast's two-by-two cells and its height. */
  mast: { x: [8, 10] as const, z: [35, 37] as const, foot: 4, head: 55 },
  lantern: [8, 56, 35] as const,
} as const;

const L = COBLE.length, OZ = COBLE.hullAt, DRAFT = COBLE.draft;
const FLOOR = 3, THWART_ROW = 6;
/** Thwarts in hull stations: stern, waist, the mast thwart (wider, the mast passes through it) and forward. */
const THWARTS = [[6, 8], [17, 19], [29, 33], [39, 41]] as const;

/** The coble's lines. */
export const COBLE_FORM: HullForm = {
  length: L,
  beam: COBLE.beam,
  // Level under the waist and the forefoot, lifting aft to a shallow heel and curving hard up into the stem.
  keel: z => (z < 14 ? round(3 * ((14 - z) / 14) ** 1.5) : z > 40 ? round(12 * ((z - 40) / 11) ** 2.2) : 0),
  // A low waist, a little rise to the transom and a high sweep forward; the stem head stands two cells proud.
  sheer: z => (z <= 20 ? round(9 + 2.6 * ((20 - z) / 20) ** 1.6) : round(9 + 7 * ((z - 20) / 31) ** 1.9)) + (z === L - 1 ? 2 : 0),
  // A broad transom; full shoulders well forward drawing in to the stem.
  plan: z => (z <= 26 ? 1 - 0.24 * ((26 - z) / 26) ** 2 : 1 - ((z - 26) / (L - 1 - 26)) ** 2.2),
  // Garboard, bilge and the flaring topside strakes: each step out is a lap.
  section: [0, 3, 4, 5, 6, 6, 7, 7, 8, 8, 8, 8],
  fineness: (row, z) => (z > 26 ? 1 + 0.2 * (11 - row) : 1),
  // The transom leans aft three cells from its heel to its top.
  stern: y => Math.max(0, Math.min(3, round((3 * (11 - y)) / 8))),
  // The coble's run: aft the bottom flattens and broadens into the wide transom.
  fullness: z => (z < 16 ? round((2.4 * (16 - z)) / 16) : 0),
};

export type CobleVariant = 0 | 1;

export function createHarbourCoble(livery: Livery, variant: CobleVariant): AggmanPiece {
  if (variant !== 0 && variant !== 1) throw new RangeError(`harbour coble: variant must be 0 or 1, not ${String(variant)}.`);
  const [SX, SY, SZ] = COBLE.size, g = new Grid(SX, SY, SZ);
  const shape = hullShape(COBLE_FORM);
  const skin = (x: number, y: number, z: number): number => {
    if (y < DRAFT) return TAR;
    if (y === DRAFT) return livery.cream;
    if (y === COBLE_FORM.sheer(z) - 1 || (z === L - 1 && y >= COBLE_FORM.sheer(z) - 3)) return livery.gold;
    // The stem post shows its bare wood above the band.
    if (shape.halfBreadth(y, z) === 0 && z > 40) return MAT.timber;
    // Paint worn back to the planks just above the band, near both ends where the boat is pushed off and hauled.
    if (y === DRAFT + 1 && (z < 9 || z > 38) && noise(x, z, 7) < 0.35) return MAT.timber;
    return livery.blue;
  };
  layHull(g, shape, { skin, plank: MAT.timber, floorboard: MAT.bark, floor: FLOOR, thwartRow: THWART_ROW, thwarts: THWARTS }, 0, 0, OZ);
  rudder(g, livery);
  mast(g, livery);
  stemHead(g, livery);
  if (variant === 0) setSail(g, livery);
  else furl(g, livery);
  stow(g, variant);
  return {
    blueprint: g.blueprint(`genesis-aggman-harbour-coble-${variant}`),
    lanterns: [[...COBLE.lantern]],
    footprint: g.planFootprint(),
    draft: DRAFT,
  };
}

/**
 * The coble's deep rudder, hung on the raked transom by two brass pintles: its blade runs down below the keel
 * line and forward under the heel, tarred below the water and painted above, and the tiller sweeps forward over
 * the transom into the stern sheets.
 */
function rudder(g: Grid, livery: Livery): void {
  const stern = COBLE_FORM.stern!, top = COBLE_FORM.sheer(0) + 2;
  for (let y = 0; y < top; y++) {
    const face = OZ + stern(y);
    // Leading edge: against the transom, or under the heel where the hull lifts clear of the water.
    const lead = y < 3 ? OZ + 3 : face;
    const trail = y > COBLE_FORM.sheer(0) - 1 ? lead - 2 : y < 3 ? 0 : y < 7 ? 0 : 1;
    for (let z = trail; z < lead; z++) {
      const m = y < DRAFT ? TAR : y >= top - 1 ? livery.gold : livery.blue;
      g.box(8, y, z, 10, y + 1, z + 1, m);
    }
  }
  // Pintles: brass straps round the rudder's leading edge, let into the transom.
  for (const y of [5, 9]) {
    const z = OZ + stern(y) - 1;
    g.box(7, y, z, 8, y + 1, z + 1, livery.brass);
    g.box(10, y, z, 11, y + 1, z + 1, livery.brass);
  }
  // The tiller, from the rudder head forward and a cell up into a worn grip.
  const head = top - 1;
  g.box(8, head, 1, 10, head + 1, 13, MAT.timber);
  g.box(8, head + 1, 12, 10, head + 2, 16, MAT.timber);
  g.box(8, head + 1, 16, 10, head + 2, 17, MAT.bark);
}

/**
 * The mast, stepped on the floorboards and through the mast thwart: a dark heel, a brass band at the thwart and
 * at the hounds, the halyard's fall down its port side, a forestay to the stem head, and the masthead lantern: a
 * brass base and cap, four corner posts and the glass between them.
 */
function mast(g: Grid, livery: Livery): void {
  const { x: [x0, x1], z: [z0, z1], foot, head } = COBLE.mast;
  g.box(x0, foot, z0, x1, head, z1, MAT.timber);
  g.box(x0, foot, z0, x1, foot + 2, z1, MAT.bark);
  g.box(x0 - 1, THWART_ROW + 1, z0 - 1, x1 + 1, THWART_ROW + 2, z1 + 1, livery.brass);
  g.box(x0, head - 4, z0, x1, head - 3, z1, livery.brass);
  // Halyard fall, belayed at the thwart.
  g.box(x0 - 1, THWART_ROW + 2, z0, x0, head, z0 + 1, ROPE);
  // Forestay to the stem head.
  g.stroke([x0 + 0.5, head - 1.5, z1 + 0.5], [x0 + 0.5, COBLE_FORM.sheer(L - 1) - 0.5, OZ + L - 0.5], ROPE, 0.75, true);
  // The lantern.
  const [lx0, lx1, lz0, lz1] = [x0 - 1, x1 + 1, z0 - 1, z1 + 1];
  g.box(lx0, head, lz0, lx1, head + 1, lz1, livery.brass);
  for (const x of [lx0, lx1 - 1]) for (const z of [lz0, lz1 - 1]) g.box(x, head + 1, z, x + 1, head + 3, z + 1, livery.brass);
  g.box(x0, head + 1, z0, x1, head + 3, z1, MAT.glass);
  g.box(lx0, head + 3, lz0, lx1, head + 4, lz1, livery.brass);
  g.box(x0, head + 4, z0, x1, head + 5, z1, livery.brass);
  // The burgee's spindle, and the burgee streaming to leeward: livery red with a gold tip.
  g.box(x0, head + 5, z0, x0 + 1, head + 9, z0 + 1, IRON);
  g.box(x0 + 1, head + 7, z0, x0 + 5, head + 8, z0 + 1, livery.red);
  g.box(x0 + 5, head + 7, z0, x0 + 7, head + 8, z0 + 1, livery.gold);
  g.box(x0 + 1, head + 6, z0, x0 + 4, head + 7, z0 + 1, livery.red);
}

/** A brass band round the stem head, where the painter is made fast. */
function stemHead(g: Grid, livery: Livery): void {
  const z = OZ + L - 1, top = COBLE_FORM.sheer(L - 1);
  for (let x = 0; x < COBLE.beam; x++) if (g.get(x, top - 3, z)) g.set(x, top - 3, z, livery.brass);
}

/** The yard's line, as a cell-space point at station z: its fore end low over the bow, its peak high aft. */
const YARD = { fore: [44.5, 41.5] as const, peak: [7.5, 58.5] as const };
const yardY = (z: number) => YARD.fore[1] + ((YARD.fore[0] - z) * (YARD.peak[1] - YARD.fore[1])) / (YARD.fore[0] - YARD.peak[0]);

/**
 * The lug sail set and drawing. Its outline: the luff rising from the tack forward of the mast to the yard's
 * fore end, the head laced under the yard, the leech falling from the peak to the clew over the transom, and a
 * loose foot that lifts in a curve as the wind fills it. The cloth bellies to starboard, deepest two fifths aft
 * of the luff, and flat where it is laced to the yard. A broad cream band crosses
 * it, a row of reef ties stands on both faces, the sheet runs from the clew to the starboard quarter and the tack
 * line down to the forward thwart.
 */
function setSail(g: Grid, livery: Livery): void {
  const tack = [43, 15] as const, clew = [5, 16] as const;
  const luffZ = (y: number) => tack[0] + (y - tack[1]) / 26;
  const leechZ = (y: number) => clew[0] + ((y - clew[1]) * 3) / 41;
  const footY = (z: number) => {
    const s = (z - clew[0]) / (tack[0] - clew[0]);
    return clew[1] + s * (tack[1] - clew[1]) + 1.6 * Math.sin(Math.PI * Math.max(0, Math.min(1, s)));
  };
  const headY = (z: number) => yardY(z) - 0.8;
  const inSail = (y: number, z: number) => {
    const yc = y + 0.5, zc = z + 0.5;
    return zc >= leechZ(yc) && zc <= luffZ(yc) && yc >= footY(zc) && yc <= headY(zc);
  };
  // The belly is shaped along the chord and held over the height, flattening only into the head where the cloth
  // is laced to the yard, so its steps run up the sail like the seams between its cloths.
  const BELLY = 3.6;
  const offset = (y: number, z: number) => {
    const yc = y + 0.5, zc = z + 0.5;
    const t = (luffZ(yc) - zc) / (luffZ(yc) - leechZ(yc));
    const v = (yc - footY(zc)) / (headY(zc) - footY(zc));
    const chord = Math.sin(Math.PI * Math.max(0, Math.min(1, t)) ** 0.78);
    const height = Math.max(0, Math.min(1, (1 - v) / 0.2)) ** 0.8;
    return round(BELLY * chord * height);
  };
  const X0 = COBLE.mast.x[1];
  const band = (y: number) => y >= 26 && y < 30;
  for (let y = 0; y < g.sy; y++) for (let z = 0; z < g.sz; z++) {
    if (!inSail(y, z)) continue;
    const o = offset(y, z);
    let lo = o, hi = o;
    // Close every step in the cloth against the neighbours below and aft, so the sheet is face-connected.
    for (const [ny, nz] of [[y - 1, z], [y, z - 1]] as const) if (inSail(ny, nz)) { const n = offset(ny, nz); lo = Math.min(lo, n); hi = Math.max(hi, n); }
    for (let o2 = lo; o2 <= hi; o2++) g.set(X0 + o2, y, z, band(y) ? livery.cream : livery.red);
  }
  // Reef ties: a row of short cream points on both faces of the cloth.
  const reef = 20;
  for (let z = 7; z < 42; z += 3) {
    if (!inSail(reef, z)) continue;
    const o = offset(reef, z);
    g.fill(X0 + o + 1, reef, z, livery.cream);
    g.fill(X0 + o + 1, reef - 1, z, livery.cream);
    if (o > 0) g.fill(X0 + o - 1, reef, z, livery.cream);
  }
  // The yard, laced along the head, crossing the mast's starboard face.
  g.stroke([X0 + 0.5, YARD.fore[1], YARD.fore[0]], [X0 + 0.5, YARD.peak[1], YARD.peak[0]], MAT.timber, 0.75);
  // Its parrel round the mast, and the halyard's sling over the masthead.
  const sling = Math.floor(yardY(36));
  for (const [x, z] of [[7, 34], [8, 34], [9, 34], [7, 35], [7, 36], [7, 37], [8, 37], [9, 37]] as const) g.fill(x, sling, z, livery.brass);
  g.box(X0, sling + 1, 36, X0 + 1, COBLE.mast.head - 1, 37, ROPE);
  // Sheet from the clew to the starboard quarter; tack line down to the forward thwart.
  g.stroke([X0 + 0.5, clew[1] + 0.5, clew[0] + 1.5], [15.5, COBLE_FORM.sheer(2) + 0.5, OZ + 2.5], ROPE, 0.9, true);
  g.box(X0, THWART_ROW + 1, 44, X0 + 1, tack[1] + 1, 45, ROPE);
}

/**
 * At her mooring: the yard lowered fore-and-aft onto the thwarts to starboard of the mast, the sail rolled along it
 * in a fat red bundle tied with cream gaskets, the yard's ends showing past the roll.
 */
function furl(g: Grid, livery: Livery): void {
  const y0 = THWART_ROW + 1, z0 = 11;
  // The roll keeps to the air beside the mast: as the boat draws in forward it slims to fit between the mast's
  // starboard face (x = 10) and the lining, and it ends where it can no longer be three cells across.
  const room = (z: number) => {
    let right = 10;
    while (right < 15 && [0, 1, 2, 3].every(dy => g.get(right, y0 + dy, z) === MAT.air)) right++;
    return right;
  };
  let z = z0, centre = 12;
  for (; z < g.sz; z++) {
    const x1 = room(z);
    if (x1 - 10 < 4) break;
    const gasket = (z - z0) % 6 === 3;
    const swell = x1 - 10 === 5 && noise(z, 3) < 0.3 ? 1 : 0;
    const m = gasket ? livery.cream : livery.red;
    centre = Math.floor((10 + x1) / 2);
    g.free(11, y0, z, x1 - 1, y0 + 1, z + 1, m, 'furled sail');
    g.free(10, y0 + 1, z, x1, y0 + 3, z + 1, m, 'furled sail');
    g.free(11, y0 + 3, z, x1 - 1, y0 + 4 + swell, z + 1, m, 'furled sail');
    if (gasket) g.free(centre, y0 + 4 + swell, z, centre + 1, y0 + 5 + swell, z + 1, livery.cream, 'gasket');
  }
  // The yard through the roll, its ends proud of the cloth: the peak resting on the stern thwart, the fore end
  // run out towards the bow.
  g.free(12, y0 + 1, 8, 13, y0 + 2, z0, MAT.timber, 'yard');
  const end = z;
  for (; z < end + 4 && g.get(centre, y0 + 1, z) === MAT.air && g.get(centre, y0 + 1, z + 1) === MAT.air; z++) g.set(centre, y0 + 1, z, MAT.timber);
  if (z > end) g.set(centre, y0 + 1, z - 1, MAT.bark);
}

/**
 * Gear on the floorboards. Under sail: a lobster pot to port of the waist, a coil of rope beside it and a basket
 * of the morning's fish in the stern sheets. At her mooring: two pots stacked to port and the coil in the stern.
 */
function stow(g: Grid, variant: CobleVariant): void {
  const put = freePut(g), floor = FLOOR + 1;
  layCreel(put, 4, floor, 24, 'z', variant === 1);
  if (variant === 0) {
    layCoil(put, 11.5, floor, 27.5, 2.4, 1);
    layBasket(put, 5, floor, 13, MAT.stone);
  } else {
    layCreel(put, 4, floor + 4, 24, 'z', false);
    layCoil(put, 8.5, floor, 16.5, 2.4, 1);
  }
}
