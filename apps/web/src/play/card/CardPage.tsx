import { createSignal, For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { anvilMark, hearthMark } from '../ledger/marks';
import { registeredForgedSource, type ForgedThing, type PlayContext } from '../slots';
import { cardDate, cardView, loadCitizenFacts, loadForged, type CitizenFactsResult } from './facts';
import './card.css';

/**
 * "Your card": the citizen plaque in the ledger. Walnut with brass pins, the person's Twitch picture in a brass
 * rim, their approved name inlaid in brass, and a parchment inlay with the homes the realm has granted them. Under
 * it, only when the Forge says so, a shelf of what they forged. Every line has a real source; nothing is padded.
 */
export function CardPage(props: {
  ctx: PlayContext;
  cue: (sound: 'wood' | 'brass' | 'parchment') => void;
  reducedMotion: () => boolean;
  load?: typeof loadCitizenFacts;
}): JSX.Element {
  const [result, setResult] = createSignal<CitizenFactsResult | null>(null);
  const [forged, setForged] = createSignal<readonly ForgedThing[] | null>(null);
  const view = () => cardView(props.ctx.self, result());

  onMount(() => {
    const controller = new AbortController();
    onCleanup(() => controller.abort());
    const load = props.load ?? loadCitizenFacts;
    load(props.ctx.kingdomId, controller.signal).then(next => {
      if (controller.signal.aborted) return;
      setResult(next);
      if (next.kind === 'ready') props.cue('wood');
    }, () => { if (!controller.signal.aborted) setResult({ kind: 'unavailable' }); });
    void loadForged(registeredForgedSource(), props.ctx, controller.signal).then(things => { if (!controller.signal.aborted) setForged(things); });
  });

  return <div class="pl-card" data-state={view().state} data-reduced={props.reducedMotion() ? 'true' : undefined}>
    <article class="pl-card-plaque" aria-label={view().name ? `The citizen card of ${view().name}` : 'A citizen card'}>
      <span class="pl-card-pin" data-at="tl" /><span class="pl-card-pin" data-at="tr" />
      <span class="pl-card-pin" data-at="bl" /><span class="pl-card-pin" data-at="br" />
      <div class="pl-card-face">
        <Portrait picture={view().picture} initial={view().initial} />
        <div class="pl-card-words">
          <Show when={view().name} fallback={<p class="pl-card-lead">{view().note}</p>}>{name => <>
            <h3 class="pl-card-name" ref={fitName}>{name()}</h3>
            <span class="pl-card-rule" aria-hidden="true"><span class="pl-card-rule-gem" /></span>
            <Show when={view().since} fallback={<p class="pl-card-note" aria-live="polite">{view().note}</p>}>{since => <p class="pl-card-since">{keepDate(since())}</p>}</Show>
          </>}</Show>
        </div>
      </div>
      <Show when={view().homes.length > 0}>
        <div class="pl-card-inlay">
          <h4 class="pl-card-label">{view().homes.length > 1 ? 'Homes' : 'Home'}</h4>
          <ul class="pl-card-homes" role="list" data-count={view().homes.length}>
            <For each={view().homes}>{(home, index) => <li class="pl-card-home" data-here={home.here ? 'true' : undefined} style={{ '--pl-card-i': index() }}>
              <span class="pl-card-home-mark">{hearthMark()}</span>
              <span class="pl-card-home-words">
                <span class="pl-card-street">{home.street}</span>
                <span class="pl-card-kingdom">{home.kingdom}</span>
              </span>
              <span class="pl-card-home-since"><span class="pl-card-home-since-word">granted</span> {keepDate(home.since)}</span>
            </li>}</For>
          </ul>
        </div>
      </Show>
    </article>
    <Show when={forged()}>{things => <Shelf things={things()} />}</Show>
  </div>;
}

/** A date never breaks across lines: '2 November 2026' stays whole. */
const keepDate = (words: string) => words.replace(/(\d{1,2}) (\p{L}+) (\d{4})/gu, '$1\u00a0$2\u00a0$3');

/**
 * A long name is set smaller until it fits on one line, down to two thirds of its size; past that it wraps. The
 * name is never cut off.
 */
function fitName(element: HTMLElement) {
  const fit = () => {
    element.style.removeProperty('--pl-card-fit');
    delete element.dataset.wrap;
    const room = element.clientWidth, needed = element.scrollWidth;
    if (!room || needed <= room + 1) return;
    const scale = Math.max(.66, Math.floor(room / needed * 100) / 100);
    element.style.setProperty('--pl-card-fit', String(scale));
    if (element.scrollWidth > element.clientWidth + 1) element.dataset.wrap = 'true';
  };
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  // The column's width, not the name's own box: the name's size never feeds back into what it is measured against.
  queueMicrotask(() => { fit(); observer?.observe(element.parentElement ?? element); });
  void document.fonts?.ready.then(fit);
  onCleanup(() => observer?.disconnect());
}

/** The round brass rim: their Twitch picture, or, without one, their initial cut into the wood. */
function Portrait(props: { picture: string | null; initial: string }): JSX.Element {
  const [broken, setBroken] = createSignal<string | null>(null);
  const shown = () => (props.picture && broken() !== props.picture ? props.picture : null);
  return <span class="pl-card-portrait" aria-hidden="true">
    <span class="pl-card-rim" />
    <span class="pl-card-well">
      <Show when={shown()} keyed fallback={<Show when={props.initial} fallback={<span class="pl-card-empty" />}>
        <span class="pl-card-initial">{props.initial}</span></Show>}>
        {src => <img class="pl-card-picture" src={src} alt="" referrerPolicy="no-referrer" decoding="async" draggable={false} onError={() => setBroken(src)} />}
      </Show>
    </span>
  </span>;
}

/** The shelf of forged pieces: a walnut plank, each piece standing on it with its plaque. */
function Shelf(props: { things: readonly ForgedThing[] }): JSX.Element {
  return <section class="pl-card-shelf" aria-labelledby="pl-card-shelf-title">
    <header class="pl-card-shelf-head">
      <span class="pl-card-shelf-mark">{anvilMark()}</span>
      <h4 class="pl-card-shelf-title" id="pl-card-shelf-title">Forged by you</h4>
    </header>
    <ul class="pl-card-pieces" role="list">
      <For each={props.things}>{(thing, index) => <Piece thing={thing} index={index()} />}</For>
    </ul>
  </section>;
}

const TILE_PX = 112;

function Piece(props: { thing: ForgedThing; index: number }): JSX.Element {
  const [painted, setPainted] = createSignal(typeof props.thing.paint === 'function');
  let canvas: HTMLCanvasElement | undefined;
  onMount(() => {
    if (!canvas || !props.thing.paint) return;
    const scale = Math.min(3, Math.max(1, globalThis.devicePixelRatio || 1));
    canvas.width = canvas.height = Math.round(TILE_PX * scale);
    try { props.thing.paint(canvas); } catch (error) {
      console.error(`The forged piece ${props.thing.id} could not be painted`, error);
      setPainted(false);
    }
  });
  return <li class="pl-card-piece" data-painted={painted() ? 'true' : 'false'} style={{ '--pl-card-i': props.index }}>
    <Show when={painted()}>
      <span class="pl-card-niche"><canvas ref={element => { canvas = element; }} class="pl-card-canvas" aria-hidden="true" /></span>
    </Show>
    <span class="pl-card-tag">
      <span class="pl-card-tag-title">{props.thing.title}</span>
      <Show when={props.thing.plaque.trim()}><span class="pl-card-tag-words">{props.thing.plaque}</span></Show>
      <span class="pl-card-tag-date">{cardDate(props.thing.forgedAt)}</span>
    </span>
  </li>;
}
