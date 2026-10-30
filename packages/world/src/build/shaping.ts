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
      else if ((west || east || north || south)
        && (y === 3 || roof.has(at(x, y + 1, z)) || roof.has(at(x, y + 2, z)))) cells[i] = policy.shaping.trim;
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

  shapeRoofCaps(source, cells, policy);
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

/**
 * A flat roof-material cap on four walls is a roof footprint, not the finished silhouette. Only complete,
 * thin rectangular components qualify: stepped roofs, air holes, connected wings and sculptures keep their shape.
 * The cap stays as the ceiling. All extra volume is a hollow shell inside the same unlocked plot; it never
 * enters source/history or changes the citizen's block allowance. See work/references/build-shaping.md.
 */
function shapeRoofCaps(source: Uint16Array, cells: Uint16Array, policy: BuildDraftPolicy): void {
  const [sx, sy, sz] = policy.size, roof = new Set(policy.shaping.roof), wall = new Set(policy.shaping.wall);
  const structural = new Set([...wall, policy.shaping.trim, policy.shaping.stone]);
  const seen = new Uint8Array(source.length);
  const index = (x: number, y: number, z: number) => cellIndex(x, y, z, sx, sy);
  const at = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz
    ? source[index(x, y, z)]! : 0;
  const put = (x: number, y: number, z: number, material: number) => {
    if (x < policy.editableFrom[0] || x >= policy.editableTo[0]
      || y < policy.editableFrom[1] || y >= policy.editableTo[1]
      || z < policy.editableFrom[2] || z >= policy.editableTo[2]) return;
    const i = index(x, y, z);
    if (!source[i]) cells[i] = material;
  };
  for (let start = 0; start < source.length; start++) {
    if (seen[start] || !roof.has(source[start]!)) continue;
    const queue = [start]; seen[start] = 1;
    let x0 = sx, x1 = 0, y0 = sy, y1 = 0, z0 = sz, z1 = 0;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
      x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1);
      y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z + 1);
      for (const [ni, valid] of [[i - 1, x > 0], [i + 1, x + 1 < sx], [i - sx, y > 0],
        [i + sx, y + 1 < sy], [i - sx * sy, z > 0], [i + sx * sy, z + 1 < sz]] as [number, boolean][]) {
        if (valid && !seen[ni] && roof.has(source[ni]!)) { seen[ni] = 1; queue.push(ni); }
      }
    }
    if (y1 - y0 > 4 || y0 < policy.editableFrom[1] + 4 || x1 - x0 < 6 || z1 - z0 < 6) continue;
    let chimneyX0 = x1, chimneyX1 = x0, chimneyZ0 = z1, chimneyZ1 = z0;
    const chimney = (x: number, y: number, z: number) => {
      const material = at(x, y, z);
      if ((material !== policy.shaping.stone && material !== policy.shaping.trim)
        || at(x, y1, z) !== material || at(x, y1 + 3, z) !== material || !at(x, y1 - 1, z)) return false;
      chimneyX0 = Math.min(chimneyX0, x); chimneyX1 = Math.max(chimneyX1, x + 1);
      chimneyZ0 = Math.min(chimneyZ0, z); chimneyZ1 = Math.max(chimneyZ1, z + 1);
      return true;
    };
    let complete = true;
    for (let z = z0; z < z1 && complete; z++) for (let x = x0; x < x1 && complete; x++) {
      for (let y = y0; y < y1; y++) if (!roof.has(at(x, y, z)) && !chimney(x, y, z)) { complete = false; break; }
    }
    if (!complete) continue;

    // Find the real wall rectangle under the cap, allowing an authored eave overhang and a doorway-sized
    // break in a wall head. Four substantial walls distinguish a room from a plate on a pole or sculpture.
    let wx0 = x1, wx1 = x0, wz0 = z1, wz1 = z0, plaster = 0;
    for (let z = z0; z < z1; z++) for (let x = x0; x < x1; x++) {
      const m = at(x, y0 - 1, z);
      if (!structural.has(m)) continue;
      wx0 = Math.min(wx0, x); wx1 = Math.max(wx1, x + 1);
      wz0 = Math.min(wz0, z); wz1 = Math.max(wz1, z + 1);
      if (wall.has(m)) plaster ||= m;
    }
    if (!plaster || wx1 - wx0 < 6 || wz1 - wz0 < 6) continue;
    const supported = (axis: 'x' | 'z', normal: number, lo: number, hi: number) => {
      let head = 0, lower = 0;
      for (let u = lo; u < hi; u++) {
        const x = axis === 'x' ? u : normal, z = axis === 'x' ? normal : u;
        if (structural.has(at(x, y0 - 1, z))) head++;
        if (structural.has(at(x, y0 - 4, z))) lower++;
      }
      return head >= (hi - lo) * .75 && lower >= (hi - lo) * .6;
    };
    if (!supported('x', wz0, wx0, wx1) || !supported('x', wz1 - 1, wx0, wx1)
      || !supported('z', wx0, wz0, wz1) || !supported('z', wx1 - 1, wz0, wz1)) continue;

    // Two-cell eaves are .25 m; an existing wider overhang is the citizen's shape and stays wider.
    const ex0 = Math.max(policy.editableFrom[0], Math.min(x0, wx0 - 2));
    const ex1 = Math.min(policy.editableTo[0], Math.max(x1, wx1 + 2));
    const ez0 = Math.max(policy.editableFrom[2], Math.min(z0, wz0 - 2));
    const ez1 = Math.min(policy.editableTo[2], Math.max(z1, wz1 + 2));
    const ridgeZ = z1 - z0 >= x1 - x0;
    const a0 = ridgeZ ? ex0 : ez0, a1 = ridgeZ ? ex1 : ez1;
    const l0 = ridgeZ ? ez0 : ex0, l1 = ridgeZ ? ez1 : ex1;
    const wa0 = ridgeZ ? wx0 : wz0, wa1 = ridgeZ ? wx1 : wz1;
    const wl0 = ridgeZ ? wz0 : wx0, wl1 = ridgeZ ? wz1 : wx1;
    const half = Math.floor((a1 - a0 - 1) / 2), base = y1 - 1;
    // Slate is steep; clay is a softer gable; thatch rolls into a hip. Compress the pitch as a whole if
    // the earned height is tight, rather than chopping the ridge into a flat platform at the boundary.
    const pitch = policy.styleId === 'tide' ? 1.5 : policy.styleId === 'grove' ? 1 : 1.25;
    const rise = Math.min(Math.ceil(half * pitch), policy.editableTo[1] - 1 - base);
    if (rise < 3) continue;
    const hip = policy.styleId === 'grove';
    const level = (a: number, l: number) => {
      let inset = Math.min(a - a0, a1 - 1 - a);
      if (hip) inset = Math.min(inset, l - l0, l1 - 1 - l);
      return base + Math.round(rise * inset / half);
    };
    const point = (a: number, y: number, l: number): [number, number, number] => ridgeZ ? [a, y, l] : [l, y, a];
    let obstructed = false;
    for (let l = l0; l < l1 && !obstructed; l++) for (let a = a0; a < a1 && !obstructed; a++) {
      for (let y = y1; y <= level(a, l); y++) {
        const p = point(a, y, l);
        if (at(...p) && !chimney(...p)) { obstructed = true; break; }
      }
    }
    // A compact stone/timber chimney may pierce the roof; broad platforms, towers, glass and other work
    // above it remain deliberate geometry. A chimney cannot turn an arbitrary missing patch into a roof.
    const chimneyLimit = Math.min(8, Math.floor(Math.min(x1 - x0, z1 - z0) / 3));
    if (chimneyX1 - chimneyX0 > chimneyLimit || chimneyZ1 - chimneyZ0 > chimneyLimit) obstructed = true;
    if (obstructed) continue;

    // Two-cell corner posts read at street distance. Recolour only authored plaster on the facade, so a
    // window or carved opening is never covered and the citizen still owns every wall's outline.
    for (let y = policy.editableFrom[1] + 2; y < y0; y++) {
      for (const z of [wz0, wz1 - 1]) for (const x of [wx0, wx0 + 1, wx1 - 2, wx1 - 1]) {
        if (wall.has(at(x, y, z))) cells[index(x, y, z)] = policy.shaping.trim;
      }
      for (const x of [wx0, wx1 - 1]) for (const z of [wz0, wz0 + 1, wz1 - 2, wz1 - 1]) {
        if (wall.has(at(x, y, z))) cells[index(x, y, z)] = policy.shaping.trim;
      }
    }
    for (let l = l0; l < l1; l++) for (let a = a0; a < a1; a++) {
      const top = level(a, l), [x, , z] = point(a, top, l);
      const authored = at(Math.max(x0, Math.min(x1 - 1, x)), y1 - 1, Math.max(z0, Math.min(z1 - 1, z)));
      const material = roof.has(authored) ? authored : source[start]!;
      // Three-cell courses overlap at the steepest pitch; the attic remains empty above its ceiling.
      const under = Math.max(y0, top - 2);
      if (!hip && a >= wa0 && a < wa1 && (l === wl0 || l === wl1 - 1)) {
        const mid = Math.floor((wa0 + wa1 - 1) / 2);
        for (let y = y1; y < under; y++) put(...point(a, y, l), Math.abs(a - mid) < 1 ? policy.shaping.trim : plaster);
      }
      for (let y = under; y <= top; y++) put(...point(a, y, l), material);
      // Timber verge follows the pitch, with a continuous fascia at each eave, never across a window.
      if (a === a0 || a === a1 - 1 || l === l0 || l === l1 - 1) put(...point(a, under - 1, l), policy.shaping.trim);
    }
  }
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
