import { StyleIdSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../../materials';
import { CREST_HEIGHT, CREST_WIDTH, crestGrid, type CrestCharge, type CrestShape } from '../heraldry';
import { Boxes, LANDMARK_KITS, hash, type LandmarkKit } from '../kit';
import { extentOf } from '../parts';
import type { CellBox, LandmarkPiece, LandmarkSeat } from '../types';

/**
 * The reserved cathedral site of a city kingdom: land held for the cathedral its chat will one day raise together,
 * and nothing more. There are no walls, no scaffold, no workers, no stacked materials and no lit windows; only the
 * setting-out a surveyor leaves on the grass before the first course is laid.
 *
 * The plan is a Latin cross with a round apse. Its outline is traced by timber pegs with pale heads every two metres
 * or so, joined by one taut cord half a metre off the ground; the apse is set out as chords between pegs on its arc.
 * Ranging poles stand at the cross's outer corners, the apse springings and the apse's east point, each flying a small
 * pennant in the kingdom's colours, all blown the same way by one wind. A flat octagonal stone with a brass pin marks
 * where the crossing tower will stand. Four pale boundary stones with iron bands hold the corners of the reserve.
 *
 * On the great west door's line, between the two door-jamb pegs where the cord stops, stands the foundation stone: a
 * dressed block on a two-step plinth, the kingdom's crest framed on its face towards the plaza, and one caged lantern
 * on a timber post beside it. The lower step is a seat. The lantern's glass is physical; content never lights it.
 *
 * Frame, in build cells: the reserve is the whole footprint; y = 0 is host ground; +Z is the front, the plaza side,
 * where the future building's west front and door will be (liturgical west); its apse is at −Z (liturgical east).
 * Ids that name a direction (`corner-nw` and so on) use the piece's local facing convention, +Z south and +X east.
 */
export interface CathedralSiteOptions {
  readonly style: StyleKey;
  readonly crest: { readonly shape: CrestShape; readonly charge: CrestCharge };
  /** Snapped cloth: the field of the crest and of the ranging-pole pennants, and their band. */
  readonly colours: { readonly field: number; readonly band: number };
}

export const CATHEDRAL_SITE_SIZE: Vec3 = [192, 48, 256];
/** The reserve's middle, in cells. */
export const CATHEDRAL_SITE_AXIS = { x: 96, z: 128 } as const;

/** The measured planes of the site, shared by the factory, its metadata and its tests. */
export const CATHEDRAL_SITE = {
  reserve: { x: [0, 192] as const, y: [0, 48] as const, z: [0, 256] as const },
  /** The plan's outline. The nave runs from the apse springing to the west front; the crossing is where they meet. */
  nave: { x: [56, 136] as const, z: [44, 240] as const },
  transepts: { x: [16, 176] as const, z: [88, 152] as const },
  apse: { x: 96, z: 44, radius: 40, chords: 8 },
  /** The great west door: the front line's gap between its two jamb pegs, where the cord stops. */
  door: { x: [72, 120] as const },
  /**
   * A peg stands on an outline point (x, z) and fills cells x − 1 .. x + 1 and z − 1 .. z + 1: timber to `height` (one
   * cell more where the hand drove it shallower), then a pale head cell.
   */
  peg: { height: 5, spacing: 16 },
  /** The cord's one height. It runs in the peg's outer cell row, on the outline's outside. */
  cord: 4,
  /** Ranging poles: timber to `top`, two pale rings, a bright tip; the pennant hangs from `pennant.top` down. */
  pole: { top: 30, tip: 2, rings: [6, 14] as const, pennant: { top: 29, rows: [4, 7, 10, 13, 10, 7, 4] as const } },
  crossing: { x: 96, z: 120, half: 10, chamfer: 4, inner: 8 },
  /** Boundary stones: the shaft's near corner `inset` cells in from each reserve corner. */
  corners: { size: 8, inset: 3, top: 12, embed: 3 },
  foundation: {
    /** The plinth, lower then upper: [x0, x1, top, z0, z1]; each sits on host ground. */
    steps: [[78, 114, 4, 232, 251], [81, 111, 7, 234, 247]] as const,
    stone: { x: [84, 108] as const, y: [7, 27] as const, z: [236, 244] as const },
    /** Two dressed courses over the block, the lower one cell proud all round. */
    cap: 29,
  },
  /** The lower step's top, in front of the upper step. */
  seat: { x: [78, 114] as const, y: [3, 4] as const, z: [247, 251] as const },
  /** The crest's lower-left cell; the field lies in cell row `face`, the stone's front, border and charge one proud. */
  crest: { x: 89, y: 9, face: 243 },
  lantern: { post: { x: [121, 123] as const, z: [247, 249] as const, top: 24 }, glass: { x: 117, y: 13, z: 248 }, size: 5 },
  /** Nothing of the site stands higher than the ranging poles' tips. */
  top: 32,
} as const;

/** One setting-out peg on an outline point; a pole is a ranging pole in its place. */
export interface SitePeg { readonly x: number; readonly z: number; readonly pole: boolean }

/** Every peg and pole of the plan, and every run of cord between them, in drawing order. */
export const CATHEDRAL_SETTING_OUT: { readonly pegs: readonly SitePeg[]; readonly cords: readonly CellBox[] } = settingOut();

export function createCathedralSite(options: CathedralSiteOptions): LandmarkPiece {
  const { style, crest, colours } = options;
  if (!(style in LANDMARK_KITS)) throw new Error(`Unknown landmark style ${String(style)}.`);
  const kit = LANDMARK_KITS[style];
  const b = new Boxes();

  plan(b, kit, colours);
  crossing(b, kit);
  cornerStones(b, kit);
  foundation(b, kit, crest, colours.field);
  lantern(b, kit);

  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-cathedral-site-${style}-${crest.shape}-${crest.charge}-${colours.field}-${colours.band}`,
    styleId: StyleIdSchema.parse(STYLES[style].id), kind: 'civic', lattice: 'build',
    size: [...CATHEDRAL_SITE_SIZE], boxes: b.list, windows: [],
  };
  return { blueprint, parts: [], ...metadata(blueprint) };
}

// ── The plan ─────────────────────────────────────────────────────────────────────────────────────────────────────

type Point = readonly [number, number];

/**
 * The outline is symmetric about the axis, so only its +X half is set out here, from the door's jamb round to the
 * apse's east point, and then mirrored. A peg at x mirrors to 192 − x; a cord cell at x to 191 − x.
 */
function settingOut(): { pegs: SitePeg[]; cords: CellBox[] } {
  const { nave, transepts, apse, door, peg, cord: y } = CATHEDRAL_SITE;
  const width = CATHEDRAL_SITE.reserve.x[1];
  const poles = new Set<string>([
    [nave.x[1], nave.z[1]], [transepts.x[1], transepts.z[1]], [transepts.x[1], transepts.z[0]], [nave.x[1], apse.z],
    [apse.x, apse.z - apse.radius],
  ].flatMap(([x, z]) => [`${x},${z}`, `${width - x!},${z}`]));
  const runs: readonly (readonly [Point, Point])[] = [
    [[door.x[1], nave.z[1]], [nave.x[1], nave.z[1]]],
    [[nave.x[1], nave.z[1]], [nave.x[1], transepts.z[1]]],
    [[nave.x[1], transepts.z[1]], [transepts.x[1], transepts.z[1]]],
    [[transepts.x[1], transepts.z[1]], [transepts.x[1], transepts.z[0]]],
    [[transepts.x[1], transepts.z[0]], [nave.x[1], transepts.z[0]]],
    [[nave.x[1], transepts.z[0]], [nave.x[1], apse.z]],
  ];
  const half: Point[] = [], cords: { x: [number, number]; z: [number, number] }[] = [];
  for (const [a, c] of runs) {
    const dx = Math.sign(c[0] - a[0]), dz = Math.sign(c[1] - a[1]);
    const length = Math.abs(c[0] - a[0]) + Math.abs(c[1] - a[1]), n = Math.max(1, Math.round(length / peg.spacing));
    const at = Array.from({ length: n + 1 }, (_, i): Point => [a[0] + dx * Math.round((i * length) / n), a[1] + dz * Math.round((i * length) / n)]);
    half.push(...at);
    // The outline's outside lies to the run's left: outward is (−dz, dx). The cord keeps to the peg's outer cell.
    for (let i = 0; i < n; i++) {
      const p = at[i]!, q = at[i + 1]!;
      if (dx) {
        const z = dx > 0 ? p[1] : p[1] - 1;
        cords.push({ x: [Math.min(p[0], q[0]) + 1, Math.max(p[0], q[0]) - 1], z: [z, z + 1] });
      } else {
        const x = -dz > 0 ? p[0] : p[0] - 1;
        cords.push({ x: [x, x + 1], z: [Math.min(p[1], q[1]) + 1, Math.max(p[1], q[1]) - 1] });
      }
    }
  }
  // The apse: pegs on its arc from the springing round to the east point, joined by straight chords drawn as
  // face-connected staircases of cord in the pegs' outer cells.
  const arc: Point[] = [];
  for (let k = 0; k <= apse.chords / 2; k++) {
    const t = (k * Math.PI) / apse.chords;
    arc.push([Math.round(apse.x + apse.radius * Math.cos(t)), Math.round(apse.z - apse.radius * Math.sin(t))]);
  }
  half.push(...arc);
  for (let k = 0; k + 1 < arc.length; k++) {
    const [p, q] = [arc[k]!, arc[k + 1]!];
    for (const run of runsOf(staircase(p[0], p[1] - 1, q[0], q[1] - 1))) cords.push(run);
  }
  const pegs = new Map<string, SitePeg>();
  for (const [x, z] of [...half, ...half.map(([x, z]): Point => [width - x, z])]) {
    const key = `${x},${z}`;
    if (!pegs.has(key)) pegs.set(key, { x, z, pole: poles.has(key) });
  }
  const mirrored = cords.map(c => ({ x: [width - c.x[1], width - c.x[0]] as [number, number], z: c.z }));
  return {
    pegs: [...pegs.values()],
    cords: [...cords, ...mirrored].filter(c => c.x[0] < c.x[1] && c.z[0] < c.z[1]).map(c => ({ from: [c.x[0], y, c.z[0]], to: [c.x[1], y + 1, c.z[1]] })),
  };
}

/** A 4-connected line of cells from (x0, z0) to (x1, z1), so each cell meets the next face to face. */
function staircase(x0: number, z0: number, x1: number, z1: number): Point[] {
  const nx = Math.abs(x1 - x0), nz = Math.abs(z1 - z0), sx = Math.sign(x1 - x0), sz = Math.sign(z1 - z0);
  const cells: Point[] = [[x0, z0]];
  let x = x0, z = z0;
  for (let ix = 0, iz = 0; ix < nx || iz < nz;) {
    if ((0.5 + ix) / nx < (0.5 + iz) / nz) { x += sx; ix++; } else { z += sz; iz++; }
    cells.push([x, z]);
  }
  return cells;
}

/** Splits a staircase into its straight runs along X or Z; each run meets the next face to face. */
function runsOf(cells: readonly Point[]): { x: [number, number]; z: [number, number] }[] {
  const runs: { x: [number, number]; z: [number, number] }[] = [];
  let first = cells[0]!, last = first, axis: 'x' | 'z' | null = null;
  const close = () => runs.push({ x: [Math.min(first[0], last[0]), Math.max(first[0], last[0]) + 1], z: [Math.min(first[1], last[1]), Math.max(first[1], last[1]) + 1] });
  for (const cell of cells.slice(1)) {
    const step = cell[0] !== last[0] ? 'x' : 'z';
    if (axis === null || axis === step) { axis = step; last = cell; continue; }
    close();
    first = last = cell; axis = null;
  }
  close();
  return runs;
}

function plan(b: Boxes, kit: LandmarkKit, colours: CathedralSiteOptions['colours']): void {
  const { peg } = CATHEDRAL_SITE;
  for (const c of CATHEDRAL_SETTING_OUT.cords) b.add(c.from[0], c.from[1], c.from[2], c.to[0], c.to[1], c.to[2], kit.cord);
  for (const { x, z, pole: tall } of CATHEDRAL_SETTING_OUT.pegs) {
    if (tall) { rangingPole(b, kit, x, z, colours); continue; }
    // Some pegs were driven a little shallower by the hand that set them.
    const h = peg.height + (hash(x, 0, z, 41) < 0.35 ? 1 : 0);
    b.add(x - 1, 0, z - 1, x + 1, h, z + 1, kit.trim);
    b.add(x - 1, h, z - 1, x + 1, h + 1, z + 1, kit.band);
  }
}

/**
 * A ranging pole driven into a little patch of turned earth: timber with two pale rings and a bright tip, flying a
 * pennant towards +X, the one way the wind blows across the whole site. The pennant's middle row is the band.
 */
function rangingPole(b: Boxes, kit: LandmarkKit, x: number, z: number, colours: CathedralSiteOptions['colours']): void {
  const { top, tip, rings, pennant } = CATHEDRAL_SITE.pole;
  b.add(x - 2, 0, z - 2, x + 2, 1, z + 2, MAT.earth);
  b.add(x - 1, 0, z - 1, x + 1, top, z + 1, kit.trim);
  for (const y of rings) b.add(x - 1, y, z - 1, x + 1, y + 2, z + 1, kit.band);
  b.add(x - 1, top, z - 1, x + 1, top + tip, z + 1, kit.metal);
  const middle = (pennant.rows.length - 1) / 2;
  pennant.rows.forEach((length, i) => {
    const y = pennant.top - 1 - i;
    b.add(x + 1, y, z - 1, x + 1 + length, y + 1, z, i === middle ? colours.band : colours.field);
  });
}

// ── The crossing ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A flat octagonal stone where the crossing tower will stand: a dark border, a pale face, an inlaid cross, a pin. */
function crossing(b: Boxes, kit: LandmarkKit): void {
  const { x, z, half, chamfer, inner } = CATHEDRAL_SITE.crossing;
  b.octagon(x, z, half, chamfer, 0, 1, kit.base);
  b.octagon(x, z, inner, chamfer - 1, 0, 2, kit.band);
  b.add(x - 1, 1, z - inner + 1, x + 1, 2, z + inner - 1, kit.base);
  b.add(x - inner + 1, 1, z - 1, x + inner - 1, 2, z + 1, kit.base);
  b.add(x - 1, 1, z - 1, x + 1, 2, z + 1, kit.metal);
}

// ── The boundary stones ──────────────────────────────────────────────────────────────────────────────────────────

/** The near (lowest x and z) cell of each boundary stone's shaft, named in local facing (+Z south, +X east). */
export function cathedralCornerStones(): { readonly id: string; readonly x: number; readonly z: number }[] {
  const { size, inset } = CATHEDRAL_SITE.corners, [, X] = CATHEDRAL_SITE.reserve.x, [, Z] = CATHEDRAL_SITE.reserve.z;
  return [
    { id: 'corner-nw', x: inset, z: inset },
    { id: 'corner-ne', x: X - inset - size, z: inset },
    { id: 'corner-sw', x: inset, z: Z - inset - size },
    { id: 'corner-se', x: X - inset - size, z: Z - inset - size },
  ];
}

/**
 * A dressed pale post on a wider dark foot that reads as half sunk, an iron band, a proud weathering course, a
 * chamfered cap and a brass pin flush in its top. Moss has crept along one side of the foot.
 */
function cornerStones(b: Boxes, kit: LandmarkKit): void {
  const { size: s, top } = CATHEDRAL_SITE.corners;
  for (const { x, z } of cathedralCornerStones()) {
    const cx = x + s / 2, cz = z + s / 2;
    b.add(x - 1, 0, z - 1, x + s + 1, 2, z + s + 1, kit.base);
    b.add(x, 2, z, x + s, top - 3, z + s, kit.band);
    b.add(x - 1, 5, z - 1, x + s + 1, 6, z + s + 1, kit.iron);
    b.octagon(cx, cz, s / 2 + 1, 2, top - 3, top - 2, kit.band);
    b.octagon(cx, cz, s / 2, 2, top - 2, top - 1, kit.band);
    b.add(cx - 2, top - 1, cz - 2, cx + 2, top, cz + 2, kit.band);
    b.add(cx - 1, top - 1, cz - 1, cx + 1, top, cz + 1, kit.metal);
    // Moss along one side: a run on the ground against the foot, and a shorter one on the foot's ledge.
    const side = Math.floor(hash(x, 0, z, 17) * 4), at = Math.floor(hash(x, 1, z, 17) * 4);
    const u0 = (side < 2 ? x : z) + at;
    const [outer, ledge] = side === 0 ? [z - 2, z - 1] : side === 1 ? [z + s + 1, z + s] : side === 2 ? [x - 2, x - 1] : [x + s + 1, x + s];
    const along = (u: number, U: number, depth: number, y: number): void => {
      if (side < 2) b.add(u, y, depth, U, y + 1, depth + 1, MAT.moss);
      else b.add(depth, y, u, depth + 1, y + 1, U, MAT.moss);
    };
    along(u0 - 1, u0 + 4, outer, 0);
    along(u0, u0 + 2, outer, 1);
    along(u0 + 1, u0 + 4, ledge, 2);
  }
}

// ── The foundation stone ─────────────────────────────────────────────────────────────────────────────────────────

function foundation(b: Boxes, kit: LandmarkKit, crest: CathedralSiteOptions['crest'], field: number): void {
  const { steps, stone, cap } = CATHEDRAL_SITE.foundation;
  for (const [x0, x1, top, z0, z1] of steps) {
    b.add(x0, 0, z0, x1, top, z1, kit.base);
    b.add(x0, top - 1, z1 - 1, x1, top, z1, kit.band);
  }
  b.add(stone.x[0], stone.y[0], stone.z[0], stone.x[1], stone.y[1], stone.z[1], kit.stone);
  b.add(stone.x[0] - 1, stone.y[1], stone.z[0] - 1, stone.x[1] + 1, cap - 1, stone.z[1] + 1, kit.band);
  b.add(stone.x[0], cap - 1, stone.z[0], stone.x[1], cap, stone.z[1], kit.band);
  crestPanel(b, kit, crest, field);
}

/** The crest on the stone's face, as on the river hall: field flush in the face, border and charge one cell proud. */
function crestPanel(b: Boxes, kit: LandmarkKit, crest: CathedralSiteOptions['crest'], field: number): void {
  const { x, y, face } = CATHEDRAL_SITE.crest;
  b.add(x - 2, y - 2, face + 1, x + CREST_WIDTH + 2, y + CREST_HEIGHT + 2, face + 2, kit.band);
  b.add(x - 1, y - 1, face + 1, x + CREST_WIDTH + 1, y + CREST_HEIGHT + 1, face + 2, MAT.air);
  b.add(x - 3, y - 3, face + 1, x + CREST_WIDTH + 3, y - 2, face + 3, kit.band);
  const material: Record<string, number> = { B: kit.metal, C: kit.charge };
  crestGrid(crest.shape, crest.charge).forEach((row, i) => {
    const yy = y + CREST_HEIGHT - 1 - i;
    for (let c = 0; c < row.length; c++) {
      const mark = row[c]!;
      if (mark === '.') continue;
      b.add(x + c, yy, face, x + c + 1, yy + 1, face + 1, field);
      if (mark !== 'F') b.add(x + c, yy, face + 1, x + c + 1, yy + 1, face + 2, material[mark]!);
    }
  });
}

// ── The lantern ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One caged lantern beside the foundation stone, as on the river hall: 3 × 5 × 3 glass, iron corner bars, bright
 * caps, an iron hanger and a bracket arm back to a timber post on a small stone pad.
 */
function lantern(b: Boxes, kit: LandmarkKit): void {
  const { post, glass: { x: gx, y: gy, z: gz }, size: g } = CATHEDRAL_SITE.lantern;
  b.add(post.x[0] - 1, 0, post.z[0] - 1, post.x[1] + 1, 1, post.z[1] + 1, kit.base);
  b.add(post.x[0], 0, post.z[0], post.x[1], post.top, post.z[1], kit.trim);
  b.add(post.x[0], post.top, post.z[0], post.x[1], post.top + 1, post.z[1], kit.metal);
  b.add(gx - 1, gy, gz - 1, gx + 2, gy + g, gz + 2, MAT.glass);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) b.add(gx + dx, gy, gz + dz, gx + dx + 1, gy + g, gz + dz + 1, kit.iron);
  b.add(gx - 2, gy - 1, gz - 2, gx + 3, gy, gz + 3, kit.metal);
  b.add(gx - 2, gy + g, gz - 2, gx + 3, gy + g + 1, gz + 3, kit.metal);
  b.add(gx - 1, gy + g + 1, gz - 1, gx + 2, gy + g + 2, gz + 2, kit.metal);
  b.add(gx, gy + g + 2, gz, gx + 1, gy + g + 4, gz + 1, kit.iron);
  const arm = gy + g + 4;
  b.add(Math.min(gx, post.x[0]), arm, gz, Math.max(gx + 1, post.x[0]), arm + 1, gz + 1, kit.iron);
}

// ── Metadata ─────────────────────────────────────────────────────────────────────────────────────────────────────

function metadata(blueprint: VoxelBlueprint): Omit<LandmarkPiece, 'blueprint' | 'parts'> {
  const { reserve, corners, foundation: f, seat, lantern: l } = CATHEDRAL_SITE;
  const [lower, upper] = f.steps;
  // The lower step is a seat only where its top lies at seat height and is deep enough in front of the upper step.
  const seats: LandmarkSeat[] = upper[4] + 3 <= lower[4] && lower[2] >= 3 && lower[2] <= 4
    ? [{ id: 'foundation-step', box: { from: [seat.x[0], seat.y[0], seat.z[0]], to: [seat.x[1], seat.y[1], seat.z[1]] }, facing: 'south' }]
    : [];
  return {
    extent: extentOf(blueprint),
    footings: [
      ...cathedralCornerStones().map(({ id, x, z }) => ({ id, box: { from: [x - 1, 0, z - 1], to: [x + corners.size + 1, 2, z + corners.size + 1] } as CellBox, embed: corners.embed })),
      { id: 'foundation-stone', box: { from: [lower[0], 0, lower[3]], to: [lower[1], lower[2], lower[4]] }, embed: 0 },
      { id: 'setting-out', box: { from: [reserve.x[0], 0, reserve.z[0]], to: [reserve.x[1], 1, reserve.z[1]] }, embed: 0 },
    ],
    doorways: [],
    walks: [],
    seats,
    emitters: [{ id: 'site-lantern', kind: 'lantern', position: [l.glass.x + 0.5, l.glass.y + l.size / 2, l.glass.z + 0.5], reach: 40 }],
    sounds: [{ id: 'wind', kind: 'wind', position: [CATHEDRAL_SITE_AXIS.x, 24, CATHEDRAL_SITE_AXIS.z] }],
    mounts: [],
    clear: [{ id: 'reserve', role: 'reserve', box: { from: [reserve.x[0], reserve.y[0], reserve.z[0]], to: [reserve.x[1], reserve.y[1], reserve.z[1]] } }],
    affordances: [
      {
        id: 'raise-cathedral', kind: 'raise-cathedral', uses: ['reserve'], status: 'needs-host',
        requires: 'A host community build that raises the cathedral from real contributions; the site holds only its setting-out until then.',
      },
      ...seats.map(s => ({ id: 'sit', kind: 'sit' as const, uses: [s.id], status: 'needs-host' as const, requires: 'Host seat registration from the placed step edge.' })),
    ],
  };
}
