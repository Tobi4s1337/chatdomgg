import { MAT } from '../materials';
import { Boxes, octagon, type CivicKit } from './kit';

/**
 * Market furniture beside the core stalls and well: a two-wheeled gift cart and one stack of prepared stores.
 * Both kits share the forms; the goods, paint and cord are what change. Hearth brings red-wrapped bundles,
 * terracotta crocks, loaves and apples; Tide brings hessian bundles on a cream-painted cart, stoneware, greens and
 * brass-hooped casks. Nothing here is priced or sold: the cart brings gifts, the stores are laid in for a gathering.
 */
interface MarketTreatment {
  /** The cart's side and tail boards, between timber rails. */
  readonly panel: number;
  /** One plank line or painted stripe along the boards. */
  readonly stripe: number;
  /** Stakes, corner posts and the darker alternate boards. */
  readonly stake: number;
  readonly wrap: number;
  readonly ribbon: number;
  readonly crock: number;
  readonly bloom: number;
  readonly produce: number;
  /** The few lighter tops in a heap of produce: an apple's blush, the pale heart of a cabbage. */
  readonly highlight: number;
  readonly loaf: number;
  readonly sack: number;
  readonly tie: number;
  readonly hoop: number;
}

const TREATMENTS: Readonly<Record<CivicKit['style'], MarketTreatment>> = {
  hearth: {
    panel: MAT.timber, stripe: MAT.bark, stake: MAT.bark, wrap: MAT.cloth, ribbon: MAT.cream, crock: MAT.terracotta,
    bloom: MAT.petal, produce: MAT.cloth, highlight: MAT.petal, loaf: MAT.cream, sack: MAT.thatch, tie: MAT.bark,
    hoop: MAT.darkStone,
  },
  tide: {
    panel: MAT.cream, stripe: MAT.slate, stake: MAT.timber, wrap: MAT.thatch, ribbon: MAT.slate, crock: MAT.stone,
    bloom: MAT.blueFlower, produce: MAT.leaf, highlight: MAT.moss, loaf: MAT.earth, sack: MAT.cream, tie: MAT.slate,
    hoop: MAT.brass,
  },
};

/**
 * Gift cart planes in build cells (README, "Gift cart"). Long axis X, handle at x 0, open front +Z. The wheels
 * turn on one axle at x 21, y 7 with radius 7, so each rim stands on the ground at y 0; the bed is level at
 * y 10 and rests on the axle and on two legs under the handle end.
 */
export const GIFT_CART = {
  size: [32, 32, 24], axle: [21, 7], radius: 7, wheels: [[1, 3], [21, 23]], bed: { from: [8, 8, 5], to: [32, 10, 19] },
  legs: [9, 11], grip: [0, 2],
} as const;

