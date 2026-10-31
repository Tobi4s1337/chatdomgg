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

/**
 * Bench staging for the showcase panels: what each selected landscape puts in front of and behind the forecourt.
 * Returns the meadow plates it replaces, the extra pieces (each with an optional uniform scale), the water and its
 * height field, and the portrait camera. None of it is the kingdom's terrain; it only lets a panel read as its land.
 */
export function land(character, MAT) {
  if (character === 'coastal-harbour') return harbour(MAT);
  if (character === 'river-valley') return river(MAT);
  return pass(MAT);
}

const ground = GROUND * CELL;
/** The front row of meadow plates (indices into `composition().meadows`), between the forecourt and the camera. */
const FRONT = [5, 6, 7];
/** From the near bank, over the land's own foreground, past the crest to the standard rising behind it. */
const PANEL_CAMERA = { fov: 50, position: [4.2, 4.6, 52], target: [15.2, 5.7, 21.5] };

function seeded(seed) {
  return () => ((seed = (seed * 48271) % 2147483647) / 2147483647);
}
const plate = (id, size, boxes) => ({ version: 1, id, styleId: STYLES.hearth.id, kind: 'prop', lattice: 'build', size, boxes, windows: [] });

/** A harbour: the forecourt ends at a coursed quay over open water, and a timber jetty runs out from its path. */
function harbour(MAT) {
  const pieces = [];
  // The sea bed, two metres down.
  for (const x of [-32, 0, 32]) for (const z of [32, 64]) {
    pieces.push({ blueprint: plate(`heraldry-bench-seabed-${x}-${z}`, [256, 4, 256], [{ from: [0, 0, 0], to: [256, 4, 256], material: MAT.waterbed }]), position: [x, -2.5, z] });
  }
  // Quay: 3 m of coursed stone from the bed to the forecourt, damp and dark below the tide line, a limestone coping.
  for (const [i, x] of [-32, 0, 32].entries()) {
    const boxes = [];
    const add = (x0, y0, z0, x1, y1, z1, material) => boxes.push({ from: [x0, y0, z0], to: [x1, y1, z1], material });
    const next = seeded(31 + i * 977);
    add(0, 0, 0, 256, 23, 11, MAT.stone);
    for (let y = 0, course = 0; y < 22; y += 3, course++) {
      // Each course laid in blocks of irregular length, alternate ones a shade apart, so the face reads as masonry.
      for (let bx = course % 2 ? -6 : 0; bx < 256;) {
        const len = 8 + Math.floor(next() * 10);
        const material = y < 8 ? (next() < 0.7 ? MAT.darkStone : MAT.moss) : (next() < 0.25 ? MAT.limestone : MAT.stone);
        add(Math.max(0, bx), y, 10, Math.min(256, bx + len - 1), y + 3, 11, material);
        bx += len;
      }
    }
    add(0, 22, 0, 256, 24, 12, MAT.limestone);
    // Mooring bollards along the coping, iron-dark with a brass band.
    for (let bx = 18; bx < 250; bx += 52) {
      if (i === 1 && bx > 96 && bx < 160) continue;
      add(bx, 24, 3, bx + 4, 28, 7, MAT.darkStone);
      add(bx - 1, 28, 2, bx + 5, 29, 8, MAT.darkStone);
      add(bx, 26, 3, bx + 4, 27, 7, MAT.brass);
    }
    if (i === 1) {
      // The jetty: a plank deck on paired piles from the end of the path out over the water.
      const deck = 22, from = 114, to = 142;
      add(from, deck - 2, 12, to, deck, 104, MAT.timber);
      for (let z = 12; z < 104; z += 3) add(from, deck, z, to, deck + 1, z + 2, MAT.timber);
      for (let z = 24; z < 104; z += 20) for (const px of [from - 2, to - 1]) add(px, 0, z, px + 3, deck + 6, z + 3, MAT.bark);
      for (const px of [from - 2, to - 1]) add(px, deck + 5, 12, px + 3, deck + 6, 104, MAT.timber);
      for (const px of [from - 1, to - 1]) for (let z = 24; z < 104; z += 20) add(px, deck + 4, z, px + 2, deck + 5, z + 3, MAT.thatch);
      add(from - 2, deck - 2, 101, to + 2, deck + 6, 104, MAT.bark);
    }
    pieces.push({ blueprint: plate(`heraldry-bench-quay-${i}`, [256, 30, 104], boxes), position: [x, -2.5, 32] });
  }
  const level = 0.12;
  const height = (x, z) => (z > 33.5 ? -2 : ground);
  return { replaces: FRONT, pieces, water: { lake: { x: 16, z: 62, radiusX: 46, radiusZ: 26, level }, height }, camera: PANEL_CAMERA };
}

