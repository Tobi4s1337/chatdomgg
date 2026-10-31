import type { Cell, Slot, VoxelGrid } from './grid';
import { ARM, BACK_Z, CHEST_Z, HIPS, LEG, NECK, PROUD_Z, SIDES, TORSO, armX, legX } from './body';
import { cellHash } from './hair-kit';
import type { BottomStyleId, NeckwearStyleId, OuterStyleId, PatternId, ShoeStyleId, TopStyleId } from './recipe';

/*
 * The wardrobe (spec L5): patterned, layered clothes on the compact body, every one painted voxels on the
 * avatar lattice. Garments are drawn in dressing order: the bottom, the top over it, the bib of overalls over
 * the top, an open outer layer over both, then neckwear and shoes. Each garment paints its own four slots
 * (base, deep, accent, mix), so a pattern is painted once on that garment's cells and a layer over it never
 * inherits it.
 *
 * Layering is what makes the reference's clothes read: an outer layer is worn open, its front panels stand one
 * cell proud of the chest, and the top shows recessed down the middle between them.
 */

interface GarmentSlots { readonly base: Slot; readonly deep: Slot; readonly accent: Slot; readonly mix: Slot }
const TOP: GarmentSlots = { base: 'top', deep: 'topDeep', accent: 'topAccent', mix: 'topMix' };
const OUTER: GarmentSlots = { base: 'outer', deep: 'outerDeep', accent: 'outerAccent', mix: 'outerMix' };
const BOTTOM: GarmentSlots = { base: 'bottom', deep: 'bottomDeep', accent: 'bottomAccent', mix: 'bottomMix' };

const [TX0, TX1] = TORSO.x, [TZ0, TZ1] = TORSO.z, SHOULDER = TORSO.y[1] - 1;

/** Repaints the torso's existing cells over rows [y0, y1): the shoulder corners stay carved. */
const torso = (g: VoxelGrid, y0: number, y1: number, slot: Slot) => g.paint([TX0, y0, TZ0], [TX1, y1, TZ1], slot);
/** Repaints both arms over rows [y0, y1). */
const arms = (g: VoxelGrid, y0: number, y1: number, slot: Slot) => {
  for (const side of SIDES) g.paint([armX(side), y0, ARM.z[0]], [armX(side) + 1, y1, ARM.z[1]], slot);
};
/** Repaints both legs over rows [y0, y1). */
const legs = (g: VoxelGrid, y0: number, y1: number, slot: Slot) => {
  for (const side of SIDES) g.paint([legX(side), y0, LEG.z[0]], [legX(side) + 2, y1, LEG.z[1]], slot);
};
const set = (g: VoxelGrid, cells: readonly Cell[], slot: Slot) => { for (const [x, y, z] of cells) g.set(x, y, z, slot); };
/** Ribbing: every other cell of a row in the deep tone. */
const rib = (g: VoxelGrid, y: number, base: Slot, deep: Slot) => {
  for (const [[x, cy, z], slot] of [...g.entries()]) if (cy === y && slot === base && (x + z) % 2 !== 0) g.set(x, cy, z, deep);
};

/**
 * Paints a pattern over a garment's base cells. Bands run on the surface: rows for stripes, and for plaid the
 * rows crossed with columns that wrap round the body (x on the front and back, z on the sides, so the check
 * meets itself at the corners).
 */
export function paintPattern(g: VoxelGrid, pattern: PatternId, slots: GarmentSlots, salt: number): void {
  if (pattern === 'plain') return;
  for (const [[x, y, z], slot] of [...g.entries()]) {
    if (slot !== slots.base) continue;
    const row = ((y % 2) + 2) % 2 === 1, column = (((x + z) % 2) + 2) % 2 === 0;
    if (pattern === 'stripes' && row) g.set(x, y, z, slots.accent);
    else if (pattern === 'plaid' && (row || column)) g.set(x, y, z, row && column ? slots.accent : slots.mix);
    else if (pattern === 'dots' && cellHash(x, y, z, salt) < .2) g.set(x, y, z, slots.accent);
  }
  if (pattern === 'print') {
    // A block on the chest, front plane only: the reference's printed tee.
    for (let x = -1; x < 1; x++) for (let y = 11; y < 13; y++) if (g.get(x, y, CHEST_Z) === slots.base) g.set(x, y, CHEST_Z, slots.accent);
  }
}

/** A crew neck: a notch of skin at the collar, the inside of the collar in the deep tone. */
function crewNeck(g: VoxelGrid, deep: Slot): void {
  g.fill([-1, SHOULDER, CHEST_Z], [1, SHOULDER + 1, CHEST_Z + 1], 'skin');
  g.fill([-1, SHOULDER, CHEST_Z - 1], [1, SHOULDER + 1, CHEST_Z], deep);
}

