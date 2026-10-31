import { Show, createSignal, onCleanup } from 'solid-js';
import { galleryWords } from './copy';
import { Glyph } from './glyphs';
import { DuskCourtGuide } from './guide';
import type { CampfirePublicView, CampfireSessionPort } from './ports';
import { Nameplates, PhasePlate, SourceRibbon, StageFailure, WitnessedLine, runStage, type CampfireClock } from './ui';
import './campfire.css';

/**
 * The campfire as a walker sees it: the clearing, the circle's names, what the fire is doing now
 * and how Dusk Court works. It reads the public view only; a seated person's private hand is a
 * separate surface bound to their own authenticated envelope.
 */
export function CampfireSurface(props: { session: CampfireSessionPort; clock: CampfireClock; still?: boolean; guide?: 'open' | 'closed' }) {
  let host: HTMLDivElement | undefined;
  const [view, setView] = createSignal<CampfirePublicView | null>(null);
  onCleanup(props.session.subscribePublic(setView));
  const stage = runStage({ host: () => host!, framing: 'page', surface: 'circle', label: 'The campfire at the edge of the Wilds', view, clock: props.clock, still: props.still ?? false });
  const between = () => { const l = view()?.lifecycle; return l === 'closed' || l === 'gathering' || l === 'seating'; };
  const [guide, setGuide] = createSignal<boolean | null>(props.guide === undefined ? null : props.guide === 'open');
  const guideOpen = () => guide() ?? between();
  return <div class="campfire campfire--page" data-campfire-surface="circle" data-campfire-origin={props.session.origin} data-campfire-state={view()?.lifecycle}>
    <div class="campfire-stage" ref={element => { host = element; }} />
    <div class="campfire-shade" aria-hidden="true" />
    <Show when={view()}>{v => <>
      <Nameplates anchors={stage.anchors()} view={v()} />
      <header class="campfire-heading">
        <p class="campfire-eyebrow">{v().kingdom.name} · The campfire</p>
        <h1>At the edge of the Wilds</h1>
      </header>
      <SourceRibbon origin={v().origin} detail="Development cast · no real people" />
      <div class="campfire-dock" classList={{ 'has-guide': guideOpen() }}>
        <Show when={guideOpen()}><DuskCourtGuide id="campfire-guide" class="campfire-guide--dock" /></Show>
        <div class="campfire-dock-main">
          <PhasePlate view={v()} now={stage.now()} />
          <WitnessedLine view={v()} />
          <Show when={galleryWords(v())}>{words => <p class="campfire-gallery-hint"><Glyph name="ember" class="campfire-gallery-mark" />{words()}</p>}</Show>
          <button type="button" class="campfire-button" aria-expanded={guideOpen()} aria-controls="campfire-guide" onClick={() => setGuide(!guideOpen())}>
            <Glyph name="lantern" class="campfire-button-mark" />{guideOpen() ? 'Fold the rules away' : 'How Dusk Court works'}
          </button>
        </div>
      </div>
    </>}</Show>
    <Show when={stage.failure()}>{message => <StageFailure message={message()} />}</Show>
  </div>;
}