/** A river valley: a stream crosses in front of the forecourt between reedy banks, and stepping stones carry the path over. */
function river(MAT) {
  const pieces = [];
  // Channel profile in cells from the plate's near edge (z 32): bank, slope, bed, slope, bank.
  const depthAt = zc => {
    if (zc < 4 || zc > 60) return 0;
    const edge = Math.min(zc - 4, 60 - zc);
    return Math.min(9, 2 + edge);
  };
  for (const [i, x] of [-32, 0, 32].entries()) {
    const boxes = [];
    const add = (x0, y0, z0, x1, y1, z1, material) => boxes.push({ from: [x0, y0, z0], to: [x1, y1, z1], material });
    const next = seeded(53 + i * 7919);
    add(0, 0, 0, 256, 12, 256, MAT.grass);
    add(0, 0, 0, 256, 11, 256, MAT.earth);
    for (let zc = 0; zc < 64; zc++) {
      const d = depthAt(zc);
      if (d) {
        add(0, 12 - d, zc, 256, 12, zc + 1, 0);
        add(0, 11 - d, zc, 256, 12 - d, zc + 1, d > 5 ? MAT.waterbed : MAT.earth);
      }
    }
    // Pebbles on the bed, and stones, reeds and flowers along both banks.
    for (let n = 0; n < 70; n++) {
      const bx = Math.floor(next() * 250), zc = 12 + Math.floor(next() * 40);
      add(bx, 12 - depthAt(zc), zc, bx + 2 + Math.floor(next() * 3), 13 - depthAt(zc), zc + 2, next() < 0.5 ? MAT.stone : MAT.limestone);
    }
    for (const [lo, hi] of [[0, 9], [56, 72]]) {
      for (let n = 0; n < 150; n++) {
        const bx = Math.floor(next() * 254), zc = lo + Math.floor(next() * (hi - lo));
        const base = 12 - depthAt(zc), roll = next();
        if (roll < 0.45) {
          // A clump of reeds: green stems of uneven height, a few with a pale seed head.
          for (let k = 0; k < 5; k++) {
            const rx = Math.min(255, bx + Math.floor(next() * 4)), rz = zc + Math.floor(next() * 3), top = base + 3 + Math.floor(next() * 4);
            add(rx, base, rz, rx + 1, top, rz + 1, next() < 0.7 ? MAT.moss : MAT.leaf);
            if (next() < 0.35) add(rx, top, rz, rx + 1, top + 1, rz + 1, MAT.thatch);
          }
        }
        else if (roll < 0.7) add(bx, base, zc, bx + 1, base + 1, zc + 1, next() < 0.5 ? MAT.blueFlower : MAT.petal);
        else if (roll < 0.85) add(bx, base - 1, zc, bx + 3, base + 1, zc + 3, MAT.stone);
        else add(bx, base, zc, bx + 2, base + 1, zc + 2, MAT.moss);
      }
    }
    if (i === 1) {
      // Stepping stones in line with the path, their tops just clear of the water.
      for (let zc = 6, k = 0; zc < 60; zc += 9, k++) {
        const sx = 118 + (k % 2 ? 3 : -2);
        add(sx, 12 - depthAt(zc + 3) - 1, zc, sx + 18, 10, zc + 7, k % 2 ? MAT.limestone : MAT.stone);
        add(sx + 1, 10, zc + 1, sx + 17, 11, zc + 6, k % 2 ? MAT.stone : MAT.limestone);
        add(sx, 9, zc, sx + 3, 11, zc + 2, MAT.moss);
      }
    }
    // Scatter of tufts on the far meadow, as on every plate.
    for (let n = 0; n < 80; n++) {
      const bx = Math.floor(next() * 252), zc = 74 + Math.floor(next() * 180);
      add(bx, 12, zc, bx + 1 + Math.floor(next() * 2), 13, zc + 1, [MAT.petal, MAT.blueFlower, MAT.moss, MAT.cream][Math.floor(next() * 4)]);
    }
    pieces.push({ blueprint: plate(`heraldry-bench-river-${i}`, [256, 24, 256], boxes), position: [x, -1, 32] });
  }
  const level = 0.18;
  const height = (x, z) => {
    const zc = Math.floor((z - 32) / CELL);
    return z < 32 || z >= 64 ? ground : ground - depthAt(zc) * CELL;
  };
  return { replaces: FRONT, pieces, water: { lake: { x: 16, z: 36, radiusX: 46, radiusZ: 6, level }, height }, camera: PANEL_CAMERA };
}

