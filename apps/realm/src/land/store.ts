import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, link, unlink, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import { canonicalSceneJson } from '../../../../packages/world/src/founded-world/codec';
import { decodeBakedMetadata } from '../../../../packages/world/src/grand/baked/codec';
import { freezeGrandLandRecipe, type GrandLandRecipe } from '../../../../packages/world/src/grand/recipe';
import { decodeSketchRecord, SKETCH_RECIPE_BYTES, SKETCH_RECORD_BYTES, validateSketchRecipe, type GrandSketchRecipe, type GrandSketchRecord } from '../../../../packages/world/src/grand/sketch';

const compress = promisify(gzip), decompress = promisify(gunzip);
const HASH = /^[a-f0-9]{64}$/;
const KINGDOM = /^[1-9][0-9]{0,31}$/;
export const MAX_LAND_RAW_BYTES = 128 * 1024 * 1024;
export const MAX_LAND_GZIP_BYTES = 8 * 1024 * 1024;
export interface StoredLandBlob { readonly hash: string; readonly rawBytes: number; readonly gzipHash: string; readonly gzipBytes: number }
export interface StoredLandBinding {
  readonly version: 1;
  readonly kingdomId: string;
  readonly sceneHash: string;
  readonly layoutRevision: string;
  readonly collisionRevision: number;
  readonly sourcePlanHash: string;
  readonly recipeHash: string;
  readonly manifest: StoredLandBlob;
}
/** Immutable exact-plan lookup. It is never a current/latest pointer and grants no physical authority. */
export interface StoredLandPlan {
  readonly version: 1;
  readonly kingdomId: string;
  readonly recipeHash: string;
  readonly sourcePlanHash: string;
  readonly layoutRevision: string;
  readonly manifest: StoredLandBlob;
}
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function requireHash(value: string) { if (typeof value !== 'string' || !HASH.test(value)) throw new Error('Invalid land content hash'); }
function requireKingdom(value: string) { if (typeof value !== 'string' || !KINGDOM.test(value)) throw new Error('Invalid land kingdom identity'); }
function fields(value: unknown, keys: readonly string[], label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`Invalid land ${label} fields`);
}
function reference(value: StoredLandBlob) {
  requireHash(value.hash); requireHash(value.gzipHash);
  if (!Number.isSafeInteger(value.rawBytes) || value.rawBytes < 1 || value.rawBytes > MAX_LAND_RAW_BYTES
    || !Number.isSafeInteger(value.gzipBytes) || value.gzipBytes < 1 || value.gzipBytes > MAX_LAND_GZIP_BYTES)
    throw new Error('Land blob exceeds its byte budget');
}
function validateBinding(binding: StoredLandBinding) {
  const keys = ['version', 'kingdomId', 'sceneHash', 'layoutRevision', 'collisionRevision', 'sourcePlanHash', 'recipeHash', 'manifest'];
  fields(binding, keys, 'receipt binding');
  requireKingdom(binding.kingdomId); requireHash(binding.sceneHash); requireHash(binding.recipeHash); requireHash(binding.sourcePlanHash);
  fields(binding.manifest, ['hash', 'rawBytes', 'gzipHash', 'gzipBytes'], 'manifest reference');
  reference(binding.manifest);
  if (binding.version !== 1 || typeof binding.layoutRevision !== 'string' || !binding.layoutRevision || binding.layoutRevision.length > 256
    || !Number.isSafeInteger(binding.collisionRevision) || binding.collisionRevision < 0) throw new Error('Invalid land receipt binding');
}
function validatePlan(plan: StoredLandPlan): void {
  fields(plan, ['version', 'kingdomId', 'recipeHash', 'sourcePlanHash', 'layoutRevision', 'manifest'], 'plan catalogue');
  requireKingdom(plan.kingdomId); requireHash(plan.recipeHash); requireHash(plan.sourcePlanHash);
  fields(plan.manifest, ['hash', 'rawBytes', 'gzipHash', 'gzipBytes'], 'manifest reference');
  reference(plan.manifest);
  if (plan.version !== 1 || typeof plan.layoutRevision !== 'string' || !plan.layoutRevision || plan.layoutRevision.length > 256)
    throw new Error('Invalid land plan catalogue identity');
}
async function record(path: string): Promise<{ readonly value: unknown } | null> {
  let bytes: Buffer;
  try {
    if ((await stat(path)).size > 4096) throw new Error('Stored land record exceeds its byte budget');
    bytes = await readFile(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (bytes.byteLength > 4096) throw new Error('Stored land record exceeds its byte budget');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), value: unknown = JSON.parse(text);
  if (canonicalSceneJson(value) !== text) throw new Error('Stored land record must use canonical JSON bytes');
  return { value };
}

/** Immutable files become visible only after a complete, flushed write. Existing bytes are never replaced. */
async function createOnce(path: string, bytes: Uint8Array, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const temporary = `${path}.${randomUUID()}.pending`;
  const file = await open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(bytes); await file.sync(); await file.close();
    signal?.throwIfAborted();
    try { await link(temporary, path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readFile(path);
      if (!existing.equals(Buffer.from(bytes))) throw new Error('Immutable land publication conflicts with stored bytes', { cause: error });
    }
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file.close().catch(() => undefined); await unlink(temporary).catch(() => undefined); }
}

/** Offline producer store. Requests never generate land or mutate a published recipe. */
export class LandArtifactStore {
  constructor(readonly directory: string) {}
  private async directoryFor(kind: string) { const directory = join(this.directory, kind); await mkdir(directory, { recursive: true }); return directory; }

  async put(bytes: Uint8Array): Promise<StoredLandBlob> {
    if (!bytes.byteLength || bytes.byteLength > MAX_LAND_RAW_BYTES) throw new Error('Land blob exceeds its byte budget');
    const compressed = await compress(bytes, { level: 9 });
    // Canonical gzip header across supported hosts: no wall clock and no OS-specific byte.
    compressed.fill(0, 4, 8); compressed[9] = 255;
    const ref = { hash: hash(bytes), rawBytes: bytes.byteLength, gzipHash: hash(compressed), gzipBytes: compressed.byteLength };
    reference(ref);
    await createOnce(join(await this.directoryFor('blobs'), `${ref.hash}.gz`), compressed);
    return ref;
  }

  async compressed(ref: StoredLandBlob): Promise<Uint8Array> {
    reference(ref);
    const path = join(this.directory, 'blobs', `${ref.hash}.gz`);
    if ((await stat(path)).size !== ref.gzipBytes) throw new Error('Stored land size does not match its manifest');
    const bytes = await readFile(path);
    if (hash(bytes) !== ref.gzipHash) throw new Error('Stored land gzip digest does not match its manifest');
    return bytes;
  }

  /** Size-only presence of an immutable blob, for artifacts already fully verified when they were catalogued. */
  async present(ref: StoredLandBlob): Promise<boolean> {
    reference(ref);
    try { return (await stat(join(this.directory, 'blobs', `${ref.hash}.gz`))).size === ref.gzipBytes; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }

  /** The pinned recipe hash, or null while this kingdom has never been baked into this store. */
  async pinnedRecipeHash(kingdomId: string): Promise<string | null> {
    try { return await this.recipeHash(kingdomId); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  async read(ref: StoredLandBlob): Promise<Uint8Array> {
    const bytes = await decompress(await this.compressed(ref), { maxOutputLength: ref.rawBytes });
    if (bytes.byteLength !== ref.rawBytes || hash(bytes) !== ref.hash) throw new Error('Stored land content does not match its manifest');
    return bytes;
  }

  async pinRecipe(kingdomId: string, recipe: unknown, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    requireKingdom(kingdomId);
    const bytes = Buffer.from(canonicalSceneJson(recipe));
    if (bytes.length > 64 * 1024) throw new Error('Land recipe exceeds its byte budget');
    await createOnce(join(await this.directoryFor('recipes'), `${kingdomId}.json`), bytes, signal);
    return hash(bytes);
  }

  /** The kingdom's pinned land recipe itself, or null while none is pinned here. */
  async landRecipe(kingdomId: string): Promise<GrandLandRecipe | null> {
    requireKingdom(kingdomId);
    let bytes: Buffer;
    try {
      const path = join(this.directory, 'recipes', `${kingdomId}.json`);
      if ((await stat(path)).size > 64 * 1024) throw new Error('Stored recipe exceeds its byte budget');
      bytes = await readFile(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), recipe = freezeGrandLandRecipe(JSON.parse(text) as GrandLandRecipe);
    if (canonicalSceneJson(recipe) !== text || recipe.seed.kingdomId !== kingdomId) throw new Error('Stored land recipe identity mismatch');
    return recipe;
  }

  /**
   * A channel's world (GW13): the first sketch recipe the realm accepted for it, kept for ever. Later surveys of the
   * same channel never reroll it, and a founding raises the kingdom's land from it. Returns the hash of the world
   * the channel has, which differs from the offered recipe's when another was pinned first.
   */
  async pinWorld(recipe: GrandSketchRecipe, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const value = validateSketchRecipe(recipe), bytes = Buffer.from(canonicalSceneJson(value)), kingdomId = value.seed.kingdomId;
    const existing = await this.world(kingdomId);
    if (existing) return existing.hash;
    try { await createOnce(join(await this.directoryFor('worlds'), `${kingdomId}.json`), bytes, signal); }
    catch (error) {
      const winner = await this.world(kingdomId);
      if (!winner) throw error;
      return winner.hash;
    }
    return hash(bytes);
  }

  /** The channel's pinned world and its recipe hash, or null while nobody has looked this channel up here. */
  async world(kingdomId: string): Promise<{ readonly recipe: GrandSketchRecipe; readonly hash: string; readonly bytes: Uint8Array } | null> {
    requireKingdom(kingdomId);
    let bytes: Buffer;
    try {
      const path = join(this.directory, 'worlds', `${kingdomId}.json`);
      if ((await stat(path)).size > SKETCH_RECIPE_BYTES) throw new Error('Stored world exceeds its byte budget');
      bytes = await readFile(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), recipe = validateSketchRecipe(JSON.parse(text));
    if (canonicalSceneJson(recipe) !== text || recipe.seed.kingdomId !== kingdomId) throw new Error('Stored world identity mismatch');
    return { recipe, hash: hash(bytes), bytes };
  }

  async recipeHash(kingdomId: string): Promise<string> {
    requireKingdom(kingdomId);
    const path = join(this.directory, 'recipes', `${kingdomId}.json`);
    if ((await stat(path)).size > 64 * 1024) throw new Error('Stored recipe exceeds its byte budget');
    return hash(await readFile(path));
  }

  /** Publish only after the caller has validated the receipt and all referenced artifact blobs. */
  async bind(binding: StoredLandBinding, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    validateBinding(binding);
    const bytes = Buffer.from(canonicalSceneJson(binding)), value = JSON.parse(bytes.toString('utf8')) as StoredLandBinding;
    if (await this.recipeHash(value.kingdomId) !== value.recipeHash) throw new Error('Land recipe differs from the pinned kingdom recipe');
    signal?.throwIfAborted();
    await this.read(value.manifest);
    signal?.throwIfAborted();
    const directory = await this.directoryFor(`bindings/${value.kingdomId}`);
    await createOnce(join(directory, `${value.sceneHash}.json`), bytes, signal);
  }

  async binding(kingdomId: string, sceneHash: string): Promise<StoredLandBinding | null> {
    requireKingdom(kingdomId); requireHash(sceneHash);
    const stored = await record(join(this.directory, 'bindings', kingdomId, `${sceneHash}.json`));
    if (stored === null) return null;
    const value = stored.value as StoredLandBinding;
    validateBinding(value);
    if (value.version !== 1 || value.kingdomId !== kingdomId || value.sceneHash !== sceneHash) throw new Error('Stored land binding identity mismatch');
    reference(value.manifest); requireHash(value.sourcePlanHash);
    if (await this.recipeHash(kingdomId) !== value.recipeHash) throw new Error('Stored land recipe identity mismatch');
    return value;
  }

  /** Caller must first verify every blob with verifyLandArtifact. This writer additionally checks the
   * manifest identity and pinned recipe. Exact-key insertion conflicts rather than replacing a bake. */
  async cataloguePlan(plan: StoredLandPlan, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted(); validatePlan(plan);
    const bytes = Buffer.from(canonicalSceneJson(plan)), value = JSON.parse(bytes.toString('utf8')) as StoredLandPlan;
    if (await this.recipeHash(value.kingdomId) !== value.recipeHash) throw new Error('Land catalogue differs from the pinned kingdom recipe');
    signal?.throwIfAborted();
    const metadata = decodeBakedMetadata(await this.read(value.manifest));
    if (metadata.kingdomId !== value.kingdomId || metadata.recipeHash !== value.recipeHash
      || metadata.sourcePlanHash !== value.sourcePlanHash || metadata.sourcePlanRevision !== value.layoutRevision)
      throw new Error('Land catalogue does not match its manifest identity');
    signal?.throwIfAborted();
    const directory = await this.directoryFor(`plans/${value.kingdomId}/${value.recipeHash}`);
    await createOnce(join(directory, `${value.sourcePlanHash}.json`), bytes, signal);
  }

  async plan(kingdomId: string, recipeHash: string, sourcePlanHash: string): Promise<StoredLandPlan | null> {
    requireKingdom(kingdomId); requireHash(recipeHash); requireHash(sourcePlanHash);
    const stored = await record(join(this.directory, 'plans', kingdomId, recipeHash, `${sourcePlanHash}.json`));
    if (stored === null) return null;
    const value = stored.value as StoredLandPlan;
    validatePlan(value);
    if (value.kingdomId !== kingdomId || value.recipeHash !== recipeHash || value.sourcePlanHash !== sourcePlanHash)
      throw new Error('Stored land plan catalogue identity mismatch');
    if (await this.recipeHash(kingdomId) !== value.recipeHash) throw new Error('Stored land catalogue recipe identity mismatch');
    return value;
  }

  /**
   * Publish a sketch record once every blob it names is stored. Records are immutable: the same recipe always makes
   * the same bytes, and different bytes for a stored recipe are refused.
   */
  async putSketch(record: GrandSketchRecord, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const bytes = Buffer.from(canonicalSceneJson(record));
    const value = decodeSketchRecord(bytes, { kingdomId: record.kingdomId, recipeHash: record.recipeHash });
    for (const ref of [value.surface, ...value.meshes]) if (!await this.present(ref)) throw new Error('A sketch names a blob the store does not hold');
    signal?.throwIfAborted();
    await createOnce(join(await this.directoryFor(`sketches/${value.kingdomId}`), `${value.recipeHash}.json`), bytes, signal);
    return bytes;
  }

  /** A stored sketch's canonical record bytes, or null when this recipe has not been raised here. */
  async sketchBytes(kingdomId: string, recipeHash: string): Promise<Uint8Array | null> {
    requireKingdom(kingdomId); requireHash(recipeHash);
    const path = join(this.directory, 'sketches', kingdomId, `${recipeHash}.json`);
    try { if ((await stat(path)).size > SKETCH_RECORD_BYTES) throw new Error('Stored sketch exceeds its byte budget'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    const bytes = await readFile(path);
    decodeSketchRecord(bytes, { kingdomId, recipeHash });
    return bytes;
  }

  async sketch(kingdomId: string, recipeHash: string): Promise<GrandSketchRecord | null> {
    const bytes = await this.sketchBytes(kingdomId, recipeHash);
    return bytes ? decodeSketchRecord(bytes, { kingdomId, recipeHash }) : null;
  }

  /** The recipe hashes of a channel's stored sketches (each a different survey of the same channel). */
  async sketchHashes(kingdomId: string): Promise<readonly string[]> {
    requireKingdom(kingdomId);
    try { return (await readdir(join(this.directory, 'sketches', kingdomId))).flatMap(name => /^[a-f0-9]{64}\.json$/.test(name) ? [name.slice(0, 64)] : []); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
}