/** Rows a top covers from: a tee or shirt stops at the waistband, a hoodie or sweater hangs over it. */
const TOP_HEM: Record<TopStyleId, number> = { tee: 10, tank: 10, shirt: 10, hoodie: 9, sweater: 9, robe: 9 };

export function drawTop(g: VoxelGrid, style: TopStyleId, pattern: PatternId): void {
  const hem = TOP_HEM[style];
  torso(g, hem, TORSO.y[1], 'top');
  switch (style) {
    case 'tee':
      crewNeck(g, 'topDeep');
      arms(g, 12, ARM.y[1], 'top');
      arms(g, 12, 13, 'topDeep');
      break;
    case 'tank':
      // A scoop neck and deep armholes: straps over the shoulders, the arms bare.
      g.fill([-1, SHOULDER - 1, CHEST_Z], [1, SHOULDER + 1, CHEST_Z + 1], 'skin');
      g.fill([-1, SHOULDER - 1, CHEST_Z - 1], [1, SHOULDER + 1, CHEST_Z], 'topDeep');
      for (const x of [TX0, TX1 - 1]) g.paint([x, SHOULDER - 1, TZ0], [x + 1, SHOULDER, TZ1], 'skin');
      break;
    case 'shirt':
      // A collared shirt, sleeves rolled to the forearm, a placket with a button.
      crewNeck(g, 'topDeep');
      set(g, [[-2, SHOULDER, PROUD_Z], [1, SHOULDER, PROUD_Z]], 'top');
      for (let y = hem; y < SHOULDER; y++) g.set(-1, y, CHEST_Z, 'topDeep');
      arms(g, 10, ARM.y[1], 'top');
      arms(g, 10, 11, 'topDeep');
      break;
    case 'hoodie':
      // The hood lies folded behind the neck and down the back; a kangaroo pocket; two drawstrings, apart.
      g.fill([-1, SHOULDER, CHEST_Z], [1, SHOULDER + 1, CHEST_Z + 1], 'topDeep');
      for (let x = TX0; x < TX1; x++) for (const z of [BACK_Z - 1, BACK_Z]) g.set(x, NECK.y[0], z, 'top');
      for (let x = TX0 + 1; x < TX1 - 1; x++) for (let y = 11; y < SHOULDER + 1; y++) g.set(x, y, BACK_Z - 1, y === SHOULDER ? 'topDeep' : 'top');
      g.paint([-2, 10, CHEST_Z], [2, 12, CHEST_Z + 1], 'topDeep');
      set(g, [[-2, 12, PROUD_Z], [-2, 13, PROUD_Z], [1, 12, PROUD_Z], [1, 13, PROUD_Z]], 'topTrim');
      arms(g, hem, ARM.y[1], 'top');
      rib(g, hem, 'top', 'topDeep');
      arms(g, hem, hem + 1, 'topDeep');
      break;
    case 'sweater':
      crewNeck(g, 'topDeep');
      set(g, [[-2, SHOULDER, CHEST_Z], [1, SHOULDER, CHEST_Z]], 'topDeep');
      arms(g, hem, ARM.y[1], 'top');
      rib(g, hem, 'top', 'topDeep');
      arms(g, hem, hem + 1, 'topDeep');
      break;
    case 'robe': {
      // Floor-ish length: the robe hangs over the hips and legs to the shins and flares at the hem. Wide
      // sleeves, a wrapped neck with a trim in the accent, a sash.
      g.fill([TX0, 5, TZ0], [TX1, hem, TZ1], 'top');
      for (let x = TX0 - 1; x < TX1 + 1; x++) for (let z = TZ0 - 1; z < TZ1 + 1; z++) {
        const corner = (x === TX0 - 1 || x === TX1) && (z === TZ0 - 1 || z === TZ1);
        if (!corner) for (const y of [3, 4]) g.set(x, y, z, y === 3 ? 'topDeep' : 'top');
      }
      arms(g, ARM.hand, ARM.y[1], 'top');
      for (const side of SIDES) g.fill([armX(side), ARM.hand, ARM.z[0] - 1], [armX(side) + 1, ARM.hand + 1, ARM.z[1] + 1], 'topDeep');
      set(g, [[-1, SHOULDER, CHEST_Z], [0, SHOULDER, CHEST_Z], [0, SHOULDER - 1, CHEST_Z]], 'skin');
      set(g, [[-2, SHOULDER, CHEST_Z], [1, SHOULDER, CHEST_Z], [-1, SHOULDER - 1, CHEST_Z], [1, SHOULDER - 1, CHEST_Z], [0, SHOULDER - 2, CHEST_Z]], 'topAccent');
      for (let x = TX0; x < TX1; x++) for (let z = TZ0; z < TZ1; z++) if (x === TX0 || x === TX1 - 1 || z === TZ0 || z === TZ1 - 1) g.set(x, hem, z, 'topAccent');
      set(g, [[0, hem, PROUD_Z], [0, hem - 1, PROUD_Z], [0, hem - 2, PROUD_Z]], 'topAccent');
      break;
    }
  }
  paintPattern(g, pattern, TOP, 11);
}

