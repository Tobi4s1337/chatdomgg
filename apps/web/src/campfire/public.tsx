import { Show, createSignal, onCleanup } from 'solid-js';
import { galleryWords } from './copy';
import { Glyph } from './glyphs';
import type { CampfireOrigin, CampfirePublicView, CampfireSessionPort } from './ports';
import { Nameplates, PhasePlate, SourceRibbon, StageFailure, WitnessedLine, runStage, type CampfireClock } from './ui';
import './campfire.css';

/*
 * The public-only stream entry. It accepts a source of `CampfirePublicView` and nothing else: no
 * private envelope type, no hide-secrets flag, and no import of the private hand. What a stream
 * shows is exactly what the Gallery may know.
 */

export interface CampfirePublicSource {
  readonly origin: CampfireOrigin;
  subscribe(listener: (view: CampfirePublicView) => void): () => void;
}

/** Narrows a session to its public half before it reaches a broadcast surface. */
export function publicSource(session: Pick<CampfireSessionPort, 'origin' | 'subscribePublic'>): CampfirePublicSource {
  return { origin: session.origin, subscribe: listener => session.subscribePublic(listener) };
}

export function CampfireStream(props: { source: CampfirePublicSource; clock: CampfireClock; still?: boolean }) {
  let host: HTMLDivElement | undefined;
  const [view, setView] = createSignal<CampfirePublicView | null>(null);
  onCleanup(props.source.subscribe(setView));
  const stage = runStage({ host: () => host!, framing: 'stream', surface: 'stream', label: 'The campfire at the edge of the Wilds, on stream', view, clock: props.clock, still: props.still ?? false });
  return <div class="campfire campfire--stream" data-campfire-surface="stream" data-campfire-origin={props.source.origin}>
    <div class="campfire-stage" ref={element => { host = element; }} />
    <div class="campfire-shade" aria-hidden="true" />
    <Show when={view()}>{v => <>
      <Nameplates anchors={stage.anchors()} view={v()} compact />
      <div class="campfire-stream-caption">
        <PhasePlate view={v()} now={stage.now()} class="campfire-plate--stream" />
        <WitnessedLine view={v()} class="campfire-witnessed--stream" />
        <Show when={galleryWords(v())}>{words => <p class="campfire-gallery-hint"><Glyph name="ember" class="campfire-gallery-mark" />{words()}</p>}</Show>
      </div>
      <SourceRibbon origin={v().origin} detail="Development cast · no real people" />
    </>}</Show>
    <Show when={stage.failure()}>{message => <StageFailure message={message()} />}</Show>
  </div>;
}
