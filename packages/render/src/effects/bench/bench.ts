// Boots the effects bench: the dusk diorama from scene.ts and, unless `effects=off`, the effects library fed with
// the scene's real anchors. The clock is FIXED from the URL (a deterministic still); it changes only through
// `window.__chatdomEffects.setTime`. Every input is SIMULATED, and the seal says so.
//   bench.html?view=street|wide&hour=20&time=12&quality=balanced&effects=on|off&seed=7
import type { Effects, EffectsQuality } from '../index';
import { createBenchScene, type BenchView } from './scene';

type BenchApi = {
  setTime(time: number): void;
  setView(view: BenchView): void;
  setQuality(quality: EffectsQuality): void;
  setEffects(on: boolean): Promise<void>;
  stats(): { drawCalls: number; triangles: number; time: number; view: BenchView; quality: EffectsQuality; effects: boolean };
};
type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomEffects?: BenchApi };

const QUALITIES: readonly EffectsQuality[] = ['low', 'balanced', 'high'];
const WIND = [0.6, 0, 0.25] as const;
const query = new URLSearchParams(location.search);
const finite = (name: string, fallback: number) => { const value = Number(query.get(name) ?? fallback); return Number.isFinite(value) ? value : fallback; };
let view: BenchView = query.get('view') === 'wide' ? 'wide' : 'street';
let quality: EffectsQuality = QUALITIES.find(q => q === query.get('quality')) ?? 'balanced';
let time = finite('time', 12);
let effectsOn = query.get('effects') !== 'off';
const hour = finite('hour', 20), seed = Math.trunc(finite('seed', 7));

const canvas = document.querySelector('canvas')!;
const seal = document.querySelector<HTMLElement>('[data-seal]')!;
const fail = (error: unknown) => { console.error('Effects bench failed', error); document.body.dataset.error = String(error instanceof Error ? error.message : error); };
const label = () => { seal.textContent = `SIMULATED bench inputs · effects library · ${view} · t=${time}s · ${quality}${effectsOn ? '' : ' · effects off'}`; };

try {
  const bench = await createBenchScene(canvas, { hour });
  bench.setView(view);
  let effects: Effects | undefined;
  // Loaded only when wanted, so the diorama runs on its own while the library is being built.
  const ensureEffects = async () => {
    if (effects) return;
    const { createEffects } = await import('../index');
    effects = createEffects({ scene: bench.scene, camera: bench.camera, seed, quality });
  };
  if (effectsOn) await ensureEffects();
  label();

  const frame = () => {
    try {
      if (effectsOn && effects) {
        effects.update({ time, wind: WIND, fireflies: bench.anchors.fireflySources, embers: bench.anchors.emberSources });
      }
      bench.render(time);
      const win = window as BenchWindow;
      if (!win.__chatdomReady) win.__chatdomReady = true;
      requestAnimationFrame(frame);
    } catch (error) { fail(error); }
  };

  (window as BenchWindow).__chatdomEffects = {
    setTime(next) { if (Number.isFinite(next)) { time = next; label(); } },
    setView(next) { bench.setView(next); view = next; label(); },
    setQuality(next) { if (!QUALITIES.includes(next)) throw new Error(`Unknown quality ${String(next)}`); quality = next; effects?.setQuality(next); label(); },
    async setEffects(on) {
      if (on) await ensureEffects();
      else if (effects) { effects.dispose(); effects = undefined; }
      effectsOn = on; label();
    },
    stats: () => ({ ...bench.stats(), time, view, quality, effects: effectsOn }),
  };
  requestAnimationFrame(frame);
} catch (error) { fail(error); }