export function giftCart(kit: CivicKit): Boxes {
  const b = new Boxes(), t = TREATMENTS[kit.style];
  const [ax, ay] = GIFT_CART.axle;
  // Running gear: the axle passes under the bed into two hubs, and both spoked wheels stand clear of the boards.
  b.add(ax - 1, ay - 1, 3, ax + 1, ay + 1, 21, kit.trim);
  for (const [z, Z] of GIFT_CART.wheels) wheel(b, kit, t, ax, ay, GIFT_CART.radius, z, Z);
  // Two legs under the handle end keep the bed level when the cart is set down, with a brace between them.
  for (const z of [6, 16]) b.add(9, 0, z, 11, 8, z + 2, kit.trim);
  b.add(9, 3, 8, 11, 4, 16, MAT.bark);
  // The bed: two bearers along the length, a planked floor, then rails and boards on three sides.
  for (const z of [6, 16]) b.add(8, 7, z, 32, 8, z + 2, MAT.bark);
  b.add(8, 8, 5, 32, 10, 19, kit.trim);
  for (let x = 8; x < 32; x += 3) b.add(x, 9, 5, x + 1, 10, 19, t.stake);
  for (const [z, Z] of [[5, 6], [18, 19]] as const) {
    b.add(8, 10, z, 32, 14, Z, t.panel);
    b.add(8, 11, z, 32, 12, Z, t.stripe);
    b.add(8, 13, z, 32, 14, Z, kit.trim);
  }
  b.add(8, 10, 6, 9, 12, 18, kit.trim);
  // Stakes hold the boards in at a steady rhythm and stand one cell proud of the top rail.
  for (const x of [8, 14, 26, 30]) for (const [z, Z] of [[4, 6], [18, 20]] as const) b.add(x, 9, z, x + 2, 15, Z, t.stake);
  // The handle end: the bearers run on as two shafts, joined by a turned grip wider than the cart.
  for (const z of [6, 16]) b.add(1, 10, z, 9, 12, z + 2, kit.trim);
  b.add(0, 10, 4, 2, 12, 20, t.stake);
  for (const z of [4, 18]) b.add(0, 10, z, 2, 12, z + 2, kit.trim);
  // The tail board rises over the load to a stepped crest. Its boards sit one cell back between two rails and a
  // centre batten, so the end of the cart has relief rather than a flat slab.
  b.add(30, 10, 6, 31, 18, 18, t.panel);
  b.add(30, 11, 6, 31, 12, 18, t.stripe);
  b.add(30, 18, 8, 32, 19, 16, t.panel);
  b.add(30, 19, 10, 32, 20, 14, kit.trim);
  for (const y of [13, 17]) b.add(30, y, 6, 32, y + 1, 18, kit.trim);
  b.add(31, 10, 11, 32, 18, 13, kit.trim);
  // A pole at the back corner flies a small swallowtail pennant over the load, clear of the open side.
  b.add(30, 15, 4, 32, 31, 6, t.stake);
  b.add(30, 31, 4, 32, 32, 6, MAT.brass);
  pennant(b, kit.field, 30, 23, 5);
  // The gifts. A wide basket of loaves with a bowed handle, a ribboned bundle, crocks and a bunch of flowers.
  basket(b, 10, 10, 7, 18, 16, 17, t.loaf);
  bundle(b, t, 19, 10, 7, 25, 16, 13);
  bundle(b, t, 20, 10, 13, 25, 14, 18);
  crock(b, t, 26, 10, 7);
  crock(b, t, 26, 10, 11);
  bouquet(b, t, 27, 14, 15);
  return b;
}

/** A spoked wheel in the XY plane: an iron-dark tyre, a timber felloe, eight two-cell spokes and a brass-capped hub. */
function wheel(b: Boxes, kit: CivicKit, t: MarketTreatment, cx: number, cy: number, r: number, z: number, Z: number): void {
  for (let x = cx - r; x < cx + r; x++) {
    let start = -1, material = -1;
    for (let y = cy - r; y <= cy + r; y++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
      const spoke = d < r - 2 && (Math.abs(dx) < 1 || Math.abs(dy) < 1 || Math.abs(Math.abs(dx) - Math.abs(dy)) <= 1);
      const next = y === cy + r ? -1 : d >= r ? -1 : d >= r - 1 ? MAT.darkStone : d >= r - 2 || spoke ? kit.trim : -1;
      if (next === material) continue;
      if (material >= 0) b.add(x, start, z, x + 1, y, Z, material);
      start = y; material = next;
    }
  }
  b.add(cx - 2, cy - 2, z - 1, cx + 2, cy + 2, Z + 1, MAT.bark);
  b.add(cx - 1, cy - 1, z - 1, cx + 1, cy + 1, Z + 1, t.hoop);
}

/** A swallowtail pennant flying back over the bed from a pole face at x0, seven cells tall from y0. */
function pennant(b: Boxes, field: number, x0: number, y0: number, z: number): void {
  // Row lengths from the bottom: the two tails are longest and the notch cuts back between them.
  const rows = [8, 7, 6, 4, 6, 7, 8] as const;
  rows.forEach((length, i) => b.add(x0 - length, y0 + i, z, x0, y0 + i + 1, z + 1, field));
  // A hem along the hoist where the cloth wraps the pole.
  b.add(x0 - 1, y0, z, x0, y0 + 7, z + 1, MAT.cream);
}

