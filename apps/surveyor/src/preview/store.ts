import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { compareIds, sha256 } from '../export/project';
import { buildPreview, type PreviewFiles, type PreviewInput } from './build';
import { insideLand, ringBox } from './land';
import { isGamblingCategory } from '../policy/visibility';
import {
  PreviewChunkSchema, PreviewIdSchema, PreviewManifestSchema, PreviewNamesSchema, PreviewWorldSchema, TIER_CODES,
  type PreviewManifest, type PreviewNames, type PreviewWorld, type SettlerColumns,
} from './schema';

/**
 * previews/<id>/  manifest.json · world.json · region-<n>.json · names.json — immutable once renamed into place.
 * A preview belongs to one observation revision and is removed with it, because names.json carries display names.
 */
export const PREVIEW_MANIFEST = 'manifest.json';

export function previewsRoot(dataDir: string): string {
  return join(dataDir, 'previews');
}

export function previewDir(dataDir: string, id: string): string {
  return join(previewsRoot(dataDir), PreviewIdSchema.parse(id));
}

function writeDurable(path: string, bytes: Uint8Array): void {
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDir(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readPreviewManifest(dataDir: string, id: string): PreviewManifest {
  return PreviewManifestSchema.parse(JSON.parse(readFileSync(join(previewDir(dataDir, id), PREVIEW_MANIFEST), 'utf8')));
}

/** The preview's raw names, checked against the hash its manifest pinned. */
export function readPreviewNames(dataDir: string, id: string): PreviewNames {
  const manifest = readPreviewManifest(dataDir, id);
  const bytes = readFileSync(join(previewDir(dataDir, id), manifest.names.path));
  if (bytes.byteLength !== manifest.names.bytes || sha256(bytes) !== manifest.names.sha256) throw new Error('names.json does not match its manifest hash.');
  const names = PreviewNamesSchema.parse(JSON.parse(bytes.toString('utf8')));
  if (names.preview !== id || names.revision !== manifest.revision) throw new Error('names.json belongs to another preview.');
  return names;
}

const decodeRing = (points: readonly number[], scale: number) => {
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (let p = 0; p < points.length; p += 2) {
    x += points[p]!;
    y += points[p + 1]!;
    out.push(x / scale, y / scale);
  }
  return out;
};

/**
 * Verifies a preview folder completely: hashes and lengths, strict shapes, the label, every mapped channel drawn
 * exactly once on dry land at its tier, and no two holdings overlapping. Returns a bounded list of problems.
 */
export function verifyPreviewDir(dir: string, expected?: { id: string; revision: string }): string[] {
  const problems: string[] = [];
  const add = (problem: string) => {
    if (problems.length < 20) problems.push(problem);
  };
  let manifest: PreviewManifest;
  let world: PreviewWorld;
  try {
    manifest = PreviewManifestSchema.parse(JSON.parse(readFileSync(join(dir, PREVIEW_MANIFEST), 'utf8')));
    const bytes = readFileSync(join(dir, manifest.world.path));
    if (bytes.byteLength !== manifest.world.bytes || sha256(bytes) !== manifest.world.sha256) return ['preview world.json does not match its manifest hash.'];
    world = PreviewWorldSchema.parse(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    return [`preview unreadable: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`];
  }
  if (expected && (manifest.id !== expected.id || manifest.revision !== expected.revision)) add('preview belongs to a different revision.');
  if (world.id !== manifest.id || world.revision !== manifest.revision || world.asOf !== manifest.asOf) add('preview world and manifest disagree.');
  const allowed = new Set([PREVIEW_MANIFEST, 'world.json', manifest.names.path, ...world.regions.map((region) => region.chunk.path)]);
  for (const game of world.games) if (isGamblingCategory(game.gameId)) add(`gambling category ${game.gameId} appears on the map.`);
  for (const name of readdirSync(dir)) if (!allowed.has(name)) add(`unexpected file ${name} in the preview.`);

  const rings = world.coasts.map((coast) => {
    const points = decodeRing(coast.points, world.coordScale);
    return { points, box: ringBox(points) };
  });
  const all: { id: string; tier: number; x: number; y: number; region: number; average: number }[] = [];
  const collect = (columns: SettlerColumns, label: string, tiers: readonly number[], region?: number) => {
    columns.ids.forEach((id, i) => {
      const tier = columns.tier[i]!;
      if (!tiers.includes(tier)) add(`${label}: ${id} has tier ${TIER_CODES[tier]} in the wrong file.`);
      if (region !== undefined && columns.region[i] !== region) add(`${label}: ${id} belongs to another region.`);
      const average = columns.average[i]!;
      const min = world.tiers.minAverage[TIER_CODES[tier]!];
      const next = tier > 0 ? world.tiers.minAverage[TIER_CODES[tier - 1]!] : Infinity;
      // Averages are rounded for display; the tier was assigned from the exact value.
      if (average < Math.floor(min) || average > Math.ceil(next)) add(`${label}: ${id} average ${average} does not fit ${TIER_CODES[tier]}.`);
      all.push({ id, tier, x: columns.x[i]! / world.coordScale, y: columns.y[i]! / world.coordScale, region: columns.region[i]!, average });
    });
  };
  collect(world.head, 'head', [0, 1]);
  for (const region of world.regions) {
    try {
      const bytes = readFileSync(join(dir, region.chunk.path));
      if (bytes.byteLength !== region.chunk.bytes || sha256(bytes) !== region.chunk.sha256) {
        add(`${region.chunk.path} does not match its hash in world.json.`);
        continue;
      }
      const chunk = PreviewChunkSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (chunk.preview !== world.id || chunk.region !== region.index) add(`${region.chunk.path} belongs to another preview or region.`);
      if (chunk.settlers.ids.length !== region.chunk.records) add(`${region.chunk.path} record count differs.`);
      collect(chunk.settlers, region.chunk.path, [2, 3], region.index);
    } catch (error) {
      add(`${region.chunk.path} unreadable: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
    }
  }
  const ids = new Set<string>();
  for (const settler of all) {
    if (ids.has(settler.id)) add(`${settler.id} is drawn twice.`);
    ids.add(settler.id);
  }
  if (all.length !== world.counts.mapped) add(`world counts ${world.counts.mapped} mapped channels but ${all.length} are drawn.`);
  for (const [tier, code] of TIER_CODES.entries()) {
    if (all.filter((s) => s.tier === tier).length !== world.counts[code]) add(`${code} count differs from the drawn holdings.`);
  }

  // Land: holdings on dry land and never overlapping.
  const radius = (tier: number) => world.tiers.holdingRadius[TIER_CODES[tier]!];
  let wet = 0;
  for (const settler of all) if (!insideLand(rings, settler.x, settler.y)) wet++;
  if (wet) add(`${wet} holdings stand in the sea.`);
  const cell = 16;
  const grid = new Map<string, typeof all>();
  for (const settler of all) {
    const key = `${Math.floor(settler.x / cell)},${Math.floor(settler.y / cell)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(settler);
    else grid.set(key, [settler]);
  }
  let overlapping = 0;
  for (const a of all) {
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const b of grid.get(`${gx},${gy}`) ?? []) {
          if (b.id <= a.id) continue;
          // Coordinates are quantised to 1/20 unit; allow that much.
          if (Math.hypot(a.x - b.x, a.y - b.y) < radius(a.tier) + radius(b.tier) - 0.1) overlapping++;
        }
      }
    }
  }
  if (overlapping) add(`${overlapping} pairs of holdings overlap.`);

  // Names: exactly the drawn holdings, in ID order, pinned by the manifest.
  try {
    const bytes = readFileSync(join(dir, manifest.names.path));
    if (bytes.byteLength !== manifest.names.bytes || sha256(bytes) !== manifest.names.sha256) {
      add('names.json does not match its manifest hash.');
    } else {
      const names = PreviewNamesSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (names.preview !== manifest.id || names.revision !== manifest.revision) add('names.json belongs to another preview.');
      const drawn = [...ids].sort(compareIds);
      if (names.ids.length !== drawn.length || names.ids.some((id, i) => id !== drawn[i])) add('names.json does not name exactly the drawn holdings in ID order.');
      if (manifest.names.records !== names.ids.length) add('names.json record count differs.');
    }
  } catch (error) {
    add(`names.json unreadable: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
  }
  return problems;
}

/**
 * Writes a preview into staging, verifies it, then renames it into place. An existing preview is verified, not
 * rewritten, and must be byte-identical to what its revision draws now: a session may have pinned it, so the same
 * preview ID can never come to mean different land.
 */
export function writePreview(dataDir: string, preview: PreviewFiles): 'written' | 'existing' {
  const root = previewsRoot(dataDir);
  mkdirSync(root, { recursive: true });
  const target = previewDir(dataDir, preview.id);
  const expected = { id: preview.id, revision: preview.manifest.revision };
  if (existsSync(target)) {
    const problems = verifyPreviewDir(target, expected);
    if (problems.length === 0) {
      const stored = readPreviewManifest(dataDir, preview.id);
      if (stored.world.sha256 !== preview.manifest.world.sha256 || stored.names.sha256 !== preview.manifest.names.sha256) {
        throw new Error(`Survey preview ${preview.id} is not reproducible: its revision now draws different bytes under the same preview ID.`);
      }
      return 'existing';
    }
    rmSync(target, { recursive: true, force: true });
  }
  const staging = join(dataDir, '.staging-preview');
  rmSync(staging, { recursive: true, force: true });
  const staged = join(staging, `${preview.id}-${process.pid}`);
  mkdirSync(staged, { recursive: true });
  for (const [name, bytes] of preview.files) writeDurable(join(staged, name), bytes);
  writeDurable(join(staged, PREVIEW_MANIFEST), new TextEncoder().encode(`${JSON.stringify(preview.manifest, null, 2)}\n`));
  fsyncDir(staged);
  const problems = verifyPreviewDir(staged, expected);
  if (problems.length) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`The survey preview failed verification: ${problems.slice(0, 3).join(' ')}`);
  }
  renameSync(staged, target);
  fsyncDir(root);
  rmSync(staging, { recursive: true, force: true });
  return 'written';
}

export function buildAndWritePreview(dataDir: string, input: PreviewInput): { id: string; outcome: 'written' | 'existing' } {
  const preview = buildPreview(input);
  return { id: preview.id, outcome: writePreview(dataDir, preview) };
}

/** Removes previews whose observation revision is no longer kept. */
export function prunePreviews(dataDir: string, keepRevisions: ReadonlySet<string>): string[] {
  const root = previewsRoot(dataDir);
  if (!existsSync(root)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(root).sort()) {
    if (!PreviewIdSchema.safeParse(name).success) continue;
    let revision: string | null;
    try {
      revision = readPreviewManifest(dataDir, name).revision;
    } catch {
      revision = null;
    }
    if (revision && keepRevisions.has(revision)) continue;
    rmSync(join(root, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}
