import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../materials';
import { BLUEPRINTS, FENCE_PROFILE, JOIN_FIXTURES, STREET_PROP_FORMS, STREET_PROP_SIZES, createStreetProp, type StreetPropForm } from './index';

const STRUCTURAL = ['fence-straight', 'fence-corner', 'fence-end', 'wall-straight', 'wall-corner', 'wall-end'] as const;
type Cell = readonly [number, number, number];
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const parse = (k: string) => k.split(',').map(Number) as unknown as Cell;

/** Ordered half-open boxes into solid cells, exactly as the rasterizer applies them (later boxes win). */
function occupancy(b: VoxelBlueprint): Map<string, number> {
  const cells = new Map<string, number>();
  for (const { from, to, material } of b.boxes) {
    for (let x = from[0]; x < to[0]; x++) for (let y = from[1]; y < to[1]; y++) for (let z = from[2]; z < to[2]; z++) {
      if (material === MAT.air) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), material);
    }
  }
  return cells;
}

/** Positive-Y quarter turns of a unit cell about the local origin (three.js rotation.y), then translation. */
function place([x, y, z]: Cell, q: 0 | 1 | 2 | 3, [px, py, pz]: Cell): Cell {
  const [rx, rz] = q === 0 ? [x, z] : q === 1 ? [z, -x - 1] : q === 2 ? [-x - 1, -z - 1] : [-z - 1, x];
  return [rx + px, y + py, rz + pz];
}