/**
 * A flared woven basket: a narrow foot, an octagonal body with a darker weave band and rim, a row of loaves and a
 * handle that bows over along X. Floor at y0, footprint [x0, X) × [z0, Z), rim top at Y.
 */
function basket(b: Boxes, x0: number, y0: number, z0: number, X: number, Y: number, Z: number, loaf: number): void {
  b.add(x0 + 1, y0, z0 + 1, X - 1, y0 + 1, Z - 1, MAT.bark);
  octagon(b, x0, y0 + 1, z0, X, Y, Z, MAT.thatch);
  octagon(b, x0, y0 + 3, z0, X, y0 + 4, Z, MAT.bark);
  octagon(b, x0, Y - 1, z0, X, Y, Z, MAT.bark);
  // Loaves laid side by side across the basket, each domed: a long body under a short crown.
  b.add(x0 + 1, Y - 1, z0 + 1, X - 1, Y, Z - 1, loaf);
  const crown = Math.max(1, Math.floor((Z - z0 - 4) / 3));
  for (let x = x0 + 1; x + 2 <= X - 1; x += 3) {
    b.add(x, Y, z0 + 2, x + 2, Y + 1, Z - 2, loaf);
    b.add(x, Y + 1, z0 + 2 + crown, x + 2, Y + 2, Z - 2 - crown, loaf);
  }
  // Each column of the handle reaches down to its neighbour's height, so the bow is one face-connected piece.
  const mid = Math.floor((z0 + Z) / 2) - 1, span = X - x0;
  let previous = Y - 1;
  for (let i = 0; i < span; i++) {
    const y = Y - 1 + Math.round(5 * Math.sin(Math.PI * (i + 0.5) / span));
    b.add(x0 + i, Math.min(y, previous), mid, x0 + i + 1, Math.max(y, previous) + 1, mid + 2, MAT.thatch);
    previous = y;
  }
}

/** A gift bundle wrapped in cloth or hessian, tied with a ribbon cross and a two-loop bow. */
function bundle(b: Boxes, t: MarketTreatment, x0: number, y0: number, z0: number, X: number, Y: number, Z: number): void {
  b.add(x0, y0, z0, X, Y, Z, t.wrap);
  const cx = Math.floor((x0 + X) / 2), cz = Math.floor((z0 + Z) / 2);
  b.add(cx - 1, y0, z0, cx + 1, Y, Z, t.ribbon);
  b.add(x0, y0, cz, X, Y, cz + 1, t.ribbon);
  b.add(cx - 1, Y, cz, cx + 1, Y + 1, cz + 1, t.ribbon);
  b.add(cx - 2, Y, cz, cx - 1, Y + 2, cz + 1, t.ribbon);
  b.add(cx + 1, Y, cz, cx + 2, Y + 2, cz + 1, t.ribbon);
}

/** A round-shouldered crock: octagonal body, a shoulder, a narrow neck and a lip. Base at (x0, y0, z0), 4 × 4. */
function crock(b: Boxes, t: MarketTreatment, x0: number, y0: number, z0: number): void {
  octagon(b, x0, y0, z0, x0 + 4, y0 + 4, z0 + 4, t.crock);
  b.add(x0 + 1, y0 + 4, z0 + 1, x0 + 3, y0 + 5, z0 + 3, t.crock);
  b.add(x0 + 1, y0 + 5, z0 + 1, x0 + 3, y0 + 6, z0 + 3, MAT.bark);
}

/** A tied bunch of flowers leaning against the back board, stems down into the bed. */
function bouquet(b: Boxes, t: MarketTreatment, x0: number, y0: number, z0: number): void {
  b.add(x0, y0 - 4, z0, x0 + 3, y0 + 1, z0 + 2, MAT.leaf);
  b.add(x0, y0 - 2, z0, x0 + 3, y0 - 1, z0 + 2, MAT.thatch);
  b.add(x0 - 1, y0 + 1, z0 - 1, x0 + 3, y0 + 3, z0 + 2, t.bloom);
  b.add(x0, y0 + 3, z0, x0 + 3, y0 + 4, z0 + 2, t.bloom);
  b.add(x0 - 1, y0 + 2, z0 + 1, x0, y0 + 3, z0 + 2, MAT.leaf);
}

