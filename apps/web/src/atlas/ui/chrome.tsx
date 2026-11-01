import { For, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { DISTANCES, type Distance } from '../map/camera';
import { PREVIEW_LABEL, type PreviewWorld } from '../data/preview';
import { formatCount, formatDayRange, scaleBar } from './format';
import { StampIcon } from './marks';

/** The title cartouche: what this is, that it is a survey preview, and when it was observed. */
export function Cartouche(props: { world: PreviewWorld; children?: JSX.Element }) {
  const w = () => props.world;
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
    <header ref={(element) => (header = element)} class="atlas-cartouche">
      <p class="atlas-eyebrow">Chatdom</p>
      <h1 class="atlas-title">The Atlas of Kingdoms</h1>
      <div class="atlas-flourish" aria-hidden="true"><span /><i /><span /></div>
      <p class="atlas-preview-label">{PREVIEW_LABEL}</p>
      <p class="atlas-cartouche-facts">
        <span>{formatCount(w().counts.mapped)} channels in {w().counts.languages} tongues,</span>
        <span>observed {formatDayRange(w().window.firstObservationAt, w().window.lastObservationAt)}</span>
      </p>
      {props.children}
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
