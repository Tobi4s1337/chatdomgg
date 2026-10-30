import { cellIndex, type BuildDraftPolicy, type ContentWindow, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { BuildError } from './draft';

/** Authored neighborhood rules, not a mesh trick: the result remains ordinary collision-bearing voxels. */
export function shapeBuildCells(source: Uint16Array, policy: BuildDraftPolicy): { cells: Uint16Array; windows: ContentWindow[] } {
  const cells = source.slice(), [sx, sy, sz] = policy.size;
  const wall = new Set(policy.shaping.wall), roof = new Set(policy.shaping.roof);
  const index = (x: number, y: number, z: number) => cellIndex(x, y, z, sx, sy);
  const inside = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  const at = (x: number, y: number, z: number) => inside(x, y, z) ? source[index(x, y, z)]! : 0;
  const add = (x: number, y: number, z: number, material: number) => {
    if ([x, y, z].some((n, i) => n < policy.editableFrom[i]! || n >= policy.editableTo[i]!)) return;
    const i = index(x, y, z);
    if (!source[i] && !cells[i]) cells[i] = material;
  };
  for (let z = policy.editableFrom[2]; z < policy.editableTo[2]; z++) for (let y = 0; y < policy.editableTo[1]; y++) for (let x = policy.editableFrom[0]; x < policy.editableTo[0]; x++) {
    const i = index(x, y, z), material = source[i]!;
    if (!material) continue;
    const west = !at(x - 1, y, z), east = !at(x + 1, y, z), north = !at(x, y, z - 1), south = !at(x, y, z + 1);
    if (wall.has(material)) {
      // Corner posts and a low stone plinth read as structure even on a one-cell brush stroke.
      if ((west || east) && (north || south)) cells[i] = policy.shaping.trim;
      else if (y < 2 && (west || east || north || south)) cells[i] = policy.shaping.stone;
      // A lintel over a gap receives shallow stepped haunches next to its supporting pier.
      // Never generate a door leaf or fill the middle of an opening.
      if (y >= 10 && !at(x, y - 1, z)) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (wall.has(at(x + dx!, y - 1, z + dz!)) && wall.has(at(x + dx!, y - 2, z + dz!))) {
            cells[i] = policy.shaping.stone;
            add(x, y - 1, z, policy.shaping.stone);
          }
        }
      }
    }
    // A single-cell fascia follows only the lowest exposed roof edge, not every stair in the slope.
    if (roof.has(material) && !roof.has(at(x, y - 1, z))) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!at(x + dx!, y, z + dz!) && !at(x + dx!, y + 1, z + dz!)) add(x + dx!, y, z + dz!, policy.shaping.trim);
      }
    }
  }

  const windows = discoverWindows(source, policy);
  for (const pane of windows) {
    const horizontalX = pane.facing === 'north' || pane.facing === 'south';
    const [cx, cy, cz] = pane.centre, halfW = pane.width / 2, halfH = pane.height / 2;
    // Stone sill projects one voxel; timber framing stays in the authored surrounding wall.
    const positive = pane.facing === 'south' || pane.facing === 'east';
    const exterior = (horizontalX ? cz : cx) - (positive ? 0 : 1);
    const facade = (horizontalX ? cz : cx) - (positive ? 1 : 0);
    for (let u = -halfW - 1; u <= halfW; u++) {
      const x = horizontalX ? cx + u : exterior, z = horizontalX ? exterior : cz + u;
      const supportX = horizontalX ? x : facade, supportZ = horizontalX ? facade : z;
      if (at(supportX, cy - halfH - 1, supportZ)) add(x, cy - halfH - 1, z, policy.shaping.stone);
    }
    for (let v = -halfH; v < halfH; v++) for (const u of [-halfW - 1, halfW]) {
      const x = horizontalX ? cx + u : facade, z = horizontalX ? facade : cz + u, y = cy + v;
      if (inside(x, y, z) && wall.has(at(x, y, z))) cells[index(x, y, z)] = policy.shaping.trim;
    }
  }
  return { cells, windows };
}