function grounded(cells: ReadonlySet<string>): boolean {
  const seen = new Set([...cells].filter(k => parse(k)[1] === 0));
  const queue = [...seen];
  while (queue.length) {
    const [x, y, z] = parse(queue.pop()!);
    for (const [dx, dy, dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const n = key(x + dx!, y + dy!, z + dz!);
      if (cells.has(n) && !seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  return seen.size === cells.size;
}

describe('street edge kit blueprints', () => {
  it('lists finished forms only, Hearth then Tide, in the contract order', () => {
    const expected = ['hearth', 'tide'].flatMap(style => STRUCTURAL.map(form => `street-${style}-${form}`));
    expect(BLUEPRINTS.map(b => b.id)).toEqual(expected);
  });

  it.each(BLUEPRINTS.map(b => [b.id, b] as const))('%s is a strict, passive, grounded prop in its own kit', (_, b) => {
    expect(() => VoxelBlueprintSchema.parse(b)).not.toThrow();
    const style = b.styleId as 'hearth' | 'tide';
    const form = b.id.slice(`street-${style}-`.length) as StreetPropForm;
    expect(b).toMatchObject({ version: 1, kind: 'prop', lattice: 'build', windows: [] });
    expect(b.size).toEqual(STREET_PROP_SIZES[form]);
    const kit = STYLES[style];
    const allowed = new Set<number>([MAT.air, kit.trim, kit.stone, MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.petal, MAT.blueFlower]);
    expect(b.boxes.every(box => allowed.has(box.material))).toBe(true);
    expect(b.boxes.length).toBeLessThanOrEqual(512);
    const cells = occupancy(b);
    expect(cells.size).toBeGreaterThan(0);
    expect(grounded(new Set(cells.keys()))).toBe(true);
    // Structure is the kit's trim and stone; accents stay a small share of the surface.
    const accent = [...cells.values()].filter(m => m !== kit.trim && m !== kit.stone).length;
    expect(accent / cells.size).toBeLessThan(0.05);
    expect(JSON.stringify(createStreetProp(form, style))).toBe(JSON.stringify(b));
  });

  it('keeps the two kits the same form in their own structural materials', () => {
    for (const form of STRUCTURAL) {
      const hearth = occupancy(createStreetProp(form, 'hearth')), tide = occupancy(createStreetProp(form, 'tide'));
      expect([...tide.keys()]).toEqual([...hearth.keys()]);
      const swap = new Map<number, number>([[STYLES.hearth.trim, STYLES.tide.trim], [STYLES.hearth.stone, STYLES.tide.stone]]);
      for (const [k, m] of hearth) expect(tide.get(k)).toBe(swap.get(m) ?? m);
    }
  });

  it('leans the line post along the run while its rails stay on the shared centre line', () => {
    const cells = occupancy(createStreetProp('fence-straight', 'hearth'));
    const post = (y: number) => Array.from({ length: 16 }, (_, x) => x).filter(x => cells.get(key(x, y, 0)) === STYLES.hearth.trim);
    expect(post(2)).toEqual([7, 8, 9]);
    expect(post(10)).toEqual([8, 9, 10]);
    for (const [y0, y1] of FENCE_PROFILE.rails) for (let y = y0; y < y1; y++) for (const x of [0, 15]) {
      expect([0, 1, 2, 3].filter(z => cells.has(key(x, y, z)))).toEqual([1, 2]);
    }
  });

  it('fails explicitly for unknown, unfinished or foreign-kit requests', () => {
    expect(() => createStreetProp('garden-gate' as StreetPropForm, 'hearth')).toThrow('Unknown street prop form');
    expect(() => createStreetProp('fence-straight', 'grove' as 'hearth')).toThrow('hearth and tide');
    for (const form of STREET_PROP_FORMS.filter(f => !(STRUCTURAL as readonly string[]).includes(f))) {
      expect(() => createStreetProp(form, 'tide')).toThrow('not part of the finished street kit');
    }
  });
});

describe('garden-edge join fixtures', () => {
  const byId = new Map(BLUEPRINTS.map(b => [b.id, b]));

  it.each(JOIN_FIXTURES.map(f => [f.id, f] as const))('%s names all ten kit forms with valid bench transforms', (id, fixture) => {
    const style = id.slice(6);
    for (const form of STREET_PROP_FORMS) expect(fixture.instances.some(i => i.assetId === `street-${style}-${form}`)).toBe(true);
    for (const i of fixture.instances) {
      expect(i.position.every(Number.isInteger)).toBe(true);
      expect(i.position[1]).toBe(0);
      expect(i.position[2]).toBeGreaterThanOrEqual(0);
    }
  });

  for (const fixture of JOIN_FIXTURES) describe(fixture.id, () => {
    const structural = fixture.instances.map((instance, index) => ({ ...instance, index, blueprint: byId.get(instance.assetId) }))
      .filter(i => i.blueprint && (STRUCTURAL as readonly string[]).some(f => i.assetId.endsWith(f)));
    const world = new Map<string, { owner: number; material: number }>();
    const overlaps: string[] = [];
    for (const item of structural) for (const [k, material] of occupancy(item.blueprint!)) {
      const w = key(...place(parse(k), item.quarterTurns, item.position));
      if (world.has(w)) overlaps.push(w);
      world.set(w, { owner: item.index, material });
    }
    const cellsOf = (owner: number) => [...world].filter(([, v]) => v.owner === owner).map(([k]) => parse(k));

    it('assembles both runs with no overlapping cells, all above ground and in front of the house', () => {
      expect(structural.length).toBe(10);
      expect(overlaps).toEqual([]);
      for (const k of world.keys()) { const [, y, z] = parse(k); expect(y).toBeGreaterThanOrEqual(0); expect(z).toBeGreaterThanOrEqual(0); }
      expect(grounded(new Set(world.keys()))).toBe(true);
    });

    it('keeps the path opening in front of the door clear', () => {
      expect([...world.keys()].map(parse).filter(([x]) => x >= 20 && x < 40)).toEqual([]);
    });

    it('leaves the reserved plant footprints clear of structure and of each other', () => {
      const reserved = new Set<string>();
      for (const item of fixture.instances.filter(i => !(STRUCTURAL as readonly string[]).some(f => i.assetId.endsWith(f)))) {
        const form = item.assetId.replace(/^street-(hearth|tide)-/, '') as StreetPropForm;
        const [sx, , sz] = STREET_PROP_SIZES[form];
        for (let x = 0; x < sx; x++) for (let z = 0; z < sz; z++) {
          const [wx, , wz] = place([x, 0, z], item.quarterTurns, item.position);
          const column = `${wx},${wz}`;
          expect(reserved.has(column)).toBe(false);
          reserved.add(column);
          expect(wz).toBeGreaterThanOrEqual(0);
          for (let y = 0; y < 12; y++) expect(world.has(key(wx, y, wz))).toBe(false);
          expect(wx >= 20 && wx < 40 && wz > 10).toBe(false);
        }
      }
    });

    // Contacts between face-adjacent cells of different pieces, keyed by the pair and the shared plane.
    const contacts = new Map<string, { a: number; b: number; axis: 0 | 2; plane: number }>();
    for (const [k, v] of world) {
      const [x, y, z] = parse(k);
      for (const axis of [0, 2] as const) {
        const n = axis === 0 ? key(x + 1, y, z) : key(x, y, z + 1);
        const other = world.get(n);
        if (other && other.owner !== v.owner) {
          const plane = axis === 0 ? x + 1 : z + 1;
          contacts.set(`${Math.min(v.owner, other.owner)}-${Math.max(v.owner, other.owner)}`, { a: v.owner, b: other.owner, axis, plane });
        }
      }
    }
    const form = (owner: number) => fixture.instances[owner]!.assetId.replace(/^street-(hearth|tide)-/, '');

    it('joins exactly straight–corner–straight and straight–end on both runs', () => {
      const pairs = [...contacts.values()].map(c => [form(c.a), form(c.b)].sort().join('+')).sort();
      const expected = ['fence', 'wall'].flatMap(kind => [
        `${kind}-corner+${kind}-straight`, `${kind}-corner+${kind}-straight`,
        `${kind}-end+${kind}-straight`, `${kind}-end+${kind}-straight`,
      ]).sort();
      expect(pairs).toEqual(expected);
    });

    it('meets every join plane with matching sections and no crack', () => {
      for (const { a, b, axis, plane } of contacts.values()) {
        const lateral = axis === 0 ? 2 : 0;
        const face = (owner: number, coordinate: number) => new Set(cellsOf(owner).filter(c => c[axis] === coordinate).map(c => `${c[1]},${c[lateral]}`));
        const faceA = face(a, plane - 1), faceB = face(b, plane);
        const ends = [a, b].filter(o => form(o).endsWith('-end'));
        // Every running section meets solid material across the plane; between running pieces the
        // sections are identical, so rails, plinths, caps and cope stones continue unbroken.
        for (const [mine, theirs, owner] of [[faceA, faceB, a], [faceB, faceA, b]] as const) {
          if (ends.includes(owner)) continue;
          for (const cell of mine) expect(theirs.has(cell), `${fixture.id}: ${form(owner)} ${cell} at ${'xyz'[axis]}=${plane}`).toBe(true);
        }
        expect(faceA.size).toBeGreaterThan(0);
        expect(faceB.size).toBeGreaterThan(0);
      }
    });

    it('carries the fence rails unbroken from end post to corner post along the street edge', () => {
      const fenceCells = [...world].filter(([, v]) => form(v.owner).startsWith('fence-')).map(([k]) => parse(k));
      const front = fenceCells.filter(([, , z]) => z === 33);
      const xs = front.map(([x]) => x);
      const [min, max] = [Math.min(...xs), Math.max(...xs)];
      for (const [y0, y1] of FENCE_PROFILE.rails) for (let y = y0; y < y1; y++) for (let x = min; x <= max; x++) {
        for (const z of [33, 34]) expect(world.has(key(x, y, z)), `rail ${x},${y},${z}`).toBe(true);
      }
      expect(max - min + 1).toBe(36);
    });

    it('carries the wall plinth, cap and crown unbroken along the street edge', () => {
      const wallFront = [...world].filter(([, v]) => form(v.owner).startsWith('wall-')).map(([k]) => parse(k)).filter(([, , z]) => z === 32);
      const xs = wallFront.map(([x]) => x);
      const [min, max] = [Math.min(...xs), Math.max(...xs)];
      expect(max - min + 1).toBe(36);
      // The plinth runs under the pier too; cap courses belong to the running pieces, the pier carries its own.
      for (let x = min; x <= max; x++) for (const y of [0, 1]) expect(world.has(key(x, y, 32)), `plinth ${x},${y}`).toBe(true);
      const running = wallFront.filter(([x, y, z]) => !form(world.get(key(x, y, z))!.owner).endsWith('-end')).map(([x]) => x);
      const [r0, r1] = [Math.min(...running), Math.max(...running)];
      expect(r1 - r0 + 1).toBe(32);
      for (let x = r0; x <= r1; x++) for (const y of [6, 7]) expect(world.has(key(x, y, 32)), `cap ${x},${y}`).toBe(true);
      // Cope stones leave single-cell joints only; a doubled joint would mean a gap opened at a join plane.
      const crown = Array.from({ length: r1 - r0 + 1 }, (_, i) => world.has(key(r0 + i, 8, 33)));
      expect(crown.some((has, i) => !has && crown[i + 1] === false)).toBe(false);
      expect(crown.filter(Boolean).length).toBeGreaterThan(24);
    });
  });
});
