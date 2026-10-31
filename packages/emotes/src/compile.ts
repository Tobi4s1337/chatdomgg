import { Sha256Schema, StyleIdSchema, TokenSchema, UIntSchema, VoxelBlueprintSchema, type MaterialRegistry, type VoxelBlueprint } from './deps';
import { buildEmotePalette, colourDistance2, distanceThreshold2, nearestPaletteIndex, type PaletteEntry } from './palette';
import { EMOTE_COMPILED_BUDGET, EMOTE_COMPILER_VERSION, EMOTE_PROFILES, EMOTE_SAMPLING, EMOTE_SOURCE_LIMITS, normalizeFrameDuration, type EmoteProfileBounds } from './profiles';
import { createSha256, sha256Text } from './sha256';
import type { CompiledEmote, DecodedEmote, EmoteCompileFailureCode, EmoteCompileInput, EmoteCompileProfile, EmoteCompileResult, EmoteSource } from './types';

const PROVIDERS = new Set(['twitch', '7tv', 'bttv', 'ffz']);
const RENDITIONS = new Set(['png', 'gif', 'webp']);
const PURPOSES = new Set(Object.keys(EMOTE_PROFILES));
const EMOTE_STYLE = StyleIdSchema.parse('emote');

type Failure = Extract<EmoteCompileResult, { ok: false }>;
const fail = (code: EmoteCompileFailureCode, message: string): Failure => ({ ok: false, code, message });

function checkSource(source: EmoteSource): Failure | null {
  if (!source || typeof source !== 'object') return fail('invalid-source', 'The emote source is missing.');
  if (!TokenSchema.safeParse(source.id).success) return fail('invalid-source', 'The emote ID is not a safe token.');
  if (!PROVIDERS.has(source.provider)) return fail('invalid-source', 'The emote provider is unknown.');
  if (source.origin !== 'live' && source.origin !== 'simulated') return fail('invalid-source', 'The emote origin must be live or simulated.');
  if (!Sha256Schema.safeParse(source.sourceHash).success) return fail('invalid-source', 'The source hash must be a SHA-256 of the fetched bytes.');
  if (!RENDITIONS.has(source.rendition)) return fail('invalid-source', 'The rendition must be PNG, GIF or WebP.');
  return null;
}

/** Checks dimensions before touching pixels, so a lying decoder cannot make the compiler allocate. */
function checkDecoded(decoded: DecodedEmote): Failure | null {
  if (!decoded || typeof decoded !== 'object' || !Array.isArray(decoded.frames)) return fail('invalid-source', 'The decoded emote has no frames.');
  const { width, height, frames } = decoded;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return fail('invalid-source', 'The decoded canvas has no size.');
  if (width > EMOTE_SOURCE_LIMITS.canvas || height > EMOTE_SOURCE_LIMITS.canvas) return fail('over-budget', `The canvas is larger than ${EMOTE_SOURCE_LIMITS.canvas}×${EMOTE_SOURCE_LIMITS.canvas}.`);
  if (frames.length < 1) return fail('invalid-source', 'The decoded emote has no frames.');
  if (frames.length > EMOTE_SOURCE_LIMITS.frames) return fail('over-budget', `The animation has more than ${EMOTE_SOURCE_LIMITS.frames} frames.`);
  if (width * height * 4 * frames.length > EMOTE_SOURCE_LIMITS.coalescedBytes) return fail('over-budget', 'The coalesced animation is larger than 32 MiB.');
  let playback = 0;
  for (const frame of frames) {
    if (!(frame?.rgba instanceof Uint8Array) || frame.rgba.length !== width * height * 4) return fail('invalid-source', 'A frame does not cover the whole canvas.');
    if (frames.length > 1) playback += normalizeFrameDuration(frame.durationMs);
  }
  if (playback > EMOTE_SOURCE_LIMITS.playbackMs) return fail('over-budget', 'The animation plays for longer than 30 seconds.');
  return null;
}

function checkProfile(profile: EmoteCompileProfile): { bounds: EmoteProfileBounds; depth: number; height: number } | Failure {
  if (!profile || !PURPOSES.has(profile.purpose)) return fail('invalid-profile', 'Choose statue, heraldry, motif or effect.');
  const bounds = EMOTE_PROFILES[profile.purpose];
  const depth = profile.depthCells ?? bounds.defaultDepth, height = profile.targetHeightCells ?? bounds.defaultHeight;
  if (!Number.isInteger(depth) || depth < bounds.depth[0] || depth > bounds.depth[1]) return fail('invalid-profile', `A ${profile.purpose} is ${bounds.depth[0]}–${bounds.depth[1]} cells deep.`);
  if (!Number.isInteger(height) || height < bounds.height[0] || height > bounds.height[1]) return fail('invalid-profile', `A ${profile.purpose} stands ${bounds.height[0]}–${bounds.height[1]} cells tall.`);
  if (!UIntSchema.safeParse(profile.paletteRevision).success) return fail('invalid-profile', 'The palette revision must be a whole number.');
  return { bounds, depth, height };
}

