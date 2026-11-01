import type { Vec3 } from '@chatdom/shared';
import { MAT } from '@chatdom/content/materials';
import { Grid, bunting, checkOptions, finish, hash, lanternPost, stream, variantTag, type PieceKit } from '../kit';
import type { GeneratedPiece, PieceOptions } from '../types';
import { contrast, emblem, type EmblemFigure } from '../emblem';

/**
 * The village open-air stage where the chat gathers: a raised plank deck on stone piers with slatted skirts, flared
 * stone steps up the front, a canopy on four posts with a pediment carrying the kingdom's emblem, a dagged valance
 * and tied-back curtains in its cloth, a backdrop hanging, side rails, a drum and a lute on the boards, lamp posts at
 * the deck's front corners, bunting from the gable down to them, and rows of benches or log seats on a worn green.
 *
 * Two canopy forms share the grammar: a steep tiled `gable` in the kit's roof, and a striped cloth `tent` with a
 * concave pitch and dagged eaves. The seed picks the form and every proportion and detail; the style picks the kit.
 */
export type StageCanopy = 'gable' | 'tent';

export interface StageLayout {
  readonly canopy: StageCanopy;
  readonly deck: { readonly x: readonly [number, number]; readonly z: readonly [number, number]; readonly height: number };
  readonly eave: number;
  readonly apex: number;
  readonly rows: number;
  readonly seats: 'bench' | 'log';
  readonly figure: EmblemFigure;
}

const ROOF_ALT: Readonly<Record<PieceKit['style'], number>> = { hearth: MAT.brick, tide: MAT.darkStone, grove: MAT.moss };

export function stageLayout(seed: number): StageLayout & { readonly width: number; readonly chamfer: number } {
  const r = stream(seed, 0x57a6e);
  const canopy: StageCanopy = r.chance(0.5) ? 'gable' : 'tent';
  const deckW = 76 + 4 * r.int(0, 2), width = deckW + 28;
  const height = r.pick([8, 10] as const), depth = 40 + 2 * r.int(0, 3);
  const x0 = (width - deckW) / 2, z0 = 4;
  const eave = height + 28 + 2 * r.int(0, 1);
  const half = (deckW + 6) / 2;
  const apex = eave + (canopy === 'gable' ? half : half - 8);
  return {
    canopy, width, chamfer: r.int(5, 8),
    deck: { x: [x0, x0 + deckW], z: [z0, z0 + depth], height },
    eave, apex, rows: r.int(2, 3), seats: r.chance(0.5) ? 'bench' : 'log',
    figure: r.pick(['heart', 'star', 'diamond', 'note'] as const),
  };
}