/**
 * Market stores planes in build cells (README, "Market stores"). One composed stack that steps down to the front:
 * a standing cask at the back left, a closed crate under an open crate heaped with produce, and in front a sack,
 * a basket of loaves and a keg on its side whose head faces +Z.
 */
export const MARKET_STORES = {
  size: [24, 16, 16],
  cask: { from: [0, 0, 1], to: [8, 11, 9] },
  crate: { from: [8, 0, 0], to: [18, 7, 9] },
  open: { from: [9, 7, 1], to: [17, 12, 8] },
  keg: { from: [18, 0, 2], to: [24, 7, 13] },
} as const;

/** Produce heights over the open crate's rim line, back row first. Authored, so the heap is lumpy but never noise. */
const HEAP = ['233221', '332322', '233332', '223232', '122221'] as const;

export function marketStores(kit: CivicKit): Boxes {
  const b = new Boxes(), t = TREATMENTS[kit.style];
  cask(b, kit, t, 0, 0, 1);
  // The closed crate: boards with shadow joints, darker corner posts, a battened lid and a hand hole.
  const { crate, open, keg } = MARKET_STORES;
  planked(b, kit, t, crate.from, crate.to);
  b.add(crate.from[0], 6, 3, crate.to[0], 7, 4, t.stake);
  b.add(crate.from[0], 6, 6, crate.to[0], 7, 7, t.stake);
  b.add(11, 3, crate.to[2] - 1, 14, 4, crate.to[2], MAT.air);
  // The open crate set on top, a little in from every edge, heaped above its rim.
  planked(b, kit, t, open.from, open.to);
  const [ox, , oz] = open.from, [OX, OY, OZ] = open.to;
  // The crate stays packed wood below the rim, so its shadow joints read as joints rather than slots onto goods.
  b.add(ox + 1, OY - 2, oz + 1, OX - 1, OY, OZ - 1, t.produce);
  HEAP.forEach((row, i) => {
    for (let j = 0; j < row.length; j++) {
      const height = Number(row[j]), x = ox + 1 + j, z = oz + 1 + i;
      b.add(x, OY - 1, z, x + 1, OY - 1 + height, z + 1, t.produce);
      if (height === 3 && (i + j) % 3 === 0) b.add(x, OY + 1, z, x + 1, OY + 2, z + 1, t.highlight);
    }
  });
  b.add(ox + 2, OY + 2, oz + 2, ox + 3, OY + 3, oz + 3, MAT.leaf);
  b.add(OX - 3, OY + 1, OZ - 3, OX - 2, OY + 2, OZ - 2, MAT.leaf);
  kegOnSide(b, kit, t, keg.from, keg.to);
  // A sack slumped against the cask: a tall bulging body, one rounded shoulder, a tied neck and a short flop.
  // A crease runs down the front where the cloth folds.
  b.add(2, 0, 10, 7, 1, 15, t.sack);
  octagon(b, 1, 1, 9, 8, 5, 16, t.sack);
  octagon(b, 2, 5, 10, 7, 6, 15, t.sack);
  b.add(4, 1, 15, 5, 5, 16, MAT.air);
  b.add(3, 6, 11, 6, 7, 14, t.tie);
  b.add(3, 7, 12, 6, 8, 15, t.sack);
  b.add(4, 8, 12, 5, 9, 14, t.sack);
  // A basket of loaves in front of the crates, its handle bowing over the load.
  basket(b, 9, 0, 10, 17, 5, 16, t.loaf);
  return b;
}

