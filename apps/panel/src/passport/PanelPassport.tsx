// The passport in the panel: the viewer's own worn book lying open on the walnut under a lamp, one leaf at a time,
// in the 318 x 496 slot under the video. The book, its states and its reading are the shared passport craft; this
// view gives it the panel's room (a slim head, thumb tabs down the fore-edge, one stamp to a leaf so every name
// reads whole) and never decides anything about whose book it is. Main binds the transport and the mount.
import { createEffect, For, Show, type JSX } from 'solid-js';
import {
  PassportReading, createPassportReading,
  type PassportBookProps, type PassportDisclosureView, type PassportReadState, type PassportSession, type PassportTransport,
} from '@chatdom/ui/passport/live';
import { PANEL_DENSITY } from './model';
import './panel-passport.css';

export interface PanelPassportProps {
  /**
   * Reads the passport. A different transport is a different subject: the reading closes, drops every late reply and
   * starts again on the closed book, so nothing of the previous holder stays on the leaf.
   */
  readonly transport: PassportTransport;
  /** Kingdom names the panel already shows publicly beside the book (the card's disclosed homes). */
  readonly places?: ReadonlyMap<string, string>;
  /**
   * The viewer's card disclosure as the backend last projected it (`passportDisclosure`). Hidden closes the book
   * without a read, a newer revision reads a fresh snapshot, an older one is ignored. Without it the book is read once.
   */
  readonly disclosure?: PassportDisclosureView;
  /** Back to the kingdom. Without it the view has no way out of its own and shows no back button. */
  readonly onClose?: () => void;
  readonly backLabel?: string;
  /** 0 is the closed cover, where the panel opens by default; 1 is the flyleaf. */
  readonly initialView?: number;
  /** Every state the reading passes through, for a host that waits on the first settled one. */
  readonly onState?: (state: PassportReadState) => void;
  readonly title?: string;
  /**
   * A reading the host already holds for this same transport (the card reads the passport's keepsakes before the page
   * is turned). The view then shows that reading instead of opening a second one.
   */
  readonly reading?: { readonly state: () => PassportReadState; readonly session: PassportSession };
  /** Told after every page the reader turns, so the host can give it a sound. */
  readonly onTurn?: PassportBookProps['onTurn'];
}

export function PanelPassport(props: PanelPassportProps): JSX.Element {
  // Keyed by transport: a new subject is a new reading, never the old one with new words poured in.
  return <Show when={props.transport} keyed>{transport => <PanelReading {...props} transport={transport} />}</Show>;
}

function PanelReading(props: PanelPassportProps): JSX.Element {
  const { state, session } = props.reading ?? createPassportReading(props.transport, { disclosure: () => props.disclosure });
  createEffect(() => props.onState?.(state()));
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !props.onClose) return;
    event.preventDefault();
    event.stopPropagation();
    props.onClose();
  };
  return <section class="cpp" aria-labelledby="cpp-title" data-state={state().kind} onKeyDown={onKey}>
    <LampLight />
    <header class="cpp-head">
      <Show when={props.onClose}>{close =>
        <button type="button" class="cpp-back" onClick={() => close()()} data-autofocus>
          <svg class="cpp-back-glyph" viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 3 5.5 8l5 5" /></svg>
          <span>{props.backLabel ?? 'The kingdom'}</span>
        </button>}
      </Show>
      <h2 id="cpp-title" class="cpp-title">{props.title ?? 'Your passport'}</h2>
    </header>
    <div class="cpp-desk">
      <PassportReading state={state()} layout="page" density={PANEL_DENSITY} initialView={props.initialView ?? 0} class="cpp-book"
        {...(props.places ? { places: props.places } : {})} onMore={collection => session.more(collection)} onRetry={() => session.open()}
        {...(props.onTurn ? { onTurn: props.onTurn } : {})} />
    </div>
  </section>;
}

/**
 * The lamp the book is read under: a warm pool across the walnut, a soft shaft through it and a few motes of dust
 * turning in the light. Still under reduced motion; never over the words.
 */
function LampLight(): JSX.Element {
  return <div class="cpp-lamp" aria-hidden="true">
    <span class="cpp-shaft" />
    <span class="cpp-motes"><For each={[0, 1, 2, 3, 4, 5, 6, 7]}>{i => <i style={{ '--i': i }} />}</For></span>
  </div>;
}