export function createOpenAirStage(options: PieceOptions): GeneratedPiece {
  const kit = checkOptions(options);
  const { field, charge, border } = options.colours;
  const L = stageLayout(options.seed);
  const r = stream(options.seed, 0x5eed5);
  const salt = (options.seed ^ 0x2c1b) | 0;
  const [dx0, dx1] = L.deck.x, [dz0, zf] = L.deck.z, dh = L.deck.height, xc = (dx0 + dx1) / 2;
  const width = L.width, depth = 104, height = L.apex + 18;
  const g = new Grid(width, height, depth);
  const lanterns: Vec3[] = [];

  // ── The green: worn earth where feet go (a fan at the foot of the steps and the aisle between the seats), ragged
  // at its rim with tufts; the rest is the host's grass.
  const stepsOut = zf + 3 * (dh / 2 - 1);
  const firstRow = stepsOut + 9;
  for (let z = stepsOut - 2; z < depth - 1; z++) for (let x = 0; x < width; x++) {
    const n = hash(x >> 1, 0, z >> 1, salt) * 0.4 + hash(x >> 2, 9, z >> 2, salt) * 0.3;
    const fan = ((x + 0.5 - xc) / 22) ** 2 + ((z + 0.5 - stepsOut) / 9) ** 2;
    const aisle = Math.abs(x + 0.5 - xc) / (5.5 + 2 * hash(0, 8, z >> 2, salt)) + Math.max(0, (z - depth + 10) / 8);
    const e = Math.min(fan, aisle * aisle);
    if (e < 0.55 + n) g.set(x, 0, z, MAT.earth);
    else if (e < 0.85 + n && hash(x, 1, z, salt) < 0.3) g.set(x, 0, z, MAT.leaf);
  }
  // Flagstones at the foot of the steps.
  for (let z = stepsOut; z < stepsOut + 8; z += 4) for (let x = Math.round(xc) - 16; x < xc + 16; x += 5) {
    const w = 3 + Math.floor(hash(x, 2, z, salt) * 2), d = 3;
    if (hash(x, 3, z, salt) < 0.85) g.fill(x, 0, z, x + w, 1, z + d, hash(x, 4, z, salt) < 0.5 ? MAT.paving : kit.stone);
  }

  // ── The deck: a slatted skirt on stone piers under a plank floor with a one-cell lip.
  const c = L.chamfer;
  const inset = (z: number) => (z >= zf - c ? z - (zf - c) + 1 : 0);
  const inDeck = (x: number, z: number, shrink: number) => z >= dz0 + shrink && z < zf - shrink && x >= dx0 + inset(z + shrink) + shrink && x < dx1 - inset(z + shrink) - shrink;
  for (let z = dz0; z < zf; z++) for (let x = dx0; x < dx1; x++) {
    if (!inDeck(x, z, 0)) continue;
    if (inDeck(x, z, 1)) {
      const edge = !inDeck(x, z, 2);
      if (edge) {
        // The skirt: boards two wide with a recessed dark gap, a footing course under them.
        g.set(x, 0, z, kit.base);
        const slat = (x + z) % 3 !== 2;
        g.fill(x, 1, z, x + 1, dh - 2, z + 1, slat ? kit.trim : MAT.air);
      } else g.fill(x, 0, z, x + 1, dh - 2, z + 1, kit.wood);
    }
    // Floor planks running front to back, with darker seams; the lip is the outer ring.
    g.fill(x, dh - 2, z, x + 1, dh, z + 1, kit.trim);
    if ((x - dx0) % 5 === 0 && inDeck(x, z, 1)) g.set(x, dh - 1, z, kit.wood);
    if (!inDeck(x, z, 1)) g.set(x, dh - 2, z, kit.wood);
  }
  // Stone piers at the corners and along the faces, flush with the lip, each with a pale cap course.
  const pier = (x: number, z: number, w: number, d: number) => {
    g.fill(x, 0, z, x + w, dh - 2, z + d, kit.stone);
    g.fill(x - 1, 0, z - 1, x + w + 1, 1, z + d + 1, kit.base);
    g.fill(x, dh - 3, z, x + w, dh - 2, z + d, kit.base);
  };
  for (let x = dx0; x <= dx1 - 4; x += Math.floor((dx1 - dx0 - 4) / 4)) { pier(x, dz0, 4, 3); }
  for (const x of [dx0, dx1 - 3]) for (let z = dz0 + 12; z < zf - c - 4; z += 14) pier(x, z, 3, 4);
  for (const side of [-1, 1]) {
    // The front faces: a pier where the chamfer starts and one each side of the steps.
    const x = side < 0 ? dx0 : dx1 - 3;
    pier(x, zf - c - 4, 3, 4);
    const sx = side < 0 ? Math.round(xc) - 15 - 4 : Math.round(xc) + 15;
    pier(sx, zf - 3, 4, 3);
  }

  // ── Steps: flared stone flights up the front, lighter treads over a darker body, with pots at the foot.
  const flights = dh / 2 - 1, sx0 = Math.round(xc) - 13, sx1 = Math.round(xc) + 13;
  for (let i = flights; i >= 1; i--) {
    const top = dh - 2 * i;
    g.fill(sx0 - i, 0, zf - 2, sx1 + i, top, zf + 3 * i, kit.base);
    g.fill(sx0 - i, top - 1, zf - 2, sx1 + i, top, zf + 3 * i, kit.stone);
  }
  for (const x of [sx0 - flights - 4, sx1 + flights + 1]) {
    const z = zf + 3 * flights - 4;
    g.fill(x, 0, z, x + 3, 3, z + 3, kit.stone);
    g.fill(x - 1, 3, z - 1, x + 4, 4, z + 4, kit.base);
    g.fill(x, 4, z, x + 3, 6, z + 3, MAT.leaf);
    g.fill(x + 1, 6, z + 1, x + 2, 7, z + 2, MAT.leaf);
    for (const [dx, dz] of [[0, 0], [2, 1], [1, 2], [0, 2]] as const) g.set(x + dx, 6, z + dz, hash(x, dx, dz, salt) < 0.5 ? MAT.petal : MAT.blueFlower);
  }

  // ── Canopy posts, side rails and the beams the roof sits on.
  const px0 = dx0 + 3, px1 = dx1 - 6, zBack = dz0 + 2, zFront = zf - c - 8, eave = L.eave;
  const post = (x: number, z: number) => {
    g.fill(x - 1, dh, z - 1, x + 4, dh + 2, z + 4, kit.stone);
    g.fill(x, dh + 2, z, x + 3, eave, z + 3, kit.trim);
    g.fill(x - 1, eave - 6, z - 1, x + 4, eave - 5, z + 4, kit.wood);
  };
  for (const x of [px0, px1]) for (const z of [zBack, zFront]) post(x, z);
  // Beams: front and back across, plates along the sides, each three cells deep.
  g.fill(px0 - 2, eave - 3, zFront, px1 + 5, eave, zFront + 3, kit.trim);
  g.fill(px0 - 2, eave - 3, zBack, px1 + 5, eave, zBack + 3, kit.trim);
  for (const x of [px0, px1]) g.fill(x, eave - 3, zBack, x + 3, eave, zFront + 3, kit.trim);
  // Knee braces from each front post out to the beam, stepping two cells at a time.
  for (const [x, dir] of [[px0 + 3, 1], [px1 - 1, -1]] as const) for (let k = 0; k < 5; k++) {
    g.fill(x + dir * k * 1, eave - 4 - 5 + k, zFront, x + dir * k + 1, eave - 3 - 5 + k + 1, zFront + 3, kit.wood);
  }
  // Rails along both open sides: a cap rail on turned balusters.
  for (const x of [px0 + 1, px1 + 1]) {
    for (let z = zBack + 4; z < zFront; z += 3) g.fill(x, dh, z, x + 1, dh + 7, z + 1, kit.trim);
    g.fill(x - 1, dh + 7, zBack + 3, x + 2, dh + 8, zFront, kit.wood);
    g.fill(x, dh + 3, zBack + 3, x + 1, dh + 4, zFront, kit.trim);
  }

  // ── Backdrop: a planked wall between the back posts with the kingdom's hanging on it.
  g.fill(px0 + 3, dh, zBack, px1, eave - 3, zBack + 2, kit.trim);
  for (let x = px0 + 5; x < px1; x += 4) g.fill(x, dh, zBack + 1, x + 1, eave - 3, zBack + 2, kit.wood);
  const hx0 = px0 + 9, hx1 = px1 - 6, hTop = eave - 5, hBottom = dh + 7;
  g.fill(hx0 - 1, hTop, zBack + 2, hx1 + 1, hTop + 1, zBack + 3, kit.wood);
  g.fill(hx0, hBottom, zBack + 2, hx1, hTop, zBack + 3, field);
  g.fill(hx0, hBottom, zBack + 2, hx0 + 1, hTop, zBack + 3, border);
  g.fill(hx1 - 1, hBottom, zBack + 2, hx1, hTop, zBack + 3, border);
  for (let x = hx0; x < hx1; x++) {
    // A dagged hem: one cell longer in the middle of every four.
    g.set(x, hBottom, zBack + 2, border);
    if ((x - hx0) % 4 === 1 || (x - hx0) % 4 === 2) g.set(x, hBottom - 1, zBack + 2, border);
  }
  emblem(g, L.figure, Math.round(xc), Math.round((hTop + hBottom) / 2), zBack + 3, 6, charge, border, contrast([field, MAT.cream, MAT.darkStone], [charge, border]), 'z');

  // ── Curtains: gathered drapes inside each front post, tied back with a brass cord.
  const tie = dh + 12;
  for (const side of [-1, 1]) {
    const edge = side < 0 ? px0 + 3 : px1;
    for (let y = dh; y < eave - 3; y++) {
      const w = y >= tie ? 2 + Math.round(((y - tie) / (eave - 3 - tie)) * 6) : 2 + Math.round(((tie - y) / (tie - dh)) * 2);
      for (let k = 0; k < w; k++) {
        const x = side < 0 ? edge + k : edge - 1 - k;
        g.set(x, y, zFront + 1, field);
        if ((k + (y >> 3)) % 2) g.set(x, y, zFront + 2, field);
      }
    }
    for (let k = 0; k < 3; k++) g.set(side < 0 ? edge + k : edge - 1 - k, tie, zFront + 3, kit.metal);
  }

  // ── The roof.
  const rx0 = px0 - 6, rx1 = px1 + 9, rz0 = 1, rz1 = zFront + 3 + 7, half = (rx1 - rx0) / 2;
  const ins = (k: number) => (L.canopy === 'gable' ? k : k < 8 ? 2 * k : 16 + (k - 8));
  const roofMat = L.canopy === 'gable' ? kit.roof : field;
  let rows = 0;
  while (ins(rows) < half - 1) rows++;
  for (let k = 0; k <= rows; k++) {
    const y = eave + k, a = Math.min(ins(k), half - 1), next = Math.min(ins(k + 1), half), t = Math.max(3, next - a + 2);
    if (a + t >= half - 0.5) g.fill(rx0 + a, y, rz0, rx1 - a, y + 1, rz1, roofMat);
    else {
      g.fill(rx0 + a, y, rz0, rx0 + a + t, y + 1, rz1, roofMat);
      g.fill(rx1 - a - t, y, rz0, rx1 - a, y + 1, rz1, roofMat);
    }
  }
  const top = eave + rows;
  // A drip course under the eaves.
  g.fill(rx0, eave - 1, rz0, rx0 + 3, eave, rz1, roofMat);
  g.fill(rx1 - 3, eave - 1, rz0, rx1, eave, rz1, roofMat);
  if (L.canopy === 'gable') {
    // Hand-laid tiles: a few of the kit's second colour, and a ridge cap.
    for (let z = rz0; z < rz1; z++) for (let y = eave; y <= top; y++) for (let x = rx0; x < rx1; x++) {
      if (g.get(x, y, z) === kit.roof && !g.get(x, y + 1, z) && hash(x, y, z >> 1, salt) < 0.07) g.set(x, y, z, ROOF_ALT[kit.style]);
    }
    for (let y = top - 1; y <= top; y++) g.over(rx0, y, rz0, rx1, y + 1, rz1, ROOF_ALT[kit.style]);
    g.fill(Math.floor(xc) - 1, top + 1, rz0, Math.ceil(xc) + 1, top + 2, rz1, ROOF_ALT[kit.style]);
  } else {
    // Cloth stripes down the slope, and a dagged valance along both eaves.
    for (let z = rz0; z < rz1; z++) if (Math.floor((z - rz0) / 9) % 2) g.over(rx0, eave - 1, z, rx1, top + 1, z + 1, charge);
    for (const [x0, x1] of [[rx0, rx0 + 1], [rx1 - 1, rx1]] as const) for (let z = rz0; z < rz1; z++) {
      const m = Math.floor((z - rz0) / 9) % 2 ? charge : field, s = (z - rz0) % 9;
      g.fill(x0, eave - 3, z, x1, eave - 1, z + 1, border);
      if (s >= 1 && s <= 7) g.set(x0, eave - 4, z, m);
      if (s >= 3 && s <= 5) g.set(x0, eave - 5, z, m);
    }
  }
  // Bargeboards on the front gable edge, and the pediment set two cells back with a cornice under it.
  g.over(rx0, eave - 1, rz1 - 1, rx1, top + 2, rz1, L.canopy === 'gable' ? kit.trim : border);
  const tymp = L.canopy === 'gable' ? kit.wall : field;
  for (let k = 0; k < rows; k++) {
    const a = ins(k) + 1, x0 = Math.max(rx0 + a, px0 - 1), x1 = Math.min(rx1 - a, px1 + 4);
    if (x0 < x1) { g.fill(x0, eave + k, rz1 - 3, x1, eave + k + 1, rz1 - 2, tymp); g.fill(x0, eave + k, rz0 + 1, x1, eave + k + 1, rz0 + 2, tymp); }
  }
  g.fill(px0 - 3, eave, rz1 - 3, px1 + 6, eave + 2, rz1 - 1, kit.trim);
  g.fill(px0 - 3, eave - 3, zFront, px1 + 6, eave, zFront + 4, kit.trim);
  emblem(g, L.figure, Math.round(xc), eave + Math.round((top - eave) * 0.36), rz1 - 2, 7, charge, border, contrast([L.canopy === 'gable' ? field : kit.wall, MAT.cream, field, MAT.darkStone], [charge, border]), 'z');

  // A pole and pennant on the front apex, where the bunting starts.
  const apexX = Math.floor(xc), apexZ = rz1 - 2;
  g.fill(apexX, top, apexZ, apexX + 1, top + 12, apexZ + 1, kit.iron);
  g.set(apexX, top + 12, apexZ, kit.metal);
  for (let k = 0; k < 7; k++) {
    const h = Math.max(1, 4 - Math.floor(k / 2));
    g.fill(apexX + 1 + k, top + 11 - h, apexZ, apexX + 2 + k, top + 11, apexZ + 1, k < 2 ? border : field);
  }
  if (L.canopy === 'tent') {
    const bz = rz0 + 1;
    g.fill(apexX, top, bz, apexX + 1, top + 8, bz + 1, kit.iron);
    g.set(apexX, top + 8, bz, kit.metal);
  }

  // ── The valance under the front beam: border band, then dagged tongues in field and charge.
  for (let x = px0 - 2; x < px1 + 5; x++) {
    const s = (x - (px0 - 2)) % 6, m = Math.floor((x - (px0 - 2)) / 6) % 2 ? charge : field;
    g.set(x, eave - 4, zFront + 3, border);
    g.fill(x, eave - 7, zFront + 3, x + 1, eave - 4, zFront + 4, m);
    if (s >= 1 && s <= 4) g.set(x, eave - 8, zFront + 3, m);
    if (s === 2 || s === 3) g.set(x, eave - 9, zFront + 3, m);
  }

  // ── Lanterns: one on a bracket on the face of each front post, and lamp posts at the deck's front corners.
  for (const x of [px0 + 1, px1 + 1]) {
    const y = dh + 16;
    g.fill(x, y + 4, zFront + 3, x + 1, y + 5, zFront + 6, kit.iron);
    g.fill(x, y + 3, zFront + 5, x + 1, y + 4, zFront + 6, kit.iron);
    g.fill(x - 1, y + 2, zFront + 4, x + 2, y + 3, zFront + 7, kit.metal);
    g.fill(x - 1, y - 1, zFront + 4, x + 2, y + 2, zFront + 7, MAT.glass);
    for (const [dx, dz] of [[-1, 4], [1, 4], [-1, 6], [1, 6]] as const) g.set(x + dx, y, zFront + dz, kit.iron);
    g.fill(x - 1, y - 2, zFront + 4, x + 2, y - 1, zFront + 7, kit.metal);
    lanterns.push([x, y, zFront + 5]);
  }
  const postH = 22;
  const leftPost = lanternPost(g, kit, dx0 - 1, zf - 1, postH);
  const rightPost = lanternPost(g, kit, dx1 - 1, zf - 1, postH);
  lanterns.push(leftPost, rightPost);

  // ── Bunting: from the apex pole down to both lamp posts, and swags along the deck's front lip.
  const cloths = [field, charge, border];
  bunting(g, kit.cord, [apexX - 1, top + 3, apexZ], [dx0, postH + 1, zf - 1], 5, cloths);
  bunting(g, kit.cord, [apexX + 1, top + 3, apexZ], [dx1, postH + 1, zf - 1], 5, cloths);
  if (r.chance(0.6)) {
    const anchors = [dx0 + c, sx0 - flights - 2, sx1 + flights + 2, dx1 - c];
    for (const [a, b] of [[anchors[0]!, anchors[1]!], [anchors[2]!, anchors[3]!]] as const) {
      bunting(g, kit.cord, [a, dh - 2, zf], [b, dh - 2, zf], 2, [charge, field], 4);
    }
  }

  // ── On the boards: a drum, a lute on its stand and a stool, sides chosen by the seed.
  const drumLeft = r.chance(0.5);
  const drumX = drumLeft ? px0 + 10 : px1 - 10, drumZ = zBack + 10 + r.int(0, 4);
  drum(g, kit, drumX, dh, drumZ, border, charge);
  const luteX = drumLeft ? px1 - 12 : px0 + 12;
  lute(g, kit, luteX, dh, zBack + 14 + r.int(0, 3));
  const stoolX = luteX + (drumLeft ? -6 : 6), stoolZ = zBack + 12;
  for (const [dx, dz] of [[0, 0], [3, 0], [0, 3], [3, 3]] as const) g.fill(stoolX + dx, dh, stoolZ + dz, stoolX + dx + 1, dh + 3, stoolZ + dz + 1, kit.wood);
  g.fill(stoolX - 1, dh + 3, stoolZ - 1, stoolX + 5, dh + 4, stoolZ + 5, kit.trim);

  // ── Seats in shallow arcs on the green, an aisle down the middle.
  for (let i = 0; i < L.rows; i++) {
    const z = firstRow + i * 11;
    if (z + 6 > depth) break;
    for (const side of [-1, 1]) {
      const inner = Math.round(xc) + side * 7, len1 = 12 + r.int(0, 4) + i * 2, len2 = 10 + r.int(0, 4);
      const nudge = r.chance(0.2) ? r.pick([-1, 1]) : 0;
      seat(g, kit, L.seats, side < 0 ? inner - len1 : inner, z + nudge, len1, salt + i * 7 + side);
      const outer = side < 0 ? inner - len1 - 2 - len2 : inner + len1 + 2;
      seat(g, kit, L.seats, outer, z - 3, len2, salt + i * 13 + side * 3);
    }
  }

  // Tufts and flowers at the skirt's foot, where the mower never reaches.
  for (let z = dz0 - 2; z < zf + 2; z++) for (let x = dx0 - 2; x < dx1 + 2; x++) {
    if (g.get(x, 0, z) || !(g.get(x + 1, 1, z) || g.get(x - 1, 1, z) || g.get(x, 1, z + 1) || g.get(x, 1, z - 1))) continue;
    const h = hash(x, 5, z, salt);
    if (h < 0.4) g.set(x, 0, z, MAT.leaf);
    if (h < 0.08) g.set(x, 1, z, h < 0.04 ? MAT.petal : MAT.blueFlower);
    else if (h < 0.16) g.set(x, 1, z, MAT.leaf);
  }

  const id = `genesis-stage-${kit.style}-${L.canopy}-${variantTag(options.seed, options.colours)}`;
  return finish(g, id, kit.style, lanterns);
}

