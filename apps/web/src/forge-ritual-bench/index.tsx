import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { FORGE_STAGE_TIMING } from '@chatdom/forge';
import type { ForgePhase } from '@chatdom/shared';
import { createForgeStage, type ForgePresentation, type StageEnvironment } from '../forge/presentation/stage';
import { benchFrame } from './clock';
import { parseRitualBench, RITUAL_SECONDS, type RitualBenchState } from './params';
import { createBenchSound, type BenchRenderPlan, type BenchSoundReport } from './sound';
import { createRitualWorld, type RitualWorld } from './world';
import './style.css';

export interface RitualBenchReport {
  t: number; phase: ForgePhase | null; progress: number; held: number; cleared: boolean; reduced: boolean;
  part: string; family: string; triangles: number; draws: number; width: number; height: number;
  /** Owned effect objects currently drawn, and whether the borrowed clone is shown. */
  shown: string[]; pieceShown: boolean;
}
interface RitualBenchControl {
  seek(t: number): RitualBenchReport;
  gate(seconds: number | null): RitualBenchReport;
  clear(): RitualBenchReport;
  motion(reduced: boolean): RitualBenchReport;
  report(): RitualBenchReport;
  sound: {
    report(): BenchSoundReport;
    mix(muted: boolean, volume: number): BenchSoundReport;
    second(offset: number | null): BenchSoundReport;
    refusal(variant: 0 | 1 | 2): BenchSoundReport;
    render(plan: BenchRenderPlan): ReturnType<ReturnType<typeof createBenchSound>['render']>;
    host(): { context: AudioContext; bus: GainNode } | null;
  };
}
declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomForgeRitual?: RitualBenchControl;
    __chatdomForgeRitualError?: string;
  }
}

const CAPTIONS: Record<ForgePhase, string> = {
  words: 'Words find their shape', blueprint: 'A wish, drawn in light', pour: 'Molten metal fills the drawing',
  seal: 'Sealed: fit for this home', strike: 'One strike', cool: 'Cooling into the kingdom’s colours',
  flight: 'Off to its home', landed: 'Home, on its socket',
};
const STAGE_NAMES: Record<ForgePhase, string> = { words: 'Words', blueprint: 'Blueprint', pour: 'Pour', seal: 'Seal', strike: 'Strike', cool: 'Cool', flight: 'Flight', landed: 'Landed' };
const STAGES = FORGE_STAGE_TIMING.map(([phase, from, to]) => ({ phase, from, to }));
const PARTS = [['chimney', 'Dragon chimney'], ['lantern', 'Moon lantern'], ['weathervane', 'Owl vane']] as const;
const KITS = [['hearth', 'Hearth'], ['tide', 'Tide'], ['grove', 'Grove']] as const;
const RITUAL_ID = 'bench-simulated-ritual';