/** A planked crate: boards with a shadow joint every third course and darker posts standing at each corner. */
function planked(b: Boxes, kit: CivicKit, t: MarketTreatment, from: readonly number[], to: readonly number[]): void {
  const [x0, y0, z0] = from as [number, number, number], [X, Y, Z] = to as [number, number, number];
  b.add(x0, y0, z0, X, Y, Z, kit.trim);
  for (let y = y0 + 2; y < Y - 1; y += 3) {
    b.add(x0 + 1, y, z0, X - 1, y + 1, z0 + 1, MAT.air);
    b.add(x0 + 1, y, Z - 1, X - 1, y + 1, Z, MAT.air);
    b.add(x0, y, z0 + 1, x0 + 1, y + 1, Z - 1, MAT.air);
    b.add(X - 1, y, z0 + 1, X, y + 1, Z - 1, MAT.air);
  }
  for (const [x, z] of [[x0, z0], [X - 1, z0], [x0, Z - 1], [X - 1, Z - 1]] as const) b.add(x, y0, z, x + 1, Y, z + 1, t.stake);
}

/**
 * A standing cask, footprint 8 × 8 from (x0, z0): narrow chimes, a wide octagonal belly between two hoops,
 * staves picked out in darker wood and a head let in below the chime.
 */
function cask(b: Boxes, kit: CivicKit, t: MarketTreatment, x0: number, y0: number, z0: number): void {
  const head = y0 + 11;
  octagon(b, x0 + 1, y0, z0 + 1, x0 + 7, y0 + 2, z0 + 7, kit.trim);
  octagon(b, x0 + 1, head - 2, z0 + 1, x0 + 7, head, z0 + 7, kit.trim);
  // The belly: a two-step octagon, the outermost ring of the round.
  b.add(x0, y0 + 2, z0 + 2, x0 + 8, head - 2, z0 + 6, kit.trim);
  b.add(x0 + 2, y0 + 2, z0, x0 + 6, head - 2, z0 + 8, kit.trim);
  b.add(x0 + 1, y0 + 2, z0 + 1, x0 + 7, head - 2, z0 + 7, kit.trim);
  // Every other stave is darker. The stripes along Z run through the whole round, so the head shows as boards.
  for (const x of [x0 + 1, x0 + 3, x0 + 5]) b.add(x, y0, z0, x + 1, head, z0 + 8, MAT.bark);
  for (const z of [z0 + 1, z0 + 3, z0 + 5]) b.add(x0, y0 + 2, z, x0 + 8, head - 2, z + 1, MAT.bark);
  // Iron or brass hoops where the belly meets the chimes.
  for (const y of [y0 + 2, head - 3]) {
    b.add(x0, y, z0 + 2, x0 + 8, y + 1, z0 + 6, t.hoop);
    b.add(x0 + 2, y, z0, x0 + 6, y + 1, z0 + 8, t.hoop);
    b.add(x0 + 1, y, z0 + 1, x0 + 7, y + 1, z0 + 7, t.hoop);
  }
  b.add(x0 + 2, head - 1, z0 + 2, x0 + 6, head, z0 + 6, MAT.air);
}

/**
 * A keg on its side along Z, resting in two chocked cradles: an octagonal round, staves along its length, two
 * hoops and a recessed head on the +Z end.
 */
function kegOnSide(b: Boxes, kit: CivicKit, t: MarketTreatment, from: readonly number[], to: readonly number[]): void {
  const [x0, , z0] = from as [number, number, number], [X, Y, Z] = to as [number, number, number];
  for (const z of [z0 + 2, Z - 4]) {
    b.add(x0, 0, z, X, 1, z + 2, MAT.bark);
    b.add(x0, 1, z, x0 + 1, 2, z + 2, MAT.bark);
    b.add(X - 1, 1, z, X, 2, z + 2, MAT.bark);
  }
  b.add(x0, 2, z0, X, Y - 1, Z, kit.trim);
  b.add(x0 + 1, 1, z0, X - 1, Y, Z, kit.trim);
  for (const x of [x0 + 1, x0 + 3]) b.add(x, 1, z0, x + 1, Y, Z, MAT.bark);
  for (const z of [z0 + 1, Z - 3]) {
    b.add(x0, 2, z, X, Y - 1, z + 1, t.hoop);
    b.add(x0 + 1, 1, z, X - 1, Y, z + 1, t.hoop);
  }
  // The head is let in one cell behind the chime, its boards running up and down.
  b.add(x0 + 1, 2, Z - 1, X - 1, Y - 1, Z, MAT.air);
}
