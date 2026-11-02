import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { adoptedGrandRecipe } from '../../../../packages/world/src/grand/adopted';
import { grandLandRecipeHash, type GrandLandRecipe } from '../../../../packages/world/src/grand/recipe';
import { LandNeedsBakeError, publishFoundedLand, type LandPublicationResult } from './publication';
import { LandArtifactStore } from './store';
import { mountLandRoutes } from './mount';

/** One bake of one exact founded scene, written into `directory` (the realm's land store). */
export interface LandBakeJob {
  readonly sceneBytes: Uint8Array;
  readonly receipt: RealmFoundedManifest;
  readonly recipe: GrandLandRecipe;
  readonly directory: string;
  readonly signal: AbortSignal;
}
/** The bake command's own report (`bakeFoundedLand`'s result); timings never enter content identity. */
export interface LandBakeReport {
  readonly storedBytes: number;
  readonly cpuSeconds: number;
  readonly wallSeconds: number;
  readonly peakMemoryKiB: number;
  readonly meshes: number;
}
export type LandBakeRunner = (job: LandBakeJob) => Promise<LandBakeReport>;

export interface RealmLandOptions {
  /** The durable land store. The read routes serve exactly this directory. */
  readonly directory: string;
  /** The host's adopted kingdom-to-recipe mapping. A receipt never chooses its own recipe. */
  readonly recipeFor?: (kingdomId: string) => GrandLandRecipe | undefined;
  /** Raises the land for a plan the store has not baked. Null: such plans wait for the offline bake command. */
  readonly bake?: LandBakeRunner | null;
  /** The longest a publication may hold a founded write; slower disks finish it in the background. */
  readonly rebindTimeoutMs?: number;
  readonly log?: (line: string) => void;
}

export interface RealmLand {
  readonly store: LandArtifactStore;
  /**
   * The founded store's `beforeFoundedPublication`. It binds the land to the exact receipt before the receipt can
   * become public when the plan's land is already baked (a Forge piece, a claimed home, a new collision revision:
   * no land blob decoded; about a second for a real 2 MB scene). A plan without land is queued for one bake in a niced child process and the
   * kingdom keeps today's land until it is bound. It never throws: land is presentation, never a reason to
   * refuse a founded write.
   */
  beforePublication(bytes: Uint8Array, receipt: RealmFoundedManifest, signal?: AbortSignal): Promise<void>;
  mount(app: uWebSocketsTransport['app']): void;
  /** Resolves once no bake or queued publication remains. */
  idle(): Promise<void>;
  stop(): Promise<void>;
}

const short = (hash: string) => hash.slice(0, 8);