/** Union of every frame's visible pixels: one crop, so every frame shares the same origin. */
function unionCrop(decoded: DecodedEmote): [number, number, number, number] | null {
  let minX = decoded.width, minY = decoded.height, maxX = -1, maxY = -1;
  for (const { rgba } of decoded.frames) {
    for (let y = 0; y < decoded.height; y++) for (let x = 0; x < decoded.width; x++) {
      if (rgba[(x + y * decoded.width) * 4 + 3]! <= EMOTE_SAMPLING.cropAlpha) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

const PAIRS = [[-1, 0, 1, 0], [0, -1, 0, 1], [-1, -1, 1, 1], [1, -1, -1, 1]] as const;
const BLEND_CONTRAST = distanceThreshold2(EMOTE_SAMPLING.blendContrast);

/**
 * Anti-aliasing leaves in-between pixels where an outline meets a fill. Snapped on their own they
 * become stray materials (a brown fleck between black and cream). A pixel that lies between two
 * strongly different opposite neighbours on any axis is such an interpolant: it still counts for
 * coverage, but its colour vote is damped so the real colours on either side decide the cell.
 */
function blendWeight(rgba: Uint8Array, width: number, crop: readonly [number, number, number, number], px: number, py: number): number {
  const o = (px + py * width) * 4, r = rgba[o]!, g = rgba[o + 1]!, b = rgba[o + 2]!;
  for (const [ax, ay, bx, by] of PAIRS) {
    const x1 = px + ax, y1 = py + ay, x2 = px + bx, y2 = py + by;
    if (x1 < crop[0] || x2 < crop[0] || y1 < crop[1] || y2 < crop[1] || x1 >= crop[0] + crop[2] || x2 >= crop[0] + crop[2] || y1 >= crop[1] + crop[3] || y2 >= crop[1] + crop[3]) continue;
    const p = (x1 + y1 * width) * 4, q = (x2 + y2 * width) * 4;
    if (rgba[p + 3]! < 128 || rgba[q + 3]! < 128) continue;
    const pr = rgba[p]!, pg = rgba[p + 1]!, pb = rgba[p + 2]!, qr = rgba[q]!, qg = rgba[q + 1]!, qb = rgba[q + 2]!;
    if (colourDistance2(pr, pg, pb, qr, qg, qb) < BLEND_CONTRAST) continue;
    const between = (v: number, m: number, n: number): boolean => v >= Math.min(m, n) - 6 && v <= Math.max(m, n) + 6;
    if (!between(r, pr, qr) || !between(g, pg, qg) || !between(b, pb, qb)) continue;
    const quarter = BLEND_CONTRAST / 16;
    if (colourDistance2(r, g, b, pr, pg, pb) > quarter && colourDistance2(r, g, b, qr, qg, qb) > quarter) return .12;
  }
  return 1;
}

interface Grid { width: number; height: number; scale: number; originX: number; originY: number }

/**
 * Area sampling with an alpha vote: each source pixel snaps to its nearest kingdom material, then
 * every cell takes the material with the most alpha-weighted area. Occupancy is alpha coverage
 * alone, so opaque black is a solid outline and transparent black is air. Choosing a palette
 * colour that is really present, instead of averaging outline into fill, keeps eyes and outlines
 * crisp and avoids inventing in-between materials. Rows are returned top-down, as in the source.
 */
function sampleFrame(rgba: Uint8Array, sourceWidth: number, crop: readonly [number, number, number, number], grid: Grid,
  palette: readonly PaletteEntry[], cache: Map<number, number>, votes: Float64Array, coverage: Float64Array): Uint8Array {
  const cells = grid.width * grid.height, colours = palette.length;
  votes.fill(0, 0, cells * colours); coverage.fill(0, 0, cells);
  const [cropX, cropY, cropW, cropH] = crop;
  for (let py = cropY; py < cropY + cropH; py++) {
    const y0 = (py - grid.originY) * grid.scale, y1 = y0 + grid.scale;
    if (y1 <= 0 || y0 >= grid.height) continue;
    for (let px = cropX; px < cropX + cropW; px++) {
      const offset = (px + py * sourceWidth) * 4, alpha = rgba[offset + 3]!;
      if (alpha === 0) continue;
      const x0 = (px - grid.originX) * grid.scale, x1 = x0 + grid.scale;
      if (x1 <= 0 || x0 >= grid.width) continue;
      const key = rgba[offset]! << 16 | rgba[offset + 1]! << 8 | rgba[offset + 2]!;
      let colour = cache.get(key);
      if (colour === undefined) {
        if (cache.size >= 65_536) cache.clear();
        colour = nearestPaletteIndex(palette, rgba[offset]!, rgba[offset + 1]!, rgba[offset + 2]!);
        cache.set(key, colour);
      }
      const a = alpha / 255, vote = blendWeight(rgba, sourceWidth, crop, px, py);
      for (let cy = Math.max(0, Math.floor(y0)); cy < Math.min(grid.height, Math.ceil(y1)); cy++) {
        const wy = Math.min(y1, cy + 1) - Math.max(y0, cy);
        for (let cx = Math.max(0, Math.floor(x0)); cx < Math.min(grid.width, Math.ceil(x1)); cx++) {
          const weight = a * wy * (Math.min(x1, cx + 1) - Math.max(x0, cx)), cell = cx + cy * grid.width;
          coverage[cell] = coverage[cell]! + weight;
          votes[cell * colours + colour] = votes[cell * colours + colour]! + weight * vote;
        }
      }
    }
  }
  const out = new Uint8Array(cells);
  for (let cell = 0; cell < cells; cell++) {
    if (coverage[cell]! < EMOTE_SAMPLING.occupancy) continue;
    let best = 0;
    for (let c = 1; c < colours; c++) if (votes[cell * colours + c]! > votes[cell * colours + best]!) best = c;
    out[cell] = best + 1;
  }
  return out;
}

/**
 * A lone cell surrounded by a near colour is a snapping artefact; so is a lone cell of a rare
 * material that is only moderately different from its surroundings (an anti-aliasing fleck that
 * snapped to a third colour). Both take their surroundings' material. A lone cell that contrasts
 * strongly with its surroundings (a pupil, a stud, a highlight) is a feature and always stays,
 * however rarely its material appears. Reads the input only.
 */
function cleanSpeckle(cells: Uint8Array, width: number, height: number, palette: readonly PaletteEntry[]): { cells: Uint8Array; cleaned: number } {
  const out = cells.slice(), counts = new Uint8Array(palette.length + 1);
  const near = distanceThreshold2(EMOTE_SAMPLING.speckleDistance), fleck = distanceThreshold2(EMOTE_SAMPLING.fleckDistance);
  const usage = new Uint32Array(palette.length + 1);
  for (const cell of cells) usage[cell]!++;
  const at = (x: number, y: number): number => x < 0 || y < 0 || x >= width || y >= height ? 0 : cells[x + y * width]!;
  let cleaned = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const own = cells[x + y * width]!;
    if (!own || at(x - 1, y) === own || at(x + 1, y) === own || at(x, y - 1) === own || at(x, y + 1) === own) continue;
    counts.fill(0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) counts[at(x + dx, y + dy)]!++;
    let major = 1;
    for (let c = 2; c < counts.length; c++) if (counts[c]! > counts[major]!) major = c;
    const rare = usage[own]! <= EMOTE_SAMPLING.rareCells;
    if (counts[major]! < (rare ? 3 : 5)) continue;
    const a = palette[own - 1]!, b = palette[major - 1]!;
    if (colourDistance2(a.r, a.g, a.b, b.r, b.g, b.b) > (rare ? fleck : near)) continue;
    out[x + y * width] = major;
    cleaned++;
  }
  return { cells: out, cleaned };
}

/**
 * Extrudes a top-down palette grid into an x-contiguous, Y-up voxel volume. +Z is the front face,
 * so a viewer in front sees the source the right way round. With room for it (three cells or more),
 * silhouette cells, including the rims of holes, lose their front and back layer: a one-cell bevel
 * that softens the contour without changing the outline seen from the front.
 */
function extrude(cells: Uint8Array, width: number, height: number, depth: number, palette: readonly PaletteEntry[]): Uint16Array {
  const voxels = new Uint16Array(width * height * depth);
  const solid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height && cells[x + y * width]! > 0;
  for (let row = 0; row < height; row++) for (let x = 0; x < width; x++) {
    const colour = cells[x + row * width]!;
    if (!colour) continue;
    const edge = !solid(x - 1, row) || !solid(x + 1, row) || !solid(x, row - 1) || !solid(x, row + 1);
    const bevel = depth >= 3 && edge ? 1 : 0, material = palette[colour - 1]!.id, y = height - 1 - row;
    for (let z = bevel; z < depth - bevel; z++) voxels[x + width * (y + height * z)] = material;
  }
  return voxels;
}

/** Deterministic greedy boxes: grow along x, then z, then y, over uniform unvisited material. */
function greedyBoxes(voxels: Uint16Array, size: readonly [number, number, number]): VoxelBlueprint['boxes'] {
  const [sx, sy, sz] = size, visited = new Uint8Array(voxels.length), boxes: VoxelBlueprint['boxes'] = [];
  const index = (x: number, y: number, z: number): number => x + sx * (y + sy * z);
  const free = (x: number, y: number, z: number, material: number): boolean => !visited[index(x, y, z)] && voxels[index(x, y, z)] === material;
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    const material = voxels[index(x, y, z)]!;
    if (!material || visited[index(x, y, z)]) continue;
    let dx = 1, dz = 1, dy = 1;
    while (x + dx < sx && free(x + dx, y, z, material)) dx++;
    grow: while (z + dz < sz) {
      for (let i = 0; i < dx; i++) if (!free(x + i, y, z + dz, material)) break grow;
      dz++;
    }
    grow: while (y + dy < sy) {
      for (let k = 0; k < dz; k++) for (let i = 0; i < dx; i++) if (!free(x + i, y + dy, z + k, material)) break grow;
      dy++;
    }
    for (let j = 0; j < dy; j++) for (let k = 0; k < dz; k++) visited.fill(1, index(x, y + j, z + k), index(x + dx, y + j, z + k));
    boxes.push({ from: [x, y, z], to: [x + dx, y + dy, z + dz], material });
  }
  return boxes;
}

function littleEndian16(values: Uint16Array): Uint8Array {
  const bytes = new Uint8Array(values.length * 2);
  for (let i = 0; i < values.length; i++) { bytes[i * 2] = values[i]! & 255; bytes[i * 2 + 1] = values[i]! >> 8; }
  return bytes;
}

/**
 * Compiles one decoded emote for one purpose in one kingdom palette. Pure and deterministic: the
 * same bytes, palette, profile and compiler always give the same geometry hash and revision.
 * Failures are typed results, never thrown, so review and UI code can show an honest state.
 */
export function compileEmote(input: EmoteCompileInput, registry: MaterialRegistry, allowedMaterialIds: readonly number[], profile: EmoteCompileProfile): EmoteCompileResult {
  const sourceFailure = checkSource(input?.source) ?? checkDecoded(input?.decoded);
  if (sourceFailure) return sourceFailure;
  const checked = checkProfile(profile);
  if ('ok' in checked) return checked;
  const paletteResult = buildEmotePalette(registry, allowedMaterialIds);
  if (!paletteResult.ok) return fail('invalid-palette', paletteResult.message);
  const { source, decoded } = input, palette = paletteResult.entries, { bounds, depth } = checked;
  const crop = unionCrop(decoded);
  if (!crop) return fail('empty', 'Every pixel of the emote is transparent.');
  const [, , cropW, cropH] = crop;

  const cache = new Map<number, number>();
  const maxCells = bounds.maxWidth * (bounds.height[1] + 1);
  const votes = new Float64Array(maxCells * palette.length), coverage = new Float64Array(maxCells);
  let wanted = checked.height, grids: Uint8Array[] = [], grid: Grid | undefined, trimmed = { x: 0, y: 0, width: 0, height: 0 };
  // Thin anti-aliased rims can fall under half coverage; ask again so the occupied height is the target.
  for (let attempt = 0; attempt < 3; attempt++) {
    wanted = Math.min(wanted, bounds.height[1] + 1);
    let scale = wanted / cropH, height = wanted, width = Math.max(1, Math.round(cropW * scale));
    if (width > bounds.maxWidth) { width = bounds.maxWidth; scale = width / cropW; height = Math.max(1, Math.min(wanted, Math.round(cropH * scale))); }
    grid = { width, height, scale, originX: crop[0] + (cropW - width / scale) / 2, originY: crop[1] + (cropH - height / scale) / 2 };
    const current = grid;
    grids = decoded.frames.map(frame => sampleFrame(frame.rgba, decoded.width, crop, current, palette, cache, votes, coverage));
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (const cells of grids) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (cells[x + y * width]) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (maxX < 0) return fail('empty', 'The emote is too faint to occupy a single cell.');
    trimmed = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    if (trimmed.height >= checked.height || width >= bounds.maxWidth || height > bounds.height[1]) break;
    wanted += checked.height - trimmed.height;
  }
  if (trimmed.height < bounds.height[0] || trimmed.height > bounds.height[1]) return fail('unsupported-aspect', `At most ${bounds.maxWidth} cells wide, this emote would stand ${trimmed.height} cells; a ${profile.purpose} needs ${bounds.height[0]}–${bounds.height[1]}.`);
  if (trimmed.width > bounds.maxWidth) return fail('unsupported-aspect', `The emote is wider than a ${profile.purpose} allows.`);

  const size: [number, number, number] = [trimmed.width, trimmed.height, depth];
  const hash = createSha256();
  hash.update(new TextEncoder().encode(`${EMOTE_COMPILER_VERSION}|${size.join('x')}|${grids.length}|`));
  const volumes: { voxels: Uint16Array; durationMs: number }[] = [];
  let speckleCleaned = 0, occupiedCells = 0, boxCount = 0;
  const used = new Set<number>();
  const frames: CompiledEmote['frames'][number][] = [];
  for (const [index, full] of grids.entries()) {
    const cells = new Uint8Array(size[0] * size[1]);
    for (let y = 0; y < size[1]; y++) cells.set(full.subarray(trimmed.x + (trimmed.y + y) * grid!.width, trimmed.x + (trimmed.y + y) * grid!.width + size[0]), y * size[0]);
    const clean = cleanSpeckle(cells, size[0], size[1], palette);
    speckleCleaned += clean.cleaned;
    const voxels = extrude(clean.cells, size[0], size[1], depth, palette);
    const durationMs = grids.length > 1 ? normalizeFrameDuration(decoded.frames[index]!.durationMs) : 0;
    const boxes = greedyBoxes(voxels, size);
    for (const value of voxels) if (value) { occupiedCells++; used.add(value); }
    boxCount += boxes.length;
    if (boxes.length > bounds.maxBoxesPerFrame) return fail('over-budget', `Frame ${index + 1} needs ${boxes.length} boxes; a ${profile.purpose} frame may use ${bounds.maxBoxesPerFrame}.`);
    if (boxCount > EMOTE_COMPILED_BUDGET.maxBoxes || boxCount * 14 > EMOTE_COMPILED_BUDGET.maxStoredBytes || occupiedCells > EMOTE_COMPILED_BUDGET.maxOccupiedCells) return fail('over-budget', 'The compiled animation is larger than the stored geometry budget.');
    volumes.push({ voxels, durationMs });
    hash.update(new Uint8Array([durationMs & 255, durationMs >> 8 & 255, durationMs >> 16 & 255, durationMs >>> 24]));
    hash.update(littleEndian16(voxels));
    frames.push({ blueprint: { version: 1, id: 'pending', styleId: EMOTE_STYLE, kind: bounds.kind, lattice: 'build', size, boxes, windows: [] }, durationMs });
  }
  const geometryHash = hash.hex();
  const occupiedHeight = size[1];
  const revision = `${profile.purpose}.${sha256Text([source.sourceHash, EMOTE_COMPILER_VERSION, profile.paletteRevision, profile.purpose, occupiedHeight, depth, geometryHash].join('|')).slice(0, 24)}`;
  for (const [index, frame] of frames.entries()) {
    const parsed = VoxelBlueprintSchema.safeParse({ ...frame.blueprint, id: `emote.${revision}.f${index}` });
    if (!parsed.success) return fail('over-budget', `Frame ${index + 1} is not a valid build blueprint.`);
    frame.blueprint = parsed.data;
  }
  // The mask is the first frame's front face, x contiguous and Y up.
  const first = volumes[0]!.voxels, maskIds = new Uint16Array(size[0] * size[1]);
  for (let y = 0; y < size[1]; y++) for (let x = 0; x < size[0]; x++) {
    let material = 0;
    for (let z = depth - 1; z >= 0 && !material; z--) material = first[x + size[0] * (y + size[1] * z)]!;
    maskIds[x + size[0] * y] = material;
  }
  const emote: CompiledEmote = {
    id: source.id, revision, origin: source.origin, purpose: profile.purpose, sourceHash: source.sourceHash, geometryHash,
    compilerVersion: EMOTE_COMPILER_VERSION, paletteRevision: profile.paletteRevision, targetHeightCells: occupiedHeight,
    frames, periodMs: volumes.reduce((sum, volume) => sum + volume.durationMs, 0),
    mask: { width: size[0], height: size[1], materialIds: maskIds },
  };
  return { ok: true, emote, stats: { size, crop, cellsPerSourcePixel: grid!.scale, occupiedCells, boxes: boxCount, materials: [...used].sort((a, b) => a - b), speckleCleaned } };
}
