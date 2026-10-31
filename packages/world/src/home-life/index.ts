import type { Vec3, VoxelBlueprint } from '@chatdom/shared';

type Box = VoxelBlueprint['boxes'][number];
export interface HomeLifeAnchors {
  /** Actual front portal bounds, in local build cells. */
  readonly door: { readonly from: Vec3; readonly to: Vec3 } | null;
  /** Actual open flue mouths, or the authored legacy Grove chimney cap, in local build cells. */
  readonly chimneys: readonly Vec3[];
}

/** Sample final ordered box occupancy without allocating a whole reserved lot. */
function materialSampler(blueprint: VoxelBlueprint) {
  const [sx, sy, sz] = blueprint.size, cache = new Map<number, number>();
  return (x: number, y: number, z: number): number => {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return 0;
    const key = x + sx * (y + sy * z), known = cache.get(key);
    if (known !== undefined) return known;
    let material = 0;
    for (let i = blueprint.boxes.length - 1; i >= 0; i--) {
      const box = blueprint.boxes[i]!;
      if (x >= box.from[0] && x < box.to[0] && y >= box.from[1] && y < box.to[1] && z >= box.from[2] && z < box.to[2]) {
        material = box.material; break;
      }
    }
    cache.set(key, material);
    return material;
  };
}

type Sample = ReturnType<typeof materialSampler>;
function clearPortal(box: Box, at: Sample): boolean {
  const x0 = Math.floor((box.from[0] + box.to[0] - 6) / 2);
  for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.from[1] + 15; y++) {
    for (let x = x0; x < x0 + 6; x++) if (at(x, y, z)) return false;
  }
  return true;
}

function openFlue(box: Box, at: Sample, height: number): boolean {
  const [x0, y0, z0] = box.from, [x1, y1, z1] = box.to;
  for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
    if (!at(x, y0 - 1, z)) return false;
    for (let y = y0; y < height; y++) if (at(x, y, z)) return false;
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) if (!at(x, y, z0 - 1) || !at(x, y, z1)) return false;
    for (let z = z0; z < z1; z++) if (!at(x0 - 1, y, z) || !at(x1, y, z)) return false;
  }
  return true;
}

function groveCap(blueprint: VoxelBlueprint, at: Sample): Vec3 | undefined {
  if (!/^home-(hut|cottage|house|manor|hall)-grove-[012]$/.test(blueprint.id)) return;
  const solids = blueprint.boxes.filter(box => box.material !== 0);
  const caps = solids.filter(box => box.to[0] - box.from[0] <= 12 && box.to[2] - box.from[2] <= 12
    && box.to[1] - box.from[1] <= 3).sort((a, b) => b.to[1] - a.to[1]);
  for (const cap of caps) {
    // The cap overhangs a real tall, narrow stack; a roof course or little flower bed is insufficient.
    const stack = solids.find(box => box.to[1] === cap.from[1] && box.to[1] - box.from[1] >= 6
      && box.from[0] > cap.from[0] && box.to[0] < cap.to[0]
      && box.from[2] > cap.from[2] && box.to[2] < cap.to[2]);
    if (!stack) continue;
    const x = Math.floor((stack.from[0] + stack.to[0]) / 2), z = Math.floor((stack.from[2] + stack.to[2]) / 2);
    let supported = true;
    for (let y = cap.from[1] - 6; y < cap.to[1]; y++) if (!at(x, y, z)) supported = false;
    for (let y = cap.to[1]; y < blueprint.size[1]; y++) if (at(x, y, z)) supported = false;
    if (supported) return [(cap.from[0] + cap.to[0]) / 2, cap.to[1], (cap.from[2] + cap.to[2]) / 2];
  }
}

/** Geometry projection only: no inferred doors, roof puffs, identities or blueprint edits. */
export function homeLifeAnchors(blueprint: VoxelBlueprint): HomeLifeAnchors {
  if (blueprint.kind !== 'home') return { door: null, chimneys: [] };
  const at = materialSampler(blueprint);
  const portal = blueprint.boxes.filter(box => box.material === 0 && box.from[1] <= 4
    && box.to[1] - box.from[1] >= 15 && box.to[0] - box.from[0] >= 6 && box.to[0] - box.from[0] <= 18
    && box.to[2] - box.from[2] <= 8 && box.to[2] > blueprint.size[2] * .5)
    .sort((a, b) => b.to[2] - a.to[2]).find(box => clearPortal(box, at));
  const solidTop = blueprint.boxes.reduce((top, box) => box.material ? Math.max(top, box.to[1]) : top, 0);
  const chimneys: Vec3[] = [], seen = new Set<string>();
  for (const box of blueprint.boxes) {
    const width = box.to[0] - box.from[0], depth = box.to[2] - box.from[2], height = box.to[1] - box.from[1];
    if (box.material !== 0 || width > 6 || depth > 6 || height < 2 || height < Math.max(width, depth)
      || box.from[1] < solidTop * .5 || !openFlue(box, at, blueprint.size[1])) continue;
    const anchor: Vec3 = [(box.from[0] + box.to[0]) / 2, box.to[1], (box.from[2] + box.to[2]) / 2];
    const key = anchor.join(':');
    if (!seen.has(key)) { seen.add(key); chimneys.push(anchor); }
  }
  const cap = groveCap(blueprint, at);
  if (cap && !seen.has(cap.join(':'))) chimneys.push(cap);
  chimneys.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
  return { door: portal ? { from: [...portal.from], to: [...portal.to] } : null, chimneys };
}
