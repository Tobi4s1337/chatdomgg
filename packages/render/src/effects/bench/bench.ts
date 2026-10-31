// Boots the effects bench: the dusk diorama from scene.ts and, unless `effects=off`, the effects library fed with
// the scene's real anchors. The clock is FIXED from the URL (a deterministic still); it changes only through
// `window.__chatdomEffects.setTime`. Every input is SIMULATED, and the seal says so.
//   bench.html?view=street|wide|stream&hour=20&time=12&quality=balanced&effects=on|off&seed=7
// The cues repeat every eight seconds of the bench clock: a strike on the forge's fire at 3.7 s, and a forged piece
// flying from the forge to the near hut's roof from 2.8 s to 5.4 s, landing with its own small burst.
import type { Vec3 } from '@chatdom/shared';
import type { Effects, EffectsFrame, EffectsQuality, FlightSample } from '../index';
import { presenceChimneySmoke } from '../adapters';
import { BENCH_VIEWS, createBenchScene, type BenchAnchors, type BenchView } from './scene';

type BenchApi = {
  setTime(time: number): void;
  setView(view: BenchView): void;
  setQuality(quality: EffectsQuality): void;
  setEffects(on: boolean): Promise<void>;
  stats(): { drawCalls: number; triangles: number; time: number; view: BenchView; quality: EffectsQuality; effects: boolean; diagnostics: ReturnType<Effects['diagnostics']> | null };
};
type BenchWindow = Window & { __chatdomReady?: boolean; __chatdomEffects?: BenchApi };

const QUALITIES: readonly EffectsQuality[] = ['low', 'balanced', 'high'];
const WIND = [0.6, 0, 0.25] as const;
const query = new URLSearchParams(location.search);
const finite = (name: string, fallback: number) => { const value = Number(query.get(name) ?? fallback); return Number.isFinite(value) ? value : fallback; };
let view: BenchView = BENCH_VIEWS.find(v => v === query.get('view')) ?? 'street';
let quality: EffectsQuality = QUALITIES.find(q => q === query.get('quality')) ?? 'balanced';
let time = finite('time', 12);
let effectsOn = query.get('effects') !== 'off';
const hour = finite('hour', 20), seed = Math.trunc(finite('seed', 7));

const CYCLE = 8, STRIKE = 3.7, LAUNCH = 2.8, LANDING = 5.4, SAMPLE = 1 / 30;
const ease = (u: number) => u * u * (3 - 2 * u);

/** The SIMULATED flight: up out of the forge, over in one arc, down onto the roof ridge. */
function flightPath(anchors: BenchAnchors, u: number): Vec3 {
  const [fx, fy, fz] = anchors.strike, [lx, ly, lz] = anchors.landing, k = ease(Math.min(1, Math.max(0, u)));
  const a: Vec3 = [fx, fy + .5, fz], c: Vec3 = [(fx + lx) / 2, Math.max(fy, ly) + 2.2, (fz + lz) / 2];
  const q = (i: 0 | 1 | 2) => (1 - k) * (1 - k) * a[i] + 2 * (1 - k) * k * c[i] + k * k * [lx, ly + .25, lz][i]!;
  return [q(0), q(1), q(2)];
}

/** Every effect input for the bench clock, from the scene's real anchors and the SIMULATED presence and cues. */
function benchFrame(anchors: BenchAnchors, time: number): EffectsFrame & { piece: Vec3 | null } {
  const cycle = Math.floor(time / CYCLE), start = cycle * CYCLE, local = time - start;
  const launch = start + LAUNCH, landed = start + LANDING, span = LANDING - LAUNCH;
  let flight: EffectsFrame['flight'] = null, piece: Vec3 | null = null;
  if (local >= LAUNCH && local < LANDING + 1.2) {
    // The record a caller would keep: the piece's position each thirtieth of a second since launch.
    const history: FlightSample[] = [];
    for (let t = launch; t < Math.min(time, landed); t += SAMPLE) history.push({ time: t, position: flightPath(anchors, (t - launch) / span) });
    const active = time < landed;
    piece = active ? flightPath(anchors, (time - launch) / span) : null;
    flight = { id: `bench:flight:${cycle}`, position: piece ?? flightPath(anchors, 1), startedAt: launch, active, history };
  }
  return {
    time, wind: WIND, piece, flight,
    fireflies: anchors.fireflySources,
    embers: anchors.emberSources,
    smoke: [...presenceChimneySmoke(anchors.homes, anchors.presence, anchors.presence.asOf), { id: 'forge:hearth:flue', position: anchors.forgeNose }],
    dust: anchors.shafts,
    sparks: [
      { id: 'forge:fire', position: anchors.strike, burstId: `bench:strike:${cycle}`, startedAt: start + STRIKE },
      { id: 'home:1:roof', position: anchors.landing, burstId: `bench:landing:${cycle}`, startedAt: landed },
    ],
  };
}

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
      const inputs = benchFrame(bench.anchors, time);
      bench.setPiece(inputs.piece);
      if (effectsOn && effects) effects.update(inputs);
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
    stats: () => ({ ...bench.stats(), time, view, quality, effects: effectsOn, diagnostics: effects?.diagnostics() ?? null }),
  };
  requestAnimationFrame(frame);
} catch (error) { fail(error); }
