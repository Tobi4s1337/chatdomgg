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

const BLOOM = { hearth: MAT.petal, tide: MAT.blueFlower } as const;
const ofForm = (form: StreetPropForm, style: 'hearth' | 'tide' = 'hearth') => occupancy(createStreetProp(form, style));
const count = (cells: Map<string, number>, material: number) => [...cells.values()].filter(m => m === material).length;

describe('street kit blueprints', () => {
  it('lists all twenty, Hearth then Tide, in the contract order', () => {
    const expected = ['hearth', 'tide'].flatMap(style => STREET_PROP_FORMS.map(form => `street-${style}-${form}`));
    expect(BLUEPRINTS.map(b => b.id)).toEqual(expected);
  });

  it.each(BLUEPRINTS.map(b => [b.id, b] as const))('%s is a strict, passive, grounded prop in its own kit', (_, b) => {
    expect(() => VoxelBlueprintSchema.parse(b)).not.toThrow();
    const style = b.styleId as 'hearth' | 'tide';
    const form = b.id.slice(`street-${style}-`.length) as StreetPropForm;
    expect(b).toMatchObject({ version: 1, kind: 'prop', lattice: 'build', windows: [] });
    expect(b.size).toEqual(STREET_PROP_SIZES[form]);
    const kit = STYLES[style];
    const allowed = new Set<number>([MAT.air, kit.trim, kit.stone, MAT.earth, MAT.bark, MAT.leaf, MAT.moss, BLOOM[style]]);
    expect(b.boxes.every(box => allowed.has(box.material))).toBe(true);
    expect(b.boxes.length).toBeLessThanOrEqual(512);
    const solids = b.boxes.filter(box => box.material !== MAT.air).map(box => JSON.stringify(box));
    expect(new Set(solids).size).toBe(solids.length);
    const cells = occupancy(b);
    expect(cells.size).toBeGreaterThan(0);
    expect(grounded(new Set(cells.keys()))).toBe(true);
    // Flowers stay an accent everywhere: never a carpet.
    expect(count(cells, BLOOM[style]) / cells.size).toBeLessThan(0.04);
    if ((STRUCTURAL as readonly string[]).includes(form)) {
      // Structure is the kit's trim and stone; accents stay a small share of the surface.
      const accent = [...cells.values()].filter(m => m !== kit.trim && m !== kit.stone).length;
      expect(accent / cells.size).toBeLessThan(0.05);
    } else {
      // Plants and stones carry no timber: containers and stones are the kit's stone, the rest is growing.
      expect(count(cells, kit.trim)).toBe(0);
    }
    expect(JSON.stringify(createStreetProp(form, style))).toBe(JSON.stringify(b));
  });

  it('keeps the two kits the same form in their own structural materials and flower', () => {
    const swap = new Map<number, number>([[STYLES.hearth.trim, STYLES.tide.trim], [STYLES.hearth.stone, STYLES.tide.stone], [MAT.petal, MAT.blueFlower]]);
    for (const form of STREET_PROP_FORMS) {
      const hearth = ofForm(form, 'hearth'), tide = ofForm(form, 'tide');
      expect([...tide.keys()]).toEqual([...hearth.keys()]);
      for (const [k, m] of hearth) expect(tide.get(k)).toBe(swap.get(m) ?? m);
    }
  });

  it('leans the line post along the run while its rails stay on the shared centre line', () => {
    const cells = ofForm('fence-straight');
    const post = (y: number) => Array.from({ length: 16 }, (_, x) => x).filter(x => cells.get(key(x, y, 0)) === STYLES.hearth.trim);
    expect(post(2)).toEqual([7, 8, 9]);
    expect(post(10)).toEqual([8, 9, 10]);
    for (const [y0, y1] of FENCE_PROFILE.rails) for (let y = y0; y < y1; y++) for (const x of [0, 15]) {
      expect([0, 1, 2, 3].filter(z => cells.has(key(x, y, z)))).toEqual([1, 2]);
    }
  });

  it('fails explicitly for unknown forms or foreign kits', () => {
    expect(() => createStreetProp('garden-gate' as StreetPropForm, 'hearth')).toThrow('Unknown street prop form');
    expect(() => createStreetProp('fence-straight', 'grove' as 'hearth')).toThrow('hearth and tide');
  });
});

