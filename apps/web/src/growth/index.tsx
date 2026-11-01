import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { ProvenanceSeal } from '@chatdom/ui';
import '@chatdom/ui/kit.css';
import { simulateGrowthHistory } from './history';
import { createCeremonyLedger, createRecordedGrowthFeed, type GrowthCeremony } from './ledger';
import { composeScore, sampleScore, type Caption, type GrowthScore, type Shot } from './score';
import { createGrowthStage, type GrowthStage, type GrowthStageReport } from './stage/stage';
import { neighbourHistory, planGrowthTown } from './town';
import type { GrowthSceneFrame } from '@chatdom/shared';
import './growth.css';

export interface GrowthBenchReport extends GrowthStageReport {
  readonly t: number; readonly duration: number; readonly act: string; readonly caption: string; readonly origin: 'SIMULATED';
  readonly ceremonies: number; readonly playing: boolean;
}
interface GrowthBenchControl {
  /** Draw the exact frame at `t` seconds and wait until its light has settled. */
  seek(t: number): Promise<GrowthBenchReport>;
  /**
   * Seek by score position, `act:<kind>[:n]@<seconds|end>` or `end`, optionally holding an evidence view: `close`
   * frames the finished hall, `street` the hut and cottage from across the lane, `wide` the town.
   */
  seekTo(at: string, view: 'close' | 'street' | 'wide' | null): Promise<GrowthBenchReport>;
  play(from?: number): void;
  pause(): void;
  report(): GrowthBenchReport | null;
}
declare global {
  interface Window { __chatdomReady?: boolean; __chatdomGrowth?: GrowthBenchControl; __chatdomGrowthError?: string }
}

const TOWN_YEAR = 2025;

/**
 * Growth over time, watched as one dusk sequence: a plot kept for a new citizen grows hut to hall through the real
 * growth policy, the street grows around it, and a year on the town opens its next quarter. The history is SIMULATED
 * and labelled so; the stage consumes it through the same feed contract and ceremony ledger a live room will use.
 */
