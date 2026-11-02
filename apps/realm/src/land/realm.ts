import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { RealmFoundedManifestSchema, type RealmFoundedManifest } from '@chatdom/shared/realm';
import { adoptedGrandRecipe } from '../../../../packages/world/src/grand/adopted';
import { decodeFoundedScene } from '../../../../packages/world/src/founded-world/validate';
import { createGrandLandRecipe, grandLandRecipeHash, type GrandLandRecipe } from '../../../../packages/world/src/grand/recipe';
import { LandNeedsBakeError, publishFoundedLand, type LandPublicationResult } from './publication';
import { LandArtifactStore } from './store';
import { mountLandRoutes } from './mount';
import { childSketchBake, createSketchService, type FoundedCheck, type SketchBakeRunner, type SketchLimits, type SketchService, type TrustedWorld } from './sketches';
import { atlasTrustedWorld } from './atlas-world';

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
  /** Raises a channel's sketch (GW13) when a visitor asks for one. Null: only stored sketches are served. */
  readonly sketch?: SketchBakeRunner | null;
  readonly sketchLimits?: Partial<SketchLimits>;
  /** Whether a kingdom is founded (the realm's layout heads). Until one is known, no new sketch is raised. */
  readonly founded?: FoundedCheck;
  /** The world a channel's own Atlas facts give, read by the realm. Absent: no new world is pinned. */
  readonly trusted?: TrustedWorld | null;
}