export function drawBottom(g: VoxelGrid, style: BottomStyleId, pattern: PatternId): void {
  g.paint([HIPS.x[0], HIPS.y[0], HIPS.z[0]], [HIPS.x[1], HIPS.y[1], HIPS.z[1]], 'bottom');
  torso(g, TORSO.y[0], 10, 'bottom');
  switch (style) {
    case 'trousers':
    case 'overalls':
      legs(g, LEG.foot, LEG.y[1], 'bottom');
      legs(g, LEG.foot, LEG.foot + 1, 'bottomDeep');
      break;
    case 'shorts':
      legs(g, 4, LEG.y[1], 'bottom');
      legs(g, 4, 5, 'bottomDeep');
      break;
    case 'skirt':
      // An A-line skirt: the hips, then a wider flared hem with pleats.
      g.fill([TX0, 5, TZ0], [TX1, 6, TZ1], 'bottom');
      for (let x = TX0 - 1; x < TX1 + 1; x++) for (let z = TZ0 - 1; z < TZ1 + 1; z++) {
        const corner = (x === TX0 - 1 || x === TX1) && (z === TZ0 - 1 || z === TZ1);
        if (!corner) for (const y of [3, 4]) g.set(x, y, z, (x + z) % 2 !== 0 ? 'bottomDeep' : 'bottom');
      }
      break;
  }
  paintPattern(g, pattern, BOTTOM, 13);
}

/** The bib and straps of overalls, worn over the top, with a pocket and two brass buttons. */
export function drawBib(g: VoxelGrid): void {
  g.paint([-2, 10, CHEST_Z], [2, SHOULDER, CHEST_Z + 1], 'bottom');
  for (const x of [-2, 1]) {
    g.paint([x, SHOULDER, TZ0], [x + 1, SHOULDER + 1, TZ1], 'bottom');
    g.paint([x, 10, BACK_Z], [x + 1, SHOULDER, BACK_Z + 1], 'bottom');
    g.set(x, SHOULDER - 1, CHEST_Z, 'button');
  }
  g.paint([-1, 11, CHEST_Z], [1, 12, CHEST_Z + 1], 'bottomDeep');
}

/** Rows an outer layer covers from; a coat hangs to the shins. */
const OUTER_HEM: Record<OuterStyleId, number> = { jacket: 8, vest: 9, overshirt: 8, coat: 3 };

export function drawOuter(g: VoxelGrid, style: OuterStyleId, pattern: PatternId): void {
  const hem = OUTER_HEM[style];
  // Repaint the torso, then open the front: the middle two columns keep what is under it.
  const under: [number, number, Slot][] = [];
  for (let x = -1; x < 1; x++) for (let y = 8; y < TORSO.y[1]; y++) { const s = g.get(x, y, CHEST_Z); if (s) under.push([x, y, s]); }
  torso(g, Math.max(hem, TORSO.y[0]), TORSO.y[1], 'outer');
  for (const [x, y, s] of under) if (y >= hem) g.set(x, y, CHEST_Z, s);
  // The front panels stand one cell proud either side of the opening; the lapels fold out at the top.
  const top = SHOULDER;
  for (const x of [TX0, TX0 + 1, TX1 - 2, TX1 - 1]) for (let y = Math.max(hem, 8); y < top; y++) g.set(x, y, PROUD_Z, 'outer');
  set(g, [[TX0 + 1, top, PROUD_Z], [TX1 - 2, top, PROUD_Z]], 'outerDeep');
  if (style === 'coat') {
    // Below the waist the coat closes: a skirt of cloth over the hips and legs, one cell proud in front.
    g.fill([TX0, hem, TZ0], [TX1, 8, TZ1 + 1], 'outer');
    for (let y = hem; y < 8; y++) g.set(-1, y, PROUD_Z, 'outerDeep');
    for (const y of [9, 11]) g.set(TX0 + 1, y, PROUD_Z, 'button');
  } else {
    // The hem of the jacket is its deep tone.
    for (const x of [TX0, TX0 + 1, TX1 - 2, TX1 - 1]) g.set(x, hem, PROUD_Z, 'outerDeep');
  }
  if (style === 'jacket' || style === 'coat') {
    // A collar stands up round the back of the neck.
    for (let x = NECK.x[0] - 1; x < NECK.x[1] + 1; x++) g.set(x, NECK.y[0], NECK.z[0] - 1, 'outer');
    for (const x of [NECK.x[0] - 1, NECK.x[1]]) g.set(x, NECK.y[0], NECK.z[0], 'outer');
  }
  // Sleeves: long for a jacket and coat, short for an overshirt, none for a vest (the top's sleeves show).
  if (style === 'jacket' || style === 'coat') { arms(g, ARM.hand, ARM.y[1], 'outer'); arms(g, ARM.hand, ARM.hand + 1, 'outerDeep'); }
  if (style === 'overshirt') { arms(g, 11, ARM.y[1], 'outer'); arms(g, 11, 12, 'outerDeep'); }
  paintPattern(g, pattern === 'print' ? 'stripes' : pattern, OUTER, 17);
}