export default function GrowthBench() {
  let canvas!: HTMLCanvasElement;
  const query = new URLSearchParams(location.search);
  const seed = (query.get('seed') ?? 'hearthmoor').slice(0, 40) || 'hearthmoor';
  const hour = Number.isFinite(Number(query.get('hour'))) && query.has('hour') ? Number(query.get('hour')) : 19.6;
  const still = query.has('t');
  const [progress, setProgress] = createSignal<{ text: string; fraction: number } | null>({ text: 'Remembering a year of evenings', fraction: 0 });
  const [caption, setCaption] = createSignal<Caption | null>(null);
  const [alpha, setAlpha] = createSignal(0);
  const [ended, setEnded] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  let stage: GrowthStage | undefined, score: GrowthScore | undefined, raf = 0, t = 0, playing = !still, last = performance.now(), ceremonies = 0;
  /** Evidence only: one fixed view for same-view before/after stills. Playback never sets it. */
  let held: Shot | null = null;
  const abort = new AbortController();

  const report = (): GrowthBenchReport | null => {
    if (!stage || !score) return null;
    const sample = sampleScore(score, t);
    return { ...stage.report(), t, duration: score.duration, act: sample.act.kind, caption: `${sample.caption.kicker} · ${sample.caption.line}`, origin: 'SIMULATED', ceremonies, playing };
  };
  const show = (dt: number, seeking: boolean) => {
    if (!stage || !score) return;
    const scored = sampleScore(score, t);
    const sample = held ? { ...scored, camera: { from: held, to: held, blend: 1, local: 0, fromLocal: 0 } } : scored;
    stage.frame(sample, dt, seeking);
    setCaption(sample.caption); setAlpha(sample.captionAlpha);
  };
  const loop = (now: number) => {
    const dt = Math.min(.1, (now - last) / 1000); last = now;
    try {
      // A paused picture is drawn only when something asks for it; SwiftShader captures depend on that.
      if (playing && score) {
        t = Math.min(score.duration, t + dt); if (t >= score.duration) { playing = false; setEnded(true); }
        show(dt, false);
      }
      raf = requestAnimationFrame(loop);
    } catch (error) { fail(error); }
  };
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Growth bench failed', error);
    window.__chatdomGrowthError = message; setFailure(message);
  };

  onMount(() => {
    const resize = new ResizeObserver(() => stage?.resize()); resize.observe(canvas);
    onCleanup(() => resize.disconnect());
    void (async () => {
      try {
        await new Promise(resolve => setTimeout(resolve, 30));
        const town = planGrowthTown(seed, TOWN_YEAR);
        const history = simulateGrowthHistory({ heroPlotId: town.hero.id, neighbours: neighbourHistory(town) });
        // The stage hears the history only through the feed contract and the ledger, as it would hear a room.
        const ledger = createCeremonyLedger(), owed: GrowthCeremony[] = [];
        let bootstrap: GrowthSceneFrame | undefined, latest: GrowthSceneFrame | undefined;
        const feed = createRecordedGrowthFeed(history.frames);
        const stop = feed.subscribe(frame => { const update = ledger.accept(frame); if (!update.accepted) return; bootstrap ??= frame; latest = frame; owed.push(...update.ceremonies); }, () => fail(new Error('The growth history could not be read.')));
        stop();
        if (!bootstrap || !latest) throw new Error('The growth history is empty.');
        ceremonies = owed.length;
        const turned = new Date(latest.asOf).getUTCFullYear() > TOWN_YEAR;
        const openedAt = history.frames.find(frame => new Date(frame.asOf).getUTCFullYear() > TOWN_YEAR)?.asOf ?? latest.asOf;
        score = composeScore({ heroPlotId: town.hero.id, street: town.hero.street, bootstrap, ceremonies: owed,
          quarter: turned ? { name: town.quarter.name, year: town.quarter.year, openedAt } : null });
        stage = await createGrowthStage({ canvas, town, hour, signal: abort.signal, onProgress: (text, fraction) => setProgress({ text, fraction }) });
        t = still ? Math.max(0, Math.min(score.duration, Number(query.get('t')) || 0)) : 0;
        show(1 / 60, true);
        setProgress(null);
        window.__chatdomGrowth = {
          async seek(at) {
            playing = false; setEnded(false); t = Math.max(0, Math.min(score!.duration, at));
            show(1 / 60, true);
            // The light fields solve in workers; wait for them, then draw the settled picture once more.
            for (let i = 0; i < 600 && !stage!.settled(); i++) await new Promise(resolve => setTimeout(resolve, 50));
            show(1 / 60, true);
            for (let i = 0; i < 600 && !stage!.settled(); i++) await new Promise(resolve => setTimeout(resolve, 50));
            show(1 / 60, true);
            return report()!;
          },
          seekTo(at, view) {
            const match = /^act:([a-z]+)(?::(\d+))?@(end|[0-9.]+)$/.exec(at);
            let target = score!.duration - .01;
            if (match) {
              const acts = score!.acts.filter(act => act.kind === match[1]), act = acts[Number(match[2] ?? 0)];
              if (!act) throw new Error(`The score has no ${at}.`);
              target = match[3] === 'end' ? act.end - .3 : act.start + Number(match[3]);
            } else if (at !== 'end') throw new Error(`Unknown score position ${at}.`);
            held = view === 'close' ? { kind: 'lot', side: 1, stage: 'hall', drift: 0 } : view === 'street' ? { kind: 'lot', side: 1, stage: 'cottage', drift: 0 }
              : view === 'wide' ? { kind: 'quarter', drift: 0 } : null;
            return window.__chatdomGrowth!.seek(target);
          },
          play(from) { held = null; if (from !== undefined) t = from; playing = true; setEnded(false); last = performance.now(); },
          pause() { playing = false; },
          report,
        } as GrowthBenchControl;
        last = performance.now();
        raf = requestAnimationFrame(loop);
        window.__chatdomReady = true;
      } catch (error) { if (!abort.signal.aborted) fail(error); }
    })();
  });
  onCleanup(() => { abort.abort(); cancelAnimationFrame(raf); stage?.dispose(); delete window.__chatdomGrowth; });

  return <div class="growth cd-kit" data-growth-surface="sequence">
    <canvas ref={element => { canvas = element; }} class="growth-canvas" aria-label="A home growing from hut to hall at dusk, and the town opening a new quarter around it" />
    <div class="growth-shade" aria-hidden="true" />
    <Show when={caption()}>{line => <figure class="growth-caption" style={{ opacity: alpha() }} aria-live="polite">
      <p class="growth-kicker">{line().kicker}</p>
      <div class="growth-rule" aria-hidden="true"><span /></div>
      <figcaption class="growth-line">{line().line}</figcaption>
      <Show when={line().note}>{note => <p class="growth-note">{note()}</p>}</Show>
    </figure>}</Show>
    <ProvenanceSeal class="growth-seal" state="simulated" detail="A year of evenings, earned through the growth rules" />
    <Show when={progress()}>{state => <div class="growth-loading" role="status">
      <p class="growth-kicker">Growth over time</p>
      <p class="growth-line">{state().text}</p>
      <div class="growth-candle" aria-hidden="true"><span style={{ width: `${Math.round(state().fraction * 100)}%` }} /></div>
    </div>}</Show>
    <Show when={ended()}>
      <button class="growth-again" type="button" onClick={() => window.__chatdomGrowth?.play(0)}>Watch the year again</button>
    </Show>
    <Show when={failure()}>{message => <div class="growth-loading growth-failed" role="alert">
      <p class="growth-kicker">The sequence could not be drawn</p><p class="growth-line">{message()}</p>
    </div>}</Show>
  </div>;
}
