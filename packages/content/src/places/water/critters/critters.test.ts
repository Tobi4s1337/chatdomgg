import type { Vec3, VoxelAsset } from '@chatdom/shared';
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../../materials';
import { CRITTER_KINDS, createCritter, type Critter, type CritterKind, type CritterVariant } from './index';

const VARIANTS: readonly CritterVariant[] = [0, 1, 2];
const ALL = CRITTER_KINDS.flatMap(kind => VARIANTS.map(variant => ({ kind, variant, critter: createCritter(kind, variant) })));
const REGISTERED = new Set(MATERIALS.materials.filter(m => m.id !== 0).map(m => m.id));

/** Metres, nose to tail and overall height. Small fliers and the fish sit at the nearest whole cell to the brief. */
const SIZES: Readonly<Record<CritterKind, { length?: readonly [number, number]; height?: readonly [number, number] }>> = {
  drake: { length: [0.55, 0.65] },
  hen: { length: [0.55, 0.65] },
  heron: { height: [1.0, 1.1] },
  trout: { length: [0.35, 0.44] },
  kingfisher: { length: [0.28, 0.32] },
  dragonfly: { length: [0.25, 0.32] },
  floater: { length: [0.37, 0.44] },
};

const at = (a: VoxelAsset, x: number, y: number, z: number) => {
  const [sx, sy, sz] = a.size;
  return x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : a.voxels[x + sx * (y + sy * z)]!;
};

function occupied(a: VoxelAsset): Vec3[] {
  const out: Vec3[] = [];
  const [sx, sy, sz] = a.size;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) if (at(a, x, y, z)) out.push([x, y, z]);
  return out;
}

function components(a: VoxelAsset): number {
  const seen = new Set<string>();
  let count = 0;
  for (const start of occupied(a)) {
    if (seen.has(start.join())) continue;
    count++;
    const stack: Vec3[] = [start];
    seen.add(start.join());
    while (stack.length) {
      const [x, y, z] = stack.pop()!;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const n: Vec3 = [x + dx, y + dy, z + dz];
        if (at(a, ...n) && !seen.has(n.join())) { seen.add(n.join()); stack.push(n); }
      }
    }
  }
  return count;
}

const inside = (p: Vec3, size: Vec3) => p.every((v, d) => v >= 0 && v <= size[d]!);
/** Distance from a point to the nearest occupied cell's closed box. */
function gap(a: VoxelAsset, p: Vec3): number {
  let best = Infinity;
  for (const c of occupied(a)) {
    const d = Math.hypot(...[0, 1, 2].map(i => Math.max(c[i]! - p[i]!, 0, p[i]! - (c[i]! + 1))));
    best = Math.min(best, d);
  }
  return best;
}

const body = (c: Critter) => c.parts[0]!;

