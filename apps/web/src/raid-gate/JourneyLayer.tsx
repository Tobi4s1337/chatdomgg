/**
 * The journey over the walking view (Moments.md §7; spec 23 R6): when the authority holds a place for this person,
 * the kingdom washes into ink, the map rises (atlas-map's gate mode, at the pace of the authority's answers) and the
 * road is drawn; once the destination acknowledges the step, the page walks in at its gate. A page that opens just
 * after a step through starts on the drawing and lets it fade into the world.
 *
 * The layer moves nobody. It reads the gate controller's snapshot through `journeyScene` and hands the march call a
 * place to speak from while the world is inked. The Atlas draws the rise and the road only when, as the journey
 * begins, its map is drawn and can place both ends (`mapCarries`; the walk warms it once the walker may travel);
 * otherwise, and without the Atlas in the build, the road is inked on the parchment between the two seals. One
 * journey never switches between the two.
 */
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { KingdomId } from '../../../api/src/raid-gate/contracts';
import type { GateSnapshot, JourneySnapshot } from './controller';
import {
  arrivingHere, clearJourneyMemo, journeyScene, readJourneyMemo, stepThroughAt, walkPath, writeJourneyMemo,
  type JourneyMemo, type JourneyScene,
} from './journey';
import { marchDestinationName } from './march-call';
import { Seal } from './Seal';
import './journey.css';

/** How long the drawing takes to fade into the world after walking in. */
const ARRIVAL_FADE_MS = 1_600;
/** How long the ink takes to leave when a journey turns back before stepping through. */
const RETURN_FADE_MS = 700;

type LayerState = 'idle' | 'road' | 'through' | 'arriving' | 'leaving';

export type JourneyLayerOptions = Readonly<{
  /** The kingdom this page shows. */
  here: KingdomId;
  storage: Storage | null;
  clock: () => number;
  /** Walks the page on; defaults to `location.assign`. */
  navigate?: (path: string) => void;
  reducedMotion?: boolean;
  parent?: HTMLElement;
  /** Whether the Atlas in `mapHost` can carry this journey's road right now. Asked once, as its road begins. */
  mapCarries?: (journey: JourneySnapshot) => boolean;
}>;

export type JourneyLayer = Readonly<{
  /** Where the Atlas mounts its gate mode: the whole window, shown only while the road is drawn. */
  mapHost: HTMLElement;
  /** Where the march call speaks from while the world is inked. */
  wordsHost: HTMLElement;
  /** True while the layer covers the world (the march call belongs in `wordsHost` meanwhile). */
  covering(): boolean;
  onCovering(listener: (covering: boolean) => void): () => void;
  follow(snapshot: GateSnapshot): void;
  dispose(): void;
}>;

/** The two ends of the road as the parchment draws them. */
type Ends = Readonly<{ from: Readonly<{ id: string; name: string }>; to: Readonly<{ id: string; name: string; waiting: boolean }> }>;

function endsOf(s: GateSnapshot, scene: JourneyScene): Ends | null {
  if (scene.kind === 'none') return null;
  const j = scene.journey;
  const away = { id: j.kind === 'return' ? j.from : j.to, name: j.destination ? marchDestinationName(j.destination) : 'a neighbouring kingdom' };
  const home = { id: s.source.kingdomId, name: s.source.name };
  return j.kind === 'return'
    ? { from: away, to: { ...home, waiting: false } }
    : { from: home, to: { ...away, waiting: false } };
}

