import { describe, expect, it } from 'vitest';
import { HOME_DEPTH_METRES, HomeTierSchema, VoxelBlueprintSchema, type HomeTier, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../materials';
import { BLUEPRINTS, HOME_REVIEW, createTideHome } from './index';
import { FACADE, FLOOR, LOT } from './grammar';

/** Occupancy after executing the ordered boxes, exactly as the rasterizer does. */
function occupancy(b: VoxelBlueprint) {
  const [sx, sy, sz] = b.size, cells = new Uint16Array(sx * sy * sz);
  for (const { from, to, material } of b.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) cells.fill(material, from[0] + sx * (y + sy * z), to[0] + sx * (y + sy * z));
  }
  const inside = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  const get = (x: number, y: number, z: number) => inside(x, y, z) ? cells[x + sx * (y + sy * z)]! : MAT.air;
  return { sx, sy, sz, cells, get, solid: (x: number, y: number, z: number) => get(x, y, z) !== MAT.air };
}
type Grid = ReturnType<typeof occupancy>;

const FAMILIES = ['gullstep', 'saltbend', 'keelcroft'] as const;
const READY = [...new Set(BLUEPRINTS.map(b => b.id.split('-').at(-1) as HomeTier))];
const tierOf = (b: VoxelBlueprint) => b.id.split('-').at(-1) as HomeTier;
const familyOf = (b: VoxelBlueprint) => b.id.split('-')[2] as typeof FAMILIES[number];
const grids = new Map(BLUEPRINTS.map(b => [b.id, occupancy(b)]));
const grid = (b: VoxelBlueprint) => grids.get(b.id)!;

/** A person 2 m tall and three cells across, stepping at most two cells (0.25 m) up or down at a time. */
const HEAD = 16;
function standable(g: Grid, x: number, h: number, z: number): boolean {
  if (h < 0 || h + HEAD > g.sy) return false;
  if (h > 0 && !g.solid(x, h - 1, z)) return false;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const nx = x + dx, nz = z + dz;
    if (nx < 0 || nz < 0 || nx >= g.sx || nz >= g.sz) continue;
    // The body's rounded foot may overhang a step edge of up to two cells beside it.
    for (let y = dx || dz ? h + 2 : h; y < h + HEAD; y++) if (g.solid(nx, y, nz)) return false;
  }
  return true;
}

/** Breadth-first walk from the street edge in front of the lot. Returns the reachable standing height per column. */
function walk(g: Grid, start: readonly [number, number]): Int16Array {
  const reached = new Int16Array(g.sx * g.sz).fill(-1), queue: number[] = [];
  const [x0, z0] = start, h0 = [0, 1, 2].find(h => standable(g, x0, h, z0));
  if (h0 === undefined) throw new Error('The street edge in front of the door is blocked.');
  reached[x0 + g.sx * z0] = h0; queue.push(x0, h0, z0);
  for (let head = 0; head < queue.length; head += 3) {
    const x = queue[head]!, h = queue[head + 1]!, z = queue[head + 2]!;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= g.sx || nz >= g.sz || reached[nx + g.sx * nz]! >= 0) continue;
      for (const nh of [h, h + 1, h - 1, h + 2, h - 2]) {
        if (!standable(g, nx, nh, nz)) continue;
        reached[nx + g.sx * nz] = nh; queue.push(nx, nh, nz);
        break;
      }
    }
  }
  return reached;
}

/** A column is indoors when a solid roof or ceiling closes it above head height. */
function covered(g: Grid, x: number, h: number, z: number): boolean {
  for (let y = h + HEAD; y < g.sy; y++) if (g.solid(x, y, z)) return true;
  return false;
}