/** A tall drum standing on its end: a cloth body between wooden hoops, a cream head and brass tension pegs. */
function drum(g: Grid, kit: PieceKit, x: number, y: number, z: number, body: number, band: number): void {
  const ring = (y0: number, y1: number, m: number, r: number) => {
    g.fill(x - r + 1, y0, z - r, x + r, y1, z + r + 1, m);
    g.fill(x - r, y0, z - r + 1, x + r + 1, y1, z + r, m);
  };
  ring(y, y + 6, body, 3);
  ring(y + 2, y + 3, band, 3);
  ring(y, y + 1, kit.trim, 3);
  ring(y + 5, y + 6, kit.trim, 3);
  ring(y + 6, y + 7, MAT.cream, 2);
  for (const [dx, dz] of [[0, 3], [3, 0], [0, -3], [-3, 0]] as const) g.set(x + dx, y + 4, z + dz, kit.metal);
  // Two sticks laid across the head.
  g.fill(x - 2, y + 7, z - 1, x + 3, y + 8, z, kit.wood);
  g.fill(x - 1, y + 7, z + 1, x + 4, y + 8, z + 2, kit.wood);
}

/** A lute on a little A-frame stand, its belly to the audience: a round body, a dark rose and a long neck. */
function lute(g: Grid, kit: PieceKit, x: number, y: number, z: number): void {
  g.fill(x - 3, y, z - 2, x - 2, y + 4, z - 1, kit.wood);
  g.fill(x + 3, y, z - 2, x + 4, y + 4, z - 1, kit.wood);
  g.fill(x - 3, y + 3, z - 2, x + 4, y + 4, z - 1, kit.wood);
  // The body: a rounded pear from rows of different widths, one cell deep at the rim, two at the bowl.
  const rows = [[1, 2], [3, 3], [4, 3], [5, 3], [6, 3], [7, 2], [8, 1]] as const;
  for (const [dy, hw] of rows) {
    g.fill(x - hw, y + dy, z - 1, x + hw + 1, y + dy + 1, z, MAT.timber);
    g.fill(x - hw + 1, y + dy, z - 2, x + hw, y + dy + 1, z - 1, kit.wood);
  }
  g.set(x, y + 5, z - 1, MAT.darkStone);
  g.fill(x - 1, y + 2, z - 1, x + 2, y + 3, z, kit.wood);
  // The neck, then the pegbox bent back.
  g.fill(x, y + 9, z - 1, x + 1, y + 16, z, kit.wood);
  g.fill(x, y + 15, z - 2, x + 1, y + 18, z - 1, kit.wood);
  g.set(x - 1, y + 17, z - 2, MAT.cream); g.set(x + 1, y + 16, z - 2, MAT.cream);
}