export function createRealmLand(options: RealmLandOptions): RealmLand {
  const directory = resolve(options.directory);
  if (!options.directory.trim()) throw new Error('The land artifact directory must be explicit');
  const store = new LandArtifactStore(directory), log = options.log ?? (() => {});
  const recipeFor = options.recipeFor ?? adoptedGrandRecipe, bake = options.bake ?? null;
  const timeout = options.rebindTimeoutMs ?? 4000, abort = new AbortController();
  const hashes = new Map<GrandLandRecipe, Promise<string>>();
  const hashOf = (recipe: GrandLandRecipe) => {
    let hash = hashes.get(recipe);
    if (!hash) { hash = grandLandRecipeHash(recipe); hashes.set(recipe, hash); }
    return hash;
  };
  // The newest receipt per kingdom that still lacks land; an older one is superseded before its bake would start.
  const queued = new Map<string, { bytes: Uint8Array; receipt: RealmFoundedManifest; recipe: GrandLandRecipe }>();
  const failed = new Set<string>();
  let worker: Promise<void> | null = null, stopped = false;

  const publish = async (bytes: Uint8Array, receipt: RealmFoundedManifest, recipe: GrandLandRecipe): Promise<LandPublicationResult> =>
    publishFoundedLand({ sceneBytes: bytes, receipt, recipeHash: await hashOf(recipe), store, verification: 'catalogued', signal: abort.signal });
  const published = (result: LandPublicationResult, receipt: RealmFoundedManifest) => {
    if (result.disposition === 'rebound')
      log(`land: ${receipt.kingdomId} scene ${short(receipt.sceneHash)} bound to baked land ${short(result.binding.manifest.hash)} (${result.reused.meshes} meshes reused)`);
  };

  async function drain(): Promise<void> {
    while (!stopped && queued.size) {
      const [kingdomId, job] = queued.entries().next().value!;
      queued.delete(kingdomId);
      try {
        // A bake for this plan may have finished while this receipt waited.
        published(await publish(job.bytes, job.receipt, job.recipe), job.receipt);
        continue;
      } catch (error) {
        if (stopped) return;
        if (!(error instanceof LandNeedsBakeError)) { log(`land: ${kingdomId} scene ${short(job.receipt.sceneHash)} publication failed: ${(error as Error).message}`); continue; }
        const key = `${kingdomId}:${error.recipeHash}:${error.sourcePlanHash}`;
        if (failed.has(key)) continue;
        if (!bake) {
          log(`land: ${kingdomId} plan ${short(error.sourcePlanHash)} (${error.layoutRevision}) needs a bake; no bake command is configured, so it keeps today's land`);
          failed.add(key); continue;
        }
        log(`land: baking ${kingdomId} plan ${short(error.sourcePlanHash)} (${error.layoutRevision}) for scene ${short(job.receipt.sceneHash)}`);
        try {
          const report = await bake({ sceneBytes: job.bytes, receipt: job.receipt, recipe: job.recipe, directory, signal: abort.signal });
          log(`land: baked ${kingdomId} in ${report.wallSeconds.toFixed(1)} s (${report.cpuSeconds.toFixed(1)} CPU s, ${(report.peakMemoryKiB / 1024).toFixed(0)} MiB peak), ${report.meshes} meshes, ${(report.storedBytes / 1e6).toFixed(2)} MB stored`);
          // The bake binds its own receipt; newer receipts of the same plan rebind on their turn.
          published(await publish(job.bytes, job.receipt, job.recipe), job.receipt);
        } catch (bakeError) {
          if (stopped) return;
          failed.add(key);
          log(`land: bake for ${kingdomId} plan ${short(error.sourcePlanHash)} failed; it keeps today's land until the realm restarts: ${(bakeError as Error).message}`);
        }
      }
    }
  }
  const kick = () => {
    if (worker || stopped) return;
    worker = drain().finally(() => { worker = null; if (queued.size && !stopped) kick(); });
  };

  return {
    store,
    async beforePublication(bytes, receipt, signal) {
      if (stopped) return;
      signal?.throwIfAborted();
      let parsed: RealmFoundedManifest;
      try { parsed = RealmFoundedManifestSchema.parse(receipt); } catch { return; }
      const recipe = recipeFor(parsed.kingdomId);
      if (!recipe || parsed.origin !== 'live') return;
      const owned = new Uint8Array(bytes);
      const attempt = publish(owned, parsed, recipe).then(result => { published(result, parsed); }, error => {
        if (stopped) return;
        if (error instanceof LandNeedsBakeError) { queued.delete(parsed.kingdomId); queued.set(parsed.kingdomId, { bytes: owned, receipt: parsed, recipe }); kick(); }
        else log(`land: ${parsed.kingdomId} scene ${short(parsed.sceneHash)} publication failed: ${(error as Error).message}`);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([attempt, new Promise<void>(done => { timer = setTimeout(done, timeout); })]);
      clearTimeout(timer);
    },
    mount(app) { mountLandRoutes(app, store); },
    async idle() { while (worker) await worker; },
    async stop() {
      stopped = true; queued.clear(); abort.abort(new Error('The realm is stopping'));
      await worker?.catch(() => undefined);
    },
  };
}

/**
 * The bake command in a child process at the lowest priority, with at most two background threads and none of
 * the realm's environment (no database or ingress secrets). Its inputs are private copies in the land
 * directory, removed afterwards; a killed bake leaves only unreferenced blobs, never a partial binding.
 */
export function childLandBake(script: string, log: (line: string) => void = () => {}): LandBakeRunner {
  return async job => {
    job.signal.throwIfAborted();
    await mkdir(job.directory, { recursive: true });
    const work = await mkdtemp(join(job.directory, '.bake-'));
    try {
      const file = (name: string) => join(work, name);
      await writeFile(file('scene.json'), job.sceneBytes);
      await writeFile(file('receipt.json'), JSON.stringify(job.receipt));
      await writeFile(file('recipe.json'), JSON.stringify(job.recipe));
      const child = spawn(process.execPath, ['--max-old-space-size=1536', script,
        '--scene', file('scene.json'), '--receipt', file('receipt.json'), '--recipe', file('recipe.json'),
        '--directory', job.directory, '--report', file('report.json')],
      { env: { PATH: process.env.PATH ?? '', UV_THREADPOOL_SIZE: '2', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
      if (child.pid !== undefined) try { setPriority(child.pid, 19); } catch { /* best effort: still bounded to two threads */ }
      const kill = () => child.kill('SIGTERM');
      job.signal.addEventListener('abort', kill, { once: true });
      let stderr = '', stage = '';
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        for (const line of chunk.split('\n')) {
          const progress = /"stage":"([a-z]+)"/.exec(line)?.[1];
          if (progress && progress !== stage) { stage = progress; log(`land: bake ${job.receipt.kingdomId} ${progress}`); }
        }
      });
      const code = await new Promise<number | null>((done, fail) => { child.once('error', fail); child.once('close', done); });
      job.signal.removeEventListener('abort', kill);
      job.signal.throwIfAborted();
      if (code !== 0) throw new Error(`the bake command exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' / ')}`);
      return JSON.parse(await readFile(file('report.json'), 'utf8')) as LandBakeReport;
    } finally { await rm(work, { recursive: true, force: true }); }
  };
}

/** `REALM_LAND_BAKE_SCRIPT`, else `land-bake.mjs` beside the running realm bundle (`build:land`). */
export function realmLandBakeScript(env: NodeJS.ProcessEnv = process.env, entry = process.argv[1]): string | null {
  const script = env.REALM_LAND_BAKE_SCRIPT?.trim() || (entry ? join(dirname(entry), 'land-bake.mjs') : '');
  return script && existsSync(script) ? resolve(script) : null;
}

/** The realm host's composition: the store directory from `REALM_LAND_DIRECTORY`, the adopted recipes, and
 * the child bake when its bundle is present. */
export function openRealmLand(directory: string, log: (line: string) => void): RealmLand {
  const script = realmLandBakeScript();
  log(script ? `land: serving and baking ${resolve(directory)} (bake command ${script})`
    : `land: serving ${resolve(directory)}; no land-bake.mjs beside the realm, so a new plan waits for the offline bake command`);
  return createRealmLand({ directory, bake: script ? childLandBake(script, log) : null, log });
}