describe('water critters', () => {
  it('lists every kind once and builds each kind by name', () => {
    expect(new Set(CRITTER_KINDS).size).toBe(CRITTER_KINDS.length);
    expect([...CRITTER_KINDS].sort()).toEqual(['dragonfly', 'drake', 'floater', 'hen', 'heron', 'kingfisher', 'trout']);
    for (const { kind, critter } of ALL) expect(critter.kind).toBe(kind);
    expect(createCritter('drake').parts[0]!.asset.voxels).toEqual(createCritter('drake', 0).parts[0]!.asset.voxels);
  });

  it.each(ALL)('$kind $variant: parts are valid avatar-lattice assets', ({ critter }) => {
    expect(critter.parts[0]!.id).toBe('body');
    expect(new Set(critter.parts.map(p => p.id)).size).toBe(critter.parts.length);
    for (const part of critter.parts) {
      const { asset } = part;
      expect(asset.lattice).toBe('avatar');
      expect(asset.size.every(n => Number.isInteger(n) && n >= 1 && n <= 32)).toBe(true);
      expect(asset.voxels).toBeInstanceOf(Uint16Array);
      expect(asset.voxels.length).toBe(asset.size[0] * asset.size[1] * asset.size[2]);
      for (const v of asset.voxels) if (v) expect(REGISTERED.has(v)).toBe(true);
      expect(occupied(asset).length).toBeGreaterThan(0);
      expect(components(asset), `${part.id} is one face-connected piece`).toBe(1);
      expect(inside(part.pivot, asset.size), `${part.id} pivot`).toBe(true);
    }
  });

  it.each(ALL)('$kind $variant: the root and every joint sit where they should', ({ critter }) => {
    const root = body(critter);
    expect(root.attach).toEqual(root.pivot);
    for (const part of critter.parts.slice(1)) {
      expect(inside(part.attach, root.asset.size), `${part.id} attach inside the body`).toBe(true);
      expect(gap(root.asset, part.attach), `${part.id} attach touches the body`).toBeLessThanOrEqual(0.5);
      expect(gap(part.asset, part.pivot), `${part.id} pivot touches its own cells`).toBeLessThanOrEqual(0.5);
    }
  });

  it.each(ALL)('$kind $variant: has the expected rig', ({ kind, critter }) => {
    const ids = critter.parts.map(p => p.id);
    const expected = kind === 'drake' || kind === 'hen' || kind === 'heron' ? ['body', 'head']
      : kind === 'kingfisher' ? ['body', 'wing-left', 'wing-right'] : ['body'];
    expect(ids).toEqual(expected);
    if (kind === 'floater') {
      expect(critter.light).toBeDefined();
      const light = critter.light!;
      expect(inside(light, body(critter).asset.size)).toBe(true);
      // The glow sits in the lantern's hollow, not inside a solid cell.
      expect(at(body(critter).asset, Math.floor(light[0]), Math.floor(light[1]), Math.floor(light[2]))).toBe(0);
    } else {
      expect(critter.light).toBeUndefined();
    }
  });

  it.each(ALL.filter(c => ['drake', 'hen', 'floater'].includes(c.kind)))('$kind $variant: floats with a share of its body under the waterline', ({ critter }) => {
    const root = body(critter);
    const cells = occupied(root.asset);
    const below = cells.filter(c => c[1] + 1 <= root.pivot[1]).length;
    const above = cells.filter(c => c[1] >= root.pivot[1]).length;
    expect(below + above).toBe(cells.length);
    expect(below).toBeGreaterThan(0);
    expect(above).toBeGreaterThan(0);
    expect(below / cells.length).toBeGreaterThanOrEqual(0.25);
    expect(below / cells.length).toBeLessThanOrEqual(0.5);
  });

  it.each(ALL.filter(c => c.kind === 'heron'))('heron $variant: stands with its feet on the root', ({ critter }) => {
    const root = body(critter);
    expect(Math.min(...occupied(root.asset).map(c => c[1]))).toBe(root.pivot[1]);
  });

  it.each(ALL)('$kind $variant: measures within its size', ({ kind, critter }) => {
    const { length, height } = SIZES[kind];
    if (length) { expect(critter.length).toBeGreaterThanOrEqual(length[0]); expect(critter.length).toBeLessThanOrEqual(length[1]); }
    if (height) { expect(critter.height).toBeGreaterThanOrEqual(height[0]); expect(critter.height).toBeLessThanOrEqual(height[1]); }
    expect(critter.length).toBeGreaterThan(0);
    expect(critter.height).toBeGreaterThan(0);
  });

  it('keeps the rig across variants: only colours change', () => {
    for (const kind of CRITTER_KINDS) {
      const [a, ...rest] = VARIANTS.map(v => createCritter(kind, v));
      for (const b of rest) {
        expect(b!.parts.map(p => [p.id, p.pivot, p.attach, p.asset.size])).toEqual(a!.parts.map(p => [p.id, p.pivot, p.attach, p.asset.size]));
        expect([b!.length, b!.height, b!.light]).toEqual([a!.length, a!.height, a!.light]);
        a!.parts.forEach((p, i) => expect(b!.parts[i]!.asset.voxels.map(v => (v ? 1 : 0))).toEqual(p.asset.voxels.map(v => (v ? 1 : 0))));
      }
    }
  });

  it('is deterministic and gives each variant its own look', () => {
    for (const { kind, variant, critter } of ALL) {
      const again = createCritter(kind, variant);
      expect(again.parts.map(p => [p.asset.id, p.asset.size, [...p.asset.voxels]])).toEqual(critter.parts.map(p => [p.asset.id, p.asset.size, [...p.asset.voxels]]));
    }
    for (const kind of CRITTER_KINDS) {
      const looks = VARIANTS.map(v => createCritter(kind, v).parts.map(p => [...p.asset.voxels].join()).join('|'));
      expect(new Set(looks).size).toBe(VARIANTS.length);
    }
  });

  it('gives every asset a unique id', () => {
    const ids = ALL.flatMap(({ critter }) => critter.parts.map(p => p.asset.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('rejects unknown kinds and variants', () => {
    expect(() => createCritter('swan' as CritterKind)).toThrow();
    expect(() => createCritter('drake', 3 as CritterVariant)).toThrow();
  });
});
