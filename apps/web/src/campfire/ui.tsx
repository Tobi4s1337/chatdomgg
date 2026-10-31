import { For, Show, createSignal, onCleanup, onMount, type Accessor } from 'solid-js';
import { clockText, remaining, ROLE_NAMES, stateWords } from './copy';
import { Glyph } from './glyphs';
import type { CampfireOrigin, CampfirePublicView } from './ports';
import { createCampfireStage, type ScreenAnchor, type StageFraming } from './stage';

/*
 * Public-safe pieces shared by the circle page and the stream: the stage runner, nameplates, the
 * phase plate and the source ribbon. Everything here reads only `CampfirePublicView`.
 */

declare global {
  interface Window {
    __chatdomReady?: boolean;
    __chatdomCampfire?: { readonly surface: string; readonly origin: CampfireOrigin; readonly lifecycle: string; readonly seats: number; readonly revision: number };
    __chatdomCampfireError?: string;
  }
}

export interface CampfireClock { now(): number }

/** Mounts the stage in `host` and draws the latest public view every frame (or once, when still). */
export function runStage(options: { host: () => HTMLElement; framing: StageFraming; surface: string; label: string; view: Accessor<CampfirePublicView | null>; clock: CampfireClock; still: boolean }): { anchors: Accessor<readonly ScreenAnchor[]>; failure: Accessor<string | null>; now: Accessor<number> } {
  const [anchors, setAnchors] = createSignal<readonly ScreenAnchor[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [now, setNow] = createSignal(options.clock.now());
  let disposed = false, frame = 0, ready = false;
  onMount(() => {
    window.__chatdomReady = false;
    const host = options.host();
    const stage = createCampfireStage(host, { framing: options.framing, label: options.label });
    const fit = (): void => stage.resize(host.clientWidth, host.clientHeight);
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    fit();
    const draw = async (): Promise<void> => {
      const view = options.view();
      if (!view || disposed) return;
      const at = options.clock.now();
      await stage.render(view, at);
      if (disposed) return;
      setNow(at);
      setAnchors(stage.project());
      if (!ready) {
        await stage.ready;
        await stage.render(view, at);
        if (disposed) return;
        ready = true;
        setAnchors(stage.project());
        await new Promise(resolve => requestAnimationFrame(resolve));
        window.__chatdomCampfire = { surface: options.surface, origin: view.origin, lifecycle: view.lifecycle, seats: view.seats.length, revision: view.revision };
        window.__chatdomReady = true;
      }
    };
    const loop = (): void => {
      if (disposed) return;
      draw().then(() => { if (!options.still && !disposed) frame = requestAnimationFrame(loop); }, error => {
        const message = error instanceof Error ? error.message : String(error);
        window.__chatdomCampfireError = message;
        setFailure(message);
        console.error(message);
      });
    };
    loop();
    onCleanup(() => { disposed = true; cancelAnimationFrame(frame); observer.disconnect(); stage.dispose(); window.__chatdomReady = false; });
  });
  return { anchors, failure, now };
}

/** Names over heads. A plate carries only the public label, a mark for the Magistrate or a text seat, and a revealed role. */
export function Nameplates(props: { anchors: readonly ScreenAnchor[]; view: CampfirePublicView; compact?: boolean }) {
  const seatOf = (seat: number) => props.view.seats.find(s => s.seat === seat);
  return <div class="campfire-nameplates" classList={{ 'campfire-nameplates--compact': props.compact }} aria-hidden="true">
    <For each={props.anchors.filter(a => a.visible)}>{anchor => {
      const seat = () => seatOf(anchor.seat);
      return <div class="campfire-nameplate" classList={{ 'is-magistrate': anchor.kind === 'magistrate', 'is-out': seat()?.lantern === 'out', 'is-away': seat()?.presence === 'away' }} style={{ transform: `translate(${anchor.x.toFixed(1)}px, ${anchor.y.toFixed(1)}px) translate(-50%, -100%)` }}>
        <Show when={anchor.kind === 'magistrate'}><Glyph name="magistrate" class="campfire-nameplate-mark" /></Show>
        <Show when={anchor.kind !== 'magistrate' && seat()?.medium === 'text'}><Glyph name="quill" class="campfire-nameplate-mark" /></Show>
        <span class="campfire-nameplate-name">{anchor.label}</span>
        <Show when={seat()?.revealed}>{role => <span class="campfire-nameplate-role">{ROLE_NAMES[role()]}</span>}</Show>
        <Show when={seat()?.presence === 'away'}><span class="campfire-nameplate-role">holding seat</span></Show>
      </div>;
    }}</For>
  </div>;
}

/** The phase and its clock, carved into a small plate. */
export function PhasePlate(props: { view: CampfirePublicView; now: number; class?: string }) {
  const words = () => stateWords(props.view);
  const left = () => remaining(props.view, props.now);
  return <div class={`campfire-plate ${props.class ?? ''}`}>
    <p class="campfire-plate-eyebrow">{words().eyebrow}</p>
    <div class="campfire-plate-title">
      <h2>{words().title}</h2>
      <Show when={left() !== null}><span class="campfire-clock" role="timer" aria-label="Time left in this phase">{clockText(left()!)}</span></Show>
    </div>
    <p class="campfire-plate-line">{words().line}</p>
  </div>;
}

/** The latest approved, witnessed line, if any. */
export function WitnessedLine(props: { view: CampfirePublicView; class?: string }) {
  const cue = () => props.view.cues.at(-1);
  return <Show when={cue()}>{c => <p class={`campfire-witnessed ${props.class ?? ''}`}><Glyph name="ember" class="campfire-witnessed-mark" />{c().text}</p>}</Show>;
}

export function SourceRibbon(props: { origin: CampfireOrigin; detail: string }) {
  return <Show when={props.origin === 'SIMULATED'}>
    <p class="campfire-source" role="note"><b>SIMULATED</b><span>{props.detail}</span></p>
  </Show>;
}

export function StageFailure(props: { message: string }) {
  return <div class="campfire-failure" role="alert"><strong>The campfire could not be drawn</strong><p>{props.message}</p></div>;
}