export interface RealmLand {
  readonly store: LandArtifactStore;
  /** The sketch queue behind `POST /api/realm/land/<channel>/<recipe-hash>`. */
  readonly sketches: SketchService;
  /**
   * The founded store's `beforeFoundedPublication`. It binds the land to the exact receipt before the receipt can
   * become public when the plan's land is already baked (a Forge piece, a claimed home, a new collision revision:
   * no land blob decoded; about a second for a real 2 MB scene). A plan without land is queued for one bake in a niced child process and the
   * kingdom keeps today's land until it is bound. It never throws: land is presentation, never a reason to
   * refuse a founded write.
   */
  beforePublication(bytes: Uint8Array, receipt: RealmFoundedManifest, signal?: AbortSignal): Promise<void>;
  mount(app: uWebSocketsTransport['app']): void;
  /** Give the land the realm's own layout heads ("is this kingdom founded?") once the realm's services exist. */
  knowFounded(currentLayout: (kingdomId: KingdomId) => Promise<object | null>): void;
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
  // One land is raised at a time on this host, founded or sketched: the second waits for the first.
  let bakeChain: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = bakeChain.then(work, work);
    bakeChain = next.catch(() => undefined);
    return next;
  };
  let foundedCheck = options.founded ?? null;
  const sketches = createSketchService({ store, bake: options.sketch ?? null, serial, log, founded: id => foundedCheck ? foundedCheck(id) : Promise.resolve(null),
    ...(options.trusted ? { trusted: options.trusted } : {}),
    ...(options.sketchLimits ? { limits: options.sketchLimits } : {}) });
  // Every kingdom that is not adopted here stands on its channel's own world: the one visitors were shown before it
  // founded, or, when nobody looked it up first, the one its Atlas facts give at its first live publication after this.
  const own = new Map<string, GrandLandRecipe>();
  async function ownRecipe(bytes: Uint8Array, receipt: RealmFoundedManifest): Promise<GrandLandRecipe | undefined> {
    const kingdomId = receipt.kingdomId, known = own.get(kingdomId);
    if (known) return known;
    let world = await store.world(kingdomId);
    if (!world && options.trusted) {
      // Read by the realm itself; an Atlas that cannot be read now is asked again at the next publication.
      const trusted = await options.trusted(kingdomId).catch(() => undefined);
      if (trusted && trusted.seed.kingdomId === kingdomId) {
        await store.pinWorld(trusted, abort.signal);
        world = await store.world(kingdomId);
        if (world) log(`land: ${kingdomId} has its world from its Atlas facts: ${world.recipe.seed.world.landform}, ${world.recipe.seed.world.forest.join(' and ')} (${short(world.hash)})`);
      }
    }
    // A channel without a world (not on the Atlas, or the Atlas away) keeps today's land for now.
    if (!world) return undefined;
    let recipe = await store.landRecipe(kingdomId);
    if (!recipe) {
      // The founding scene seats the town; the world (landform, woods, crest, landmark, size) is the one visitors saw.
      const scene = await decodeFoundedScene(new Uint8Array(bytes), receipt);
      recipe = createGrandLandRecipe(scene.plan, world.recipe.seed);
      await store.pinRecipe(kingdomId, recipe, abort.signal);
      // Another publication may have pinned first; the store keeps the first and so does this realm.
      recipe = (await store.landRecipe(kingdomId)) ?? recipe;
      log(`land: ${kingdomId} founded on its own world (${world.recipe.seed.world.landform}, sketch ${short(world.hash)}); land recipe ${short(await hashOf(recipe))} pinned`);
    }
    own.set(kingdomId, recipe);
    return recipe;
  }

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
          const report = await serial(() => bake({ sceneBytes: job.bytes, receipt: job.receipt, recipe: job.recipe, directory, signal: abort.signal }));
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
    sketches,
    async beforePublication(bytes, receipt, signal) {
      if (stopped) return;
      signal?.throwIfAborted();
      let parsed: RealmFoundedManifest;
      try { parsed = RealmFoundedManifestSchema.parse(receipt); } catch { return; }
      if (parsed.origin !== 'live') return;
      const owned = new Uint8Array(bytes), adopted = recipeFor(parsed.kingdomId);
      const attempt = (adopted ? Promise.resolve(adopted) : ownRecipe(owned, parsed)).then(async recipe => {
        if (!recipe || stopped) return;
        try { published(await publish(owned, parsed, recipe), parsed); }
        catch (error) {
          if (stopped) return;
          if (error instanceof LandNeedsBakeError) { queued.delete(parsed.kingdomId); queued.set(parsed.kingdomId, { bytes: owned, receipt: parsed, recipe }); kick(); }
          else throw error;
        }
      }).catch((error: unknown) => { if (!stopped) log(`land: ${parsed.kingdomId} scene ${short(parsed.sceneHash)} publication failed: ${(error as Error).message}`); });
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([attempt, new Promise<void>(done => { timer = setTimeout(done, timeout); })]);
      clearTimeout(timer);
    },
    mount(app) { mountLandRoutes(app, store, sketches); },
    knowFounded(currentLayout) { foundedCheck = async id => (await currentLayout(KingdomIdSchema.parse(id))) !== null; },
    async idle() { while (worker) await worker; await sketches.idle(); },
    async stop() {
      stopped = true; queued.clear(); abort.abort(new Error('The realm is stopping'));
      await Promise.all([worker?.catch(() => undefined), sketches.stop()]);
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
export function openRealmLand(directory: string, log: (line: string) => void, env: NodeJS.ProcessEnv = process.env): RealmLand {
  const script = realmLandBakeScript(env), atlas = env.REALM_ATLAS_BASE?.trim();
  if (!atlas) log('land: REALM_ATLAS_BASE is not set, so no channel is given a new world (pinned worlds are still served)');
  log(script ? `land: serving and baking ${resolve(directory)} (bake command ${script}; channel sketches raised on request)`
    : `land: serving ${resolve(directory)}; no land-bake.mjs beside the realm, so a new plan waits for the offline bake command and only stored sketches are served`);
  return createRealmLand({ directory, bake: script ? childLandBake(script, log) : null, sketch: script ? childSketchBake(script) : null, log,
    trusted: atlas ? atlasTrustedWorld({ base: atlas }) : null });
}