/** A SIMULATED review bench for the Forge ritual's presentation, around main's real assembled part. */
export default function ForgeRitualBench() {
  let host!: HTMLDivElement;
  let disposed = false, world: RitualWorld | undefined, presentation: ForgePresentation | undefined, raf = 0;
  const [input, setInput] = createSignal<RitualBenchState>();
  const [status, setStatus] = createSignal('Setting the words on the anvil…');
  const [failed, setFailed] = createSignal(false);
  const [title, setTitle] = createSignal('');
  const [sky, setSky] = createSignal('');
  const [time, setTime] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [gate, setGate] = createSignal<number | null>(null);
  const [cleared, setCleared] = createSignal(false);
  const [reduced, setReduced] = createSignal(false);
  const [phase, setPhase] = createSignal<ForgePhase | null>(null);
  const [held, setHeld] = createSignal(0);
  const [soundOn, setSoundOn] = createSignal(false);
  const [muted, setMuted] = createSignal(false);
  const [volume, setVolume] = createSignal(.65);
  const [second, setSecond] = createSignal(false);
  const sound = createBenchSound();
  const motionListeners = new Set<() => void>(), cleanups: (() => void)[] = [];

  const report = (): RitualBenchReport => {
    const s = input()!, { frame, held: wait } = benchFrame(RITUAL_ID, time(), gate());
    return {
      t: time(), phase: cleared() ? null : frame.phase, progress: frame.phaseProgress, held: wait, cleared: cleared(), reduced: reduced(),
      part: s.part, family: s.family, triangles: world?.triangles ?? 0, draws: world?.renderer.info.render.calls ?? 0,
      width: host.clientWidth, height: host.clientHeight,
      shown: world ? world.effects.children.filter(o => o.visible).map(o => o.name) : [], pieceShown: world?.piece.visible ?? false,
    };
  };
  /** Presents the current simulated observation and finishes the GPU work, so a capture sees this exact state. */
  const draw = () => {
    if (!world || !presentation) return;
    const { frame, held: wait } = benchFrame(RITUAL_ID, time(), gate());
    presentation.update(cleared() ? null : frame);
    sound.update(cleared() ? null : frame, time());
    setPhase(cleared() ? null : frame.phase); setHeld(wait);
    world.direct(cleared() ? null : frame.phase, frame.phaseProgress, reduced());
    world.renderer.render(world.scene, world.camera);
    world.renderer.getContext().finish();
  };
  const loop = (now: number, then = now) => {
    if (disposed) return;
    if (playing()) setTime(t => t + Math.min(.1, (now - then) / 1000));
    draw();
    raf = window.requestAnimationFrame(next => loop(next, now));
  };
  /** The first press is the gesture that makes and starts the context; later presses mute and unmute. */
  const toggleSound = async () => {
    if (!sound.on) { setSoundOn(await sound.enable()); setMuted(false); sound.setMix({ muted: false }); return; }
    if (!soundOn()) { setSoundOn(await sound.enable()); return; }
    setMuted(m => !m); sound.setMix({ muted: muted() });
  };
  const setMotion = (value: boolean) => { setReduced(value); motionListeners.forEach(listener => listener()); draw(); };
  const play = () => { if (cleared() || time() >= RITUAL_SECONDS + 4) setTime(0); setCleared(false); setPlaying(p => !p); };
  const seek = (t: number) => { setPlaying(false); setCleared(false); setTime(Math.max(0, t)); draw(); };
  const navigate = (key: string, value: string) => { const params = new URLSearchParams(window.location.search); params.set(key, value); params.delete('t'); window.location.search = params.toString(); };

  onMount(() => {
    window.__chatdomReady = false;
    delete window.__chatdomForgeRitualError;
    void (async () => {
      const s = parseRitualBench(window.location.search);
      setInput(s);
      const media = window.matchMedia('(prefers-reduced-motion: reduce)');
      setReduced(s.motion === 'system' ? media.matches : s.motion === 'reduce');
      const follow = () => { if (input()?.motion === 'system') setMotion(media.matches); };
      media.addEventListener('change', follow);
      cleanups.push(() => media.removeEventListener('change', follow));
      setGate(s.gate);
      const built = await createRitualWorld(host, s.part, s.family, s.hour, () => !disposed);
      if (!built) return;
      world = built;
      setTitle(built.title); setSky(built.sky);
      const environment: StageEnvironment = {
        reducedMotion: () => reduced(),
        subscribe(listener) { motionListeners.add(listener); return () => motionListeners.delete(listener); },
        phone: window.matchMedia('(max-width: 640px), (pointer: coarse)').matches,
      };
      presentation = createForgeStage({ root: built.effects, anvil: built.anvil, landing: built.landing, piece: built.piece }, environment);
      const resize = () => { built.aim(host.clientWidth, host.clientHeight); draw(); };
      built.aim(host.clientWidth, host.clientHeight);
      setTime(s.t ?? 0);
      const { frame } = benchFrame(RITUAL_ID, time(), gate());
      presentation.update(frame);
      await built.renderer.compileAsync(built.scene, built.camera);
      if (disposed) return;
      draw();
      await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
      if (disposed) return;
      draw();
      window.addEventListener('resize', resize);
      cleanups.push(() => window.removeEventListener('resize', resize));
      window.__chatdomForgeRitual = {
        seek: t => { seek(t); return report(); },
        gate: seconds => { setGate(seconds); draw(); return report(); },
        clear: () => { setPlaying(false); setCleared(true); draw(); return report(); },
        motion: value => { setMotion(value); return report(); },
        report,
        sound: {
          report: () => sound.report(),
          mix: (m, v) => { setMuted(m); setVolume(v); sound.setMix({ muted: m, volume: v }); return sound.report(); },
          second: offset => { sound.setSecond(offset); setSecond(offset !== null); return sound.report(); },
          refusal: variant => { sound.refusal(variant); return sound.report(); },
          render: plan => sound.render(plan),
          host: () => sound.host,
        },
      };
      setStatus('');
      if (s.t === null) setPlaying(true);
      raf = window.requestAnimationFrame(now => loop(now));
      window.__chatdomReady = true;
    })().catch(error => {
      if (disposed) return;
      const message = error instanceof Error ? error.message : String(error);
      window.__chatdomForgeRitualError = message;
      setStatus(message); setFailed(true);
      console.error(message);
    });
  });
  onCleanup(() => {
    disposed = true; window.cancelAnimationFrame(raf); cleanups.forEach(c => c());
    presentation?.dispose(); world?.dispose(); sound.dispose();
    delete window.__chatdomForgeRitual; window.__chatdomReady = false;
  });

  const caption = () => {
    if (cleared()) return 'The anvil is clear';
    const p = phase();
    if (held() > 0) return `Waiting at the ${p ?? 'gate'} · ${held().toFixed(held() < 10 ? 1 : 0)} s`;
    return p ? CAPTIONS[p] : '';
  };
  const span = RITUAL_SECONDS;
  return <section class="ritual-bench" style={{ background: sky() || undefined }}>
    <div ref={element => { host = element; }} class="ritual-bench-stage" />
    <header class="ritual-bench-head">
      <span class="ritual-eyebrow">CHATDOM · THE FORGE</span>
      <strong>{title() || 'The Forge ritual'}</strong>
      <p class="ritual-caption" aria-live="polite">{caption()}</p>
      <small class="ritual-simulated">SIMULATED · local timing, no live judges</small>
    </header>
    <Show when={input() && !status()}>
      <div class="ritual-controls" role="group" aria-label="Ritual review controls">
        <div class="ritual-row">
          <button class="ritual-play" onClick={play} aria-label={playing() ? 'Pause' : 'Play'}>{playing() ? '❚❚' : '▶'}</button>
          <div class="ritual-track">
            <input type="range" min="0" max={span} step="0.05" value={Math.min(time(), span)} aria-label="Seek the ritual" onInput={e => seek(Number(e.currentTarget.value))} />
            <div class="ritual-stages" aria-hidden="true"><For each={STAGES}>{stage => <span style={{ width: `${(stage.to - stage.from) / span * 100}%` }} classList={{ on: phase() === stage.phase }} title={STAGE_NAMES[stage.phase]} />}</For></div>
          </div>
          <output class="ritual-time"><b>{phase() ? STAGE_NAMES[phase()!] : '—'}</b>{Math.min(time(), span + 99).toFixed(1)} s</output>
        </div>
        <div class="ritual-row ritual-toggles">
          <button aria-pressed={gate() !== null} onClick={() => { setGate(gate() === null ? Math.min(time(), span) : null); draw(); }}>{gate() === null ? 'Hold here' : 'Release hold'}</button>
          <button onClick={() => { setPlaying(false); setCleared(true); draw(); }}>Clear</button>
          <button aria-pressed={reduced()} onClick={() => setMotion(!reduced())}>Reduced motion</button>
        </div>
        <div class="ritual-row ritual-sound">
          <button aria-pressed={soundOn() && !muted()} onClick={() => void toggleSound()} aria-label={soundOn() && !muted() ? 'Mute the forge' : 'Hear the forge'}>{!soundOn() ? 'Sound on' : muted() ? 'Unmute' : 'Mute'}</button>
          <input type="range" min="0" max="1" step="0.01" value={volume()} aria-label="Forge volume" disabled={!soundOn()} onInput={e => { setVolume(Number(e.currentTarget.value)); sound.setMix({ volume: volume() }); }} />
          <button disabled={!soundOn()} onClick={() => sound.refusal(0)} title="A SIMULATED refusal beat: the forge coughs">Cough</button>
        </div>
        <div class="ritual-row ritual-pick">
          <select aria-label="Part" value={input()!.part} onChange={e => navigate('part', e.currentTarget.value)}><For each={PARTS}>{([value, label]) => <option value={value}>{label}</option>}</For></select>
          <select aria-label="Kingdom kit" value={input()!.family} onChange={e => navigate('family', e.currentTarget.value)}><For each={KITS}>{([value, label]) => <option value={value}>{label}</option>}</For></select>
        </div>
        <p class="ritual-note">SIMULATED local run around a real forged part. Nothing is judged, attached or saved here.<Show when={second()}> A SIMULATED second anvil is heard alongside.</Show></p>
      </div>
    </Show>
    <Show when={status()}><div class="ritual-status" role={failed() ? 'alert' : 'status'}><strong>{failed() ? 'The anvil could not be lit' : 'At the anvil'}</strong><p>{status()}</p></div></Show>
  </section>;
}
