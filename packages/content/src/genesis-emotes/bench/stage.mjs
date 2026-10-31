// Bench staging only: a paved plaza on a grass plate, a stone glass hall whose gable holds the window, and where the
// monument, the hall, the houses and the trees stand. Positions are world metres; the plate's top is at 0.5 m.
import { STYLES } from '../../materials.ts';

export const CELL = 0.125;
export const GROUND = 4;
const ground = GROUND * CELL;

const seeded = seed => () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
const blueprint = (id, style, size, boxes) => ({ version: 1, id, styleId: STYLES[style].id, kind: 'prop', lattice: 'build', size, boxes, windows: [] });

/** A 32 m plate: grass, a flagged plaza with a kerb, a path toward the viewer and a scatter of flowers. */
export function plaza(style, MAT) {
  const boxes = [];
  const add = (x, y, z, X, Y, Z, material) => boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  add(0, 0, 0, 256, GROUND, 256, MAT.grass);
  add(0, 0, 0, 256, GROUND - 1, 256, MAT.earth);
  add(4, GROUND - 1, 96, 252, GROUND + 1, 236, MAT.stone);
  add(6, GROUND - 1, 98, 250, GROUND, 234, MAT.paving);
  add(6, GROUND, 98, 250, GROUND + 1, 234, 0);
  const next = seeded(23);
  const flags = [MAT.paving, MAT.limestone, MAT.stone, MAT.paving, MAT.paving];
  for (let z = 98, row = 0; z < 234; z += 8, row++) {
    for (let x = 6 - (row % 2) * 4; x < 250; x += 8) {
      add(Math.max(6, x), GROUND - 1, z, Math.min(250, x + 7), GROUND, Math.min(234, z + 7), flags[Math.floor(next() * flags.length)]);
    }
  }
  add(108, GROUND - 1, 234, 152, GROUND, 256, MAT.paving);
  add(108, GROUND, 234, 152, GROUND + 1, 236, 0);
  const tufts = [MAT.petal, MAT.blueFlower, MAT.moss, MAT.cream, MAT.leaf];
  for (let i = 0; i < 320; i++) {
    const x = Math.floor(next() * 254), z = Math.floor(next() * 254);
    if (x > 2 && x < 254 && z > 92 && z < 238) continue;
    if (x > 104 && x < 156 && z >= 234) continue;
    add(x, GROUND, z, x + 1, GROUND + 1 + Math.floor(next() * 2), z + 1, tufts[Math.floor(next() * tufts.length)]);
  }
  return blueprint(`emote-bench-plaza-${style}`, style, [256, 8, 256], boxes);
}

/** A plain 32 m meadow plate, laid round the plaza so the land runs on. */
export function meadow(style, MAT, index) {
  const boxes = [];
  const add = (x, y, z, X, Y, Z, material) => boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  add(0, 0, 0, 256, GROUND, 256, MAT.grass);
  const next = seeded(101 + index * 7919);
  const tufts = [MAT.petal, MAT.blueFlower, MAT.moss, MAT.cream];
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(next() * 252), z = Math.floor(next() * 252);
    add(x, GROUND, z, x + 1 + Math.floor(next() * 2), GROUND + 1, z + 1, tufts[Math.floor(next() * tufts.length)]);
  }
  return blueprint(`emote-bench-meadow-${style}-${index}`, style, [256, 8, 256], boxes);
}

/**
 * A stone glass hall: a gabled nave whose south gable holds the window unit, with buttresses at the corners, a
 * dark plinth course and a tiled roof that oversails the verge. The opening is cut to the unit's own outline, row by
 * row, so no stray hole shows round the arch. Returns the hall, where the window unit sits in it (cells), and the
 * ridge's front top (cells) where a vane can stand.
 */