/** Glass is source data, so window anchors survive imports, reloads, paint and undo without stale sidecars. */
function discoverWindows(source: Uint16Array, policy: BuildDraftPolicy): ContentWindow[] {
  const [sx, sy] = policy.size, seen = new Uint8Array(source.length), windows: ContentWindow[] = [];
  const point = (i: number): [number, number, number] => [i % sx, Math.floor(i / sx) % sy, Math.floor(i / (sx * sy))];
  for (let start = 0; start < source.length; start++) {
    if (source[start] !== policy.shaping.glass || seen[start]) continue;
    const queue = [start], min = point(start), max = point(start); seen[start] = 1;
    for (let q = 0; q < queue.length; q++) {
      const [x, y, z] = point(queue[q]!);
      for (const p of [[x - 1, y, z], [x + 1, y, z], [x, y - 1, z], [x, y + 1, z], [x, y, z - 1], [x, y, z + 1]]) {
        if (p.some((n, d) => n < 0 || n >= policy.size[d]!)) continue;
        const i = cellIndex(p[0]!, p[1]!, p[2]!, sx, sy);
        if (seen[i] || source[i] !== policy.shaping.glass) continue;
        seen[i] = 1; queue.push(i);
        for (let d = 0; d < 3; d++) { min[d] = Math.min(min[d]!, p[d]!); max[d] = Math.max(max[d]!, p[d]!); }
      }
    }
    const horizontalX = max[0] - min[0] >= max[2] - min[2], axis = horizontalX ? 0 : 2, normal = horizontalX ? 2 : 0;
    const width = Math.floor((max[axis] - min[axis] + 1) / 2) * 2;
    const height = Math.floor((max[1] - min[1] + 1) / 2) * 2;
    if (width < 2 || height < 2) continue;
    const positive = policy.editableTo[normal] - max[normal] <= min[normal] - policy.editableFrom[normal];
    const centre: [number, number, number] = [min[0], min[1] + height / 2, min[2]];
    centre[axis] = min[axis] + width / 2; centre[normal] = positive ? max[normal] + 1 : min[normal];
    windows.push({ id: `pane:${start}`, centre, width, height,
      facing: horizontalX ? (positive ? 'south' : 'north') : (positive ? 'east' : 'west') });
    if (windows.length > 64) throw new BuildError('complexity', 'Keep this house to sixty-four window panes.');
  }
  // +Z is the street: the citizen's first presence light should face their neighbours when possible.
  return windows.sort((a, b) => Number(b.facing === 'south') - Number(a.facing === 'south') || b.centre[2] - a.centre[2]);
}

/** Greedy boxes in XYZ, not one box per cell. Material zero is implicit in this final asset. */
export function blueprintFromCells(cells: Uint16Array, policy: BuildDraftPolicy, windows: ContentWindow[] = []): VoxelBlueprint {
  const [sx, sy, sz] = policy.size, used = new Uint8Array(cells.length), boxes: VoxelBlueprint['boxes'] = [];
  const index = (x: number, y: number, z: number) => cellIndex(x, y, z, sx, sy);
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const at = index(x, y, z), material = cells[at]!;
    if (!material || used[at]) continue;
    let ex = x + 1, ey = y + 1, ez = z + 1;
    const matches = (px: number, py: number, pz: number) => { const i = index(px, py, pz); return !used[i] && cells[i] === material; };
    while (ex < sx && matches(ex, y, z)) ex++;
    const row = (py: number, pz: number) => { for (let px = x; px < ex; px++) if (!matches(px, py, pz)) return false; return true; };
    while (ey < sy && row(ey, z)) ey++;
    const plane = (pz: number) => { for (let py = y; py < ey; py++) if (!row(py, pz)) return false; return true; };
    while (ez < sz && plane(ez)) ez++;
    for (let pz = z; pz < ez; pz++) for (let py = y; py < ey; py++) used.fill(1, index(x, py, pz), index(ex - 1, py, pz) + 1);
    boxes.push({ from: [x, y, z], to: [ex, ey, ez], material });
    if (boxes.length > 20000) throw new BuildError('complexity', 'This house has too many separate details to publish. Join some blocks together.');
  }
  return { version: 1, id: `build:${policy.plotId}`, styleId: policy.styleId, kind: 'home', lattice: 'build', size: [...policy.size], boxes, windows };
}

/** Only publication needs a complete structure; a private draft may contain unfinished floating work. */
export function assertBuildGrounded(cells: Uint16Array, size: Vec3): void {
  const [sx, sy, sz] = size, seen = new Uint8Array(cells.length), queue: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const i = cellIndex(x, 0, z, sx, sy); if (cells[i]) { seen[i] = 1; queue.push(i); }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const [ni, valid] of [[i - 1, x > 0], [i + 1, x + 1 < sx], [i - sx, y > 0], [i + sx, y + 1 < sy], [i - sx * sy, z > 0], [i + sx * sy, z + 1 < sz]] as [number, boolean][]) {
      if (valid && cells[ni] && !seen[ni]) { seen[ni] = 1; queue.push(ni); }
    }
  }
  let occupied = 0;
  for (const cell of cells) if (cell) occupied++;
  if (!occupied) throw new BuildError('support', 'Place a few blocks before welcoming the street.');
  if (queue.length !== occupied) throw new BuildError('support', 'Connect every part of your home to the ground or another wall.');
}
