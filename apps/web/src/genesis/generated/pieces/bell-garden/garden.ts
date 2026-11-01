import type { Vec3 } from '@chatdom/shared';
import { MAT } from '@chatdom/content/materials';
import { Grid, SOFT, blob, checkOptions, finish, hash, lanternPost, stream, variantTag, type PieceKit } from '../kit';
import type { GeneratedPiece, PieceOptions } from '../types';
import { contrast, emblem, type EmblemFigure } from '../emblem';

/**
 * A little walled (or hedged) bell garden: an arched gate at +Z flying the kingdom's pennant, its leaves swung open,
 * a gravel walk to a timber bell-frame on a stone plinth where a brass bell hangs under its own small pitched roof,
 * a bell rope with a sally in the kingdom's cloth, raised flower beds, a bench on one side and a pool or a stone
 * trough on the other, a blossoming tree in a back corner, climbing roses, and two lamp posts by the walk.
 * The seed picks the size, the enclosure, the walk's plan, sides and details; the style picks the kit.
 */
export interface GardenLayout {
  readonly size: number;
  readonly enclosure: 'wall' | 'hedge';
  readonly walks: 'cross' | 'loop';
  readonly water: 'pool' | 'trough';
  readonly benchLeft: boolean;
  readonly treeLeft: boolean;
  readonly blossom: 'petal' | 'fruit' | 'cream';
  readonly figure: EmblemFigure;
}

const ROOF_ALT: Readonly<Record<PieceKit['style'], number>> = { hearth: MAT.brick, tide: MAT.darkStone, grove: MAT.moss };

export function gardenLayout(seed: number, style: PieceKit['style']): GardenLayout {
  const r = stream(seed, 0xbe11);
  const hedgeBias = style === 'grove' ? 0.7 : 0.3;
  return {
    size: 104 + 8 * r.int(0, 3),
    enclosure: r.chance(hedgeBias) ? 'hedge' : 'wall',
    walks: r.chance(0.5) ? 'cross' : 'loop',
    water: r.chance(0.6) ? 'pool' : 'trough',
    benchLeft: r.chance(0.5),
    treeLeft: r.chance(0.5),
    blossom: r.pick(['petal', 'fruit', 'cream'] as const),
    figure: r.pick(['heart', 'star', 'diamond', 'note'] as const),
  };
}