export function mountJourneyLayer(options: JourneyLayerOptions): JourneyLayer {
  const navigate = options.navigate ?? ((path: string) => location.assign(path));
  const root = document.createElement('div');
  root.className = 'rj-root';
  (options.parent ?? document.body).append(root);
  const mapHost = document.createElement('div');
  mapHost.className = 'rj-map';
  const wordsHost = document.createElement('div');
  wordsHost.className = 'rj-words';

  const [state, setState] = createSignal<LayerState>('idle');
  const [stage, setStage] = createSignal<'rise' | 'road' | 'drawing' | 'through'>('rise');
  const [ends, setEnds] = createSignal<Ends | null>(null);
  /** Which surface this journey's road is drawn on, chosen as its road begins. */
  const [map, setMap] = createSignal<'atlas' | 'paper'>('paper');
  const listeners = new Set<(covering: boolean) => void>();
  let roadShownAt: number | null = null, stepping: ReturnType<typeof setTimeout> | undefined, fading: ReturnType<typeof setTimeout> | undefined;
  let disposed = false, lastCovering = false;

  const covering = () => state() === 'road' || state() === 'through' || state() === 'arriving';
  const tell = () => {
    const now = covering();
    if (now === lastCovering) return;
    lastCovering = now;
    for (const listener of [...listeners]) listener(now);
  };
  const go = (next: LayerState) => { setState(next); tell(); };

  // A page that opens just after its person stepped through starts on the drawing and lets it fade into the world.
  const memo = readJourneyMemo(options.storage, options.clock());
  if (memo && arrivingHere(memo, options.here, options.clock())) {
    writeJourneyMemo(options.storage, { ...memo, to: null });
    setEnds({ from: { id: memo.home.kingdomId === options.here ? '' : memo.home.kingdomId, name: '' }, to: { id: options.here, name: '', waiting: false } });
    setStage('through');
    go('arriving');
    fading = setTimeout(() => { if (!disposed) { go('idle'); setEnds(null); } }, options.reducedMotion ? 200 : ARRIVAL_FADE_MS);
  }

  function remember(s: GateSnapshot, to: KingdomId | null): void {
    const held = readJourneyMemo(options.storage, options.clock());
    const j = s.journey;
    // The gate a raid journey began at is this page's own; a journey home keeps the gate it began at.
    const home = j?.kind === 'raid' ? s.source : held?.home ?? s.source;
    const next: JourneyMemo = { version: 1, home, to, at: options.clock() };
    writeJourneyMemo(options.storage, next);
  }

  function follow(s: GateSnapshot): void {
    if (disposed) return;
    const scene = journeyScene(s, options.here);
    if (scene.kind === 'road') {
      if (state() !== 'road' && state() !== 'through') {
        clearTimeout(fading);
        setMap(options.mapCarries?.(scene.journey) ? 'atlas' : 'paper');
        roadShownAt = options.clock();
        remember(s, null);
        go('road');
      }
      setEnds(endsOf(s, scene));
      setStage(scene.stage);
      return;
    }
    if (scene.kind === 'through') {
      if (state() === 'through') return;
      clearTimeout(fading);
      setEnds(endsOf(s, scene));
      setStage('drawing');
      go('through');
      const at = stepThroughAt(roadShownAt, options.clock());
      stepping = setTimeout(() => {
        if (disposed) return;
        setStage('through');
        if (scene.home) clearJourneyMemo(options.storage);
        remember(s, scene.to);
        // Let the last of the road be seen before the page goes.
        setTimeout(() => { if (!disposed) navigate(walkPath(scene.to)); }, options.reducedMotion ? 0 : 450);
      }, Math.max(0, at - options.clock()));
      return;
    }
    // Nothing under way: a road that turned back washes out of the world again.
    if (state() === 'road') {
      roadShownAt = null;
      go('leaving');
      fading = setTimeout(() => { if (!disposed && state() === 'leaving') { go('idle'); setEnds(null); } }, options.reducedMotion ? 150 : RETURN_FADE_MS);
    }
  }

  const unrender = render(() => <JourneyView state={state()} stage={stage()} ends={ends()} map={map()}
    mapHost={mapHost} wordsHost={wordsHost} reduced={options.reducedMotion === true} />, root);

  return {
    mapHost, wordsHost,
    covering,
    onCovering(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    follow,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(stepping); clearTimeout(fading);
      listeners.clear();
      unrender();
      root.remove();
    },
  };
}

/** The road's line across the parchment, gently bowed, with a little hand in it. */
const ROAD_PATH = 'M 120 210 C 260 120, 380 300, 520 200 S 760 120, 880 190';
const TORCHES = [0, 1, 2, 3, 4];
/** How much of the road is inked at each stage (the CSS draws the same share); the column rides only what is drawn. */
const drawn = (stage: string) => stage === 'rise' ? 0.16 : stage === 'road' ? 0.72 : 1;

function JourneyView(props: { state: LayerState; stage: string; ends: Ends | null; map: 'atlas' | 'paper'; mapHost: HTMLElement; wordsHost: HTMLElement; reduced: boolean }) {
  onCleanup(() => { props.mapHost.remove(); props.wordsHost.remove(); });
  return <div class="rj-layer" data-state={props.state} data-stage={props.stage} data-map={props.map}
    data-reduced={props.reduced ? '' : undefined} aria-hidden={props.state === 'idle' ? 'true' : undefined}>
    <div class="rj-ink" />
    <div class="rj-paper" />
    {props.mapHost}
    <Show when={props.map === 'paper' && props.ends}>{ends =>
      <div class="rj-road" role="img" aria-label={`The road from ${ends().from.name || 'home'} to ${ends().to.name || 'the gate'}`}>
        <svg viewBox="0 0 1000 400" aria-hidden="true">
          <defs>
            <radialGradient id="rj-flame"><stop offset="0" stop-color="#fff3c4" /><stop offset=".45" stop-color="#f6b44c" /><stop offset="1" stop-color="#e0702a" stop-opacity="0" /></radialGradient>
          </defs>
          <path class="rj-road-shadow" d={ROAD_PATH} />
          <path class="rj-road-line" d={ROAD_PATH} pathLength="100" />
          {/* The torch column rides the road while it is drawn. */}
          <g class="rj-column">
            <For each={TORCHES}>{index => <g>
              <circle r="15" fill="url(#rj-flame)" opacity=".55" />
              <circle r="4.2" fill="#ffe7a8" />
              <animateMotion dur={`${(5.5 * drawn(props.stage)).toFixed(2)}s`} repeatCount="indefinite" begin={`${-index * 0.42}s`} path={ROAD_PATH}
                keyPoints={`0;${drawn(props.stage)}`} keyTimes="0;1" calcMode="linear" />
            </g>}</For>
          </g>
        </svg>
        <Show when={ends().from.id}><div class="rj-end rj-from"><Seal kingdomId={ends().from.id} size={84} /><span>{ends().from.name}</span></div></Show>
        <div class="rj-end rj-to"><Seal kingdomId={ends().to.id} size={96} wax={ends().to.waiting ? 'umber' : 'crimson'} /><span>{ends().to.name}</span></div>
      </div>
    }</Show>
    {props.wordsHost}
  </div>;
}
