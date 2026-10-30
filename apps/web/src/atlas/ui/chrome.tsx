import { Show } from 'solid-js';
import { PREVIEW_LABEL, type PreviewWorld } from '../data/preview';
import { formatCount, formatDayRange, scaleBar } from './format';
import { StampIcon } from './marks';

/** The title cartouche: what this is, that it is a survey preview, and when it was observed. */
export function Cartouche(props: { world: PreviewWorld }) {
  const w = () => props.world;
  return (
    <header class="atlas-cartouche">
      <p class="atlas-eyebrow">Chatdom</p>
      <h1 class="atlas-title">The Atlas of Kingdoms</h1>
      <div class="atlas-flourish" aria-hidden="true"><span /><i /><span /></div>
      <p class="atlas-preview-label">{PREVIEW_LABEL}</p>
      <p class="atlas-cartouche-facts">
        <span>{formatCount(w().counts.mapped)} channels in {w().counts.languages} tongues,</span>
        <span>observed {formatDayRange(w().window.firstObservationAt, w().window.lastObservationAt)}</span>
      </p>
    </header>
  );
}

function Icon(props: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={props.d} /></svg>;
}

export function Controls(props: { onZoomIn: () => void; onZoomOut: () => void; onHome: () => void; canZoomIn: boolean; canZoomOut: boolean }) {
  return (
    <div class="atlas-controls" role="group" aria-label="Map view">
      <button type="button" onClick={() => props.onZoomIn()} disabled={!props.canZoomIn} aria-label="Zoom in" title="Zoom in (+)"><Icon d="M12 5v14M5 12h14" /></button>
      <button type="button" onClick={() => props.onZoomOut()} disabled={!props.canZoomOut} aria-label="Zoom out" title="Zoom out (−)"><Icon d="M5 12h14" /></button>
      <button type="button" onClick={() => props.onHome()} aria-label="Show the whole map" title="Whole map (0)"><Icon d="M4 11.5L12 5l8 6.5M6.5 10v8.5h11V10M10 18.5v-5h4v5" /></button>
    </div>
  );
}

export function Compass(props: { size: number }) {
  return <div class="atlas-compass" aria-hidden="true"><StampIcon group="compass" width={props.size} /></div>;
}

/** Map units are leagues: a capital's holding is twelve leagues across. */
export function ScaleBar(props: { scale: number }) {
  const bar = () => scaleBar(props.scale);
  return (
    <div class="atlas-scalebar" aria-label={`Scale: ${bar().units} leagues`} role="img">
      <div class="atlas-scalebar-bar" style={{ width: `${bar().px}px` }}><span /><span /></div>
      <span class="atlas-scalebar-text">{formatCount(bar().units)} {bar().units === 1 ? 'league' : 'leagues'}</span>
    </div>
  );
}

export function Notice(props: { children: unknown; action?: { label: string; run: () => void } | undefined; onDismiss?: () => void }) {
  return (
    <div class="atlas-notice" role="status">
      <span>{props.children as string}</span>
      <Show when={props.action}>{(action) => <button type="button" onClick={() => action().run()}>{action().label}</button>}</Show>
      <Show when={props.onDismiss}>{(dismiss) => <button type="button" class="atlas-notice-x" aria-label="Dismiss" onClick={() => dismiss()()}>×</button>}</Show>
    </div>
  );
}
