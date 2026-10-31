import { randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { KingdomIdSchema, Sha256Schema, type KingdomId } from '@chatdom/shared';
import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import type { RealmFoundedBlueprint, RealmFoundedPlacement, RealmFoundedScene, SettlementPlan } from '@chatdom/world';
import { MATERIALS } from '@chatdom/content';
import { assetHashOf, canonicalSceneJson, sha256Hex, utf8 } from './codec';
import { createNativeTown, type NativeTown } from './native';
import type { FoundedWorldStore } from './provider';
import { decodeFoundedScene, encodeFoundedScene, validateFoundedScene, FOUNDED_SCENE_LIMITS } from './validate';

/**
 * Configured filesystem store shared by realm and the narrow GET adapter. Atomic hard-link insertion preserves
 * exact immutable bytes across restarts/processes; no browser upload or private state persistence lives here.
 * Root is a trusted host configuration and must be shared by producer/reader. Withdrawal/access policy stays
 * with the host; possession of an immutable hash alone is not a grant to serve it.
 */
export class FileFoundedStore implements FoundedWorldStore {
  readonly directory: string;
  constructor(directory: string, private readonly limits = { scenes: 4096 }) {
    if (!Number.isInteger(limits.scenes) || limits.scenes < 1 || limits.scenes > 65536) throw new Error('Invalid founded store scene capacity.');
    if (!directory) throw new Error('Founded store needs a configured directory.');
    this.directory = resolve(directory);
  }
  private async read(path: string, max = FOUNDED_SCENE_LIMITS.bytes): Promise<Uint8Array | null> {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > max) throw new Error('Founded stored bytes exceed their bound.');
      const bytes = new Uint8Array(await readFile(path));
      if (bytes.byteLength > max) throw new Error('Founded stored bytes exceed their bound.');
      return bytes;
    } catch (error) { if (code(error) === 'ENOENT') return null; throw error; }
  }
  private async insert(path: string, bytes: Uint8Array): Promise<boolean> {
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600, flush: true });
    try {
      await link(temp, path);
      const parent = await open(dirname(path), 'r');
      try { await parent.sync(); } finally { await parent.close(); }
      return true;
    }
    catch (error) { if (code(error) === 'EEXIST') return false; throw error; }
    finally { await unlink(temp); }
  }
  async put(bytes: Uint8Array, manifest: RealmFoundedManifest): Promise<void> {
    const receipt = RealmFoundedManifestSchema.parse(manifest);
    await decodeFoundedScene(bytes, receipt);
    await mkdir(join(this.directory, 'scenes'), { recursive: true });
    const path = join(this.directory, 'scenes', `${receipt.sceneHash}.json`);
    if (!await this.read(path) && (await readdir(join(this.directory, 'scenes'))).filter(name => /^[0-9a-f]{64}\.json$/.test(name)).length >= this.limits.scenes) throw new Error('Founded immutable scene capacity is exhausted.');
    if (!await this.insert(path, bytes)) {
      const existing = await this.read(path);
      if (!existing || await sha256Hex(existing) !== receipt.sceneHash) throw new Error('Founded immutable bytes are corrupt.');
    }
  }
  /** Integrity-checked exact bytes; the host must separately authorize this geometry read. */
  async get(sceneHash: string): Promise<Uint8Array | null> {
    Sha256Schema.parse(sceneHash);
    const bytes = await this.read(join(this.directory, 'scenes', `${sceneHash}.json`));
    if (bytes && await sha256Hex(bytes) !== sceneHash) throw new Error('Founded immutable bytes are corrupt.');
    return bytes;
  }
  async revision(kingdomId: KingdomId, geometryDigest: string): Promise<number> {
    KingdomIdSchema.parse(kingdomId); Sha256Schema.parse(geometryDigest);
    const directory = join(this.directory, 'revisions', kingdomId);
    await mkdir(directory, { recursive: true });
    const alias = join(directory, `digest-${geometryDigest}.json`);
    const known = await this.read(alias, 256);
    if (known) {
      const revision = parseRevision(known, geometryDigest), slot = await this.read(join(directory, `revision-${revision}.json`), 256);
      if (!slot || parseRevision(slot, geometryDigest) !== revision) throw new Error('Founded revision catalog is corrupt.');
      return revision;
    }
    // Atomically claim the next unused numeric slot. Interrupted claims consume a slot safely; none is reused.
    // The immutable digest alias chooses one canonical number if concurrent equal-identity preparations race.
    for (let attempt = 0; attempt < 64; attempt++) {
      const files = (await readdir(directory)).filter(name => /^revision-[0-9]+\.json$/.test(name));
      if (files.length >= 65536) throw new Error('Founded revision catalog capacity is exhausted.');
      const next = files.reduce((max, name) => Math.max(max, Number(name.slice(9, -5))), 0) + 1;
      if (!Number.isSafeInteger(next) || next > 0xffffffff) throw new Error('Founded collision revision is exhausted.');
      const bytes = utf8(canonicalSceneJson({ digest: geometryDigest, revision: next }));
      if (!await this.insert(join(directory, `revision-${next}.json`), bytes)) continue;
      if (await this.insert(alias, bytes)) return next;
      const winner = await this.read(alias, 256);
      if (!winner) throw new Error('Founded revision alias became unavailable.');
      return parseRevision(winner, geometryDigest);
    }
    throw new Error('Founded collision revision catalog is busy.');
  }
  async native(kingdomId: KingdomId, plan: SettlementPlan, origin: 'live' | 'simulated'): Promise<NativeTown> {
    KingdomIdSchema.parse(kingdomId);
    const key = await assetHashOf({ kingdomId, origin, revision: plan.revision });
    const directory = join(this.directory, 'native');
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${key}.json`);
    let pinned = await this.read(path, 2048);
    if (!pinned) {
      // Pin reviewed public native geometry directly. No fabricated private authority state or deed is needed.
      const town = createNativeTown(plan), assets = new Map<string, RealmFoundedBlueprint>(), placements: RealmFoundedPlacement[] = [];
      const plotIds = new Map([...town.homes.values()].map(home => [home.id, home.plot.id]));
      for (const piece of [...town.homes.values(), ...town.fixtures]) {
        const assetHash = await assetHashOf(piece.blueprint);
        assets.set(assetHash, { assetHash, blueprint: piece.blueprint });
        const base = { id: piece.id, assetHash, position: piece.position, rotation: piece.rotation };
        const plotId = plotIds.get(piece.id);
        placements.push(plotId === undefined ? base : { ...base, plotId });
      }
      const scene: RealmFoundedScene = { version: 1, kingdomId, origin, layoutRevision: plan.revision, collisionRevision: 0,
        plan, materials: MATERIALS, assets: [...assets.values()], placements };
      const build = await encodeFoundedScene(await validateFoundedScene(scene));
      await this.put(build.bytes, build.manifest);
      const pointer = utf8(canonicalSceneJson({ planHash: await assetHashOf(plan), manifest: build.manifest }));
      await this.insert(path, pointer);
      pinned = await this.read(path, 2048);
    }
    if (!pinned) throw new Error('Founded native baseline is unavailable.');
    const record: unknown = JSON.parse(new TextDecoder().decode(pinned));
    if (typeof record !== 'object' || record === null || !('planHash' in record) || !('manifest' in record)
      || record.planHash !== await assetHashOf(plan)) throw new Error('The adopted plan changed under a pinned native revision.');
    const manifest = RealmFoundedManifestSchema.parse(record.manifest), bytes = await this.get(manifest.sceneHash);
    if (!bytes) throw new Error('Founded native baseline bytes are unavailable.');
    if (manifest.kingdomId !== kingdomId || manifest.origin !== origin || manifest.layoutRevision !== plan.revision) throw new Error('Founded native baseline identity disagrees with its adopted layout.');
    const scene = await decodeFoundedScene(bytes, manifest), assets = new Map(scene.assets.map(a => [a.assetHash, a.blueprint]));
    if (await assetHashOf(scene.plan) !== record.planHash) throw new Error('Founded native baseline plan bytes are inconsistent.');
    const homes = new Map<string, NativeTown['homes'] extends ReadonlyMap<string, infer V> ? V : never>();
    const fixtures: NativeTown['fixtures'][number][] = [];
    for (const placement of scene.placements) {
      const piece = { id: placement.id, blueprint: assets.get(placement.assetHash)!, position: placement.position, rotation: placement.rotation };
      if (placement.plotId) {
        const plot = plan.homes.find(p => p.id === placement.plotId);
        if (!plot) throw new Error('Founded native baseline has an unknown plot.');
        homes.set(plot.id, { ...piece, plot });
      } else fixtures.push(piece);
    }
    return { revision: plan.revision, homes, fixtures };
  }
}
function code(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
}
function parseRevision(bytes: Uint8Array, digest: string): number {
  const entry: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof entry !== 'object' || entry === null || !('digest' in entry) || entry.digest !== digest || !('revision' in entry)
    || typeof entry.revision !== 'number' || !Number.isInteger(entry.revision) || entry.revision < 1 || entry.revision > 0xffffffff) throw new Error('Founded revision catalog is corrupt.');
  return entry.revision;
}
