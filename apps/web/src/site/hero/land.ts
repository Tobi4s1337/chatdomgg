// The live land behind the hero: the grand land of tobi4s_, raised in the visitor's browser from its Genesis seed and
// drawn from the same orbit camera as the captured frames. It comes from grand-world's small hero mount when that
// exists (work/lanes/front-door/SEAMS.md §2), and otherwise from the grand land's own engine, the one `/-/grand`
// draws with. Both are found with `import.meta.glob`, so the front page builds and works whichever exists; with
// neither, the hero keeps its captures.
import type { LandTier } from './policy';

/** What the hero needs of a live land. */
export interface LiveLand {
  /** Resolves the next time the land is fully drawn at the current camera (every region at its level, shadows done). */
  settled(): Promise<void>;
  /** Turns the orbit camera to `yaw` degrees around the island, keeping its pitch and distance. */
  setYaw(yaw: number): void;
  /** The canvas changed size. */
  resize(): void;
  dispose(): void;
}

export interface LiveLandOptions {
  readonly channel: string;
  readonly hour: number;
  /** The land's clock, held (seconds). */
  readonly time: number;
  readonly yaw: number;
  readonly tier: LandTier;
  /** Called once if the land cannot be raised or drawn. */
  readonly onFailure: (message: string) => void;
}

/**
 * grand-world's mount, when it exists (proposed in SEAMS.md §2): draws into `canvas`, never takes input, holds its
 * clock, and gives the same handle as above.
 */
type MountLandHero = (canvas: HTMLCanvasElement, options: LiveLandOptions) => Promise<LiveLand>;
const mounts = import.meta.glob<{ mountLandHero?: MountLandHero }>(['../../grand/hero.ts', '../../grand/hero/index.ts']);

/** The parts of the grand land's engine the hero uses (`apps/web/src/grand/engine.ts`). */
interface Engine {
  readonly controls: { enabled: boolean };
  onReady: (() => void) | null;
  set onFailure(handler: (message: string) => void);
  start(): Promise<void>;
  orbit(yaw: number | null, pitch: number | null, distance: number | null): void;
  resize(): void;
  dispose(): void;
}
type EngineClass = new (canvas: HTMLCanvasElement, seed: unknown, options: { tier: LandTier; capture: boolean; hour: number; view: 'orbit'; time: number | null }) => Engine;
const engines = import.meta.glob<{ GrandEngine?: EngineClass }>('../../grand/engine.ts');
const channels = import.meta.glob<{ grandChannel?: (login: string | null) => { login: string; seed: unknown } }>('../../grand/channels.ts');

/** True when this build can draw a live land at all. */
export function liveLandAvailable(): boolean {
  return Object.keys(mounts).length > 0 || (Object.keys(engines).length > 0 && Object.keys(channels).length > 0);
}

/** Opens the live land into `canvas`. Rejects when no live land exists in this build or it cannot start. */
export async function openLiveLand(canvas: HTMLCanvasElement, options: LiveLandOptions): Promise<LiveLand> {
  const mount = Object.values(mounts)[0];
  if (mount) {
    const module = await mount();
    if (typeof module.mountLandHero === 'function') return module.mountLandHero(canvas, options);
  }
  const loadEngine = Object.values(engines)[0], loadChannels = Object.values(channels)[0];
  if (!loadEngine || !loadChannels) throw new Error('This build has no live land');
  // The Genesis contracts are zod schemas. Under the public CSP (no 'unsafe-eval') zod must not probe for its compiler,
  // so it is told before any schema module evaluates.
  (await import('zod')).config({ jitless: true });
  const [{ GrandEngine }, { grandChannel }] = await Promise.all([loadEngine(), loadChannels()]);
  if (typeof GrandEngine !== 'function' || typeof grandChannel !== 'function') throw new Error('The grand land engine changed shape');
  const channel = grandChannel(options.channel);
  if (channel.login !== options.channel) throw new Error(`No grand land for ${options.channel}`);
  return engineLand(new GrandEngine(canvas, channel.seed, { tier: options.tier, capture: false, hour: options.hour, view: 'orbit', time: options.time }), options);
}

async function engineLand(engine: Engine, options: LiveLandOptions): Promise<LiveLand> {
  // The hero is a picture under the page: it never takes the wheel, a drag or a touch.
  engine.controls.enabled = false;
  let waiting: (() => void)[] = [];
  let failed = false;
  engine.onReady = () => { const now = waiting; waiting = []; now.forEach(resolve => resolve()); };
  engine.onFailure = message => { if (failed) return; failed = true; options.onFailure(message); };
  await engine.start();
  engine.orbit(options.yaw, null, null);
  return {
    // The engine says ready each time it settles after a change; a waiter is answered by the next one.
    settled: () => new Promise<void>(resolve => { waiting.push(resolve); }),
    setYaw: yaw => engine.orbit(yaw, null, null),
    resize: () => engine.resize(),
    dispose: () => { waiting = []; engine.onReady = null; engine.dispose(); },
  };
}