describe('containers', () => {
  const footprint = (cells: Map<string, number>, y: number) => new Set([...cells.keys()].map(parse).filter(c => c[1] === y).map(([x, , z]) => `${x},${z}`));
  const stone = STYLES.hearth.stone;

  it.each([['flower-pot', 5, 6], ['flower-trough', 4, 5]] as const)('%s holds earth below a lip that oversails its body', (form, earthY, lipTop) => {
    const cells = ofForm(form);
    const earth = [...cells].filter(([, m]) => m === MAT.earth).map(([k]) => parse(k));
    expect(earth.length).toBeGreaterThan(8);
    expect(new Set(earth.map(c => c[1]))).toEqual(new Set([earthY]));
    // The lip is a closed stone ring around the earth at both of its courses.
    for (const [x, , z] of earth) for (const y of [earthY, lipTop]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      let n = 1;
      while (cells.get(key(x + dx * n, y, z + dz * n)) !== stone) { expect(n, `${form} ring ${x},${y},${z}`).toBeLessThan(16); n++; }
    }
    // A real cavity: open air sits directly over some of the earth inside the lip, below its top course.
    const open = earth.filter(([x, y, z]) => !cells.has(key(x, y + 1, z)));
    expect(open.length).toBeGreaterThanOrEqual(3);
    // The lip oversails the body by a cell on every side: it reads as a rim, not a straight-sided box.
    const extent = (y: number) => {
      const cs = [...footprint(cells, y)].map(c => c.split(',').map(Number) as [number, number]).filter(([x, z]) => cells.get(key(x, y, z)) === stone);
      return [Math.min(...cs.map(c => c[0])), Math.max(...cs.map(c => c[0])), Math.min(...cs.map(c => c[1])), Math.max(...cs.map(c => c[1]))] as const;
    };
    const [lx0, lx1, lz0, lz1] = extent(lipTop), [bx0, bx1, bz0, bz1] = extent(earthY - 2);
    expect([bx0 - lx0, lx1 - bx1, bz0 - lz0, lz1 - bz1]).toEqual([1, 1, 1, 1]);
  });

  it('keeps every flower in foliage, never on a bare stalk or loose', () => {
    for (const form of ['flower-pot', 'flower-trough', 'leafy-shrub'] as const) {
      const cells = ofForm(form);
      const blooms = [...cells].filter(([, m]) => m === MAT.petal).map(([k]) => parse(k));
      expect(blooms.length).toBeGreaterThan(0);
      for (const [x, y, z] of blooms) {
        const below = cells.get(key(x, y - 1, z));
        expect(below === MAT.leaf || below === MAT.petal, `${form} bloom ${x},${y},${z}`).toBe(true);
      }
    }
  });

  it('keeps trough foliage off both ends so troughs meet end to end or against a wall', () => {
    const cells = ofForm('flower-trough');
    for (const [k, m] of cells) if (m === MAT.leaf || m === MAT.petal) expect(parse(k)[0] > 0 && parse(k)[0] < 15, k).toBe(true);
    // Its trailing stem hangs from the front lip, in front of the inset body.
    const hanging = [...cells].filter(([k, m]) => m === MAT.leaf && parse(k)[1] < 4).map(([k]) => parse(k));
    expect(hanging.length).toBeGreaterThan(0);
    for (const [, , z] of hanging) expect(z).toBe(5);
  });
});

describe('stones and shrub', () => {
  const top = (cells: Map<string, number>, x: number, z: number) => Math.max(-1, ...[...cells.keys()].map(parse).filter(c => c[0] === x && c[2] === z).map(c => c[1]));

  it('makes the rock cluster one dominant stone and two lower neighbours, settled at their widest', () => {
    const cells = ofForm('rock-cluster');
    expect(top(cells, 5, 4)).toBe(6);
    expect(top(cells, 10, 7)).toBeLessThanOrEqual(4);
    expect(top(cells, 1, 8)).toBeLessThanOrEqual(2);
    // The ground course is the widest, and the lean never perches a ledge more than a cell beyond the course below.
    const courses = Array.from({ length: 7 }, (_, y) => footprint(cells, y));
    for (const course of courses) expect(course.size).toBeLessThanOrEqual(courses[0]!.size);
    for (let y = 1; y < 7; y++) for (const c of courses[y]!) {
      const [x, z] = c.split(',').map(Number) as [number, number];
      expect([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => courses[y - 1]!.has(`${x + dx!},${z + dz!}`)), `${c} at ${y}`).toBe(true);
    }
    // Moss is a restrained accent in the shade and the joints, not a coat.
    expect(count(cells, MAT.moss) / cells.size).toBeLessThan(0.15);
    for (const [k, m] of cells) if (m === MAT.moss && parse(k)[1] > 0) expect(parse(k)[2]).toBeLessThan(3);
  });

  it('lifts the shrub canopy on a visible stem over three root flares', () => {
    const cells = ofForm('leafy-shrub');
    for (const [k, m] of cells) if (parse(k)[1] < 3) expect(m, k).toBe(MAT.bark);
    const roots = [...cells].filter(([k, m]) => m === MAT.bark && parse(k)[1] === 0).map(([k]) => parse(k));
    expect(roots.filter(([x, , z]) => x < 5 || x > 6 || z < 5 || z > 6).length).toBeGreaterThanOrEqual(5);
    const leaves = count(cells, MAT.leaf);
    expect(leaves / cells.size).toBeGreaterThan(0.85);
    // An uneven crown, higher at the back right: a top-row column there has no mirror across the stem.
    expect(top(cells, 8, 4)).toBe(11);
    expect(top(cells, 3, 4)).toBeLessThan(11);
  });
});

function footprint(cells: Map<string, number>, y: number) {
  return new Set([...cells.keys()].map(parse).filter(c => c[1] === y).map(([x, , z]) => `${x},${z}`));
}

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
          // Planting stays inside the two gardens: behind the street edge, between the side runs.
          expect(wz < 32 && wx >= -12 && wx < 72, `${item.assetId} at ${column}`).toBe(true);
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