/** One seat on the green: a plank bench on two or three legs, or a split log with a flat top and pale cut ends. */
function seat(g: Grid, kit: PieceKit, form: 'bench' | 'log', x: number, z: number, len: number, salt: number): void {
  if (form === 'bench') {
    g.fill(x, 4, z, x + len, 5, z + 3, kit.trim);
    g.fill(x, 4, z + 1, x + len, 5, z + 2, kit.wood);
    g.fill(x - 1, 4, z, x, 5, z + 3, kit.trim);
    const legs = len > 14 ? [x + 1, x + Math.floor(len / 2), x + len - 2] : [x + 1, x + len - 2];
    for (const lx of legs) { g.fill(lx, 0, z, lx + 1, 4, z + 1, kit.wood); g.fill(lx, 0, z + 2, lx + 1, 4, z + 3, kit.wood); g.fill(lx, 1, z, lx + 1, 2, z + 3, kit.wood); }
    return;
  }
  // Logs: short rounded lengths with gaps between, pale hewn tops and cut ends with a dark heart, and here and there
  // a stump stool standing between two of them.
  const wood = kit.trim === MAT.bark ? MAT.timber : kit.trim;
  let at = x;
  for (let k = 0; at < x + len; k++) {
    const piece = Math.min(x + len - at, 7 + Math.floor(hash(at, 8, z, salt) * 4));
    if (piece < 4) break;
    if (k % 2 === 1 && hash(at, 9, z, salt) < 0.5) {
      // A stump: a round of timber, bark on its sides, a pale top.
      const cx = at + 2;
      g.fill(cx - 1, 0, z + 1, cx + 2, 5, z + 4, MAT.bark);
      g.fill(cx - 2, 0, z + 2, cx + 3, 5, z + 3, MAT.bark);
      g.fill(cx - 1, 5, z + 2, cx + 2, 6, z + 3, wood); g.fill(cx, 5, z + 1, cx + 1, 6, z + 4, wood);
      at += 6;
      continue;
    }
    g.fill(at, 0, z + 1, at + piece, 1, z + 4, MAT.bark);
    g.fill(at, 1, z, at + piece, 3, z + 5, MAT.bark);
    g.fill(at, 3, z + 1, at + piece, 4, z + 4, MAT.bark);
    g.fill(at, 4, z + 1, at + piece, 5, z + 4, wood);
    for (const ex of [at, at + piece - 1]) {
      g.fill(ex, 1, z + 1, ex + 1, 4, z + 4, wood);
      g.set(ex, 2, z + 2, kit.wood === MAT.bark ? MAT.darkStone : kit.wood);
    }
    for (let q = 1; q < piece - 1; q++) if (hash(at + q, 6, z, salt) < 0.2) g.set(at + q, 2, z + (hash(at + q, 7, z, salt) < 0.5 ? 0 : 4), MAT.moss);
    at += piece + 2;
  }
}
