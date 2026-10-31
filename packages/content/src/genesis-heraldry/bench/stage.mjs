// Bench staging only: a paved forecourt on a grass plate, and where the houses, trees, crest and standard stand
// on it. Positions are world metres; the plate's top is at y 0.5 m (four build cells).
import { STYLES } from '../../materials.ts';

const CELL = 0.125;
const GROUND = 4;

/** A 32 m square plate: grass, a flagged forecourt with a raised kerb, a path to the front and a scatter of flowers. */
export function forecourt(style, MAT) {
  const boxes = [];
  const add = (x, y, z, X, Y, Z, material) => boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  add(0, 0, 0, 256, GROUND, 256, MAT.grass);
  add(0, 0, 0, 256, GROUND - 1, 256, MAT.earth);
  // Kerb, then flags in three stones laid in a staggered bond.
  add(38, GROUND - 1, 134, 218, GROUND + 1, 226, MAT.stone);
  add(40, GROUND - 1, 136, 216, GROUND, 224, MAT.paving);
  add(40, GROUND, 136, 216, GROUND + 1, 224, 0);
  let seed = 11;
  const next = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const flags = [MAT.paving, MAT.limestone, MAT.stone, MAT.paving];
  for (let z = 136, row = 0; z < 224; z += 8, row++) {
    for (let x = 40 - (row % 2) * 4; x < 216; x += 8) {
      const from = Math.max(40, x), to = Math.min(216, x + 7);
      add(from, GROUND - 1, z, to, GROUND, z + 7, flags[Math.floor(next() * flags.length)]);
    }
  }
  // The path out of frame toward the viewer.
  add(108, GROUND - 1, 224, 148, GROUND, 256, MAT.paving);
  add(108, GROUND, 224, 148, GROUND + 1, 226, 0);
  for (let z = 228; z < 250; z += 6) add(110 + Math.floor(next() * 4), GROUND - 1, z, 146 - Math.floor(next() * 4), GROUND, z + 5, MAT.limestone);
  // Tufts and flowers in the grass, and moss in the kerb's shade.
  const tufts = [MAT.petal, MAT.blueFlower, MAT.moss, MAT.cream];
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(next() * 254), z = Math.floor(next() * 254);
    if (x > 34 && x < 222 && z > 130 && z < 230) continue;
    if (x > 104 && x < 152 && z >= 224) continue;
    const material = tufts[Math.floor(next() * tufts.length)];
    add(x, GROUND, z, x + 1, GROUND + 1, z + 1 + Math.floor(next() * 2), material);
  }
  return { version: 1, id: `heraldry-bench-forecourt-${style}`, styleId: STYLES[style].id, kind: 'prop', lattice: 'build', size: [256, 8, 256], boxes, windows: [] };
}

/** A plain 32 m meadow plate with its own scatter, laid round the forecourt so the land runs to the horizon. */
export function meadow(style, MAT, index) {
  const boxes = [];
  const add = (x, y, z, X, Y, Z, material) => boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  add(0, 0, 0, 256, GROUND, 256, MAT.grass);
  let seed = 101 + index * 7919;
  const next = () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
  const tufts = [MAT.petal, MAT.blueFlower, MAT.moss, MAT.cream];
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(next() * 252), z = Math.floor(next() * 252), material = tufts[Math.floor(next() * tufts.length)];
    add(x, GROUND, z, x + 1 + Math.floor(next() * 2), GROUND + 1, z + 1, material);
  }
  return { version: 1, id: `heraldry-bench-meadow-${style}-${index}`, styleId: STYLES[style].id, kind: 'prop', lattice: 'build', size: [256, 8, 256], boxes, windows: [] };
}

/** Where each piece stands: the crest front left of the forecourt, the standard behind it to the right, houses behind. */
export function composition() {
  const ground = GROUND * CELL;
  return {
    crest: [8.5, ground, 21.6],
    standard: [17.6, ground, 18.6],
    homes: [[1.5, ground, 0.5], [22, ground, 0.5]],
    trees: [[1, ground, 11], [30, ground, 16]],
    // Eight plates round the forecourt, then a lane of houses and a grove beyond the square.
    meadows: [[-32, 0, -32], [0, 0, -32], [32, 0, -32], [-32, 0, 0], [32, 0, 0], [-32, 0, 32], [0, 0, 32], [32, 0, 32]],
    backdrop: [['cottage', 0, [-12, ground, -6], 0], ['house', 2, [-22, ground, 4], Math.PI / 2], ['hut', 1, [36, ground, 2], -Math.PI / 2], ['manor', 0, [12, ground, -22], 0]],
    grove: [[2, [-14, ground, 28]], [1, [34, ground, 24]], [0, [40, ground, 12]], [2, [-9, ground, -14]], [1, [26, ground, -8]]],
    camera: { fov: 42, position: [28.5, 5.4, 44], target: [14.6, 7.2, 20] },
  };
}
