import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { setPriority } from 'node:os';
import { join } from 'node:path';
import { canonicalSceneJson } from '../../../../packages/world/src/founded-world/codec';
import { grandSketchRecipeHash, SKETCH_RECIPE_BYTES, validateSketchRecipe, type GrandSketchRecipe } from '../../../../packages/world/src/grand/sketch';
import type { LandArtifactStore } from './store';

/** What a sketch bake really did, reported by the bake itself; timings never enter content identity. */
export interface SketchBakeReport {
  readonly storedBytes: number;
  readonly cpuSeconds: number;
  readonly wallSeconds: number;
  readonly peakMemoryKiB: number;
  readonly meshes: number;
}
/** `raising`: the land itself is being generated (no count exists yet); `meshes`: regions cut and stored. */
export interface SketchProgress { readonly stage: 'raising' | 'meshes'; readonly done: number; readonly total: number }
export interface SketchBakeJob {
  readonly recipe: GrandSketchRecipe;
  readonly directory: string;
  readonly signal: AbortSignal;
  readonly onProgress: (progress: SketchProgress) => void;
}
export type SketchBakeRunner = (job: SketchBakeJob) => Promise<SketchBakeReport>;

export type SketchStatus =
  | { readonly state: 'ready' }
  /** `ahead`: how many other lands are raised before this one. Every number is the bake's own count. */
  | ({ readonly state: 'raising'; readonly ahead: number } & SketchProgress)
  /** `pinned`: the channel already has another world (`pinnedHash`); `founded`: a founded kingdom has no sketch. */
  | { readonly state: 'refused'; readonly reason: 'invalid' | 'pinned' | 'founded' | 'busy' | 'resting' | 'failed'; readonly pinnedHash?: string };

export interface SketchLimits {
  /** Lands waiting behind the one being raised. */
  readonly queue: number;
  /** Bakes per rolling day, so a flood of lookups cannot take the host. */
  readonly perDay: number;
}
export const SKETCH_LIMITS: SketchLimits = Object.freeze({ queue: 8, perDay: 240 });

/** Whether a kingdom is founded: true, false, or null when the realm cannot tell just now. */
export type FoundedCheck = (kingdomId: string) => Promise<boolean | null>;

export interface SketchService {
  /** Ask for a channel's world by its recipe: ready, being raised (with real progress) or refused, never generated here. */
  request(kingdomId: string, recipeHash: string, body: Uint8Array): Promise<SketchStatus>;
  idle(): Promise<void>;
  stop(): Promise<void>;
}

const short = (hash: string) => hash.slice(0, 8);

/**
 * The realm's sketch queue (GW13). A visitor's browser asks for the exact recipe it computed from the channel's
 * survey facts; the realm validates it, raises it once in a niced child (one land at a time, shared with founded
 * bakes through `serial`), stores it by content and serves it forever. Nothing a request carries can move another
 * channel's land: the record lives under the recipe's own hash and names the channel it was made for.
 *
 * The first recipe accepted for a channel becomes its world (`store.pinWorld`): a later survey whose facts drifted
 * is answered with `pinned` and the world's hash, so every visitor sees the same land, and a founding raises the
 * kingdom on it (`realm.ts`). Only an unfounded channel gets a sketch; when the realm cannot tell, it refuses.
 */