/** Face-connected pieces of one material (or, for -1, of the kit's structural materials), as cell coordinates. */
function components(g: Grid, material: number): [number, number, number][][] {
  const seen = new Uint8Array(g.cells.length), parts: [number, number, number][][] = [];
  const member = (m: number) => material < 0 ? STRUCTURE.has(m) : m === material;
  for (let start = 0; start < g.cells.length; start++) {
    if (seen[start] || !member(g.cells[start]!)) continue;
    const part: [number, number, number][] = [], stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!, x = i % g.sx, y = Math.floor(i / g.sx) % g.sy, z = Math.floor(i / (g.sx * g.sy));
      part.push([x, y, z]);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= g.sx || ny >= g.sy || nz >= g.sz) continue;
        const n = nx + g.sx * (ny + g.sy * nz);
        if (!seen[n] && member(g.cells[n]!)) { seen[n] = 1; stack.push(n); }
      }
    }
    parts.push(part);
  }
  return parts;
}

const STRUCTURE: ReadonlySet<number> = new Set([STYLES.tide.wall, STYLES.tide.roof, STYLES.tide.trim, STYLES.tide.stone]);

describe('Salt & slate homes', () => {
  it('lists only finished homes in family-major, shared-tier order', () => {
    expect(BLUEPRINTS.length).toBeGreaterThanOrEqual(6);
    const expected = FAMILIES.flatMap(f => HomeTierSchema.options.filter(t => READY.includes(t)).map(t => `home-tide-${f}-${t}`));
    expect(BLUEPRINTS.map(b => b.id)).toEqual(expected);
    expect(READY.slice(0, 2)).toEqual(['hut', 'cottage']);
  });

  it('builds deterministically and refuses invalid or unfinished inputs explicitly', () => {
    for (const b of BLUEPRINTS) {
      const variant = FAMILIES.indexOf(familyOf(b)) as 0 | 1 | 2;
      expect(JSON.stringify(createTideHome(tierOf(b), variant))).toBe(JSON.stringify(b));
    }
    expect(() => createTideHome('castle' as HomeTier, 0)).toThrow(/Unknown home tier/);
    expect(() => createTideHome('hut', 3 as 0)).toThrow(/variant/);
    expect(() => createTideHome('hut', 1.5 as 0)).toThrow(/variant/);
    for (const tier of HomeTierSchema.options.filter(t => !READY.includes(t))) for (const v of [0, 1, 2] as const) expect(() => createTideHome(tier, v)).toThrow(/has not been built/);
  });

  it('fits the registry, the kit palette and the reserved lot with locked rear land empty', () => {
    const kit = STYLES.tide;
    const allowed = new Set<number>([MAT.air, kit.wall, kit.roof, kit.trim, kit.stone, MAT.glass, MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.petal, MAT.blueFlower]);
    for (const b of BLUEPRINTS) {
      VoxelBlueprintSchema.parse(b);
      expect(b).toMatchObject({ version: 1, kind: 'home', lattice: 'build', styleId: kit.id, size: [64, 160, 128] });
      expect(b.boxes.length).toBeLessThanOrEqual(2000);
      for (const box of b.boxes) expect(allowed.has(box.material), `${b.id} material ${box.material}`).toBe(true);
      const rear = LOT[2] - HOME_DEPTH_METRES[tierOf(b)] * 8;
      const g = grid(b);
      let footprint = 0;
      for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) {
        let any = false;
        for (let y = 0; y < g.sy && !any; y++) any = g.solid(x, y, z);
        if (any) { expect(z, `${b.id} occupies locked rear land at z=${z}`).toBeGreaterThanOrEqual(rear); footprint++; }
      }
      // A home on its plot, not a slab across the whole reserve: open ground remains around it.
      expect(footprint / (64 * (128 - rear))).toBeLessThan(0.9);
      let groundCells = 0;
      for (let z = rear; z < 128; z++) for (let x = 0; x < 64; x++) if (g.solid(x, 0, z)) groundCells++;
      expect(groundCells / (64 * (128 - rear))).toBeLessThan(0.75);
    }
  });

  it('walks from the street through the open doorway into a covered ground-floor room, never stepping more than two cells', () => {
    for (const b of BLUEPRINTS) {
      const g = grid(b), entrance = HOME_REVIEW[b.id]!.entrance;
      const reached = walk(g, [entrance[0], 127]);
      // The doorway column is walked at floor level and the focus sits in its open air, about halfway up.
      expect(reached[entrance[0] + g.sx * entrance[2]], `${b.id} doorway not reached`).toBe(FLOOR);
      expect(g.solid(...entrance)).toBe(false);
      expect(entrance[1] - FLOOR).toBeGreaterThanOrEqual(8);
      expect(entrance[1] - FLOOR).toBeLessThanOrEqual(13);
      // The opening is at least ten cells wide and twenty high, between solid jambs.
      let left = entrance[0], right = entrance[0];
      while (!g.solid(left - 1, entrance[1], entrance[2])) left--;
      while (!g.solid(right + 1, entrance[1], entrance[2])) right++;
      expect(right - left + 1, `${b.id} doorway width`).toBeGreaterThanOrEqual(10);
      expect(right - left + 1).toBeLessThanOrEqual(14);
      for (let x = left; x <= right; x++) for (let y = FLOOR; y < FLOOR + 20; y++) expect(g.solid(x, y, entrance[2])).toBe(false);
      // Behind the door: a covered room on the floor boards, several square metres of it.
      let room = 0;
      for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) {
        const h = reached[x + g.sx * z]!;
        if (h === FLOOR && covered(g, x, h, z)) room++;
      }
      expect(room / 64, `${b.id} reachable indoor floor (m²)`).toBeGreaterThan(tierOf(b) === 'hut' ? 10 : 14);
    }
  });

  it('approaches every doorway over a flush threshold or steps of at most two cells', () => {
    for (const b of BLUEPRINTS) {
      const g = grid(b), [ex, , ez] = HOME_REVIEW[b.id]!.entrance;
      // Walk straight in along every column of the opening, from the street edge to a metre inside the door.
      for (let x = ex - 4; x <= ex + 4; x++) {
        let previous = 0;
        for (let z = 127; z >= ez - 8; z--) {
          let surface = 0;
          for (let y = 0; y < FLOOR + 4; y++) if (g.solid(x, y, z)) surface = y + 1;
          expect(Math.abs(surface - previous), `${b.id} step at ${x},${z}`).toBeLessThanOrEqual(2);
          expect(surface).toBeLessThanOrEqual(FLOOR);
          // Full door height through the opening, then at least two metres of headroom inside.
          for (let y = surface; y < surface + (z >= ez - 3 ? 20 : HEAD); y++) expect(g.solid(x, y, z), `${b.id} headroom at ${x},${y},${z}`).toBe(false);
          previous = surface;
        }
      }
    }
  });

  it('puts every presence anchor on real glass with open air outward and no anchorless glass', () => {
    for (const b of BLUEPRINTS) {
      const g = grid(b);
      const claimed = new Set<number>();
      for (const w of b.windows) {
        const along = w.facing === 'north' || w.facing === 'south' ? 0 : 2, normal = along === 0 ? 2 : 0;
        const out = w.facing === 'south' || w.facing === 'east' ? 1 : -1;
        const glassAt = w.centre[normal] - (out > 0 ? 1 : 0), firstOut = w.centre[normal] + (out > 0 ? 0 : -1);
        let glass = 0, total = 0;
        for (let y = w.centre[1] - w.height / 2; y < w.centre[1] + w.height / 2; y++) for (let u = w.centre[along] - w.width / 2; u < w.centre[along] + w.width / 2; u++) {
          const cell: [number, number, number] = [0, y, 0];
          cell[along] = u; cell[normal] = glassAt;
          total++;
          if (g.get(...cell) === MAT.glass) { glass++; claimed.add(cell[0] + g.sx * (cell[1] + g.sy * cell[2])); }
          // One and a half metres outward along the normal: no roof, shutter, plant or wall in the way.
          for (let n = 0; n < 12; n++) {
            cell[normal] = firstOut + out * n;
            expect(g.solid(...cell), `${b.id}/${w.id} blocked at ${cell}`).toBe(false);
          }
        }
        expect(glass / total, `${b.id}/${w.id} glass share`).toBeGreaterThan(0.7);
      }
      for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === MAT.glass) expect(claimed.has(i), `${b.id} glass without an anchor at ${i}`).toBe(true);
      expect(new Set(b.windows.map(w => w.id)).size).toBe(b.windows.length);
      expect(b.windows.length).toBeLessThanOrEqual(64);
      expect(b.windows.filter(w => w.facing === 'south').length).toBeGreaterThanOrEqual(1);
    }
  });

  it('stands every wall, beam, roof and chimney on structure down to the ground', () => {
    for (const b of BLUEPRINTS) {
      const g = grid(b), seen = new Uint8Array(g.cells.length), queue: number[] = [];
      let structural = 0;
      for (let i = 0; i < g.cells.length; i++) if (STRUCTURE.has(g.cells[i]!)) structural++;
      for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) { const i = x + g.sx * g.sy * z; if (STRUCTURE.has(g.cells[i]!)) { seen[i] = 1; queue.push(i); } }
      for (let head = 0; head < queue.length; head++) {
        const i = queue[head]!, x = i % g.sx, y = Math.floor(i / g.sx) % g.sy, z = Math.floor(i / (g.sx * g.sy));
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= g.sx || ny >= g.sy || nz >= g.sz) continue;
          const n = nx + g.sx * (ny + g.sy * nz);
          if (!seen[n] && STRUCTURE.has(g.cells[n]!)) { seen[n] = 1; queue.push(n); }
        }
      }
      // Glass, soil and planting never hold anything up.
      expect(queue.length, `${b.id}: structure hanging from glass or planting`).toBe(structural);
    }
  });

  it('grows without moving the address, the entrance or any earlier window', () => {
    for (const family of FAMILIES) {
      const homes = BLUEPRINTS.filter(b => familyOf(b) === family);
      for (let i = 1; i < homes.length; i++) {
        const before = homes[i - 1]!, after = homes[i]!;
        expect(HOME_REVIEW[after.id]!.entrance).toEqual(HOME_REVIEW[before.id]!.entrance);
        expect(after.windows.slice(0, before.windows.length)).toEqual(before.windows);
        // The street face of the earlier tier stands unchanged in the grown one.
        const a = grid(before), c = grid(after);
        for (let z = FACADE - 4; z < 128; z++) for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) expect(c.get(x, y, z), `${after.id} front changed at ${x},${y},${z}`).toBe(a.get(x, y, z));
        // Growth adds real floor space behind the old home.
        let gained = 0;
        for (let z = 0; z < 128; z++) for (let x = 0; x < 64; x++) if (c.get(x, FLOOR - 1, z) === STYLES.tide.trim && a.get(x, FLOOR - 1, z) !== STYLES.tide.trim) gained++;
        expect(gained / 64, `${after.id} new floor (m²)`).toBeGreaterThan(4);
      }
    }
  });

  it('makes every room a tier adds reachable on foot from the street door', () => {
    for (const family of FAMILIES) {
      const homes = BLUEPRINTS.filter(b => familyOf(b) === family);
      for (let i = 1; i < homes.length; i++) {
        const before = grid(homes[i - 1]!), after = homes[i]!, g = grid(after);
        const reached = walk(g, [HOME_REVIEW[after.id]!.entrance[0], 127]);
        // New boards and the clear standing space over them: a person must be able to stand on most of it.
        let room = 0, walked = 0;
        for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) {
          if (g.get(x, FLOOR - 1, z) !== STYLES.tide.trim || before.get(x, FLOOR - 1, z) === STYLES.tide.trim) continue;
          if (!standable(g, x, FLOOR, z)) continue;
          room++;
          if (reached[x + g.sx * z] === FLOOR) walked++;
        }
        expect(room / 64, `${after.id} new standing room (m²)`).toBeGreaterThan(4);
        expect(walked, `${after.id} new rooms cut off from the door`).toBe(room);
      }
    }
  });

  it('joins every addition to the house it grows from: one built mass, every wall capped', () => {
    const { wall, roof } = STYLES.tide;
    for (const b of BLUEPRINTS) {
      const g = grid(b);
      // Walls and roofs (with the timber and stone that tie them) form one face-connected body.
      const body = components(g, -1);
      const shell = body.filter(part => part.some(([x, y, z]) => g.get(x, y, z) === wall || g.get(x, y, z) === roof));
      expect(shell.length, `${b.id}: walls or roofs standing apart`).toBe(1);
      // No wall pokes out of its roof: every wall column ends under a roof, beam or capping stone.
      for (let z = 0; z < g.sz; z++) for (let x = 0; x < g.sx; x++) {
        let top = -1;
        for (let y = g.sy - 1; y >= 0 && top < 0; y--) if (g.get(x, y, z) === wall) top = y;
        if (top < 0) continue;
        let capped = false;
        for (let y = top + 1; y < g.sy && !capped; y++) capped = STRUCTURE.has(g.get(x, y, z));
        expect(capped, `${b.id}: wall open to the sky at ${x},${top},${z}`).toBe(true);
      }
    }
  });

  it('gives the three families silhouettes that differ in at least two broad ways', () => {
    type Shape = { peaks: number; ridge: 'x' | 'z'; lopsided: boolean; slender: boolean };
    const shape = (b: VoxelBlueprint): Shape => {
      const g = grid(b), roof = STYLES.tide.roof;
      const front = new Array<number>(g.sx).fill(0), side = new Array<number>(g.sz).fill(0);
      // Roof masses only: the slate drip on a chimney cap is its own small piece and not part of the skyline.
      for (const [x, y, z] of components(g, roof).filter(part => part.length > 1000).flat()) {
        front[x] = Math.max(front[x]!, y + 1); side[z] = Math.max(side[z]!, y + 1);
      }
      const xs = front.flatMap((h, x) => h ? [x] : []), minX = xs[0]!, maxX = xs.at(-1)!;
      // Summits of the street skyline whose prominence over the saddle toward any higher ground is at least a metre.
      let peaks = 0;
      for (let x = minX; x <= maxX; x++) {
        const h = front[x]!;
        if (front[x - 1] === h) continue;
        let r = x; while (front[r + 1] === h) r++;
        let left = h, right = h;
        for (let i = x - 1; i >= 0 && front[i]! <= h; i--) left = Math.min(left, front[i]!);
        for (let i = r + 1; i < g.sx && front[i]! <= h; i++) right = Math.min(right, front[i]!);
        const higherLeft = front.slice(0, x).some(v => v > h), higherRight = front.slice(r + 1).some(v => v > h);
        const saddle = Math.max(higherLeft ? left : 0, higherRight ? right : 0);
        if (h - saddle >= 8 && left < h && right < h) peaks++;
      }
      const top = Math.max(...front), plateau = (profile: number[]) => profile.filter(v => v >= top - 1).length;
      return { peaks, ridge: plateau(side) > plateau(front) ? 'z' : 'x', lopsided: Math.abs(front[minX]! - front[maxX]!) >= 6, slender: top > maxX - minX + 1 };
    };
    for (const tier of READY) {
      const shapes = FAMILIES.map(f => shape(BLUEPRINTS.find(b => b.id === `home-tide-${f}-${tier}`)!));
      expect(shapes[0]).toMatchObject({ peaks: 1, ridge: 'z', lopsided: true });
      expect(shapes[1]).toMatchObject({ peaks: 1, ridge: 'x', lopsided: false });
      expect(shapes[2]).toMatchObject({ peaks: 2, ridge: 'z', lopsided: false });
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
        const a = shapes[i]!, c = shapes[j]!;
        const differences = [a.peaks !== c.peaks, a.ridge !== c.ridge, a.lopsided !== c.lopsided, a.slender !== c.slender].filter(Boolean).length;
        expect(differences, `${FAMILIES[i]} vs ${FAMILIES[j]} at ${tier}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('exports doorway focus data for exactly the finished homes', () => {
    expect(Object.keys(HOME_REVIEW).sort()).toEqual(BLUEPRINTS.map(b => b.id).sort());
    for (const b of BLUEPRINTS) {
      const e = HOME_REVIEW[b.id]!.entrance;
      expect(e.every(Number.isInteger)).toBe(true);
      e.forEach((v, axis) => { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(b.size[axis]!); });
      // The door stays on the street side, within two metres of the facade.
      expect(e[2]).toBeGreaterThan(FACADE - 20);
    }
  });
});