export function drawNeckwear(g: VoxelGrid, style: NeckwearStyleId): void {
  const ring = () => {
    for (let x = NECK.x[0] - 1; x < NECK.x[1] + 1; x++) for (let z = NECK.z[0] - 1; z < NECK.z[1] + 1; z++) {
      if (x < NECK.x[0] || x >= NECK.x[1] || z < NECK.z[0] || z >= NECK.z[1]) g.set(x, NECK.y[0], z, 'neck');
    }
  };
  switch (style) {
    case 'scarf':
      // Wound round the neck, a fold over the collarbone, one end hanging down the chest, striped.
      ring();
      for (let x = -2; x < 2; x++) g.set(x, SHOULDER, PROUD_Z, 'neck');
      for (let y = 10; y < SHOULDER; y++) for (const x of [0, 1]) g.set(x, y, PROUD_Z, y % 2 === 0 ? 'neckAccent' : 'neck');
      for (const x of [0, 1]) g.set(x, 9, PROUD_Z, 'neckDeep');
      break;
    case 'tie':
      // A shirt collar either side of the knot, then the blade down the chest, its stripes in the accent.
      set(g, [[-2, SHOULDER, PROUD_Z], [1, SHOULDER, PROUD_Z]], 'top');
      g.fill([-1, SHOULDER, CHEST_Z], [1, SHOULDER + 1, CHEST_Z + 1], 'neckDeep');
      for (let y = 10; y < SHOULDER; y++) for (const x of [-1, 0]) g.set(x, y, CHEST_Z, y % 2 === 0 ? 'neckAccent' : 'neck');
      break;
    case 'bowtie':
      set(g, [[-2, SHOULDER, PROUD_Z], [1, SHOULDER, PROUD_Z], [-2, SHOULDER - 1, PROUD_Z], [1, SHOULDER - 1, PROUD_Z]], 'neck');
      set(g, [[-1, SHOULDER, PROUD_Z], [0, SHOULDER, PROUD_Z]], 'neckDeep');
      break;
    case 'bandana': {
      // A kerchief knotted at the back, its point on the chest, dotted in the accent.
      ring();
      const cells: Cell[] = [[-2, SHOULDER, PROUD_Z], [-1, SHOULDER, PROUD_Z], [0, SHOULDER, PROUD_Z], [1, SHOULDER, PROUD_Z], [-1, SHOULDER - 1, PROUD_Z], [0, SHOULDER - 1, PROUD_Z]];
      set(g, cells, 'neck');
      for (const [x, y, z] of [...cells, [-1, NECK.y[0], NECK.z[1]] as Cell, [0, NECK.y[0], NECK.z[1]] as Cell]) if (cellHash(x, y, z, 23) < .34) g.set(x, y, z, 'neckAccent');
      break;
    }
  }
}

export function drawShoes(g: VoxelGrid, style: ShoeStyleId): void {
  const height = style === 'boots' ? 4 : 2;
  for (const side of SIDES) {
    const x = legX(side);
    g.fill([x, 0, LEG.z[0]], [x + 2, height, LEG.z[1]], 'shoe');
    // A rounded toe one cell out in front.
    g.fill([x, 0, LEG.z[1]], [x + 2, 1, LEG.z[1] + 1], style === 'sneakers' ? 'sole' : 'shoeDeep');
    g.fill([x, 1, LEG.z[1]], [x + 2, 2, LEG.z[1] + 1], 'shoe');
    g.fill([x, 0, LEG.z[0]], [x + 2, 1, LEG.z[1]], style === 'sneakers' ? 'sole' : 'shoeDeep');
    if (style === 'boots') g.fill([x, height - 1, LEG.z[0]], [x + 2, height, LEG.z[1]], 'shoeDeep');
    if (style === 'sneakers') g.set(x + (side < 0 ? 1 : 0), 1, LEG.z[1], 'sole');
  }
}

export { BOTTOM as BOTTOM_SLOTS, OUTER as OUTER_SLOTS, TOP as TOP_SLOTS };
