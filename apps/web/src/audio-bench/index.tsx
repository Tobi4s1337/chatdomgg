import { createSignal, For, onCleanup, Show, type JSX } from 'solid-js';
import {
  AUDIO_MATERIALS, createKingdomAudio, FINISHED_FAMILIES, inspectKingdomAudio, renderKingdomAudio,
  type AudioCue, type AudioCueOptions, type AudioMaterial, type KingdomAudio, type KingdomAudioInspection, type KingdomAudioState,
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

interface Call { dt: number; cue: AudioCue; options?: AudioCueOptions }
/** One chip in a sequence: a few real calls that belong together (a surface walked on, a piece set and lifted). */
interface SequenceStep { at: number; label: string; calls: Call[] }

const one = (at: number, label: string, cue: AudioCue, options?: AudioCueOptions): SequenceStep =>
  ({ at, label, calls: [options ? { dt: 0, cue, options } : { dt: 0, cue }] });

/** Four paces on one surface, left and right feet a little apart. */
const walk = (at: number, material: AudioMaterial): SequenceStep => ({
  at, label: material, calls: [0, 0.44, 0.88, 1.32].map((dt, index) => ({ dt, cue: 'step', options: { material, pan: index % 2 ? 0.12 : -0.12 } })),
});

/** Pick a material, set a piece, then lift it out again. */
const build = (at: number, material: AudioMaterial): SequenceStep => ({
  at, label: material, calls: [
    { dt: 0, cue: 'material', options: { material } },
    { dt: 0.55, cue: 'place', options: { material } },
    { dt: 1.35, cue: 'remove', options: { material } },
  ],
});

/** Bench timings: the kingdom decides the real ones from who is home and what is built. */
const SEQUENCES: { key: string; title: string; action: string; steps: SequenceStep[] }[] = [
  {
    key: 'ceremony', title: 'The light ceremony', action: 'Play the ceremony',
    steps: [one(0, 'a window', 'light'), one(1.6, 'the street', 'wave'), one(4.2, 'the beacon', 'beacon')],
  },
  {
    key: 'four', title: 'Four cues in a row', action: 'Play all four',
    steps: [one(0, 'a knock', 'wood'), one(0.7, 'a window', 'light'), one(2.6, 'the street', 'wave'), one(5.6, 'the beacon', 'beacon')],
  },
  {
    key: 'walk', title: 'Walk across every surface', action: 'Walk across',
    steps: AUDIO_MATERIALS.map((material, index) => walk(index * 1.9, material)),
  },
  {
    key: 'build', title: 'Build with every material', action: 'Build with each',
    steps: AUDIO_MATERIALS.map((material, index) => build(index * 2.1, material)),
  },
];

type StepState = 'waiting' | 'played' | 'silent';

interface SurfaceRow { material: AudioMaterial; underfoot: string; inHand: string }

const SURFACE_ROWS: SurfaceRow[] = [
  { material: 'wood', underfoot: 'floorboards', inHand: 'a timber block' },
  { material: 'stone', underfoot: 'flagstones', inHand: 'a dressed stone' },
  { material: 'earth', underfoot: 'a packed path', inHand: 'a clod of soil' },
  { material: 'metal', underfoot: 'an iron plate', inHand: 'a forged fitting' },
  { material: 'glass', underfoot: 'a glass tile', inHand: 'a glass block' },
  { material: 'fabric', underfoot: 'a rug', inHand: 'a folded hanging' },
];

const ACTIONS: { cue: AudioCue; label: string }[] = [
  { cue: 'step', label: 'Step' },
  { cue: 'place', label: 'Set' },
  { cue: 'remove', label: 'Lift' },
  { cue: 'material', label: 'Choose' },
];

interface CrowdResult { requested: number; played: number; peakVoices: number; peakLayers: number; control?: boolean; beacon?: boolean; own: number; ownPlayed: number; running: boolean }

const MATERIAL_WORDS: Record<AudioMaterial, string> = {
  wood: 'Wood', stone: 'Stone', earth: 'Earth', metal: 'Metal', glass: 'Glass', fabric: 'Fabric',
};

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
  const [pan, setPan] = createSignal(0);
  const [distance, setDistance] = createSignal(0);
  const [crowd, setCrowd] = createSignal<CrowdResult>();
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

  const markPlayed = (key: string) => {
    const variation = inspectKingdomAudio(audio).variations[key] ?? 0;
    setLastPlayed(previous => ({ ...previous, [key]: { variation, at: performance.now() } }));
    return variation;
  };
  const familyKey = (call: { cue: AudioCue; options?: AudioCueOptions }) =>
    call.cue === 'wood' ? `wood:${call.options?.ui ?? 'wood'}`
      : ['step', 'place', 'remove', 'material'].includes(call.cue) ? `${call.cue}:${call.options?.material ?? 'wood'}` : call.cue;

  /** Plays a sequence step by step through the same `cue()` calls; each step shows what the library answered. */
  function runSequence(sequence: (typeof SEQUENCES)[number]) {
    stopSequences();
    setRuns({ [sequence.key]: sequence.steps.map((): StepState => 'waiting') });
    note(`${sequence.title}: started`, 'quiet');
    sequence.steps.forEach((step, index) => {
      const answers: boolean[] = [];
      for (const call of step.calls) {
        timers.push(window.setTimeout(() => {
          const ok = audio.cue(call.cue, call.options);
          answers.push(ok);
          refresh();
          if (ok) markPlayed(familyKey(call));
          if (answers.length < step.calls.length) return;
          const all = answers.every(Boolean);
          setRuns(previous => {
            const states = [...(previous[sequence.key] ?? [])];
            states[index] = all ? 'played' : 'silent';
            return { ...previous, [sequence.key]: states };
          });
          const held = answers.filter(answer => !answer).length;
          note(`${sequence.title} · ${step.label} → ${all ? 'played' : `${held} of ${answers.length} not played (${silentReason() || 'held back by the mix'})`}`, all ? 'ok' : 'quiet');
        }, (step.at + call.dt) * 1000));
      }
    });
  }

  function playSurface(cue: AudioCue, material: AudioMaterial) {
    const options: AudioCueOptions = { material, pan: pan(), distance: distance() };
    const ok = audio.cue(cue, options);
    refresh();
    const action = ACTIONS.find(item => item.cue === cue)!.label;
    if (ok) note(`${MATERIAL_WORDS[material]} · ${action.toLowerCase()} · take ${markPlayed(`${cue}:${material}`) + 1} → played`, 'ok');
    else note(`${MATERIAL_WORDS[material]} · ${action.toLowerCase()} → not played (${silentReason() || 'held back by the mix'})`, 'quiet');
  }

  /**
   * A bounded crowd: 120 footstep requests in 1.8 s from walkers 6–36 m away on every surface, your own footsteps
   * close by, a control press and the castle beacon in the middle of it. Everything is a real `cue()` call.
   */
  function crowdBurst() {
    stopSequences();
    const result: CrowdResult = { requested: 0, played: 0, peakVoices: 0, peakLayers: 0, own: 0, ownPlayed: 0, running: true };
    const publish = () => {
      const now = inspectKingdomAudio(audio);
      result.peakVoices = Math.max(result.peakVoices, now.voices);
      result.peakLayers = Math.max(result.peakLayers, now.sources);
      setCrowd({ ...result });
      refresh();
    };
    setCrowd({ ...result });
    note('A crowd walks past: started', 'quiet');
    for (let index = 0; index < 120; index++) {
      timers.push(window.setTimeout(() => {
        result.requested++;
        const material = AUDIO_MATERIALS[index % AUDIO_MATERIALS.length]!;
        if (audio.cue('step', { material, distance: 6 + ((index * 7) % 31), pan: (((index * 37) % 21) - 10) / 10 })) result.played++;
        publish();
      }, index * 15));
    }
    [0.05, 0.5, 0.95, 1.4].forEach((at, index) => timers.push(window.setTimeout(() => {
      result.own++;
      if (audio.cue('step', { material: 'stone', pan: index % 2 ? 0.12 : -0.12 })) result.ownPlayed++;
      publish();
    }, at * 1000 + 7)));
    timers.push(window.setTimeout(() => { result.control = audio.cue('wood'); publish(); }, 520));
    timers.push(window.setTimeout(() => { result.beacon = audio.cue('beacon'); publish(); }, 910));
    timers.push(window.setTimeout(() => {
      result.running = false;
      publish();
      note(`A crowd walks past: ${result.played} of ${result.requested} far steps played, your steps ${result.ownPlayed} of ${result.own}, control ${result.control ? 'answered' : 'not played'}, beacon ${result.beacon ? 'lit' : 'not played'}`, result.control && result.beacon ? 'ok' : 'quiet');
    }, 1950));
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
      <p class="ab-lede">Wake the sound with a click, then press the controls, light a window, the street and the castle beacon, and walk and build on six surfaces. Every press goes through the same mix the kingdom uses.</p>
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

        <article class="ab-card ab-surfaces">
          <header>
            <h2>Six surfaces</h2>
            <p class="ab-surface">walk and build</p>
          </header>
          <p class="ab-line">The same feet and the same hands on wood, stone, earth, metal, glass and cloth. Each surface keeps its own recordings and resonance; try them with your eyes closed. Lit dots show which of three takes played.</p>
          <div class="ab-placement">
            <label>
              <span>From <b>{pan() === 0 ? 'the centre' : `${pan() < 0 ? 'left' : 'right'} ${Math.abs(pan()).toFixed(1)}`}</b></span>
              <input type="range" min="-10" max="10" step="1" value={pan() * 10} onInput={event => setPan(Number(event.currentTarget.value) / 10)} />
            </label>
            <label>
              <span>Distance <b>{distance() === 0 ? 'right here' : `${distance()} m`}</b></span>
              <input type="range" min="0" max="40" step="1" value={distance()} onInput={event => setDistance(Number(event.currentTarget.value))} />
            </label>
          </div>
          <div class="ab-grid">
            <For each={SURFACE_ROWS}>{row => <div class="ab-grid-row" data-material={row.material}>
              <div class="ab-grid-name">
                <strong>{MATERIAL_WORDS[row.material]}</strong>
                <span>{row.underfoot} · {row.inHand}</span>
              </div>
              <For each={ACTIONS}>{item => {
                const key = `${item.cue}:${row.material}`, last = () => lastPlayed()[key];
                return <button type="button" class="ab-cell" data-cue={key} onClick={() => playSurface(item.cue, row.material)} disabled={!FINISHED_FAMILIES.includes(key)}>
                  <span>{item.label}</span>
                  <span class="ab-dots" aria-hidden="true"><For each={[0, 1, 2]}>{take => <i classList={{ 'ab-dot-on': last()?.variation === take }} />}</For></span>
                </button>;
              }}</For>
            </div>}</For>
          </div>
        </article>

        <article class="ab-card ab-crowd">
          <header>
            <h2>A crowd walks past</h2>
            <p class="ab-surface">bounded, not queued</p>
          </header>
          <p class="ab-line">120 footsteps in under two seconds from people 6–36 m away, your own steps close by, a control press and the castle beacon in the middle of it. Far steps give way; the control and the beacon always have room.</p>
          <dl class="ab-crowd-facts" data-running={crowd()?.running ? 'yes' : 'no'}>
            <div><dt>Far steps</dt><dd data-testid="crowd-steps">{crowd() ? `${crowd()!.played} of ${crowd()!.requested}` : '—'}</dd></div>
            <div><dt>Your steps</dt><dd data-testid="crowd-own">{crowd() ? `${crowd()!.ownPlayed} of ${crowd()!.own}` : '—'}</dd></div>
            <div><dt>Control</dt><dd data-testid="crowd-control">{crowd()?.control === undefined ? '—' : crowd()!.control ? 'answered' : 'not played'}</dd></div>
            <div><dt>Beacon</dt><dd data-testid="crowd-beacon">{crowd()?.beacon === undefined ? '—' : crowd()!.beacon ? 'lit' : 'not played'}</dd></div>
            <div><dt>Most voices</dt><dd data-testid="crowd-voices">{crowd() ? `${crowd()!.peakVoices} of 16` : '—'}</dd></div>
            <div><dt>Most layers</dt><dd data-testid="crowd-layers">{crowd() ? `${crowd()!.peakLayers} of 64` : '—'}</dd></div>
          </dl>
          <button type="button" class="ab-play" data-run="crowd" onClick={crowdBurst}>Let the crowd walk past</button>
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
