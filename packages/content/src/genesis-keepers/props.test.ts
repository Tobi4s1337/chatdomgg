import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { AVATAR_PALETTE, MAT, MATERIALS, STYLES, type StyleKey } from '../materials';
import { createAleBarrel, createInnSign, createKeeperLampPost, createMooringPost, KEEPER_PROP_ANCHORS } from './props';

const CELL = 0.125;
const STYLE_KEYS = Object.keys(STYLES) as StyleKey[];
const FACTORIES = {
  lamp: createKeeperLampPost,
  sign: createInnSign,
  barrel: createAleBarrel,
  mooring: createMooringPost,
} as const satisfies Record<keyof typeof KEEPER_PROP_ANCHORS, (style: StyleKey) => VoxelBlueprint>;
/** Street-prop budgets (packages/content/README.md). */
const MAX_BOXES = 512, MAX_CELLS = 20_000;
/**
 * The registry has no emissive material; the only solid material that passes light is glass. Only the lamp may hold
 * it, and it stays unlit: whether the lamp burns is the host's lighting, never the prop's.
 */
const LIGHT_PASSING = new Set(MATERIALS.materials.filter(m => m.solid && !m.blocksLight).map(m => m.id));
/** Skin, hair and people's fabrics are identity swatches: furniture never wears them. */
const IDENTITY = new Set<number>([...AVATAR_PALETTE.skin, ...AVATAR_PALETTE.hair, ...AVATAR_PALETTE.fabric, ...AVATAR_PALETTE.fabricLapsed]);

/** Rasterise boxes in order; material zero carves. Returns material per cell (0 = empty). */
function rasterise(bp: VoxelBlueprint) {
  const [sx, sy, sz] = bp.size;
  const cells = new Uint16Array(sx * sy * sz);
  const at = (x: number, y: number, z: number) => x + sx * (y + sy * z);
  for (const { from, to, material } of bp.boxes) {
    for (let z = from[2]; z < to[2]; z++) for (let y = from[1]; y < to[1]; y++) for (let x = from[0]; x < to[0]; x++) cells[at(x, y, z)] = material;
  }
  return { cells, at, size: bp.size };
}

/** Occupied cells not reachable from a y = 0 occupied cell through face neighbours. */
function floating(bp: VoxelBlueprint): number {
  const { cells, at, size: [sx, sy, sz] } = rasterise(bp);
  const seen = new Uint8Array(cells.length), queue: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) if (cells[at(x, 0, z)]) { seen[at(x, 0, z)] = 1; queue.push(at(x, 0, z)); }
  while (queue.length) {
    const i = queue.pop()!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx < 0 || ny < 0 || nz < 0 || nx >= sx || ny >= sy || nz >= sz) continue;
      const j = at(nx, ny, nz);
      if (cells[j] && !seen[j]) { seen[j] = 1; queue.push(j); }
    }
  }
  let lost = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] && !seen[i]) lost++;
  return lost;
}

describe('keeper props', () => {
  for (const [kind, make] of Object.entries(FACTORIES) as [keyof typeof FACTORIES, (style: StyleKey) => VoxelBlueprint][]) {
    for (const style of STYLE_KEYS) {
      describe(`${kind} (${style})`, () => {
        const bp = make(style);
        const { cells } = rasterise(bp);
        const used = new Set(cells.filter(m => m !== 0));

        it('is a valid, deterministic prop blueprint in the style kit', () => {
          expect(VoxelBlueprintSchema.parse(bp)).toEqual(bp);
          expect(bp).toMatchObject({ kind: 'prop', lattice: 'build', styleId: STYLES[style].id, windows: [] });
          expect(JSON.stringify(make(style))).toBe(JSON.stringify(bp));
          expect(bp.id).toContain(style);
        });

        it('keeps every box in bounds and within the street-prop budget', () => {
          for (const box of bp.boxes) for (let d = 0; d < 3; d++) {
            expect(box.from[d]).toBeGreaterThanOrEqual(0);
            expect(box.from[d]).toBeLessThan(box.to[d]!);
            expect(box.to[d]).toBeLessThanOrEqual(bp.size[d]!);
          }
          expect(bp.boxes.length).toBeLessThanOrEqual(MAX_BOXES);
          const occupied = cells.reduce((n, m) => n + (m ? 1 : 0), 0);
          expect(occupied).toBeGreaterThan(0);
          expect(occupied).toBeLessThanOrEqual(MAX_CELLS);
        });

        it('uses registered materials, no identity swatches, and holds no glass unless it is the lamp', () => {
          const registered = new Set(MATERIALS.materials.map(m => m.id));
          for (const m of used) {
            expect(registered.has(m)).toBe(true);
            expect(IDENTITY.has(m)).toBe(false);
          }
          const light = [...used].filter(m => LIGHT_PASSING.has(m));
          expect(light).toEqual(kind === 'lamp' ? [MAT.glass] : []);
        });

        it('stands: every occupied cell reaches the ground through face neighbours', () => {
          expect(floating(bp)).toBe(0);
        });

        it('has its anchor on the ground inside the footprint and its points on the prop', () => {
          const anchor = KEEPER_PROP_ANCHORS[kind];
          const [ox, oy, oz] = anchor.origin;
          expect(oy).toBe(0);
          expect(ox >= 0 && ox < bp.size[0] && oz >= 0 && oz < bp.size[2]).toBe(true);
          const grid = rasterise(bp);
          expect(grid.cells[grid.at(ox, 0, oz)]).not.toBe(0);
          for (const [name, point] of Object.entries(anchor.points)) {
            // Fixture-local metres back to build cells.
            const p = [ox + point[0] / CELL, oy + point[1] / CELL, oz + point[2] / CELL];
            for (let d = 0; d < 3; d++) {
              expect(p[d], `${kind}.${name}[${d}]`).toBeGreaterThanOrEqual(0);
              expect(p[d], `${kind}.${name}[${d}]`).toBeLessThanOrEqual(bp.size[d]!);
            }
            // The point lies in or on the surface of an occupied cell: something to aim at, not air.
            let touches = false;
            const lo = p.map(v => Math.ceil(v) - 1), hi = p.map(v => Math.floor(v));
            for (let z = lo[2]!; z <= hi[2]!; z++) for (let y = lo[1]!; y <= hi[1]!; y++) for (let x = lo[0]!; x <= hi[0]!; x++) {
              if (x < 0 || y < 0 || z < 0 || x >= bp.size[0] || y >= bp.size[1] || z >= bp.size[2]) continue;
              if (grid.cells[grid.at(x, y, z)]) touches = true;
            }
            expect(touches, `${kind}.${name} touches the prop`).toBe(true);
          }
        });
      });
    }
  }

  it('aims the lamplighter at the lantern glass', () => {
    const bp = createKeeperLampPost('hearth'), grid = rasterise(bp), { origin, points } = KEEPER_PROP_ANCHORS.lamp;
    const cell = points.glass.map((v, d) => Math.floor(origin[d]! + v / CELL));
    expect(grid.cells[grid.at(cell[0]!, cell[1]!, cell[2]!)]).toBe(MAT.glass);
  });

  it('refuses an unknown style', () => {
    for (const make of Object.values(FACTORIES)) expect(() => make('marble' as StyleKey)).toThrow(/Unknown style/);
  });
});
