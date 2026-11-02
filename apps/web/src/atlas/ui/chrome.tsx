import { For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import '@chatdom/ui/kit.css';
import './chrome.css';
import { DISTANCES, type Distance } from '../map/camera';
import type { PreviewWorld } from '../data/preview';
import { formatCount, scaleBar } from './format';
import { StampIcon } from './marks';

/** The carved map title and search, and under them the way into a kingdom; the dated survey seal is supplied by the scene. */
export function Cartouche(props: { world: PreviewWorld; children?: JSX.Element; seal?: JSX.Element; way?: JSX.Element }) {
  let header: HTMLElement | undefined;
  // The key below gives way to however tall the cartouche is (its live seal wraps): the page reads it as a variable.
  onMount(() => {
    if (!header || typeof ResizeObserver === 'undefined') return;
    const page = header.offsetParent as HTMLElement | null;
    const observer = new ResizeObserver(() => {
      if (header && page) page.style.setProperty('--atlas-cartouche-bottom', `${Math.ceil(header.offsetTop + header.offsetHeight)}px`);
    });
    observer.observe(header);
    onCleanup(() => {
      observer.disconnect();
      page?.style.removeProperty('--atlas-cartouche-bottom');
    });
  });
  return (
    <header ref={(element) => (header = element)} class="atlas-cartouche cd-plate">
      <div class="atlas-cartouche-heading">
        <span class="atlas-cartouche-ornament" aria-hidden="true">
          <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="14" /><circle cx="20" cy="20" r="8" /><path d="M20 2v36M2 20h36M7.3 7.3l25.4 25.4M32.7 7.3 7.3 32.7" /><path class="atlas-cartouche-needle" d="m20 5 2.4 12.6L35 20l-12.6 2.4L20 35l-2.4-12.6L5 20l12.6-2.4z" /></svg>
        </span>
        <h1 class="atlas-title">Chatdom <span>Atlas</span></h1>
        {props.seal}
      </div>
      <div class="atlas-cartouche-search">{props.children}</div>
      {props.way}
    </header>
  );
}

function Icon(props: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={props.d} /></svg>;
}

const DISTANCE_LABELS: Record<Distance, string> = { world: 'World', continent: 'Continent', realm: 'Realm', kingdom: 'Kingdom' };

/**
 * Zoom in and out around the middle of the free map, the four distances as a ladder of notches between them (the
 * nearest at the top, as zooming in climbs), and the whole map. Every control is a real button for keys and readers.
 */
export function Controls(props: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onHome: () => void;
  onDistance: (distance: Distance) => void;
  distance: Distance;
  canZoomIn: boolean;
  canZoomOut: boolean;
  children?: JSX.Element;
}) {
  return (
    <div class="atlas-controls" role="group" aria-label="Map view">
      <button type="button" on:click={() => props.onZoomIn()} disabled={!props.canZoomIn} aria-label="Zoom in" title="Zoom in (+)"><Icon d="M12 5v14M5 12h14" /></button>
      <div class="atlas-ladder" role="group" aria-label="Distance">
        <For each={[...DISTANCES].reverse()}>
          {(distance) => (
            <button
              type="button"
              class="atlas-notch"
              data-distance={distance}
              aria-pressed={props.distance === distance}
              aria-label={`${DISTANCE_LABELS[distance]} distance`}
              title={`${DISTANCE_LABELS[distance]} (${DISTANCES.indexOf(distance) + 1})`}
              on:click={() => props.onDistance(distance)}
            >
              <span aria-hidden="true" />
            </button>
          )}
        </For>
      </div>
      <button type="button" on:click={() => props.onZoomOut()} disabled={!props.canZoomOut} aria-label="Zoom out" title="Zoom out (−)"><Icon d="M5 12h14" /></button>
      <button type="button" on:click={() => props.onHome()} aria-label="Show the whole map" title="Whole map (0)"><Icon d="M4 11.5L12 5l8 6.5M6.5 10v8.5h11V10M10 18.5v-5h4v5" /></button>
      {props.children}
    </div>
  );
}

export function Compass(props: { size: number }) {
  return <div class="atlas-compass" aria-hidden="true"><StampIcon group="compass" width={props.size} /></div>;
}

/** Map units are leagues: a capital's holding is twelve leagues across. */
export function ScaleBar(props: { scale: number; distance: Distance }) {
  const bar = () => scaleBar(props.scale);
  return (
    <div class="atlas-scalebar" aria-label={`Scale: ${bar().units} leagues, ${DISTANCE_LABELS[props.distance].toLowerCase()} distance`} role="img">
      <div class="atlas-scalebar-bar" style={{ width: `${bar().px}px` }}><span /><span /></div>
      <span class="atlas-scalebar-text">{formatCount(bar().units)} {bar().units === 1 ? 'league' : 'leagues'}<span class="atlas-scalebar-distance"> · {DISTANCE_LABELS[props.distance]}</span></span>
    </div>
  );
}

export function Notice(props: { children: unknown; action?: { label: string; run: () => void } | undefined; onDismiss?: () => void }) {
  return (
    <div class="atlas-notice" role="status">
      <span>{props.children as string}</span>
      <Show when={props.action}>{(action) => <button type="button" on:click={() => action().run()}>{action().label}</button>}</Show>
      <Show when={props.onDismiss}>{(dismiss) => <button type="button" class="atlas-notice-x" aria-label="Dismiss" on:click={() => dismiss()()}>×</button>}</Show>
    </div>
  );
}