export function hall(style, MAT, kit, unit) {
  const [UW, UH] = unit.size;
  const W = Math.max(76, UW + 28) + (Math.max(76, UW + 28) % 2);
  const D = 104, T = 6, E = 56, A = E + W / 2;
  const boxes = [];
  const add = (x, y, z, X, Y, Z, material) => { if (x < X && y < Y && z < Z) boxes.push({ from: [x, y, z], to: [X, Y, Z], material }); };
  const ox = 10, oz = 4; // room for buttresses and the roof's oversail inside the blueprint
  // Walls: plinth course, then coursed stone with the moulding stone at every eighth course.
  add(ox - 1, 0, oz - 1, ox + W + 1, 4, oz + D + 1, kit.footing);
  add(ox, 4, oz, ox + W, E, oz + T, kit.stone);
  add(ox, 4, oz + D - T, ox + W, E, oz + D, kit.stone);
  add(ox, 4, oz, ox + T, E, oz + D, kit.stone);
  add(ox + W - T, 4, oz, ox + W, E, oz + D, kit.stone);
  for (let y = 12; y < E; y += 8) add(ox, y, oz + D - T, ox + W, y + 1, oz + D + 0, kit.moulding);
  // Gables, front and back, as rows narrowing to the apex.
  for (let y = E; y < A; y++) {
    const hw = A - y;
    add(ox + W / 2 - hw, y, oz + D - T, ox + W / 2 + hw, y + 1, oz + D, kit.stone);
    add(ox + W / 2 - hw, y, oz, ox + W / 2 + hw, y + 1, oz + T, kit.stone);
  }
  // The window opening, cut to the unit's outline (its frame and glass, rows of the front six cells).
  const wx = ox + (W - UW) / 2, wy = 10, wz = oz + D - T;
  const spans = new Map();
  for (const box of unit.boxes) {
    if (box.material === 0 || box.from[2] >= 6) continue;
    for (let y = box.from[1]; y < box.to[1]; y++) {
      const span = spans.get(y) ?? [Infinity, -Infinity];
      spans.set(y, [Math.min(span[0], box.from[0]), Math.max(span[1], box.to[0])]);
    }
  }
  for (const [y, [x0, x1]] of spans) add(wx + x0, wy + y, wz, wx + x1, wy + y + 1, oz + D, 0);
  // Stepped buttresses at the four corners, set diagonally out from the front and the sides.
  for (const [bx, bz, dx, dz] of [[ox - 5, oz + D - 4, 6, 9], [ox + W - 1, oz + D - 4, 6, 9]]) {
    add(bx, 0, bz, bx + dx, 36, bz + dz, kit.stone);
    add(bx + 1, 36, bz + 1, bx + dx - 1, 46, bz + dz - 2, kit.stone);
    add(bx, 35, bz, bx + dx, 36, bz + dz, kit.moulding);
    add(bx + 1, 46, bz + 1, bx + dx - 1, 47, bz + dz - 2, kit.moulding);
    add(bx, 0, bz, bx + dx, 4, bz + dz, kit.footing);
  }
  for (const bz of [oz + 28, oz + 64]) for (const bx of [ox - 4, ox + W]) {
    add(bx, 0, bz, bx + 4, 40, bz + 6, kit.stone);
    add(bx, 39, bz, bx + 4, 40, bz + 6, kit.moulding);
  }
  // Roof: 45° slopes of tile four cells thick, oversailing the gables by three cells, with a ridge course.
  const roof = STYLES[style].roof;
  for (let y = E - 3; y <= A; y++) {
    const edge = A - y;
    add(ox + W / 2 - edge - 4, y, oz - 3, ox + W / 2 - edge + 1, y + 1, oz + D + 3, roof);
    add(ox + W / 2 + edge - 1, y, oz - 3, ox + W / 2 + edge + 4, y + 1, oz + D + 3, roof);
  }
  add(ox + W / 2 - 2, A, oz - 3, ox + W / 2 + 2, A + 2, oz + D + 3, kit.moulding);
  const size = [ox + W + 10, A + 3, oz + D + 8];
  return {
    blueprint: blueprint(`emote-bench-hall-${style}-${UW}x${UH}`, style, size, boxes),
    window: [wx, wy, wz],
    ridge: [ox + W / 2, A + 2, oz + D - 1],
  };
}

/** Where each piece stands, in metres: the hall at the back, the monument front left, houses either side. */
export function composition() {
  return {
    hall: [11, ground, -2],
    monument: [2.6, ground, 16.5],
    homes: [[-17.5, ground, 3], [25.6, ground, 0.5]],
    trees: [[-7.5, ground, 10], [26.5, ground, 14.5], [-12, ground, 21]],
    meadows: [[-32, 0, -32], [0, 0, -32], [32, 0, -32], [-32, 0, 0], [32, 0, 0], [-32, 0, 32], [0, 0, 32], [32, 0, 32]],
    backdrop: [['cottage', 0, [-22, ground, -14], 0], ['house', 2, [36, ground, -12], 0], ['manor', 0, [-4, ground, -30], 0], ['hut', 1, [42, ground, 6], -Math.PI / 2]],
    grove: [[2, [-18, ground, 4]], [1, [36, ground, 22]], [0, [44, ground, -2]], [2, [6, ground, -16]], [1, [30, ground, -20]]],
    // The main-owned street props, read-only, as foreground: planters along the path, shrubs and pots by the hall
    // and the monument, rocks at the plaza's edge.
    props: [
      ['street', 'leafy-shrub', [0.4, ground, 25.6], 0], ['street', 'flower-trough', [12.4, ground, 28.7], 0],
      ['street', 'flower-trough', [17.4, ground, 28.7], 0], ['street', 'leafy-shrub', [23.6, ground, 26.8], 0],
      ['street', 'flower-pot', [21.4, ground, 13.2], 0], ['street', 'flower-pot', [9.6, ground, 13.2], 0], ['street', 'rock-cluster', [-1.8, ground, 27.4], 0],
    ],
    camera: { fov: 48, position: [23.8, 3.7, 38.5], target: [11.6, 8.9, 12.5] },
    // Review framings: the carving from the bench in front of it, and the window from the plaza.
    views: {
      statue: { fov: 40, position: [9.5, 3.4, 33], target: [6.9, 4.6, 18.6] },
      glass: { fov: 40, position: [19.5, 2.6, 30], target: [16.8, 7.2, 11] },
    },
  };
}