/** A mountain pass: snow-capped peaks rise behind the town, and boulders lie bedded in the near meadow. */
function pass(MAT) {
  const pieces = [];
  // Peaks at terrain scale: a build model drawn in 4-cell columns and shown four times larger, so a column is 2 m.
  const peaks = [
    { seed: 3, at: [22, -150], height: 104, snow: 80, stretch: 1.5 },
    { seed: 5, at: [78, -200], height: 128, snow: 92, stretch: 1.2 },
    { seed: 9, at: [128, -150], height: 92, snow: 76, stretch: 1.6 },
  ];
  for (const { seed, at, height, snow, stretch } of peaks) {
    const boxes = [];
    const next = seeded(seed * 7919);
    const ridge = next() * Math.PI;
    for (let cx = 0; cx < 48; cx++) for (let cz = 0; cz < 48; cz++) {
      const dx = (cx - 23.5) / 24, dz = (cz - 23.5) / 24;
      const along = dx * Math.cos(ridge) + dz * Math.sin(ridge), across = -dx * Math.sin(ridge) + dz * Math.cos(ridge);
      // A ridge rather than a spike: long along its axis, with spurs and gullies cut across the slopes.
      const r = Math.hypot(along / stretch, across * 1.15);
      const spurs = Math.sin(Math.atan2(across, along) * 5 + seed) * 0.07 * r + Math.sin(cx * 0.9 + seed) * Math.cos(cz * 0.7 - seed) * 0.05;
      const h = Math.min(height, Math.round(height * Math.max(0, 1 - r + spurs) ** 1.1 / 2) * 2);
      if (h <= 0) continue;
      const x = cx * 4, z = cz * 4;
      const tree = 12 + Math.floor(next() * 10);
      const low = Math.min(h, tree);
      boxes.push({ from: [x, 0, z], to: [x + 4, low, z + 4], material: next() < 0.55 ? MAT.leaf : MAT.grass });
      if (h > low) boxes.push({ from: [x, low, z], to: [x + 4, Math.min(h, snow), z + 4], material: (cx * 3 + cz) % 7 === 0 ? MAT.darkStone : MAT.stone });
      if (h > snow) boxes.push({ from: [x, snow, z], to: [x + 4, h, z + 4], material: MAT.hairSilver });
    }
    pieces.push({ blueprint: plate(`heraldry-bench-peak-${seed}`, [192, height + 2, 192], boxes), position: [at[0] - 48, 0, at[1] - 48], scale: 4 });
  }
  // Boulders bedded in the near meadow: a few big ones and a scatter of scree.
  const boxes = [];
  const add = (x0, y0, z0, x1, y1, z1, material) => boxes.push({ from: [x0, y0, z0], to: [x1, y1, z1], material });
  add(0, 0, 0, 256, GROUND, 256, MAT.grass);
  const next = seeded(4243);
  for (const [bx, bz, w] of [[20, 30, 22], [180, 20, 16], [230, 60, 26], [70, 90, 12], [150, 70, 10]]) {
    add(bx, GROUND - 1, bz, bx + w, GROUND + Math.round(w * 0.5), bz + Math.round(w * 0.8), MAT.stone);
    add(bx + 2, GROUND + Math.round(w * 0.5), bz + 2, bx + w - 3, GROUND + Math.round(w * 0.7), bz + Math.round(w * 0.8) - 2, MAT.stone);
    add(bx + 3, GROUND + Math.round(w * 0.7), bz + 3, bx + w - 6, GROUND + Math.round(w * 0.8), bz + Math.round(w * 0.6), MAT.moss);
    add(bx - 1, GROUND - 1, bz + 2, bx, GROUND + 3, bz + Math.round(w * 0.6), MAT.darkStone);
  }
  for (let n = 0; n < 160; n++) {
    const bx = Math.floor(next() * 250), bz = Math.floor(next() * 250), roll = next();
    if (roll < 0.35) add(bx, GROUND, bz, bx + 2 + Math.floor(next() * 3), GROUND + 1 + Math.floor(next() * 2), bz + 2 + Math.floor(next() * 2), next() < 0.5 ? MAT.stone : MAT.darkStone);
    else add(bx, GROUND, bz, bx + 1, GROUND + 1, bz + 1 + Math.floor(next() * 2), [MAT.petal, MAT.blueFlower, MAT.moss, MAT.cream][Math.floor(next() * 4)]);
  }
  pieces.push({ blueprint: plate('heraldry-bench-scree', [256, 32, 256], boxes), position: [0, 0, 32] });
  return { replaces: [6], pieces, water: null, camera: PANEL_CAMERA };
}
