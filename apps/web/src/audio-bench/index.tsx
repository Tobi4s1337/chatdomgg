import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import {
  createKingdomAudio, FINISHED_FAMILIES, inspectKingdomAudio, renderKingdomAudio,
  type AudioCue, type AudioCueOptions, type KingdomAudio, type KingdomAudioInspection, type KingdomAudioState,
} from '../../../../packages/audio/src/index';
import './bench.css';

interface LogLine { at: string; text: string; tone: 'ok' | 'quiet' | 'refused' }

interface Family {
  key: string;
  title: string;
  surface: string;
  line: string;
  action: string;
  cue: AudioCue;
  options?: AudioCueOptions;
  variations: string[];
}

const FAMILIES: Family[] = [
  {
    key: 'wood:wood', title: 'Wooden control', surface: 'carved wood', cue: 'wood', action: 'Knock',
    line: 'A press with the weight of a small carved block: a real knock, its ring, and a soft thock beneath.',
    variations: ['centre', 'edge', 'corner'],
  },
  {
    key: 'wood:brass', title: 'Brass lever', surface: 'brass in wood', cue: 'wood', options: { ui: 'brass' }, action: 'Tick',
    line: 'A small brass lever seating in its wooden mount: a tuned tap, a short ring the finger damps, the mount beneath.',
    variations: ['tip', 'middle', 'heel'],
  },
  {
    key: 'wood:parchment', title: 'Parchment', surface: 'paper', cue: 'wood', options: { ui: 'parchment' }, action: 'Turn',
    line: 'A sheet moved by hand: fingers on the paper, the page turning, a soft settle on the desk.',
    variations: ['first', 'second', 'third'],
  },
  {
    key: 'light', title: 'A window lights', surface: 'glass, wick and glow', cue: 'light', action: 'Light a window',
    line: 'Someone came home. A fingertip of glass, the wick catching, then a warm glow that settles.',
    variations: ['F♯', 'A', 'D'],
  },
  {
    key: 'wave', title: 'The street lights up', surface: 'five windows', cue: 'wave', action: 'Light the street',
    line: 'Window after window along the houses, each a small light of its own, gathering into one soft chord.',
    variations: ['left to right', 'right to left', 'from the middle'],
  },
  {
    key: 'beacon', title: 'The castle beacon', surface: 'fire and chord', cue: 'beacon', action: 'Light the beacon',
    line: 'The torch set in the brazier, the fire catching, then a broad warm chord that crests and returns to quiet.',
    variations: ['with E', 'with B', 'open'],
  },
];

interface SequenceStep { at: number; label: string; cue: AudioCue; options?: AudioCueOptions }

/** Bench timings: the kingdom decides the real ones from who is home. */
const SEQUENCES: { key: string; title: string; action: string; steps: SequenceStep[] }[] = [
  {
    key: 'ceremony', title: 'The light ceremony', action: 'Play the ceremony',
    steps: [{ at: 0, label: 'a window', cue: 'light' }, { at: 1.6, label: 'the street', cue: 'wave' }, { at: 4.2, label: 'the beacon', cue: 'beacon' }],
  },
  {
    key: 'four', title: 'Four cues in a row', action: 'Play all four',
    steps: [{ at: 0, label: 'a knock', cue: 'wood' }, { at: 0.7, label: 'a window', cue: 'light' }, { at: 2.6, label: 'the street', cue: 'wave' }, { at: 5.6, label: 'the beacon', cue: 'beacon' }],
  },
];

type StepState = 'waiting' | 'played' | 'silent';

const UNFINISHED: { label: string; cue: AudioCue; options?: AudioCueOptions }[] = [
  { label: 'Footstep', cue: 'step' },
  { label: 'Place', cue: 'place' },
  { label: 'Remove', cue: 'remove' },
  { label: 'Material', cue: 'material' },
];

const STATUS_WORDS: Record<KingdomAudioState['status'], string> = {
  locked: 'Locked', ready: 'Ready', suspended: 'Suspended', unavailable: 'Unavailable', disposed: 'Closed',
};