export function createBellGarden(options: PieceOptions): GeneratedPiece {
  const kit = checkOptions(options);
  const { field, charge, border } = options.colours;
  const L = gardenLayout(options.seed, kit.style);
  const r = stream(options.seed, 0x9a4de);
  const salt = (options.seed ^ 0x6b2f) | 0;
  const S = L.size, H = 64, c = S / 2, figure = L.figure;
  const g = new Grid(S, H, S);
  const lanterns: Vec3[] = [];
  const t = L.enclosure === 'wall' ? 3 : 5;
  const gateHalf = 8;
  const bx = c, bz = Math.round(S * 0.4), plinth = { x0: bx - 13, x1: bx + 13, z0: bz - 9, z1: bz + 10 };
  const front = S - t, zCross = Math.round((plinth.z1 + front) / 2) - 2;

  // ── Walks: gravel with a darker stone edge, the main walk from the gate to the plinth.
  const gravel = (x0: number, z0: number, x1: number, z1: number) => {
    g.fill(x0 - 1, 0, z0 - 1, x1 + 1, 1, z1 + 1, kit.base);
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      g.set(x, 0, z, hash(x >> 1, 0, z >> 1, salt) < 0.14 ? kit.stone : MAT.paving);
    }
  };
  gravel(c - 5, plinth.z1, c + 5, S - 1);
  if (L.walks === 'cross') gravel(t + 2, zCross - 4, S - t - 2, zCross + 4);
  else {
    gravel(plinth.x0 - 8, plinth.z0 - 8, plinth.x0 - 2, plinth.z1 + 6);
    gravel(plinth.x1 + 2, plinth.z0 - 8, plinth.x1 + 8, plinth.z1 + 6);
    gravel(plinth.x0 - 8, plinth.z0 - 8, plinth.x1 + 8, plinth.z0 - 2);
    gravel(plinth.x0 - 8, plinth.z1 + 1, plinth.x1 + 8, plinth.z1 + 6);
    gravel(c - 5, plinth.z1, c + 5, S - 1);
  }

  // ── Raised beds: timber edging round dark earth, planted in clumps with blooms.
  const bed = (x0: number, z0: number, x1: number, z1: number) => {
    // A bed a gardener can reach across: in a large garden the lawn takes the rest, beds stay hand-sized.
    if (x1 - x0 > 30) { if (x0 <= c - 30) x0 = x1 - 30; else x1 = x0 + 30; }
    if (z1 - z0 > 22) z0 = z1 - 22;
    if (x1 - x0 < 6 || z1 - z0 < 6) return;
    g.fill(x0, 0, z0, x1, 2, z1, kit.trim);
    g.fill(x0 + 1, 0, z0 + 1, x1 - 1, 2, z1 - 1, MAT.earth);
    for (let z = z0 + 1; z < z1 - 1; z += 2) for (let x = x0 + 1; x < x1 - 1; x += 2) {
      const h = hash(x, 1, z, salt);
      if (h < 0.18) continue;
      // Clumps share a height and a flower across each drift of four, as a gardener plants them.
      const tall = 2 + Math.floor(hash(x >> 2, 2, z >> 2, salt) * 3);
      g.fill(x, 2, z, Math.min(x + 2, x1 - 1), 2 + tall, Math.min(z + 2, z1 - 1), MAT.leaf);
      const b = hash(x >> 2, 3, z >> 2, salt);
      const bloom = b < 0.4 ? MAT.petal : b < 0.72 ? MAT.blueFlower : b < 0.86 ? MAT.cream : MAT.leaf;
      if (hash(x, 4, z, salt) < 0.7) g.set(x + (hash(x, 5, z, salt) < 0.5 ? 0 : 1), 2 + tall, z + (hash(x, 6, z, salt) < 0.5 ? 0 : 1), bloom);
    }
  };
  const inner0 = t + 2, inner1 = S - t - 2;
  if (L.walks === 'cross') {
    bed(inner0, zCross + 6, c - 7, front - 3);
    bed(c + 7, zCross + 6, inner1, front - 3);
  } else {
    bed(inner0, plinth.z1 + 8, c - 7, front - 3);
    bed(c + 7, plinth.z1 + 8, inner1, front - 3);
  }
  // A long bed along the back wall, broken by the tree's corner.
  const backBed0 = L.treeLeft ? inner0 + 22 : inner0, backBed1 = L.treeLeft ? inner1 : inner1 - 22;
  bed(backBed0, inner0, backBed1, inner0 + 8);

  // ── The plinth and the bell-frame.
  g.fill(plinth.x0 - 1, 0, plinth.z0 - 1, plinth.x1 + 1, 1, plinth.z1 + 1, kit.base);
  g.fill(plinth.x0, 1, plinth.z0, plinth.x1, 3, plinth.z1, kit.stone);
  g.fill(plinth.x0, 2, plinth.z0, plinth.x1, 3, plinth.z0 + 1, kit.base);
  for (let x = plinth.x0; x < plinth.x1; x += 4) g.fill(x, 2, plinth.z0 + 1, x + 1, 3, plinth.z1, kit.base);
  g.fill(c - 6, 0, plinth.z1, c + 6, 2, plinth.z1 + 3, kit.stone);
  const p0 = bx - 11, p1 = bx + 8, pz = bz - 1, top = 34;
  for (const x of [p0, p1]) {
    g.fill(x - 1, 3, pz - 1, x + 4, 5, pz + 4, kit.stone);
    g.fill(x, 5, pz, x + 3, top, pz + 3, kit.trim);
    // Raking props fore and aft, as a real bell-frame has.
    for (let k = 0; k < 9; k++) {
      g.fill(x + 1, 3 + k * 2, pz - 8 + k, x + 2, 6 + k * 2, pz - 7 + k, kit.wood);
      g.fill(x + 1, 3 + k * 2, pz + 10 - k, x + 2, 6 + k * 2, pz + 11 - k, kit.wood);
    }
  }
  // The headstock beam, its ends notched over the posts, and the cap plates.
  g.fill(p0 - 3, top - 4, pz, p1 + 6, top, pz + 3, kit.trim);
  g.fill(p0 - 3, top - 4, pz + 1, p0 - 2, top - 2, pz + 2, kit.wood);
  g.fill(p1 + 5, top - 4, pz + 1, p1 + 6, top - 2, pz + 2, kit.wood);
  g.fill(p0 - 1, top, pz - 6, p0 + 4, top + 1, pz + 9, kit.trim);
  g.fill(p1 - 1, top, pz - 6, p1 + 4, top + 1, pz + 9, kit.trim);
  // The roof: a small steep gable facing the gate, tiled, on tie beams across both ends, its front gable carrying
  // the kingdom's roundel under the bargeboards, and a brass finial at each apex.
  const rx0 = p0 - 5, rx1 = p1 + 8, rz0 = pz - 8, rz1 = pz + 11, half = (rx1 - rx0) / 2;
  g.fill(p0 - 1, top, rz0 + 1, p0 + 4, top + 1, rz1 - 1, kit.trim);
  g.fill(p1 - 1, top, rz0 + 1, p1 + 4, top + 1, rz1 - 1, kit.trim);
  for (const z of [rz0 + 1, rz1 - 3]) g.fill(rx0 + 1, top, z, rx1 - 1, top + 1, z + 2, kit.trim);
  let rows = 0;
  for (let k = 0; k < half; k++, rows++) {
    const y = top + 1 + k;
    if (k + 3 >= half) g.fill(rx0 + k, y, rz0, rx1 - k, y + 1, rz1, kit.roof);
    else { g.fill(rx0 + k, y, rz0, rx0 + k + 3, y + 1, rz1, kit.roof); g.fill(rx1 - k - 3, y, rz0, rx1 - k, y + 1, rz1, kit.roof); }
    for (const z of [rz0 + 1, rz1 - 2]) g.fill(rx0 + k + 3, y, z, rx1 - k - 3, y + 1, z + 1, L.enclosure === 'wall' ? kit.wall : kit.trim);
  }
  g.fill(rx0, top, rz0, rx0 + 2, top + 1, rz1, kit.roof);
  g.fill(rx1 - 2, top, rz0, rx1, top + 1, rz1, kit.roof);
  const ridge = top + rows, mid = (rx0 + rx1) / 2;
  g.fill(Math.floor(mid) - 1, ridge, rz0, Math.ceil(mid) + 1, ridge + 1, rz1, ROOF_ALT[kit.style]);
  for (let z = rz0; z < rz1; z++) for (let y = top; y < ridge; y++) for (let x = rx0; x < rx1; x++) {
    if (g.get(x, y, z) === kit.roof && !g.get(x, y + 1, z) && hash(x, y, z >> 1, salt) < 0.06) g.set(x, y, z, ROOF_ALT[kit.style]);
  }
  g.over(rx0, top, rz0, rx1, ridge + 1, rz0 + 1, kit.trim);
  g.over(rx0, top, rz1 - 1, rx1, ridge + 1, rz1, kit.trim);
  emblem(g, figure, Math.round(mid), top + 6, rz1 - 1, 4, charge, border, contrast([field, MAT.cream, MAT.darkStone], [charge, border]), 'z');
  for (const z of [rz0, rz1 - 1]) { g.fill(Math.floor(mid), ridge + 1, z, Math.floor(mid) + 1, ridge + 4, z + 1, kit.metal); }

  // The bell: a waisted brass profile flaring to a heavy lip, hollow below the shoulder, a copper band, a clapper.
  const bellTop = top - 5, bcx = (p0 + 3 + p1) / 2, bcz = pz + 1.5;
  const profile = [2.2, 3.0, 3.3, 3.4, 3.5, 3.6, 3.8, 4.2, 4.7, 5.2, 5.4];
  g.fill(Math.floor(bcx) - 3, bellTop, Math.floor(bcz) - 1, Math.ceil(bcx) + 3, bellTop + 1, Math.ceil(bcz) + 1, kit.trim);
  profile.forEach((rad, k) => {
    const y = bellTop - 1 - k, inner = k >= 3 ? rad - 1.2 : -1;
    for (let z = Math.floor(bcz - rad - 1); z <= bcz + rad + 1; z++) for (let x = Math.floor(bcx - rad - 1); x <= bcx + rad + 1; x++) {
      const d = Math.hypot(x + 0.5 - bcx, z + 0.5 - bcz);
      if (d <= rad && d > inner) g.set(x, y, z, k === 8 ? MAT.forgeCopper : MAT.brass);
    }
  });
  const mouth = bellTop - profile.length;
  g.fill(Math.floor(bcx), mouth - 1, Math.floor(bcz), Math.floor(bcx) + 1, bellTop - 3, Math.floor(bcz) + 1, kit.iron);
  g.fill(Math.floor(bcx) - 1, mouth - 2, Math.floor(bcz) - 1, Math.floor(bcx) + 1, mouth, Math.floor(bcz) + 1, kit.iron);
  // The rope from a lever on the headstock, down to a striped sally in the kingdom's cloth.
  const ropeX = p1 - 2, ropeZ = pz + 3;
  g.fill(ropeX - 3, top - 5, pz + 1, ropeX + 1, top - 4, pz + 4, kit.wood);
  g.fill(ropeX, 9, ropeZ, ropeX + 1, top - 5, ropeZ + 1, kit.cord);
  g.fill(ropeX, 13, ropeZ - 1, ropeX + 1, 19, ropeZ + 2, field);
  g.fill(ropeX - 1, 14, ropeZ, ropeX + 2, 18, ropeZ + 1, field);
  g.fill(ropeX - 1, 16, ropeZ, ropeX + 2, 17, ropeZ + 1, charge);
  g.fill(ropeX, 16, ropeZ - 1, ropeX + 1, 17, ropeZ + 2, charge);
  g.set(ropeX, 12, ropeZ, border);

  // ── The enclosure.
  const wallH = 7;
  // A pale coping on Tide's grey wall, a grey one on the warm and the dark walls: never a dark-blue line.
  const coping = kit.style === 'tide' ? MAT.limestone : MAT.stone;
  if (L.enclosure === 'wall') {
    for (const [x0, z0, x1, z1] of [[0, 0, S, t], [0, 0, t, S], [S - t, 0, S, S], [0, S - t, c - gateHalf, S], [c + gateHalf, S - t, S, S]] as const) {
      g.fill(x0, 0, z0, x1, wallH, z1, kit.stone);
      g.fill(x0, wallH, z0, x1, wallH + 1, z1, coping);
    }
    // Coursed blocks of the second stone let into the faces, moss settling on the coping.
    for (let z = 0; z < S; z++) for (let y = 0; y < wallH; y++) for (let x = 0; x < S; x++) {
      if (g.get(x, y, z) !== kit.stone || !g.exposed(x, y, z)) continue;
      const course = y >> 1, block = hash(Math.floor((x + z + course * 2) / 3), course, Math.floor((x + z) / 97), salt);
      if (block < 0.07) g.set(x, y, z, kit.rock);
      else if (y < 2 && hash(x >> 2, y, z >> 2, salt) < 0.2) g.set(x, y, z, MAT.moss);
    }
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) if (g.get(x, wallH, z) === coping && hash(x >> 1, 7, z >> 1, salt) < 0.16) g.set(x, wallH, z, MAT.moss);
    // Corner piers with ball caps.
    for (const [x, z] of [[0, 0], [S - 5, 0], [0, S - 5], [S - 5, S - 5]] as const) {
      g.fill(x, 0, z, x + 5, wallH + 3, z + 5, kit.stone);
      g.fill(x, wallH + 3, z, x + 5, wallH + 4, z + 5, coping);
      g.fill(x + 1, wallH + 4, z + 1, x + 4, wallH + 7, z + 4, kit.stone);
      g.fill(x + 2, wallH + 7, z + 2, x + 3, wallH + 8, z + 3, kit.stone);
    }
  } else {
    for (const [x0, z0, x1, z1] of [[0, 0, S, t], [0, 0, t, S], [S - t, 0, S, S], [0, S - t, c - gateHalf - 3, S], [c + gateHalf + 3, S - t, S, S]] as const) {
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
        const h = 9 + Math.floor(hash(Math.floor(x / 4), 0, Math.floor(z / 4), salt) * 3);
        const edge = Math.min(x - x0, x1 - 1 - x, z - z0, z1 - 1 - z) === 0 && (x1 - x0 > 5 && z1 - z0 > 5 ? false : true);
        g.fill(x, 0, z, x + 1, edge ? h - 1 : h, z + 1, MAT.leaf);
      }
      // The hedge's crown rounded off along its outer and inner faces, and the odd bloom.
      for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
        const face = (z1 - z0 === t && (z === z0 || z === z1 - 1)) || (x1 - x0 === t && (x === x0 || x === x1 - 1));
        let y = H - 1;
        while (y > 0 && !g.get(x, y, z)) y--;
        if (face) g.set(x, y, z, MAT.air);
        const b = hash(x >> 1, y >> 1, z >> 1, salt);
        if (!face && b < 0.05) g.set(x, y, z, b < 0.025 ? MAT.petal : MAT.cream);
        // Fresh clipped growth catches the light along the crown in lighter patches.
        else if (!face && hash(x >> 2, 11, z >> 2, salt) < 0.4) g.set(x, y, z, MAT.moss);
      }
    }
    // Clipped topiary on posts either side of the gate.
    for (const x of [c - gateHalf - 3, c + gateHalf]) {
      g.fill(x, 0, S - 6, x + 3, 12, S - 1, MAT.leaf);
    }
  }

  // ── The gate: an arch over the opening (stone voussoirs on a wall, a rose-twined timber arch on a hedge), its
  // leaves swung open into the garden, and the pennant flying from the crown.
  const springing = 15, ri = gateHalf, ro = gateHalf + 3, gz0 = S - 6, gz1 = S;
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? c - gateHalf - 4 : c + gateHalf, x1 = x0 + 4;
    if (L.enclosure === 'wall') {
      g.fill(x0, 0, gz0, x1, springing, gz1, kit.stone);
      g.fill(x0 - (side < 0 ? 1 : 0), springing - 1, gz0, x1 + (side > 0 ? 1 : 0), springing, gz1, kit.base);
      g.fill(x0, 0, gz0, x1, 1, gz1, kit.base);
    } else g.fill(x0 + 1, 0, gz0 + 1, x1 - 1, springing, gz1 - 1, kit.trim);
  }
  for (let y = springing; y < springing + ro + 1; y++) for (let x = c - ro - 1; x <= c + ro; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - springing);
    if (d < ri || d > ro + 0.3) continue;
    const a = Math.atan2(y + 0.5 - springing, x + 0.5 - c);
    if (L.enclosure === 'wall') {
      const segment = Math.floor((a / Math.PI) * 9);
      const key = segment === 4;
      g.fill(x, y, gz0, x + 1, y + 1, gz1, key ? kit.rock : segment % 2 ? kit.stone : kit.base);
    } else g.fill(x, y, gz0 + 1, x + 1, y + 1, gz1 - 1, kit.trim);
  }
  if (L.enclosure === 'hedge') {
    // Roses climbing both legs and over the arch.
    for (let y = 1; y < springing + ro + 1; y++) for (let x = c - ro - 2; x <= c + ro + 1; x++) for (const z of [gz0, gz1 - 1]) {
      if (g.get(x, y, z) || !(g.get(x + 1, y, z) || g.get(x - 1, y, z) || g.get(x, y - 1, z) || g.get(x, y, z + (z === gz0 ? 1 : -1)))) continue;
      const h = hash(x >> 1, y >> 1, z, salt);
      if (h < 0.5) g.set(x, y, z, hash(x, y, z, salt) < 0.22 ? MAT.petal : MAT.leaf);
    }
  }
  // The pennant's pole stands on the arch's shoulder (the seed picks which), so it never hides the bell-cote's
  // roundel from the walk; the pennant flies outward, swallow-tailed.
  const flagSide = r.chance(0.5) ? 1 : -1, pole = Math.floor(c + flagSide * 6), pzc = gz0 + 3;
  let crown = H - 1;
  while (crown > 0 && !g.get(pole, crown - 1, pzc)) crown--;
  g.fill(pole, crown, pzc, pole + 1, crown + 15, pzc + 1, kit.iron);
  g.set(pole, crown + 15, pzc, kit.metal);
  for (let k = 0; k < 10; k++) {
    const h = k < 7 ? 5 - Math.floor(k / 2.5) : 3;
    for (let dy = 0; dy < h; dy++) {
      if (k >= 8 && dy === 1) continue; // the swallow tail's notch
      const m = dy === h - 1 ? border : k === 3 && dy === 1 ? charge : field;
      g.set(pole + flagSide * (1 + k), crown + 14 - dy, pzc, m);
    }
  }
  for (const side of [-1, 1]) {
    // A board-and-ledge leaf two metres tall, standing open against the inside of the wall.
    const x = side < 0 ? c - gateHalf : c + gateHalf - 1, z0 = gz0 - 9;
    for (let z = z0; z < gz0; z++) g.fill(x, 1, z, x + 1, 11 + ((z - z0) % 3 === 0 ? 0 : 0), z + 1, (z - z0) % 3 === 2 ? kit.wood : kit.trim);
    g.fill(x - side, 2, z0, x - side + 1, 3, gz0, kit.wood);
    g.fill(x - side, 8, z0, x - side + 1, 9, gz0, kit.wood);
    for (let k = 0; k < 6; k++) g.set(x - side, 3 + k, z0 + 1 + k, kit.wood);
    g.fill(x, 0, gz0 - 1, x + 1, 1, gz0, kit.iron);
  }

  // ── Lamp posts by the walk, halfway to the bell.
  const lz = L.walks === 'cross' ? zCross + 5 : plinth.z1 + 9;
  lanterns.push(lanternPost(g, kit, c - 9, lz, 20), lanternPost(g, kit, c + 7, lz, 20));

  // ── The bench on one side, the water on the other.
  const benchX = L.benchLeft ? inner0 + 6 : inner1 - 10, benchZ = bz - 4;
  const back = L.benchLeft ? -1 : 1;
  g.fill(benchX, 4, benchZ, benchX + 4, 5, benchZ + 16, kit.trim);
  g.fill(benchX + 1, 4, benchZ, benchX + 2, 5, benchZ + 16, kit.wood);
  for (const z of [benchZ + 1, benchZ + 14]) for (const x of [benchX, benchX + 3]) g.fill(x, 0, z, x + 1, 4, z + 1, kit.wood);
  const backX = back < 0 ? benchX - 1 : benchX + 4;
  g.fill(backX, 4, benchZ, backX + 1, 10, benchZ + 16, kit.trim);
  g.fill(backX, 7, benchZ + 1, backX + 1, 8, benchZ + 15, kit.wood);
  for (const z of [benchZ - 1, benchZ + 16]) g.fill(benchX - (back < 0 ? 1 : 0), 4, z, benchX + 4 + (back > 0 ? 1 : 0), 7, z + 1, kit.trim);
  // A cushion in the kingdom's cloth.
  g.fill(benchX + 1, 5, benchZ + 2, benchX + 4, 6, benchZ + 7, field);
  g.fill(benchX + 1, 5, benchZ + 4, benchX + 4, 6, benchZ + 5, border);

  const wx = L.benchLeft ? inner1 - 14 : inner0 + 14, wz = bz + 1;
  if (L.water === 'pool') {
    for (let z = wz - 12; z <= wz + 12; z++) for (let x = wx - 12; x <= wx + 12; x++) {
      const d = Math.hypot(x + 0.5 - wx, z + 0.5 - wz);
      if (d > 10.5) continue;
      if (d > 8.2) g.fill(x, 0, z, x + 1, 3, z + 1, hash(Math.floor(Math.atan2(z - wz, x - wx) * 4), 0, 0, salt) < 0.5 ? kit.stone : kit.base);
      else g.fill(x, 0, z, x + 1, 2, z + 1, MAT.waterbed);
    }
    for (const [dx, dz] of [[-4, -2], [2, 3], [3, -4], [-1, 5]] as const) {
      if (r.chance(0.8)) { g.fill(wx + dx, 2, wz + dz, wx + dx + 2, 3, wz + dz + 2, MAT.leaf); g.set(wx + dx, 2, wz + dz + 1, MAT.air); }
    }
    g.set(wx + 2, 3, wz + 3, MAT.petal);
    g.fill(wx - 5, 0, wz + 9, wx - 2, 4, wz + 11, MAT.leaf);
    g.set(wx - 4, 4, wz + 10, MAT.blueFlower);
  } else {
    // A long stone trough on two blocks, brimming, with an iron pump at its head.
    const x0 = wx - 4, x1 = wx + 4, z0 = wz - 9, z1 = wz + 9;
    g.fill(x0, 0, z0 + 1, x0 + 2, 2, z0 + 4, kit.base); g.fill(x1 - 2, 0, z1 - 4, x1, 2, z1 - 1, kit.base);
    g.fill(x0 + 2, 0, z0 + 1, x1 - 2, 2, z0 + 4, kit.base); g.fill(x0 + 2, 0, z1 - 4, x1 - 2, 2, z1 - 1, kit.base);
    g.fill(x0, 2, z0, x1, 7, z1, kit.stone);
    g.fill(x0 + 1, 4, z0 + 1, x1 - 1, 7, z1 - 1, MAT.air);
    g.fill(x0 + 1, 4, z0 + 1, x1 - 1, 6, z1 - 1, MAT.waterbed);
    g.fill(x0, 7, z0, x1, 8, z0 + 1, kit.base); g.fill(x0, 7, z1 - 1, x1, 8, z1, kit.base);
    const px = wx - 1, pzz = z0 - 3;
    g.fill(px - 1, 0, pzz - 1, px + 3, 1, pzz + 3, kit.base);
    g.fill(px, 1, pzz, px + 2, 14, pzz + 2, kit.iron);
    g.fill(px, 11, pzz + 2, px + 2, 12, pzz + 5, kit.iron);
    g.set(px, 10, pzz + 4, kit.iron);
    g.fill(px + 2, 13, pzz, px + 7, 14, pzz + 1, kit.iron);
    g.set(px, 14, pzz, kit.metal); g.set(px + 1, 14, pzz + 1, kit.metal);
    // A bucket by the trough.
    g.fill(x1 + 1, 0, z1 - 4, x1 + 4, 3, z1 - 1, kit.trim);
    g.fill(x1 + 1, 1, z1 - 4, x1 + 4, 2, z1 - 1, kit.iron);
    g.fill(x1 + 2, 2, z1 - 3, x1 + 3, 3, z1 - 2, MAT.waterbed);
  }

  // ── The tree in a back corner: a forked trunk, a ragged crown and its blossom or fruit.
  const tx = L.treeLeft ? inner0 + 10 : inner1 - 12, tz = inner0 + 10;
  g.fill(tx - 1, 0, tz - 1, tx + 3, 1, tz + 3, MAT.bark);
  g.fill(tx, 0, tz, tx + 2, 18, tz + 2, MAT.bark);
  for (let k = 0; k < 7; k++) { g.fill(tx + 2 + k, 16 + k, tz, tx + 3 + k, 18 + k, tz + 2, MAT.bark); g.fill(tx - 1 - k, 17 + k, tz + 1, tx - k, 19 + k, tz + 2, MAT.bark); }
  g.fill(tx, 18, tz, tx + 2, 26, tz + 2, MAT.bark);
  const crownY = 30, rx = 12 + r.int(0, 3), ry = 8 + r.int(0, 2), rz = 11 + r.int(0, 3);
  const bloom = L.blossom === 'petal' ? MAT.petal : L.blossom === 'fruit' ? MAT.fabricRed : MAT.cream;
  blob(g, tx + 1, crownY, tz + 1, rx, ry, rz, MAT.leaf, (x, y, z, d) => d < 1 - 0.28 * hash(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 3), salt));
  blob(g, tx + 6, crownY + 3, tz + 4, 7, 5, 7, MAT.leaf, (x, y, z, d) => d < 1 - 0.3 * hash(x >> 1, y >> 1, z >> 1, salt + 1));
  for (let z = tz - rz - 2; z < tz + rz + 4; z++) for (let y = crownY - ry; y < crownY + ry + 6; y++) for (let x = tx - rx - 2; x < tx + rx + 8; x++) {
    if (g.get(x, y, z) !== MAT.leaf || !g.exposed(x, y, z)) continue;
    const h = L.blossom === 'fruit' ? hash(x, y, z, salt) : hash(x >> 1, y >> 1, z >> 1, salt);
    if (h < (L.blossom === 'fruit' ? 0.035 : 0.13)) g.set(x, y, z, bloom);
  }
  // Fallen petals or windfalls on the grass under it.
  for (let k = 0; k < 12; k++) {
    const x = Math.round(tx + r.range(-rx, rx)), z = Math.round(tz + r.range(-rz * 0.6, rz));
    if (!g.get(x, 0, z) && x > t && z > t) g.set(x, 0, z, bloom);
  }

  // ── Climbing roses on the inside of the wall, and tufts at the enclosure's foot.
  if (L.enclosure === 'wall') {
    for (let k = 0; k < 3; k++) {
      const along = r.int(14, S - 28), side = r.int(0, 2);
      const [x, z] = side === 0 ? [along, t] : side === 1 ? [t, along] : [S - t - 1, along];
      for (let y = 0; y < wallH + 2; y++) for (let a = -4; a <= 4; a++) {
        if (Math.abs(a) + y * 0.4 > 5 + hash(a, y, k, salt) * 2) continue;
        const [cx2, cz2] = side === 0 ? [x + a, z] : [x, z + a];
        if (g.get(cx2, y, cz2)) continue;
        g.set(cx2, y, cz2, hash(cx2, y, cz2, salt) < 0.25 ? MAT.petal : MAT.leaf);
      }
    }
  }
  for (let z = 1; z < S - 1; z++) for (let x = 1; x < S - 1; x++) {
    if (g.get(x, 0, z) || !(g.get(x + 1, 2, z) || g.get(x - 1, 2, z) || g.get(x, 2, z + 1) || g.get(x, 2, z - 1))) continue;
    const h = hash(x >> 1, 9, z >> 1, salt);
    if (h < 0.3) g.fill(x, 0, z, x + 1, h < 0.1 ? 2 : 1, z + 1, MAT.leaf);
  }

  g.prune(L.blossom === 'fruit' ? new Set([...SOFT, bloom]) : SOFT);
  const id = `genesis-bell-garden-${kit.style}-${L.enclosure}-${variantTag(options.seed, options.colours)}`;
  return finish(g, id, kit.style, lanterns);
}