export function createSketchService(options: {
  readonly store: LandArtifactStore;
  readonly bake: SketchBakeRunner | null;
  /** Absent: the realm cannot tell who is founded, so it raises nothing new. */
  readonly founded?: FoundedCheck;
  readonly serial?: <T>(work: () => Promise<T>) => Promise<T>;
  readonly limits?: Partial<SketchLimits>;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
}): SketchService {
  const limits = { ...SKETCH_LIMITS, ...options.limits }, log = options.log ?? (() => {}), now = options.now ?? Date.now;
  const serial = options.serial ?? (<T>(work: () => Promise<T>) => work());
  const abort = new AbortController(), started: number[] = [], failed = new Set<string>();
  interface Job { readonly kingdomId: string; readonly hash: string; readonly recipe: GrandSketchRecipe; progress: SketchProgress }
  const queue: Job[] = [];
  let current: Job | null = null, worker: Promise<void> | null = null, stopped = false;

  async function drain() {
    while (!stopped && queue.length) {
      const job = queue.shift()!;
      current = job;
      try {
        if (await options.store.sketchBytes(job.kingdomId, job.hash)) continue;
        const report = await serial(() => options.bake!({ recipe: job.recipe, directory: options.store.directory, signal: abort.signal,
          onProgress: progress => { job.progress = progress; } }));
        log(`land: raised the sketch of ${job.kingdomId} (${job.recipe.seed.world.landform}, ${short(job.hash)}) in ${report.wallSeconds.toFixed(1)} s (${report.cpuSeconds.toFixed(1)} CPU s, ${(report.peakMemoryKiB / 1024).toFixed(0)} MiB peak), ${(report.storedBytes / 1e6).toFixed(2)} MB`);
        if (!await options.store.sketchBytes(job.kingdomId, job.hash)) throw new Error('the bake finished without publishing its record');
      } catch (error) {
        if (stopped) return;
        failed.add(job.hash);
        log(`land: the sketch of ${job.kingdomId} (${short(job.hash)}) could not be raised: ${(error as Error).message}`);
      } finally { current = null; }
    }
  }
  const kick = () => { if (!worker && !stopped) worker = drain().finally(() => { worker = null; if (queue.length && !stopped) kick(); }); };
  const raising = (job: Job, ahead: number): SketchStatus => ({ state: 'raising', ahead, ...job.progress });

  return {
    async request(kingdomId, recipeHash, body) {
      if (stopped) return { state: 'refused', reason: 'resting' };
      const world = await options.store.world(kingdomId);
      if (world && world.hash !== recipeHash) return { state: 'refused', reason: 'pinned', pinnedHash: world.hash };
      const stored = !!await options.store.sketchBytes(kingdomId, recipeHash);
      if (world && stored) return { state: 'ready' };
      if (current?.hash === recipeHash && current.kingdomId === kingdomId) return raising(current, 0);
      const waiting = queue.findIndex(job => job.hash === recipeHash && job.kingdomId === kingdomId);
      if (waiting >= 0) return raising(queue[waiting]!, waiting + (current ? 1 : 0));
      let recipe: GrandSketchRecipe;
      try {
        if (body.byteLength > SKETCH_RECIPE_BYTES) throw new Error('too large');
        const text = new TextDecoder('utf-8', { fatal: true }).decode(body);
        recipe = validateSketchRecipe(JSON.parse(text));
        if (canonicalSceneJson(recipe) !== text || recipe.seed.kingdomId !== kingdomId || await grandSketchRecipeHash(recipe) !== recipeHash) throw new Error('mismatch');
      } catch { return { state: 'refused', reason: 'invalid' }; }
      if (failed.has(recipeHash)) return { state: 'refused', reason: 'failed' };
      const day = now() - 86_400_000;
      while (started.length && started[0]! < day) started.shift();
      if (!world) {
        // A world is pinned only for a channel that has not founded, and only for work the realm will really do.
        const founded = options.founded ? await options.founded(kingdomId).catch(() => null) : null;
        if (founded === null) return { state: 'refused', reason: 'resting' };
        if (founded) return { state: 'refused', reason: 'founded' };
        if (!stored && !options.bake) return { state: 'refused', reason: 'resting' };
        if (!stored && (queue.length >= limits.queue || started.length >= limits.perDay)) return { state: 'refused', reason: 'busy' };
        const pinned = await options.store.pinWorld(recipe);
        if (pinned !== recipeHash) return { state: 'refused', reason: 'pinned', pinnedHash: pinned };
        log(`land: ${kingdomId} has its world: ${recipe.seed.world.landform}, ${recipe.seed.world.forest.join(' and ')} (${short(recipeHash)})`);
        if (stored) return { state: 'ready' };
      }
      if (!options.bake) return { state: 'refused', reason: 'resting' };
      if (queue.length >= limits.queue || started.length >= limits.perDay) return { state: 'refused', reason: 'busy' };
      started.push(now());
      const job: Job = { kingdomId, hash: recipeHash, recipe, progress: { stage: 'raising', done: 0, total: 0 } };
      queue.push(job);
      log(`land: queued the sketch of ${kingdomId} (${recipe.seed.world.landform}, ${short(recipeHash)}), ${queue.length + (current ? 1 : 0) - 1} ahead`);
      kick();
      return raising(job, queue.length - 1 + (current ? 1 : 0));
    },
    async idle() { while (worker) await worker; },
    async stop() { stopped = true; queue.length = 0; abort.abort(new Error('The realm is stopping')); await worker?.catch(() => undefined); },
  };
}

/**
 * The sketch bake in a child process at the lowest priority, with at most two background threads and none of the
 * realm's environment. Its progress lines are the bake's own counts.
 */
export function childSketchBake(script: string): SketchBakeRunner {
  return async job => {
    job.signal.throwIfAborted();
    await mkdir(job.directory, { recursive: true });
    const work = await mkdtemp(join(job.directory, '.sketch-'));
    try {
      const file = (name: string) => join(work, name);
      await writeFile(file('recipe.json'), canonicalSceneJson(job.recipe));
      const child = spawn(process.execPath, ['--max-old-space-size=1536', script,
        '--sketch-recipe', file('recipe.json'), '--directory', job.directory, '--report', file('report.json')],
      { env: { PATH: process.env.PATH ?? '', UV_THREADPOOL_SIZE: '2', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] });
      if (child.pid !== undefined) try { setPriority(child.pid, 19); } catch { /* best effort: still bounded to two threads */ }
      const kill = () => child.kill('SIGTERM');
      job.signal.addEventListener('abort', kill, { once: true });
      let stderr = '', pending = '';
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        const lines = (pending + chunk).split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const match = /^\{"stage":"(raising|meshes)","completed":(\d+),"total":(\d+)\}$/.exec(line.trim());
          if (match) job.onProgress({ stage: match[1] as SketchProgress['stage'], done: Number(match[2]), total: Number(match[3]) });
        }
      });
      const code = await new Promise<number | null>((done, fail) => { child.once('error', fail); child.once('close', done); });
      job.signal.removeEventListener('abort', kill);
      job.signal.throwIfAborted();
      if (code !== 0) throw new Error(`the bake command exited with ${code}: ${stderr.trim().split('\n').slice(-3).join(' / ')}`);
      return JSON.parse(await readFile(file('report.json'), 'utf8')) as SketchBakeReport;
    } finally { await rm(work, { recursive: true, force: true }); }
  };
}