function clock(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false });
}

function decibels(peak: number): string {
  return peak <= 0.00001 ? 'silent' : `${(20 * Math.log10(peak)).toFixed(1)} dBFS`;
}

export default function AudioBench(): JSX.Element {
  let audio: KingdomAudio = createKingdomAudio();
  const [state, setState] = createSignal<KingdomAudioState>(audio.getState());
  const [inspection, setInspection] = createSignal<KingdomAudioInspection>(inspectKingdomAudio(audio));
  const [peak, setPeak] = createSignal(0);
  const [held, setHeld] = createSignal(0);
  const [waking, setWaking] = createSignal(false);
  const [log, setLog] = createSignal<LogLine[]>([]);
  const [lastPlayed, setLastPlayed] = createSignal<Record<string, { variation: number; at: number }>>({});
  const [runs, setRuns] = createSignal<Record<string, StepState[]>>({});
  let timers: number[] = [];

  const note = (text: string, tone: LogLine['tone']) => setLog(lines => [{ at: clock(), text, tone }, ...lines].slice(0, 7));
  const refresh = () => { setState(audio.getState()); setInspection(inspectKingdomAudio(audio)); };

  const poll = window.setInterval(refresh, 150);
  let frame = 0;
  const meter = () => {
    const level = inspectKingdomAudio(audio).level();
    setPeak(level);
    setHeld(previous => Math.max(level, previous * 0.94));
    frame = requestAnimationFrame(meter);
  };
  frame = requestAnimationFrame(meter);
  const stopSequences = () => { for (const timer of timers) window.clearTimeout(timer); timers = []; };
  onCleanup(() => { window.clearInterval(poll); cancelAnimationFrame(frame); stopSequences(); audio.dispose(); });

  const audible = () => state().status === 'ready' && !state().settings.muted && state().settings.volume > 0;
  const silentReason = () => {
    const current = state();
    if (current.status !== 'ready') return `sound is ${STATUS_WORDS[current.status].toLowerCase()}`;
    if (current.settings.muted) return 'muted';
    if (current.settings.volume === 0) return 'volume at zero';
    return '';
  };

  async function wake() {
    setWaking(true);
    note('Asked the browser to wake the sound…', 'quiet');
    const ok = await audio.unlock();
    setWaking(false);
    refresh();
    note(ok ? 'unlock() → true: the context is running' : `unlock() → false: still ${STATUS_WORDS[audio.getState().status].toLowerCase()}`, ok ? 'ok' : 'refused');
  }

  function play(family: Family) {
    const ok = audio.cue(family.cue, family.options);
    refresh();
    if (ok) {
      const variation = inspectKingdomAudio(audio).variations[family.key] ?? 0;
      setLastPlayed(previous => ({ ...previous, [family.key]: { variation, at: performance.now() } }));
      note(`${family.title} · ${family.variations[variation]} → played`, 'ok');
    } else {
      note(`${family.title} → not played (${silentReason() || 'held back by the mix'})`, 'quiet');
    }
  }

  /** Plays a sequence step by step through the same `cue()` calls; each step shows what the library answered. */
  function runSequence(sequence: (typeof SEQUENCES)[number]) {
    stopSequences();
    setRuns({ [sequence.key]: sequence.steps.map((): StepState => 'waiting') });
    note(`${sequence.title}: started`, 'quiet');
    sequence.steps.forEach((step, index) => {
      timers.push(window.setTimeout(() => {
        const ok = audio.cue(step.cue, step.options);
        refresh();
        setRuns(previous => {
          const states = [...(previous[sequence.key] ?? [])];
          states[index] = ok ? 'played' : 'silent';
          return { ...previous, [sequence.key]: states };
        });
        const family = FAMILIES.find(item => item.cue === step.cue && !item.options);
        if (ok && family) {
          const variation = inspectKingdomAudio(audio).variations[family.key] ?? 0;
          setLastPlayed(previous => ({ ...previous, [family.key]: { variation, at: performance.now() } }));
        }
        note(`${sequence.title} · ${step.label} → ${ok ? 'played' : `not played (${silentReason() || 'held back by the mix'})`}`, ok ? 'ok' : 'quiet');
      }, step.at * 1000));
    });
  }

  function tryUnfinished(item: (typeof UNFINISHED)[number]) {
    try {
      const ok = audio.cue(item.cue, item.options);
      note(`${item.label} → ${ok ? 'played' : 'not played'}`, ok ? 'ok' : 'quiet');
    } catch (error) {
      note(`${item.label} refused: ${error instanceof Error ? error.message.replace('kingdom audio: ', '') : String(error)}`, 'refused');
    }
  }

  function setVolume(value: number) {
    audio.setSettings({ volume: value / 100 });
    refresh();
  }

  function toggleMute() {
    const muted = !audio.getState().settings.muted;
    audio.setSettings({ muted });
    refresh();
    note(muted ? 'Muted: the master fades to silence' : 'Unmuted', 'quiet');
  }

  function close() {
    stopSequences();
    audio.dispose();
    refresh();
    note('dispose(): voices stopped, context closed', 'quiet');
  }

  function fresh() {
    const settings = audio.getState().settings;
    stopSequences();
    setRuns({});
    audio.dispose();
    audio = createKingdomAudio(settings);
    exposeForChecks();
    setLastPlayed({});
    refresh();
    note('A new instance: locked until you wake it', 'quiet');
  }

  function exposeForChecks() {
    Object.assign(window, { __chatdomAudio: audio, __chatdomAudioRender: renderKingdomAudio, __chatdomAudioInspect: inspectKingdomAudio });
  }
  exposeForChecks();
  requestAnimationFrame(() => { (window as Window & { __chatdomReady?: boolean }).__chatdomReady = true; });

  const samples = () => inspection().samples;
  const meterWidth = (value: number) => `${Math.min(100, Math.max(0, (20 * Math.log10(Math.max(value, 1e-5)) + 60) / 60 * 100))}%`;

  return <div class="audio-bench">
    <header class="ab-head">
      <p class="ab-eyebrow">Chatdom · Sound bench</p>
      <p class="ab-simulated"><strong>SIMULATED</strong> A listening bench. Nothing here happens in a kingdom.</p>
      <h1>The sound of a handmade kingdom</h1>
      <p class="ab-lede">Wake the sound with a click, then press the controls, light a window, the street and the castle beacon. Every press goes through the same mix the kingdom uses.</p>
    </header>

    <div class="ab-layout">
      <section class="ab-plaque" aria-label="Sound state">
        <div class="ab-status" data-status={state().status}>
          <span class="ab-lamp" aria-hidden="true" />
          <div>
            <p class="ab-label">Sound</p>
            <p class="ab-value" data-testid="audio-status">{STATUS_WORDS[state().status]}</p>
          </div>
          <div class="ab-audible">
            <p class="ab-label">Audible</p>
            <p class="ab-value" data-testid="audio-audible">{audible() ? 'Yes' : 'No'}</p>
          </div>
        </div>
        <Show when={!audible()}><p class="ab-why">Silent because {silentReason()}.</p></Show>

        <button class="ab-wake" type="button" onClick={() => void wake()} disabled={waking() || state().status === 'disposed' || state().status === 'ready'}>
          {waking() ? 'Waking…' : state().status === 'ready' ? 'Awake' : 'Wake the sound'}
        </button>

        <div class="ab-meter" aria-label={`Output ${decibels(peak())}`}>
          <div class="ab-meter-fill" style={{ width: meterWidth(peak()) }} />
          <div class="ab-meter-hold" style={{ left: meterWidth(held()) }} />
        </div>
        <p class="ab-meter-read"><span>Output</span><span data-testid="audio-peak">{decibels(held())}</span></p>

        <div class="ab-row">
          <button class="ab-toggle" type="button" aria-pressed={state().settings.muted} onClick={toggleMute} disabled={state().status === 'disposed'}>
            {state().settings.muted ? 'Unmute' : 'Mute'}
          </button>
          <label class="ab-volume">
            <span>Volume <b>{Math.round(state().settings.volume * 100)}</b></span>
            <input type="range" min="0" max="100" step="1" value={Math.round(state().settings.volume * 100)}
              onInput={event => setVolume(Number(event.currentTarget.value))} disabled={state().status === 'disposed'} />
          </label>
        </div>

        <dl class="ab-facts">
          <div><dt>Browser context</dt><dd data-testid="audio-context">{inspection().contextState ?? 'not made yet'}</dd></div>
          <div><dt>Recorded foley</dt><dd>{samples().state === 'idle' ? 'loads on wake' : `${samples().loaded} of ${samples().total} decoded`}</dd></div>
          <div><dt>Voices</dt><dd data-testid="audio-voices">{inspection().voices} of 16</dd></div>
          <div><dt>Layers</dt><dd>{inspection().sources} of 64</dd></div>
        </dl>
        <Show when={samples().failures.length}><p class="ab-failure" role="alert">Could not load: {samples().failures.join('; ')}</p></Show>

        <div class="ab-row ab-lifecycle">
          <button type="button" class="ab-quiet" onClick={close} disabled={state().status === 'disposed'}>Close the sound</button>
          <button type="button" class="ab-quiet" onClick={fresh}>New instance</button>
        </div>
      </section>

      <section class="ab-cues" aria-label="Cues">
        <For each={FAMILIES}>{family => {
          const last = () => lastPlayed()[family.key];
          return <article class="ab-card" data-family={family.key}>
            <header>
              <h2>{family.title}</h2>
              <p class="ab-surface">{family.surface}</p>
            </header>
            <p class="ab-line">{family.line}</p>
            <div class="ab-variations" aria-label="Variations">
              <For each={family.variations}>{(name, index) =>
                <span classList={{ 'ab-pip': true, 'ab-pip-on': last()?.variation === index() }}>{name}</span>}
              </For>
            </div>
            <button type="button" class="ab-play" data-cue={family.key} onClick={() => play(family)} disabled={!FINISHED_FAMILIES.includes(family.key)}>
              {family.action}
            </button>
          </article>;
        }}</For>

        <article class="ab-card ab-sequences">
          <header>
            <h2>Hear them together</h2>
            <p class="ab-surface">one mix, real calls</p>
          </header>
          <p class="ab-line">The same cues in order, so each can be compared with how it sits beside the others. Every step is a real call and shows what came back.</p>
          <For each={SEQUENCES}>{sequence => <div class="ab-sequence" data-sequence={sequence.key}>
            <ol class="ab-steps">
              <For each={sequence.steps}>{(step, index) => {
                const stepState = () => runs()[sequence.key]?.[index()];
                return <li class="ab-step" data-state={stepState() ?? 'idle'}>
                  <time>{step.at.toFixed(1)} s</time>
                  <span>{step.label}</span>
                </li>;
              }}</For>
            </ol>
            <button type="button" class="ab-play ab-play-wide" data-run={sequence.key} onClick={() => runSequence(sequence)}>{sequence.action}</button>
          </div>}</For>
        </article>

        <article class="ab-card ab-unfinished">
          <header>
            <h2>Still being carved</h2>
            <p class="ab-surface">refused, never faked</p>
          </header>
          <p class="ab-line">These families are not finished yet, so the library refuses them out loud instead of playing a stand-in. Try one.</p>
          <div class="ab-chips">
            <For each={UNFINISHED}>{item => <button type="button" class="ab-chip" onClick={() => tryUnfinished(item)}>{item.label}</button>}</For>
          </div>
        </article>

        <section class="ab-log" aria-label="What happened">
          <h2>What happened</h2>
          <Show when={log().length} fallback={<p class="ab-log-empty">Nothing yet. The sound stays locked until a click wakes it.</p>}>
            <ol>
              <For each={log()}>{line => <li data-tone={line.tone}><time>{line.at}</time><span>{line.text}</span></li>}</For>
            </ol>
          </Show>
        </section>
      </section>
    </div>
  </div>;
}
